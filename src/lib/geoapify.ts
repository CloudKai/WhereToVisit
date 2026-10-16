import { CATEGORIES, CATEGORY_INFO, guessCategory } from "./categories.ts";
import type { Candidate } from "./extract-types.ts";
import { isLat, isLon } from "./geo.ts";
import { getJson } from "./http.ts";
import {
  commonsFileName,
  humanize,
  safeHttpUrl,
  truncateText,
} from "./text.ts";
import type { Category, Destination, RawPlace, Suggestion } from "./types.ts";

type Tags = Record<string, string | undefined>;

export type GeoapifyFeature = {
  properties?: {
    name?: string;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    lat?: number;
    lon?: number;
    categories?: string[];
    opening_hours?: string;
    website?: string;
    contact?: { phone?: string; website?: string };
    catering?: { cuisine?: string };
    wiki_and_media?: { wikidata?: string; wikipedia?: string };
    datasource?: { raw?: Record<string, unknown> };
    result_type?: string;
    city?: string;
    suburb?: string;
    district?: string;
    country?: string;
  };
  geometry?: { coordinates?: number[] };
};

type FeatureCollection = { features?: GeoapifyFeature[] };

const BASE = "https://api.geoapify.com";

function stringTags(raw: Record<string, unknown> | undefined): Tags {
  const tags: Tags = {};
  if (!raw) return tags;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") tags[key] = value;
  }
  return tags;
}

function isYes(value: string | undefined): boolean {
  return value === "yes" || value === "only";
}

function osmLink(tags: Tags): string {
  const type = { n: "node", w: "way", r: "relation" }[
    (tags.osm_type ?? "").toLowerCase() as "n" | "w" | "r"
  ];
  return type && tags.osm_id && /^\d+$/.test(tags.osm_id)
    ? `https://www.openstreetmap.org/${type}/${tags.osm_id}`
    : "https://www.openstreetmap.org/copyright";
}

function parseCuisines(...values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const part of value.split(/[;,]/)) {
      const label = humanize(part);
      if (label) seen.add(label);
    }
  }
  return [...seen].slice(0, 3);
}

/** The most specific entry in `found` that belongs to this category, if any. */
function groupMatches(category: Category, found: string[]): string | undefined {
  let best: string | undefined;
  for (const group of CATEGORY_INFO[category].geoapify) {
    for (const entry of found) {
      const belongs = entry === group || entry.startsWith(`${group}.`);
      if (belongs && (!best || entry.length > best.length)) best = entry;
    }
  }
  return best;
}

/** Our category for a Geoapify feature; `hint` wins when it fits. */
export function categoryOf(found: string[], hint?: Category): Category {
  if (hint && groupMatches(hint, found)) return hint;
  return CATEGORIES.find((c) => groupMatches(c, found)) ?? hint ?? "food";
}

/** "tourism.sights.place_of_worship" -> "Place of worship" (empty for the plain group). */
export function subtypeLabel(
  found: string[],
  category: Category,
): string | undefined {
  const hit = groupMatches(category, found);
  if (!hit) return undefined;
  const group = CATEGORY_INFO[category].geoapify.find(
    (g) => hit === g || hit.startsWith(`${g}.`),
  );
  const rest = group ? hit.slice(group.length + 1) : "";
  const last = rest.split(".").pop();
  return last && last !== "yes" ? humanize(last) : undefined;
}

/** Some sign that a sight or park is a real, known place rather than map clutter. */
export function isNotable(place: RawPlace): boolean {
  return Boolean(
    place.wikidata ||
    place.flags.wikipedia ||
    place.website ||
    place.description ||
    place.photoFile,
  );
}

