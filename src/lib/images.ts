import { getJson } from "./http.ts";
import { commonsFileName, normalizeName } from "./text.ts";
import type { Category, Photo, Place } from "./types.ts";

const PHOTO_BUDGET = 16;
const LOOKUP_CONCURRENCY = 6;
const NEARBY_RADIUS_M = 50;
/** A photo this close with no name match is shown, but labelled "nearby". */
const NEARBY_CLOSE_M = 15;

/** Landmarks, parks, malls and museums get photographed; shops mostly don't. */
const PHOTOGRAPHED: Category[] = ["attraction", "museum", "park", "shopping"];

/** Words that say nothing about which place a photo shows. */
const GENERIC = new Set([
  "park",
  "parks",
  "garden",
  "gardens",
  "museum",
  "mall",
  "plaza",
  "centre",
  "center",
  "shopping",
  "market",
  "street",
  "square",
  "the",
  "and",
  "cafe",
  "restaurant",
  "national",
  "city",
  "old",
  "new",
  "main",
  "grand",
  "great",
  "hall",
  "gallery",
  "temple",
  "shrine",
  "tower",
  "station",
]);

/** Titles that are usually diagrams, not photos. */
const NOT_A_PHOTO =
  /\b(logo|map|plan|icon|diagram|flag|coat of arms|signature|poster|locator)\b/i;

function userAgent(contact: string | undefined): string {
  return `WhereToVisit/0.2 (${contact || "travel planning prototype"})`;
}

export function photoFromFile(file: string, kind: "place" | "nearby"): Photo {
  const encoded = encodeURIComponent(file.replace(/ /g, "_"));
  return {
    url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=720`,
    pageUrl: `https://commons.wikimedia.org/wiki/File:${encoded}`,
    credit: "Wikimedia Commons",
    kind,
  };
}

// ---------- Wikidata: each item's own image ----------

type SparqlResponse = {
  results?: {
    bindings?: { item?: { value?: string }; img?: { value?: string } }[];
  };
};

export function wikidataImageQuery(qids: string[]): string {
  const values = qids.filter((q) => /^Q\d+$/.test(q)).map((q) => `wd:${q}`);
  return `SELECT ?item ?img WHERE { VALUES ?item { ${values.join(" ")} } ?item wdt:P18 ?img }`;
}

/** Maps Wikidata ids to Commons file names (first image wins). */
export function parseWikidataImages(data: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const bindings = (data as SparqlResponse | null)?.results?.bindings;
  if (!Array.isArray(bindings)) return out;
  for (const row of bindings) {
    const qid = /Q\d+$/.exec(row.item?.value ?? "")?.[0];
    const raw = row.img?.value ?? "";
    const marker = "Special:FilePath/";
    const at = raw.indexOf(marker);
    if (!qid || at < 0 || out.has(qid)) continue;
    let name: string | undefined;
    try {
      name = commonsFileName(decodeURIComponent(raw.slice(at + marker.length)));
    } catch {
      name = undefined;
    }
    if (name) out.set(qid, name);
  }
  return out;
}

export async function fetchWikidataImages(
  qids: string[],
  contact?: string,
): Promise<Map<string, string>> {
  const unique = [...new Set(qids)]
    .filter((q) => /^Q\d+$/.test(q))
    .slice(0, 60);
  if (unique.length === 0) return new Map();
  const url = new URL("https://query.wikidata.org/sparql");
  url.search = new URLSearchParams({
    format: "json",
    query: wikidataImageQuery(unique),
  }).toString();
  const data = await getJson<unknown>("Wikidata", url.toString(), {
    headers: { "user-agent": userAgent(contact) },
    revalidate: 7 * 86400,
    timeoutMs: 8000,
  });
  return parseWikidataImages(data);
}

// ---------- Wikimedia Commons: photos taken at the spot ----------

type GeoSearchResponse = {
  query?: { geosearch?: { title?: string; dist?: number }[] };
};

