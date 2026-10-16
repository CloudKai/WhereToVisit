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