/** Converts one Geoapify Places feature to a RawPlace, or null if unusable. */
export function normalizePlaceFeature(
  feature: GeoapifyFeature,
  hint?: Category,
): RawPlace | null {
  const p = feature.properties;
  if (!p) return null;
  const tags = stringTags(p.datasource?.raw);

  const localName = (p.name ?? tags.name)?.trim();
  const englishName = tags["name:en"]?.trim();
  const name = englishName || localName;
  if (!name) return null;

  const coords = feature.geometry?.coordinates;
  const lat = p.lat ?? coords?.[1];
  const lon = p.lon ?? coords?.[0];
  if (lat === undefined || lon === undefined || !isLat(lat) || !isLon(lon)) {
    return null;
  }

  const categories = p.categories ?? [];
  const category = categoryOf(categories, hint);

  // For food these are cuisines; for everything else, the kind of place.
  const kind = subtypeLabel(categories, category);
  const cuisines =
    category === "cafe" || category === "food"
      ? parseCuisines(p.catering?.cuisine, tags.cuisine)
      : kind
        ? [kind]
        : [];
  const facts: string[] = [];
  if (isYes(tags.outdoor_seating)) facts.push("Outdoor seating");
  if (["wlan", "wifi", "yes"].includes(tags.internet_access ?? "")) {
    facts.push("Wi-Fi");
  }
  if (isYes(tags["diet:vegan"])) facts.push("Vegan options");
  else if (isYes(tags["diet:vegetarian"])) facts.push("Vegetarian options");
  if (isYes(tags.takeaway)) facts.push("Takeaway");
  if (tags.wheelchair === "yes") facts.push("Step-free access");

  const rawDescription = (tags["description:en"] ?? tags.description)?.trim();
  const description = rawDescription
    ? truncateText(rawDescription, 400)
    : undefined;

  const wikidata = p.wiki_and_media?.wikidata ?? tags.wikidata;
  const address =
    p.address_line2?.trim() ||
    p.formatted?.replace(`${p.name ?? ""},`, "").trim() ||
    undefined;

  return {
    origin: "openstreetmap",
    name,
    localName: localName && localName !== name ? localName : undefined,
    category,
    cuisines,
    lat,
    lon,
    address,
    hours: (p.opening_hours ?? tags.opening_hours)?.trim() || undefined,
    phone: (p.contact?.phone ?? tags.phone ?? tags["contact:phone"])?.trim(),
    website: safeHttpUrl(
      p.website ??
        p.contact?.website ??
        tags.website ??
        tags["contact:website"],
    ),
    description,
    descriptionBasis: description ? "community" : undefined,
    photoFile: commonsFileName(tags.wikimedia_commons),
    wikidata: wikidata && /^Q\d+$/.test(wikidata) ? wikidata : undefined,
    facts,
    flags: {
      michelin: Object.keys(tags).some((key) => /michelin/i.test(key)),
      chain: Boolean(tags.brand || tags["brand:wikidata"]),
      wikipedia: Boolean(p.wiki_and_media?.wikipedia ?? tags.wikipedia),
    },
    source: {
      kind: "openstreetmap",
      label: "OpenStreetMap contributors",
      url: osmLink(tags),
      license: "ODbL",
    },
  };
}

async function fetchGroup(
  destination: Destination,
  apiKey: string,
  category: Category,
): Promise<RawPlace[]> {
  const info = CATEGORY_INFO[category];
  const url = new URL(`${BASE}/v2/places`);
  url.search = new URLSearchParams({
    categories: info.geoapify.join(","),
    filter: `circle:${destination.lon},${destination.lat},${destination.radiusM}`,
    bias: `proximity:${destination.lon},${destination.lat}`,
    limit: String(info.limit),
    lang: "en",
    apiKey,
  }).toString();
  const data = await getJson<FeatureCollection>("Geoapify", url.toString(), {
    revalidate: 86400,
  });
  const places: RawPlace[] = [];
  for (const feature of data.features ?? []) {
    const place = normalizePlaceFeature(feature, category);
    if (!place || place.category !== category) continue;
    if (info.notableOnly && !isNotable(place)) continue;
    places.push(place);
  }
  return places;
}

/**
 * Places around the destination from OpenStreetMap data, one request per
 * category. A category that fails is skipped (and logged) so one bad request
 * cannot hide everything else; only if all fail does this throw.
 */
export async function fetchOsmPlaces(
  destination: Destination,
  apiKey: string,
  categories: Category[] = CATEGORIES,
): Promise<RawPlace[]> {
  const settled = await Promise.allSettled(
    categories.map((category) => fetchGroup(destination, apiKey, category)),
  );
  const places: RawPlace[] = [];
  let firstFailure: unknown;
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      places.push(...result.value);
    } else {
      firstFailure ??= result.reason;
      console.warn(
        `[geoapify] ${categories[index]} request failed: ${
          result.reason instanceof Error ? result.reason.message : "error"
        }`,
      );
    }
  });
  if (settled.every((r) => r.status === "rejected") && firstFailure) {
    throw firstFailure;
  }
  return places;
}

const RADIUS_BY_TYPE: Record<string, number> = {
  suburb: 2500,
  district: 2500,
  neighbourhood: 2000,
  locality: 3000,
  city: 6000,
  county: 10000,
  // Cities such as Tokyo (a prefecture) or Shanghai (a municipality) are often
  // mapped at "state" level, so this type must stay searchable.
  state: 8000,
};

