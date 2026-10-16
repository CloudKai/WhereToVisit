import { isLat, isLon } from "./geo.ts";
import { getJson } from "./http.ts";
import type { Suggestion } from "./types.ts";

type NominatimResult = {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  addresstype?: string;
  address?: Record<string, string | undefined>;
};

/** Search radius by kind of place; kinds not listed here are ignored. */
const RADIUS_BY_KIND: Record<string, number> = {
  city: 6000,
  town: 4000,
  village: 3000,
  municipality: 6000,
  borough: 2500,
  city_district: 2500,
  suburb: 2500,
  quarter: 2500,
  neighbourhood: 2000,
  county: 10000,
  state: 8000,
  province: 8000,
  region: 8000,
};

const RANK: Record<string, number> = {
  city: 0,
  town: 0,
  municipality: 0,
  village: 1,
  borough: 1,
  city_district: 1,
  suburb: 1,
  quarter: 1,
  neighbourhood: 1,
  county: 2,
  state: 3,
  province: 3,
  region: 3,
};

/** Converts OpenStreetMap Nominatim results to destination suggestions. */
export function normalizeNominatim(data: unknown): Suggestion[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const ranked: { rank: number; index: number; suggestion: Suggestion }[] = [];
  for (const item of data as NominatimResult[]) {
    const kind = item.addresstype ?? "";
    const radiusM = RADIUS_BY_KIND[kind];
    if (!radiusM) continue; // countries, streets, shops and so on
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!item.lat || !item.lon || !isLat(lat) || !isLon(lon)) continue;
    const label = item.display_name?.trim();
    const name = (item.name || label?.split(",")[0])?.trim();
    if (!label || !name || seen.has(label)) continue;
    seen.add(label);
    ranked.push({
      rank: RANK[kind] ?? 4,
      index: ranked.length,
      suggestion: {
        label,
        name,
        country: item.address?.country,
        lat,
        lon,
        radiusM,
      },
    });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, 6)
    .map((entry) => entry.suggestion);
}

/**
 * Backup destination lookup. Nominatim's usage policy allows occasional,
 * user-triggered searches (max 1 per second, never search-as-you-type), so
 * callers must only use this when a person presses Enter.
 */
export async function searchNominatim(
  text: string,
  contact?: string,
): Promise<Suggestion[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: text,
    format: "jsonv2",
    limit: "10",
    addressdetails: "1",
    "accept-language": "en",
  }).toString();
  const data = await getJson<unknown>("Nominatim", url.toString(), {
    headers: {
      "user-agent": `WhereToVisit/0.2 (${contact || "travel planning prototype"})`,
    },
    revalidate: 86400,
    timeoutMs: 8000,
  });
  return normalizeNominatim(data);
}
