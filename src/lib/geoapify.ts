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

/** Converts one Geoapify Places feature to a RawPlace, or null if unusable. */
export function normalizePlaceFeature(
  feature: GeoapifyFeature,
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
  const category: Category = categories.some((c) =>
    c.startsWith("catering.cafe"),
  )
    ? "cafe"
    : "food";

  const cuisines = parseCuisines(p.catering?.cuisine, tags.cuisine);
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

async function fetchCategory(
  destination: Destination,
  apiKey: string,
  category: string,
  limit: number,
): Promise<RawPlace[]> {
  const url = new URL(`${BASE}/v2/places`);
  url.search = new URLSearchParams({
    categories: category,
    filter: `circle:${destination.lon},${destination.lat},${destination.radiusM}`,
    bias: `proximity:${destination.lon},${destination.lat}`,
    limit: String(limit),
    lang: "en",
    apiKey,
  }).toString();
  const data = await getJson<FeatureCollection>("Geoapify", url.toString(), {
    revalidate: 86400,
  });
  const places: RawPlace[] = [];
  for (const feature of data.features ?? []) {
    const place = normalizePlaceFeature(feature);
    if (place) places.push(place);
  }
  return places;
}

/** Cafés and restaurants around the destination from OpenStreetMap data. */
export async function fetchOsmPlaces(
  destination: Destination,
  apiKey: string,
): Promise<RawPlace[]> {
  const [cafes, restaurants] = await Promise.all([
    fetchCategory(destination, apiKey, "catering.cafe", 60),
    fetchCategory(destination, apiKey, "catering.restaurant", 60),
  ]);
  return [...cafes, ...restaurants];
}

const RADIUS_BY_TYPE: Record<string, number> = {
  suburb: 2500,
  district: 2500,
  neighbourhood: 2000,
  locality: 3000,
  city: 6000,
  county: 10000,
};

/** Converts autocomplete features to destination suggestions. */
export function normalizeSuggestions(data: FeatureCollection): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
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
    out.push({ label, name, country: p.country, lat, lon, radiusM });
  }
  return out.slice(0, 6);
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
