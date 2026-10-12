import "server-only";
import { isIP } from "node:net";
export class ImportFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public unsupported = false,
    public backoffSeconds = 0,
  ) {
    super(message);
  }
}
export function articleInput(input: string) {
  if (typeof input !== "string" || input.length > 2048)
    throw new ImportFailure(
      "input-too-large",
      "Use one article URL of at most 2048 characters.",
    );
  // Inspect the original spelling before WHATWG normalization can remove dot segments or ports.
  if (
    !/^https:\/\/en\.wikivoyage\.org(?::443)?\/wiki\/[^?#]+(?:#[^?]*)?$/i.test(
      input,
    ) ||
    /[\\\s]/u.test(input) ||
    hasControl(input)
  ) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new ImportFailure(
        "unsafe-url",
        "Enter a public HTTPS Wikivoyage article URL.",
      );
    }
    if (
      url.hostname !== "en.wikivoyage.org" &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hostname.endsWith(".") &&
      !isIP(url.hostname.replace(/^\[|\]$/g, ""))
    )
      throw new ImportFailure(
        "source-unsupported",
        "Only English Wikivoyage article listings are supported. Social, video and other blogs are unavailable.",
        false,
        true,
      );
    throw new ImportFailure(
      "unsafe-url",
      "Only the exact public HTTPS article host and path, without credentials, query or alternate port, are allowed.",
    );
  }
  const url = new URL(input);
  if (!url.pathname.startsWith("/wiki/"))
    throw new ImportFailure(
      "unsafe-url",
      "Use the exact case-sensitive /wiki/ article path.",
    );
  const path = input.split("#")[0].replace(/^https:\/\/[^/]+/i, "");
  if (
    /%(?:2f|5c|2e|25|3f|23|3a|00)/i.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw new ImportFailure(
      "unsafe-url",
      "Ambiguous article path encoding is unsupported.",
    );
  let title: string;
  try {
    title = decodeURIComponent(url.pathname.slice(6)).replaceAll("_", " ");
  } catch {
    throw new ImportFailure(
      "unsafe-url",
      "Malformed article encoding is unsupported.",
    );
  }
  if (
    !title ||
    title.length > 300 ||
    /[:%?#\\<>|{}]/u.test(title) ||
    hasControl(title) ||
    title
      .split("/")
      .some((part) => !part.trim() || part === "." || part === "..")
  )
    throw new ImportFailure(
      "unsafe-url",
      "Use an ordinary article, without a special namespace or ambiguous path.",
    );
  return {
    title,
    canonicalUrl: `https://en.wikivoyage.org/wiki/${title
      .split("/")
      .map((part) => encodeURIComponent(part.replaceAll(" ", "_")))
      .join("/")}`,
  };
}
export function operatorContact() {
  const contact = process.env.WIKIMEDIA_OPERATOR_CONTACT ?? "";
  if (/^[^\s@;()]+@[^\s@;()]+\.[^\s@;()]+$/.test(contact)) return contact;
  try {
    const url = new URL(contact);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !/[\r\n;()]/.test(contact)
    )
      return contact;
  } catch {}
  throw new ImportFailure(
    "credentials-missing",
    "Live article retrieval needs the operator's public contact configuration. Supported import behavior is prepared; live access is unavailable.",
    false,
    true,
  );
}

function hasControl(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}
