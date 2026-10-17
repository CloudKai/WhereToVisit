import type {
  Candidate,
  Evidence,
  SpeechSegment,
  Verdict,
} from "./extract-types.ts";
import { haversineKm } from "./geo.ts";
import { normalizeName } from "./text.ts";

/** Letters and digits only, so "#Senso-ji Temple" and "sensojitemple" compare equal. */
export function compact(text: string): string {
  return normalizeName(text).replace(/ /g, "");
}

/**
 * The model must copy names out of the text. A name that is not in the text
 * (made up, translated, or planted by an instruction hidden in a caption) is dropped.
 */
export function isNamedIn(name: string, text: string): boolean {
  const n = compact(name);
  return n.length >= 2 && compact(text).includes(n);
}

const HAN = /\p{Script=Han}/u;

/**
 * True when two written names very likely mean the same place:
 * the same letters, or one inside the other when it is most of it.
 */
export function sameName(a: string, b: string): boolean {
  const x = compact(a);
  const y = compact(b);
  if (x.length < 2 || y.length < 2) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const minimum = HAN.test(short) ? 2 : 4;
  return (
    short.length >= minimum &&
    short.length / long.length >= 0.5 &&
    long.includes(short)
  );
}

/** 75 seconds → "1:15". */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The first spoken phrase that contains the name, with when it starts. */
export function findInSpeech(
  name: string,
  segments: SpeechSegment[],
): { at: number; quote: string } | null {
  for (const segment of segments) {
    if (isNamedIn(name, segment.text)) {
      const quote = segment.text.replace(/\s+/g, " ").trim();
      return {
        at: segment.start,
        quote: quote.length > 140 ? `${quote.slice(0, 137)}…` : quote,
      };
    }
  }
  return null;
}

/** Adds a piece of evidence unless the same one is already there. */
export function addEvidence(list: Evidence[], item: Evidence): Evidence[] {
  const same = list.some(
    (e) =>
      e.source === item.source &&
      e.at === item.at &&
      e.frame === item.frame &&
      e.quote === item.quote,
  );
  return same ? list : [...list, item];
}

/** A short plain-language line for one piece of evidence. */
export function evidenceLabel(item: Evidence): string {
  switch (item.source) {
    case "caption":
      return "Written in the caption you gave";
    case "images":
      return item.at !== undefined
        ? `Seen on screen at ${formatTime(item.at)}`
        : item.frame !== undefined
          ? `Seen in picture ${item.frame}`
          : "Seen in your pictures";
    case "speech":
      return item.at !== undefined
        ? `Said at ${formatTime(item.at)}${item.quote ? `: “${item.quote}”` : ""}`
        : `Heard in the audio${item.quote ? `: “${item.quote}”` : ""}`;
  }
}

const ONLY_ONE_WAY: Record<Evidence["source"], string> = {
  speech:
    "It was only heard in the audio. Nothing on screen or in a caption confirms it.",
  images:
    "It was only seen in the pictures. It wasn’t said in the audio or written in a caption.",
  caption: "It was only in the caption. It wasn’t seen or heard in the video.",
};

/**
 * Decides whether a place is "confirmed". It needs BOTH of these:
 *  1. found in two different ways (caption, on-screen text, spoken audio), and
 *  2. one clear match on the map: an exact venue, a good score, and no equally
 *     good match somewhere else.
 * Anything else stays "check", with the reasons, so a weak match is never
 * presented as certain.
 */
export function rateMention(
  evidence: Evidence[],
  candidates: Candidate[],
  alsoWrittenAs: string[] = [],
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  if (alsoWrittenAs.length > 0) {
    reasons.push(
      `Also written as “${alsoWrittenAs[0]}”. Both landed on the same spot, so check they are the same place.`,
    );
  }
  const sources = new Set(evidence.map((e) => e.source));
  if (sources.size < 2) {
    const only = [...sources][0];
    if (only) reasons.push(ONLY_ONE_WAY[only]);
  }

  const best = candidates[0];
  if (!best) {
    reasons.push("It wasn’t found on the map.");
  } else {
    if (best.approximate) {
      reasons.push("Only an area or street matched, not an exact venue.");
    } else if (best.confidence < 0.8) {
      reasons.push("The map match is uncertain.");
    }
    const rival = candidates
      .slice(1)
      .find(
        (c) =>
          !c.approximate &&
          c.confidence >= best.confidence - 0.1 &&
          haversineKm(c, best) > 0.5,
      );
    if (rival) {
      reasons.push("Several different places on the map match this name.");
    }
  }
  return { verdict: reasons.length === 0 ? "confirmed" : "check", reasons };
}

type Mergeable = {
  name: string;
  entry: number;
  evidence: Evidence[];
  candidates: Candidate[];
  alsoWrittenAs?: string[];
};

const sourcesOf = (list: Evidence[]) => new Set(list.map((e) => e.source));

/**
 * The same venue may be written differently in speech and on screen ("Coda" and
 * "科达烘焙"). Within one post, two names that were found in DIFFERENT ways and
 * land on the same exact spot (within 30 m) are treated as one place. Such a
 * place is never "confirmed" automatically: it keeps the other spelling so the
 * person can check it.
 */
export function mergeByLocation<T extends Mergeable>(list: T[]): T[] {
  const kept: T[] = [];
  for (const item of list) {
    const here = item.candidates[0];
    const twin =
      here && !here.approximate
        ? kept.find((k) => {
            const there = k.candidates[0];
            if (!there || there.approximate || k.entry !== item.entry)
              return false;
            if (haversineKm(here, there) > 0.03) return false;
            const a = sourcesOf(k.evidence);
            return [...sourcesOf(item.evidence)].every((s) => !a.has(s));
          })
        : undefined;
    if (!twin) {
      kept.push(item);
      continue;
    }
    for (const e of item.evidence)
      twin.evidence = addEvidence(twin.evidence, e);
    twin.alsoWrittenAs = [...(twin.alsoWrittenAs ?? []), item.name];
  }
  return kept;
}
