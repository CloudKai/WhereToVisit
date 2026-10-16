import { isLat, isLon } from "./geo.ts";
import type { Category, Destination } from "./types.ts";

export const MIN_RADIUS_M = 500;
export const MAX_RADIUS_M = 10000;
export const DEFAULT_RADIUS_M = 4000;

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Control characters and angle brackets never belong in a place label. */
function cleanLabel(
  value: string | undefined,
  max: number,
): string | undefined {
  const label = value
    ?.replace(/[\p{Cc}\p{Cf}<>]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return label ? label : undefined;
}

/** Validates untrusted URL parameters; returns null when unusable. */
export function parseDestination(params: Params): Destination | null {
  const name = cleanLabel(first(params.name), 80);
  const latText = first(params.lat)?.trim();
  const lonText = first(params.lon)?.trim();
  if (!name || !latText || !lonText) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!isLat(lat) || !isLon(lon)) return null;
  const radius = Number(first(params.r));
  return {
    name,
    country: cleanLabel(first(params.country), 60),
    lat,
    lon,
    radiusM: Number.isFinite(radius)
      ? Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(radius)))
      : DEFAULT_RADIUS_M,
  };
}

/** How far from the centre to look. Shown as a control on the results page. */
export const AREA_OPTIONS = [
  { radiusM: 2500, label: "Close in", detail: "2.5 km" },
  { radiusM: 6000, label: "City centre", detail: "6 km" },
  { radiusM: 10000, label: "Wide", detail: "10 km" },
] as const;

/** The option closest to a radius, so any destination highlights one choice. */
export function nearestArea(radiusM: number): (typeof AREA_OPTIONS)[number] {
  return AREA_OPTIONS.reduce((best, option) =>
    Math.abs(option.radiusM - radiusM) < Math.abs(best.radiusM - radiusM)
      ? option
      : best,
  );
}

export type CategoryFilter = "all" | Category;

export function parseFilter(
  value: string | string[] | undefined,
): CategoryFilter {
  const v = first(value);
  return v === "cafe" || v === "food" ? v : "all";
}

export function exploreHref(
  d: Pick<Destination, "name" | "country" | "lat" | "lon" | "radiusM">,
  filter: CategoryFilter = "all",
): string {
  const query = new URLSearchParams({
    name: d.name,
    lat: String(d.lat),
    lon: String(d.lon),
    r: String(d.radiusM),
  });
  if (d.country) query.set("country", d.country);
  if (filter !== "all") query.set("type", filter);
  return `/explore?${query.toString()}`;
}

export type PopularDestination = {
  name: string;
  country: string;
  lat: number;
  lon: number;
  radiusM: number;
};

/** Ready-made starting points so the app is useful before typing anything. */
export const POPULAR_DESTINATIONS: PopularDestination[] = [
  {
    name: "Tokyo",
    country: "Japan",
    lat: 35.6762,
    lon: 139.6503,
    radiusM: 5000,
  },
  {
    name: "Paris",
    country: "France",
    lat: 48.8566,
    lon: 2.3522,
    radiusM: 5000,
  },
  {
    name: "Mexico City",
    country: "Mexico",
    lat: 19.4326,
    lon: -99.1332,
    radiusM: 5000,
  },
  {
    name: "Bangkok",
    country: "Thailand",
    lat: 13.7563,
    lon: 100.5018,
    radiusM: 5000,
  },
  {
    name: "Istanbul",
    country: "Türkiye",
    lat: 41.0082,
    lon: 28.9784,
    radiusM: 5000,
  },
  {
    name: "Lisbon",
    country: "Portugal",
    lat: 38.7223,
    lon: -9.1393,
    radiusM: 4500,
  },
  {
    name: "New York",
    country: "United States",
    lat: 40.7128,
    lon: -74.006,
    radiusM: 5000,
  },
  {
    name: "Shanghai",
    country: "China",
    lat: 31.2304,
    lon: 121.4737,
    radiusM: 5000,
  },
  {
    name: "Seoul",
    country: "South Korea",
    lat: 37.5665,
    lon: 126.978,
    radiusM: 5000,
  },
  {
    name: "Marrakech",
    country: "Morocco",
    lat: 31.6295,
    lon: -7.9811,
    radiusM: 4000,
  },
  {
    name: "Buenos Aires",
    country: "Argentina",
    lat: -34.6037,
    lon: -58.3816,
    radiusM: 5000,
  },
  {
    name: "Cape Town",
    country: "South Africa",
    lat: -33.9249,
    lon: 18.4241,
    radiusM: 5000,
  },
];
