import { isLat, isLon } from "./geo.ts";
import type { Category, Place } from "./types.ts";

export const MAX_STOPS = 12;
export const MIN_DWELL = 10;
export const MAX_DWELL = 300;
const MAX_TOKEN_LENGTH = 12000;

export type Stop = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: Category;
  /** Minutes planned at this stop. */
  dwell: number;
  address?: string;
  hours?: string;
};

export type Plan = {
  /** Destination the stops were added from, for the page title. */
  destination?: string;
  stops: Stop[];
};

export const EMPTY_PLAN: Plan = { stops: [] };

export function defaultDwell(category: Category): number {
  return category === "cafe" ? 45 : 75;
}

export function stopId(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return text || undefined;
}

export function clampDwell(value: number): number {
  if (!Number.isFinite(value)) return MIN_DWELL;
  return Math.min(MAX_DWELL, Math.max(MIN_DWELL, Math.round(value)));
}

/** A place can only join a plan if it has a map position. */
export function placeToStop(place: Place): Stop | null {
  if (place.lat === undefined || place.lon === undefined) return null;
  if (!isLat(place.lat) || !isLon(place.lon)) return null;
  return {
    id: stopId(place.lat, place.lon),
    name: clip(place.name, 80) ?? "Place",
    lat: place.lat,
    lon: place.lon,
    category: place.category,
    dwell: defaultDwell(place.category),
    address: clip(place.address, 160),
    hours: clip(place.hours, 120),
  };
}

export function addStop(plan: Plan, stop: Stop, destination?: string): Plan {
  if (plan.stops.length >= MAX_STOPS) return plan;
  if (plan.stops.some((s) => s.id === stop.id)) return plan;
  return {
    destination: destination ?? plan.destination,
    stops: [...plan.stops, stop],
  };
}

export function removeStop(plan: Plan, id: string): Plan {
  const stops = plan.stops.filter((s) => s.id !== id);
  return stops.length === 0 ? EMPTY_PLAN : { ...plan, stops };
}

export function moveStop(plan: Plan, id: string, delta: -1 | 1): Plan {
  const from = plan.stops.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= plan.stops.length) return plan;
  const stops = [...plan.stops];
  [stops[from], stops[to]] = [stops[to], stops[from]];
  return { ...plan, stops };
}

export function setDwell(plan: Plan, id: string, dwell: number): Plan {
  return {
    ...plan,
    stops: plan.stops.map((s) =>
      s.id === id ? { ...s, dwell: clampDwell(dwell) } : s,
    ),
  };
}

export function reorder(plan: Plan, order: number[]): Plan {
  const stops = order
    .map((index) => plan.stops[index])
    .filter((s): s is Stop => s !== undefined);
  return stops.length === plan.stops.length ? { ...plan, stops } : plan;
}

// ---------- shareable link encoding ----------

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(token: string): string {
  const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

type Packed = [string, number, number, "c" | "f", number, string?, string?];

/** Compact URL-safe token holding the whole plan (no server storage). */
export function encodePlan(plan: Plan): string {
  const stops: Packed[] = plan.stops.map((s) => [
    s.name,
    Number(s.lat.toFixed(5)),
    Number(s.lon.toFixed(5)),
    s.category === "cafe" ? "c" : "f",
    s.dwell,
    s.address,
    s.hours,
  ]);
  return toBase64Url(JSON.stringify({ v: 1, d: plan.destination, s: stops }));
}

/** Validates and sanitises an untrusted token; null if it is not a plan. */
export function decodePlan(token: string): Plan | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  let data: unknown;
  try {
    data = JSON.parse(fromBase64Url(token));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as { v?: unknown; d?: unknown; s?: unknown };
  if (record.v !== 1 || !Array.isArray(record.s)) return null;

  const stops: Stop[] = [];
  for (const item of record.s.slice(0, MAX_STOPS)) {
    if (!Array.isArray(item)) return null;
    const [name, lat, lon, cat, dwell, address, hours] = item as unknown[];
    const cleanName = clip(name, 80);
    if (!cleanName) return null;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    if (!isLat(lat) || !isLon(lon)) return null;
    if (cat !== "c" && cat !== "f") return null;
    const id = stopId(lat, lon);
    if (stops.some((s) => s.id === id)) continue;
    const category: Category = cat === "c" ? "cafe" : "food";
    const cleanAddress = clip(address, 160);
    const cleanHours = clip(hours, 120);
    stops.push({
      id,
      name: cleanName,
      lat,
      lon,
      category,
      dwell:
        typeof dwell === "number" ? clampDwell(dwell) : defaultDwell(category),
      ...(cleanAddress ? { address: cleanAddress } : {}),
      ...(cleanHours ? { hours: cleanHours } : {}),
    });
  }
  const destination = clip(record.d, 80);
  return destination ? { destination, stops } : { stops };
}

/** Extracts the token from a location hash like "#p=abc". */
export function tokenFromHash(hash: string): string | null {
  const match = /^#p=([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? match[1] : null;
}
