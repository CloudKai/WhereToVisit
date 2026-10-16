import type { Config } from "./config.ts";
import { postJson, TtlCache, WindowCounter } from "./http.ts";
import {
  estimateRoute,
  type LatLon,
  type Leg,
  type Mode,
  optimiseOrder,
  type RouteResult,
} from "./routing.ts";

const PROFILE: Record<Mode, string> = {
  walk: "foot-walking",
  bike: "cycling-regular",
  drive: "driving-car",
};

type DirectionsResponse = {
  features?: {
    geometry?: { coordinates?: number[][] };
    properties?: { segments?: { duration?: number; distance?: number }[] };
  }[];
};

type MatrixResponse = { durations?: (number | null)[][] };

/** Reads legs and road geometry from an ORS GeoJSON directions response. */
export function parseDirections(
  data: DirectionsResponse,
  stopCount: number,
): { legs: Leg[]; geometry: [number, number][] } {
  const feature = data.features?.[0];
  const segments = feature?.properties?.segments;
  const coordinates = feature?.geometry?.coordinates;
  if (!segments || !coordinates || segments.length !== stopCount - 1) {
    throw new Error("unexpected directions response");
  }
  const legs = segments.map((segment) => {
    const durationS = segment.duration;
    const distanceM = segment.distance;
    if (typeof durationS !== "number" || typeof distanceM !== "number") {
      throw new Error("incomplete route segment");
    }
    return {
      durationS: Math.round(durationS),
      distanceM: Math.round(distanceM),
    };
  });
  const geometry = coordinates
    .filter(
      (c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]),
    )
    .map((c) => [c[0], c[1]] as [number, number]);
  if (geometry.length < 2) throw new Error("empty route geometry");
  return { legs, geometry };
}

/** Reads a square duration matrix, rejecting missing or non-square data. */
export function parseMatrix(data: MatrixResponse, size: number): number[][] {
  const rows = data.durations;
  if (!rows || rows.length !== size)
    throw new Error("unexpected matrix response");
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length !== size) {
      throw new Error("unexpected matrix row");
    }
    // A null means "no route"; treat as unreachable rather than free.
    return row.map((value) =>
      typeof value === "number" && Number.isFinite(value) ? value : 1e9,
    );
  });
}

const cache = new TtlCache<RouteResult>(6 * 3600 * 1000, 200);
const dailyCalls = new WindowCounter(24 * 3600 * 1000);

function authHeaders(key: string): Record<string, string> {
  return { authorization: key };
}

/**
 * Orders (optionally) and routes the stops with OpenRouteService.
 * Any failure degrades to straight-line estimates with an explanatory note.
 */
export async function planRoute(
  points: LatLon[],
  mode: Mode,
  optimise: boolean,
  config: Pick<Config, "orsKey" | "orsBaseUrl" | "orsDailyCap">,
): Promise<RouteResult> {
  const shouldOptimise = optimise && points.length > 2;
  if (points.length < 2) return estimateRoute(points, mode, false);
  if (!config.orsKey) {
    return estimateRoute(
      points,
      mode,
      shouldOptimise,
      "Straight-line estimates: no routing key is configured.",
    );
  }

  const cacheKey = JSON.stringify([
    mode,
    shouldOptimise,
    points.map((p) => [Number(p.lat.toFixed(5)), Number(p.lon.toFixed(5))]),
  ]);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const calls = shouldOptimise ? 2 : 1;
  for (let i = 0; i < calls; i++) {
    if (!dailyCalls.take("ors", config.orsDailyCap)) {
      return estimateRoute(
        points,
        mode,
        shouldOptimise,
        "Straight-line estimates: today's routing allowance is used up.",
      );
    }
  }

  const base = `${config.orsBaseUrl}/v2`;
  const headers = authHeaders(config.orsKey);
  try {
    let order = Array.from({ length: points.length }, (_, i) => i);
    if (shouldOptimise) {
      const matrix = parseMatrix(
        await postJson<MatrixResponse>(
          "OpenRouteService",
          `${base}/matrix/${PROFILE[mode]}`,
          {
            locations: points.map((p) => [p.lon, p.lat]),
            metrics: ["duration"],
          },
          { headers },
        ),
        points.length,
      );
      order = optimiseOrder(matrix);
    }
    const ordered = order.map((i) => points[i]);
    const { legs, geometry } = parseDirections(
      await postJson<DirectionsResponse>(
        "OpenRouteService",
        `${base}/directions/${PROFILE[mode]}/geojson`,
        {
          coordinates: ordered.map((p) => [p.lon, p.lat]),
          instructions: false,
        },
        { headers },
      ),
      ordered.length,
    );
    const result: RouteResult = {
      order,
      legs,
      geometry,
      source: "openrouteservice",
    };
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.warn(
      `[route] routing failed: ${error instanceof Error ? error.message : "error"}`,
    );
    return estimateRoute(
      points,
      mode,
      shouldOptimise,
      "Straight-line estimates: the routing service could not find or return a route.",
    );
  }
}
