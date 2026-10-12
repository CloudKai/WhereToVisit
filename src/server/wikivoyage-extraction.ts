import "server-only";
import { createHash } from "node:crypto";
import type { ImportSourceEvidence, Mention } from "@/shared/contracts";
import { ImportFailure } from "./import-policy";
import type { WikiSource } from "./wikivoyage-fetch";

type Template = { start: number; end: number; content: string };
/** Conservative lexical subset. Balanced nesting is skipped, never interpreted as a plain label. */
function templates(text: string) {
  const found: Template[] = [];
  const excluded: { start: number; end: number }[] = [];
  let start = -1,
    depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0)
        throw new ImportFailure(
          "format-unsupported",
          "Unclosed source comment is unsupported.",
          false,
          true,
        );
      excluded.push({ start: i, end: end + 3 });
      i = end + 2;
      continue;
    }
    const protectedTag = text
      .slice(i)
      .match(/^<(nowiki|pre|source|syntaxhighlight)(?:\s[^>]*)?>/i);
    if (protectedTag) {
      const ending = new RegExp(`</${protectedTag[1]}\\s*>`, "ig");
      ending.lastIndex = i + protectedTag[0].length;
      const close = ending.exec(text);
      if (!close)
        throw new ImportFailure(
          "format-unsupported",
          "Unclosed protected source block is unsupported.",
          false,
          true,
        );
      excluded.push({ start: i, end: close.index + close[0].length });
      i = close.index + close[0].length - 1;
      continue;
    }
    if (text.startsWith("{{{", i))
      throw new ImportFailure(
        "format-unsupported",
        "Template-parameter source structures are unsupported.",
        false,
        true,
      );
    if (text.startsWith("{{", i)) {
      if (depth === 0) start = i;
      depth++;
      i++;
      continue;
    }
    if (text.startsWith("}}", i)) {
      if (depth === 0)
        throw new ImportFailure(
          "format-unsupported",
          "Unbalanced source templates are unsupported.",
          false,
          true,
        );
      depth--;
      if (depth === 0)
        found.push({ start, end: i + 2, content: text.slice(start + 2, i) });
      i++;
    }
  }
  if (depth)
    throw new ImportFailure(
      "format-unsupported",
      "Unclosed source templates are unsupported.",
      false,
      true,
    );
  return { found, excluded };
}
function templateFields(content: string) {
  // Protected/HTML spans are outside this conservative parameter subset.
  // Reject the template rather than interpret literal pipes as listing fields.
  if (/[<>]/.test(content)) return null;
  const fields: { text: string; offset: number }[] = [];
  let templates = 0,
    links = 0,
    start = 0;
  for (let index = 0; index < content.length; index++) {
    if (content.startsWith("<!--", index)) {
      const end = content.indexOf("-->", index + 4);
      if (end < 0) return null;
      index = end + 2;
      continue;
    }
    if (content.startsWith("{{", index)) {
      templates++;
      index++;
      continue;
    }
    if (content.startsWith("}}", index)) {
      if (!templates) return null;
      templates--;
      index++;
      continue;
    }
    if (content.startsWith("[[", index)) {
      links++;
      index++;
      continue;
    }
    if (content.startsWith("]]", index)) {
      if (!links) return null;
      links--;
      index++;
      continue;
    }
    if (content[index] === "|" && !templates && !links) {
      fields.push({ text: content.slice(start, index), offset: start });
      start = index + 1;
    }
  }
  if (templates || links) return null;
  fields.push({ text: content.slice(start), offset: start });
  return fields;
}
export function extractListings(
  jobId: string,
  sourceUrl: string,
  canonicalUrl: string,
  source: WikiSource,
) {
  const text = source.wikitext;
  if (Array.from(text).length > 50_000)
    throw new ImportFailure(
      "input-too-large",
      "The source exceeds the bounded extraction length.",
    );
  const scanned = templates(text);
  const ranges = [...scanned.found, ...scanned.excluded];
  const headings = [
    ...text.matchAll(/^(={2,6})\s*([^=\n]+?)\s*\1[ \t]*$/gm),
  ].filter(
    (match) =>
      !ranges.some(
        (range) => match.index >= range.start && match.index < range.end,
      ),
  );
  const sections: { start: number; end: number }[] = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    if (!/^(Eat|Drink)$/i.test(heading[2].trim())) continue;
    const next = headings
      .slice(i + 1)
      .find((candidate) => candidate[1].length <= heading[1].length);
    sections.push({
      start: heading.index + heading[0].length,
      end: next?.index ?? text.length,
    });
  }
  if (!sections.length)
    throw new ImportFailure(
      "format-unsupported",
      "No supported Eat or Drink sections were found. General prose is not analysed.",
      false,
      true,
    );
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  const normalizationVersion = "verbatim-decoded-api-wikitext-v1" as const;
  const evidence: ImportSourceEvidence = {
    id: `${jobId}-source`,
    sourceUrl,
    canonicalUrl,
    revision: String(source.revid),
    revisionUrl:
      source.dataKind === "fixture"
        ? null
        : `https://en.wikivoyage.org/w/index.php?oldid=${source.revid}`,
    historyUrl:
      source.dataKind === "fixture"
        ? null
        : `https://en.wikivoyage.org/w/index.php?title=${encodeURIComponent(source.title)}&action=history`,
    capturedAt: source.capturedAt,
    attribution:
      source.dataKind === "fixture"
        ? "Authored WhereToVisit development fixture (fictional source)"
        : `Wikivoyage contributors, ${source.title}`,
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    changes:
      "Listing names extracted verbatim; other article wording, links, prices and location fields were not interpreted.",
    normalizedSourceHash: hash,
    normalizationVersion,
    limits:
      "Historical listing labels only; no endorsement, current operation, branch, address, coordinates or rating established. Listing extraction does not confirm a branch. Optional sourced-shortlist matching requires separate user selection; live provider matching and Trip saving remain unavailable.",
  };
  const mentions: Mention[] = [];
  let skipped = false;
  const consumed: { start: number; end: number }[] = [];
  for (const template of scanned.found) {
    if (
      !sections.some(
        (section) =>
          template.start >= section.start && template.end <= section.end,
      )
    )
      continue;
    const content = template.content;
    const fields = templateFields(content);
    if (!fields || !/^(eat|drink)$/i.test(fields[0].text.trim())) {
      skipped = true;
      continue;
    }
    let name: { quote: string; start: number } | null = null;
    let invalid = false;
    for (const parameter of fields.slice(1)) {
      const field = parameter.text;
      const equal = field.indexOf("=");
      if (equal < 0 && field.trim()) invalid = true;
      if (equal >= 0 && field.slice(0, equal).trim().toLowerCase() === "name") {
        if (name) invalid = true;
        const value = field.slice(equal + 1);
        const quote = value.trim();
        if (
          !quote ||
          Array.from(quote).length > 280 ||
          /[{}[\]\n\r<>]/.test(quote)
        )
          invalid = true;
        name = {
          quote,
          start:
            template.start +
            2 +
            parameter.offset +
            equal +
            1 +
            value.indexOf(quote),
        };
      }
    }
    if (invalid || !name) {
      skipped = true;
      continue;
    }
    consumed.push(template);
    if (mentions.length >= 20) {
      skipped = true;
      continue;
    }
    const codePointStart = Array.from(text.slice(0, name.start)).length;
    const codePointEnd = codePointStart + Array.from(name.quote).length;
    if (
      Array.from(text).slice(codePointStart, codePointEnd).join("") !==
      name.quote
    )
      throw new ImportFailure(
        "evidence-invalid",
        "Original source evidence could not be validated.",
      );
    mentions.push({
      id: `${jobId}-mention-${mentions.length + 1}`,
      originalText: name.quote,
      nameHint: name.quote,
      placeId: null,
      sourceEvidenceId: evidence.id,
      resolutionStatus: "unresolved",
      cityHint: { value: "Shanghai", origin: "selected-city" },
      branchHint: null,
      addressHint: null,
      candidates: [],
      extraction: {
        method: "wikivoyage-eat-drink-listing-name",
        version: "1",
        canonicalUrl,
        revision: String(source.revid),
        normalizedSourceHash: hash,
        normalizationVersion,
        quote: name.quote,
        codePointStart,
        codePointEnd,
      },
    });
  }
  const meaningful = (start: number, end: number) => {
    let remaining = text.slice(start, end);
    for (const range of [...consumed, ...scanned.excluded]
      .filter((range) => range.start >= start && range.end <= end)
      .sort((a, b) => b.start - a.start))
      remaining =
        remaining.slice(0, range.start - start) +
        remaining.slice(range.end - start);
    return (
      remaining.replace(/^(={2,6})[^\n]*$/gm, "").replace(/[\s*#:;-]/g, "")
        .length > 0
    );
  };
  const unsupportedSectionContent = sections.some((section) =>
    meaningful(section.start, section.end),
  );
  if (!mentions.length && (skipped || unsupportedSectionContent))
    throw new ImportFailure(
      "format-unsupported",
      "These sections contain unsupported prose or listing structures. They were not analysed; this is not a no-place result.",
      false,
      true,
    );
  let uncoveredStart = 0;
  let unanalysedOutsideSections = false;
  for (const section of sections) {
    if (
      section.start > uncoveredStart &&
      meaningful(uncoveredStart, section.start)
    )
      unanalysedOutsideSections = true;
    uncoveredStart = Math.max(uncoveredStart, section.end);
  }
  if (uncoveredStart < text.length && meaningful(uncoveredStart, text.length))
    unanalysedOutsideSections = true;
  return {
    mentions,
    evidence,
    partial: skipped || unsupportedSectionContent || unanalysedOutsideSections,
  };
}
