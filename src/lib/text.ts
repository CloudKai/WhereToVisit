const NAMED_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&ndash;": "–",
  "&mdash;": "—",
};

function decodeEntity(entity: string): string {
  const named = NAMED_ENTITIES[entity.toLowerCase()];
  if (named !== undefined) return named;
  const numeric = /^&#(\d+);$/.exec(entity);
  if (numeric) {
    const code = Number(numeric[1]);
    if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
  }
  return "";
}

/** Drops balanced {{...}} templates, including nested ones. */
export function removeTemplates(input: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    if (input.startsWith("{{", i)) {
      depth++;
      i++;
    } else if (depth > 0 && input.startsWith("}}", i)) {
      depth--;
      i++;
    } else if (depth === 0) {
      out += input[i];
    }
  }
  return out;
}

/** Turns a wikitext fragment into plain readable text. */
export function cleanWikitext(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/<!--[\s\S]*?-->/g, "");
  s = s
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  s = removeTemplates(s);
  s = s.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, "");
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]*)\]\]/g, "$1");
  s = s.replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1");
  s = s.replace(/\[(?:https?:)?\/\/[^\s\]]+\]/g, "");
  s = s.replace(/'{2,5}/g, "");
  s = s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "");
  s = s.replace(/&[a-z]+;|&#\d+;/gi, decodeEntity);
  return s.replace(/\s+/g, " ").trim();
}

/** Shortens text, preferring to end on a sentence boundary. */
export function truncateText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (sentenceEnd >= max * 0.5) return window.slice(0, sentenceEnd + 1);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace >= max * 0.5 ? window.slice(0, lastSpace) : window;
  return `${cut.replace(/[\s,;:–—-]+$/, "")}…`;
}

/** Lowercase, accent-free, punctuation-free form used to compare names. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when two venue names very likely refer to the same venue. */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length < 5) return false;
  return ` ${long} `.includes(` ${short} `);
}

/** Returns the URL only if it is plain http(s); never javascript: or data:. */
export function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value.trim())
    ? value.trim()
    : `https://${value.trim()}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** "japanese_regional" -> "Japanese regional" */
export function humanize(token: string): string {
  const t = token.replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Wikimedia Commons file name (no "File:" prefix) or undefined if not an image. */
export function commonsFileName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const name = value
    .trim()
    .replace(/^(?:File|Image):/i, "")
    .replace(/_/g, " ")
    .trim();
  return /\.(jpe?g|png|webp|gif)$/i.test(name) && name.length < 200
    ? name
    : undefined;
}

export function slugify(value: string): string {
  return normalizeName(value).replace(/\s+/g, "-").slice(0, 48) || "place";
}
