import type { Bounds } from "./types.ts";

const EARTH_RADIUS_KM = 6371.0088;

export function isLat(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isLon(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------- map rectangles ("Search this area") ----------

/** Largest side a searched map area may have. Wider views must zoom in first. */
export const MAX_AREA_SIDE_KM = 20;
export const MIN_AREA_SIDE_KM = 0.1;

export function boundsCenter(b: Bounds): { lat: number; lon: number } {
  return { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
}

/** Width (east-west, at the middle latitude) and height, in kilometres. */
export function boundsSizeKm(b: Bounds): { widthKm: number; heightKm: number } {
  const mid = (b.south + b.north) / 2;
  return {
    widthKm: haversineKm({ lat: mid, lon: b.west }, { lat: mid, lon: b.east }),
    heightKm: haversineKm(
      { lat: b.south, lon: b.west },
      { lat: b.north, lon: b.west },
    ),
  };
}

export function isValidBounds(b: Bounds): boolean {
  return (
    [b.south, b.north].every(isLat) &&
    [b.west, b.east].every(isLon) &&
    b.south < b.north &&
    b.west < b.east
  );
}

/** Why a rectangle cannot be searched, or null if it can. */
export function areaProblem(b: Bounds): "too-large" | "too-small" | null {
  const { widthKm, heightKm } = boundsSizeKm(b);
  if (Math.max(widthKm, heightKm) > MAX_AREA_SIDE_KM) return "too-large";
  if (Math.min(widthKm, heightKm) < MIN_AREA_SIDE_KM) return "too-small";
  return null;
}

export function inBounds(p: { lat: number; lon: number }, b: Bounds): boolean {
  return (
    p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east
  );
}

/** A circle that covers the whole rectangle: centre plus half the diagonal. */
export function circleCovering(b: Bounds): {
  lat: number;
  lon: number;
  radiusM: number;
} {
  const { widthKm, heightKm } = boundsSizeKm(b);
  return {
    ...boundsCenter(b),
    radiusM: Math.round((Math.hypot(widthKm, heightKm) / 2) * 1000),
  };
}
