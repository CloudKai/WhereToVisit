export type LastSearch = {
  name: string;
  /** Where the results page for it lives, including filter and area. */
  href: string;
};

/** Only same-site results links are trusted, even from our own storage. */
export function isResultsHref(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length < 600 &&
    /^\/explore\?[A-Za-z0-9_%.,=&+~-]*$/.test(value)
  );
}

/** Reads the remembered search back from storage; null unless it is safe. */
export function parseLastSearch(raw: string | null): LastSearch | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LastSearch>;
    if (
      typeof v.name === "string" &&
      v.name.length > 0 &&
      v.name.length <= 80 &&
      isResultsHref(v.href)
    ) {
      return { name: v.name, href: v.href };
    }
  } catch {
    // ignore damaged storage
  }
  return null;
}