/** Lower is shown first: cities, then smaller areas, then bigger regions. */
const TYPE_RANK: Record<string, number> = {
  city: 0,
  suburb: 1,
  district: 1,
  neighbourhood: 1,
  locality: 1,
  county: 2,
  state: 3,
};

/** Converts autocomplete features to destination suggestions. */
export function normalizeSuggestions(data: FeatureCollection): Suggestion[] {
  const seen = new Set<string>();
  const ranked: { rank: number; index: number; suggestion: Suggestion }[] = [];
  for (const feature of data.features ?? []) {
    const p = feature.properties;
    if (!p) continue;
    const type = p.result_type ?? "city";
    const radiusM = RADIUS_BY_TYPE[type];
    if (!radiusM) continue;
    const coords = feature.geometry?.coordinates;
    const lat = p.lat ?? coords?.[1];
    const lon = p.lon ?? coords?.[0];
    if (lat === undefined || lon === undefined || !isLat(lat) || !isLon(lon)) {
      continue;
    }
    const label = p.formatted?.trim();
    const name = (
      p.name ??
      p.city ??
      p.suburb ??
      p.district ??
      label?.split(",")[0]
    )?.trim();
    if (!label || !name || seen.has(label)) continue;
    seen.add(label);
    ranked.push({
      rank: TYPE_RANK[type] ?? 4,
      index: ranked.length,
      suggestion: { label, name, country: p.country, lat, lon, radiusM },
    });
  }
  // Keep the service's own relevance order within each kind of place.
  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, 6)
    .map((entry) => entry.suggestion);
}

export async function suggestDestinations(
  text: string,
  apiKey: string,
): Promise<Suggestion[]> {
  const url = new URL(`${BASE}/v1/geocode/autocomplete`);
  url.search = new URLSearchParams({
    text,
    limit: "8",
    lang: "en",
    apiKey,
  }).toString();
  const data = await getJson<FeatureCollection>("Geoapify", url.toString(), {
    revalidate: 3600,
    timeoutMs: 6000,
  });
  return normalizeSuggestions(data);
}

// ---------- turning a place name into coordinates ----------

type GeocodeFeature = {
  properties?: {
    name?: string;
    formatted?: string;
    address_line1?: string;
    lat?: number;
    lon?: number;
    result_type?: string;
    rank?: { confidence?: number };
  };
  geometry?: { coordinates?: number[] };
};

/** Results too coarse to be "a place": whole countries, regions, postcodes. */
const TOO_COARSE = new Set([
  "country",
  "state",
  "county",
  "postcode",
  "region",
]);
/** Close, but not an exact venue. */
const APPROXIMATE = new Set([
  "street",
  "suburb",
  "district",
  "city",
  "locality",
  "unknown",
]);

/** Converts Geoapify geocoding results to candidates, best first. */
export function normalizeGeocode(data: unknown): Candidate[] {
  const features = (data as { features?: GeocodeFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const p = feature.properties;
    if (!p) continue;
    const kind = p.result_type ?? "unknown";
    if (TOO_COARSE.has(kind)) continue;
    const coords = feature.geometry?.coordinates;
    const lat = p.lat ?? coords?.[1];
    const lon = p.lon ?? coords?.[0];
    if (lat === undefined || lon === undefined || !isLat(lat) || !isLon(lon))
      continue;
    const address = p.formatted?.trim();
    const label = (p.name ?? p.address_line1 ?? address?.split(",")[0])?.trim();
    if (!address || !label) continue;
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const confidence =
      typeof p.rank?.confidence === "number"
        ? Math.min(1, Math.max(0, p.rank.confidence))
        : 0;
    out.push({
      label,
      address,
      lat,
      lon,
      kind,
      confidence,
      approximate: APPROXIMATE.has(kind),
      category: guessCategory(`${label} ${address}`),
    });
  }
  return out.slice(0, 3);
}

/** Looks up a place name, optionally narrowed by an area such as a city. */
export async function geocodePlace(
  name: string,
  hint: string | undefined,
  apiKey: string,
): Promise<Candidate[]> {
  const url = new URL(`${BASE}/v1/geocode/search`);
  url.search = new URLSearchParams({
    text: hint ? `${name}, ${hint}` : name,
    limit: "3",
    lang: "en",
    apiKey,
  }).toString();
  const data = await getJson<unknown>("Geoapify", url.toString(), {
    revalidate: 7 * 86400,
    timeoutMs: 8000,
  });
  return normalizeGeocode(data);
}
