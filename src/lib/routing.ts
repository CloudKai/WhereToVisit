import { haversineKm } from "./geo.ts";

export type Mode = "walk" | "bike" | "drive";
export const MODES: Mode[] = ["walk", "bike", "drive"];

export type LatLon = { lat: number; lon: number };
export type Leg = { durationS: number; distanceM: number };

export type RouteResult = {
  /** Indices into the request's stops, in visiting order. */
  order: number[];
  /** legs[i] is the trip from order[i] to order[i + 1]. */
  legs: Leg[];
  /** Road geometry as [lon, lat] pairs, or straight lines for estimates. */
  geometry: [number, number][];
  source: "openrouteservice" | "estimate";
  note?: string;
};

const SPEED_KMH: Record<Mode, number> = { walk: 4.8, bike: 14, drive: 24 };
/** Roads are longer than the straight line between two points. */
const DETOUR: Record<Mode, number> = { walk: 1.3, bike: 1.3, drive: 1.4 };

/** Straight-line estimate used when no routing service is available. */
export function estimateLeg(a: LatLon, b: LatLon, mode: Mode): Leg {
  const distanceM = haversineKm(a, b) * 1000 * DETOUR[mode];
  const durationS = (distanceM / 1000 / SPEED_KMH[mode]) * 3600;
  return { distanceM: Math.round(distanceM), durationS: Math.round(durationS) };
}

export function estimateMatrix(points: LatLon[], mode: Mode): number[][] {
  return points.map((a, i) =>
    points.map((b, j) => (i === j ? 0 : estimateLeg(a, b, mode).durationS)),
  );
}

const BIG = 1e9;
const EXACT_LIMIT = 12;

function identityOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Route built only from straight-line estimates (works with no network). */
export function estimateRoute(
  points: LatLon[],
  mode: Mode,
  optimise: boolean,
  note?: string,
): RouteResult {
  const order = optimise
    ? optimiseOrder(estimateMatrix(points, mode))
    : identityOrder(points.length);
  const ordered = order.map((i) => points[i]);
  const legs: Leg[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    legs.push(estimateLeg(ordered[i], ordered[i + 1], mode));
  }
  return {
    order,
    legs,
    geometry: ordered.map((p) => [p.lon, p.lat] as [number, number]),
    source: "estimate",
    note,
  };
}

function cost(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : BIG;
}

/**
 * Cheapest order that starts at stop 0 and visits every stop once, without
 * returning. Exact (Held–Karp) up to 12 stops; nearest-neighbour beyond that.
 */
export function optimiseOrder(durations: number[][]): number[] {
  const n = durations.length;
  const identity = Array.from({ length: n }, (_, i) => i);
  if (n <= 2) return identity;

  if (n > EXACT_LIMIT) {
    const order = [0];
    const left = new Set(identity.slice(1));
    while (left.size > 0) {
      const last = order[order.length - 1];
      let best = -1;
      for (const candidate of left) {
        if (
          best < 0 ||
          cost(durations[last][candidate]) < cost(durations[last][best])
        ) {
          best = candidate;
        }
      }
      order.push(best);
      left.delete(best);
    }
    return order;
  }

  const full = (1 << n) - 1;
  const dp = new Float64Array((1 << n) * n).fill(Number.POSITIVE_INFINITY);
  const parent = new Int8Array((1 << n) * n).fill(-1);
  dp[1 * n + 0] = 0;
  for (let mask = 1; mask <= full; mask += 2) {
    for (let last = 0; last < n; last++) {
      const here = dp[mask * n + last];
      if (!(mask & (1 << last)) || here === Number.POSITIVE_INFINITY) continue;
      for (let next = 1; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const value = here + cost(durations[last][next]);
        if (value < dp[nextMask * n + next]) {
          dp[nextMask * n + next] = value;
          parent[nextMask * n + next] = last;
        }
      }
    }
  }

  let end = 1;
  for (let j = 2; j < n; j++) {
    if (dp[full * n + j] < dp[full * n + end]) end = j;
  }
  const reversed: number[] = [];
  let mask = full;
  let at = end;
  while (at >= 0) {
    reversed.push(at);
    const before = parent[mask * n + at];
    mask &= ~(1 << at);
    at = before;
  }
  return reversed.reverse();
}

// ---------- schedule & formatting ----------

export type ScheduleItem = { arriveMin: number; departMin: number };

/**
 * Times for each stop. `dwellMin[i]` is minutes spent at stop i and
 * `legSeconds[i]` is the travel time from stop i to stop i + 1.
 */
export function buildSchedule(
  startMin: number,
  dwellMin: number[],
  legSeconds: number[],
): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  let arrive = startMin;
  for (let i = 0; i < dwellMin.length; i++) {
    if (i > 0)
      arrive =
        items[i - 1].departMin + Math.round((legSeconds[i - 1] ?? 0) / 60);
    items.push({ arriveMin: arrive, departMin: arrive + dwellMin[i] });
  }
  return items;
}

export function formatClock(totalMin: number): string {
  const minutes = Math.round(totalMin);
  const day = Math.floor(minutes / 1440);
  const inDay = ((minutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(inDay / 60)).padStart(2, "0");
  const mm = String(inDay % 60).padStart(2, "0");
  return day > 0 ? `${hh}:${mm} (+${day}d)` : `${hh}:${mm}`;
}

/** "09:30" -> 570, or null if not a valid 24-hour time. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")} min`;
}

export function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters / 10) * 10} m`
    : `${(meters / 1000).toFixed(1)} km`;
}
