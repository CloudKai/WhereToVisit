import { isLat, isLon } from "./geo.ts";
import type { Mode } from "./routing.ts";
import type { Category, Place } from "./types.ts";

export const MAX_DAYS = 10;
/** Routing services accept a limited number of waypoints per request. */
export const MAX_STOPS_PER_DAY = 12;
export const MAX_TOTAL_STOPS = 40;
export const MIN_DWELL = 10;
export const MAX_DWELL = 300;
export const DEFAULT_START = 10 * 60;
const MAX_TOKEN_LENGTH = 24000;

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

export type Day = {
  /** Minutes after midnight when the day starts. */
  start: number;
  mode: Mode;
  stops: Stop[];
};

export type Plan = {
  /** Destination the stops were added from, for the page title. */
  destination?: string;
  /** Always at least one day. */
  days: Day[];
};

export function newDay(): Day {
  return { start: DEFAULT_START, mode: "walk", stops: [] };
}

export const EMPTY_PLAN: Plan = { days: [newDay()] };

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

export function clampStart(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_START;
  return Math.min(1439, Math.max(0, Math.round(value)));
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

// ---------- reading ----------

export function allStops(plan: Plan): Stop[] {
  return plan.days.flatMap((day) => day.stops);
}

export function stopCount(plan: Plan): number {
  return plan.days.reduce((sum, day) => sum + day.stops.length, 0);
}

/** Where a stop currently sits, or null. */
export function findStop(
  plan: Plan,
  id: string,
): { day: number; index: number } | null {
  for (let day = 0; day < plan.days.length; day++) {
    const index = plan.days[day].stops.findIndex((s) => s.id === id);
    if (index >= 0) return { day, index };
  }
  return null;
}

export function clampDayIndex(plan: Plan, index: number): number {
  return Math.min(plan.days.length - 1, Math.max(0, Math.trunc(index) || 0));
}

// ---------- editing (all return new plans; invalid requests change nothing) ----------

function withDay(
  plan: Plan,
  dayIndex: number,
  change: (day: Day) => Day,
): Plan {
  if (dayIndex < 0 || dayIndex >= plan.days.length) return plan;
  return {
    ...plan,
    days: plan.days.map((day, i) => (i === dayIndex ? change(day) : day)),
  };
}

export function addStop(
  plan: Plan,
  stop: Stop,
  destination?: string,
  dayIndex = 0,
): Plan {
  const target = clampDayIndex(plan, dayIndex);
  if (findStop(plan, stop.id)) return plan;
  if (stopCount(plan) >= MAX_TOTAL_STOPS) return plan;
  if (plan.days[target].stops.length >= MAX_STOPS_PER_DAY) return plan;
  const next = withDay(plan, target, (day) => ({
    ...day,
    stops: [...day.stops, stop],
  }));
  return { ...next, destination: destination ?? plan.destination };
}

export function removeStop(plan: Plan, id: string): Plan {
  const found = findStop(plan, id);
  if (!found) return plan;
  const next = withDay(plan, found.day, (day) => ({
    ...day,
    stops: day.stops.filter((s) => s.id !== id),
  }));
  return stopCount(next) === 0 ? { ...next, destination: undefined } : next;
}

/** Moves a stop earlier or later within its day. */
export function moveStop(plan: Plan, id: string, delta: -1 | 1): Plan {
  const found = findStop(plan, id);
  if (!found) return plan;
  const to = found.index + delta;
  const length = plan.days[found.day].stops.length;
  if (to < 0 || to >= length) return plan;
  return withDay(plan, found.day, (day) => {
    const stops = [...day.stops];
    [stops[found.index], stops[to]] = [stops[to], stops[found.index]];
    return { ...day, stops };
  });
}

/** Moves a stop to the end of another day. */
export function moveStopToDay(plan: Plan, id: string, toDay: number): Plan {
  const found = findStop(plan, id);
  if (!found || toDay === found.day) return plan;
  if (toDay < 0 || toDay >= plan.days.length) return plan;
  if (plan.days[toDay].stops.length >= MAX_STOPS_PER_DAY) return plan;
  const stop = plan.days[found.day].stops[found.index];
  return {
    ...plan,
    days: plan.days.map((day, i) => {
      if (i === found.day)
        return { ...day, stops: day.stops.filter((s) => s.id !== id) };
      if (i === toDay) return { ...day, stops: [...day.stops, stop] };
      return day;
    }),
  };
}

export function setDwell(plan: Plan, id: string, dwell: number): Plan {
  const found = findStop(plan, id);
  if (!found) return plan;
  return withDay(plan, found.day, (day) => ({
    ...day,
    stops: day.stops.map((s) =>
      s.id === id ? { ...s, dwell: clampDwell(dwell) } : s,
    ),
  }));
}

/** Applies a new visiting order (indices into the day's stops). */
export function reorderDay(
  plan: Plan,
  dayIndex: number,
  order: number[],
): Plan {
  const day = plan.days[dayIndex];
  if (!day) return plan;
  const unique = new Set(order);
  if (order.length !== day.stops.length || unique.size !== order.length)
    return plan;
  if (
    order.some((i) => !Number.isInteger(i) || i < 0 || i >= day.stops.length)
  ) {
    return plan;
  }
  return withDay(plan, dayIndex, (d) => ({
    ...d,
    stops: order.map((i) => day.stops[i]),
  }));
}

export function setDayStart(
  plan: Plan,
  dayIndex: number,
  minutes: number,
): Plan {
  return withDay(plan, dayIndex, (day) => ({
    ...day,
    start: clampStart(minutes),
  }));
}

export function setDayMode(plan: Plan, dayIndex: number, mode: Mode): Plan {
  return withDay(plan, dayIndex, (day) => ({ ...day, mode }));
}

export function addDay(plan: Plan): Plan {
  if (plan.days.length >= MAX_DAYS) return plan;
  // A new day starts like the previous one, which is usually what people want.
  const last = plan.days[plan.days.length - 1];
  return {
    ...plan,
    days: [...plan.days, { start: last.start, mode: last.mode, stops: [] }],
  };
}

/** Removes a day and its stops. The last remaining day is emptied instead. */
export function removeDay(plan: Plan, dayIndex: number): Plan {
  if (dayIndex < 0 || dayIndex >= plan.days.length) return plan;
  if (plan.days.length === 1) {
    return { destination: undefined, days: [{ ...plan.days[0], stops: [] }] };
  }
  const next = { ...plan, days: plan.days.filter((_, i) => i !== dayIndex) };
  return stopCount(next) === 0 ? { ...next, destination: undefined } : next;
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

type PackedStop = [string, number, number, "c" | "f", number, string?, string?];
type PackedDay = [number, "w" | "b" | "d", PackedStop[]];

const MODE_CODE: Record<Mode, PackedDay[1]> = {
  walk: "w",
  bike: "b",
  drive: "d",
};
const CODE_MODE: Record<string, Mode> = { w: "walk", b: "bike", d: "drive" };

function pack(stop: Stop): PackedStop {
  return [
    stop.name,
    Number(stop.lat.toFixed(5)),
    Number(stop.lon.toFixed(5)),
    stop.category === "cafe" ? "c" : "f",
    stop.dwell,
    stop.address,
    stop.hours,
  ];
}

/** Compact URL-safe token holding the whole trip (no server storage). */
export function encodePlan(plan: Plan): string {
  const days: PackedDay[] = plan.days.map((day) => [
    day.start,
    MODE_CODE[day.mode],
    day.stops.map(pack),
  ]);
  return toBase64Url(JSON.stringify({ v: 2, d: plan.destination, y: days }));
}

function unpackStop(item: unknown): Stop | null {
  if (!Array.isArray(item)) return null;
  const [name, lat, lon, cat, dwell, address, hours] = item as unknown[];
  const cleanName = clip(name, 80);
  if (!cleanName) return null;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!isLat(lat) || !isLon(lon)) return null;
  if (cat !== "c" && cat !== "f") return null;
  const category: Category = cat === "c" ? "cafe" : "food";
  const cleanAddress = clip(address, 160);
  const cleanHours = clip(hours, 120);
  return {
    id: stopId(lat, lon),
    name: cleanName,
    lat,
    lon,
    category,
    dwell:
      typeof dwell === "number" ? clampDwell(dwell) : defaultDwell(category),
    ...(cleanAddress ? { address: cleanAddress } : {}),
    ...(cleanHours ? { hours: cleanHours } : {}),
  };
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
  const record = data as { v?: unknown; d?: unknown; s?: unknown; y?: unknown };

  // Version 1 links held a single day of stops.
  let rawDays: { start: unknown; mode: unknown; stops: unknown }[];
  if (record.v === 1 && Array.isArray(record.s)) {
    rawDays = [{ start: DEFAULT_START, mode: "w", stops: record.s }];
  } else if (record.v === 2 && Array.isArray(record.y)) {
    rawDays = [];
    for (const day of record.y.slice(0, MAX_DAYS)) {
      if (!Array.isArray(day)) return null;
      rawDays.push({ start: day[0], mode: day[1], stops: day[2] });
    }
  } else {
    return null;
  }

  const seen = new Set<string>();
  let total = 0;
  const days: Day[] = [];
  for (const raw of rawDays) {
    if (!Array.isArray(raw.stops)) return null;
    const stops: Stop[] = [];
    for (const item of raw.stops.slice(0, MAX_STOPS_PER_DAY)) {
      const stop = unpackStop(item);
      if (!stop) return null;
      if (seen.has(stop.id) || total >= MAX_TOTAL_STOPS) continue;
      seen.add(stop.id);
      total++;
      stops.push(stop);
    }
    days.push({
      start:
        typeof raw.start === "number" ? clampStart(raw.start) : DEFAULT_START,
      mode:
        typeof raw.mode === "string" ? (CODE_MODE[raw.mode] ?? "walk") : "walk",
      stops,
    });
  }
  const destination = clip(record.d, 80);
  return {
    ...(destination ? { destination } : {}),
    days: days.length > 0 ? days : [newDay()],
  };
}

/** Extracts the token from a location hash like "#p=abc". */
export function tokenFromHash(hash: string): string | null {
  const match = /^#p=([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? match[1] : null;
}