/** The words of a place name that actually identify it. */
export function distinctiveWords(name: string): string[] {
  return normalizeName(name)
    .split(" ")
    .filter((w) => w.length >= 4 && !GENERIC.has(w));
}

/**
 * Picks a geotagged Commons photo for a place. A file name that contains one
 * of the place's distinctive words counts as "place"; otherwise only a photo
 * taken within a few metres is used, and it is labelled "nearby".
 */
export function pickNearbyFile(
  data: unknown,
  placeName: string,
): { file: string; kind: "place" | "nearby" } | null {
  const hits = (data as GeoSearchResponse | null)?.query?.geosearch;
  if (!Array.isArray(hits)) return null;
  const words = distinctiveWords(placeName);
  let close: { file: string; kind: "nearby" } | null = null;
  for (const hit of hits) {
    const title = hit.title ?? "";
    if (!title.startsWith("File:") || NOT_A_PHOTO.test(title)) continue;
    const file = commonsFileName(title);
    if (!file) continue;
    const label = normalizeName(file.replace(/\.[a-z0-9]+$/i, ""));
    if (words.some((w) => label.includes(w))) return { file, kind: "place" };
    if (!close && typeof hit.dist === "number" && hit.dist <= NEARBY_CLOSE_M) {
      close = { file, kind: "nearby" };
    }
  }
  return close;
}

export async function fetchNearbyFile(
  lat: number,
  lon: number,
  name: string,
  contact?: string,
): Promise<{ file: string; kind: "place" | "nearby" } | null> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${lat}|${lon}`,
    gsradius: String(NEARBY_RADIUS_M),
    gsnamespace: "6",
    gslimit: "10",
    format: "json",
    formatversion: "2",
  }).toString();
  const data = await getJson<unknown>("Commons", url.toString(), {
    headers: { "user-agent": userAgent(contact) },
    revalidate: 7 * 86400,
    timeoutMs: 4000,
  });
  return pickNearbyFile(data, name);
}

// ---------- putting it together ----------

async function inBatches<T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(
      ...(await Promise.allSettled(items.slice(i, i + size).map(run))),
    );
  }
  return results;
}

/**
 * Adds photos to places that have none: first the place's own Wikidata image,
 * then (for landmarks, parks, malls and museums, within a small budget) a
 * Commons photo taken at that spot. Never throws; failures just mean no photo.
 */
export async function addPhotos(
  places: Place[],
  contact?: string,
  lookups: {
    wikidata: typeof fetchWikidataImages;
    nearby: typeof fetchNearbyFile;
  } = { wikidata: fetchWikidataImages, nearby: fetchNearbyFile },
): Promise<Place[]> {
  const missing = places.filter((p) => !p.photo);
  if (missing.length === 0) return places;

  let byQid = new Map<string, string>();
  try {
    byQid = await lookups.wikidata(
      missing.map((p) => p.wikidata).filter((q): q is string => Boolean(q)),
      contact,
    );
  } catch (error) {
    console.warn(
      `[images] Wikidata lookup failed: ${error instanceof Error ? error.message : "error"}`,
    );
  }

  const photos = new Map<string, Photo>();
  for (const place of missing) {
    const file = place.wikidata ? byQid.get(place.wikidata) : undefined;
    if (file) photos.set(place.id, photoFromFile(file, "place"));
  }

  const candidates = missing
    .filter(
      (p) =>
        !photos.has(p.id) &&
        PHOTOGRAPHED.includes(p.category) &&
        p.lat !== undefined &&
        p.lon !== undefined,
    )
    .slice(0, PHOTO_BUDGET);
  const found = await inBatches(candidates, LOOKUP_CONCURRENCY, (p) =>
    lookups.nearby(p.lat as number, p.lon as number, p.name, contact),
  );
  found.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) {
      photos.set(
        candidates[index].id,
        photoFromFile(result.value.file, result.value.kind),
      );
    }
  });

  if (photos.size === 0) return places;
  return places.map((p) => {
    const photo = photos.get(p.id);
    return photo ? { ...p, photo } : p;
  });
}
