import { ConfigError, getConfig } from "./config.ts";
import { inBounds } from "./geo.ts";
import { addPhotos } from "./images.ts";
import { fetchOsmPlaces } from "./geoapify.ts";
import { failureReason, TtlCache, withTimeout } from "./http.ts";
import { polishPlaces } from "./llm.ts";
import { capPerType, foodCount, MIN_FOOD_PLACES } from "./listing.ts";
import { mergePlaces } from "./merge.ts";
import { getStore } from "./store.ts";
import type { Destination, ExploreResult, Place } from "./types.ts";
import { fetchWikivoyagePlaces } from "./wikivoyage.ts";

export { capPerType };

/** Most places kept per type (café, park, ...) and tier. */
const MAX_PER_TYPE = 30;
/** A sparse city search retries once at this radius. */
const WIDE_RADIUS_M = 10000;

const results = new TtlCache<ExploreResult>(6 * 3600 * 1000, 100);

/** Results are also kept in the shared store (Redis) so every visitor and server instance reuses them. */
const SHARED_TTL_SECONDS = 12 * 3600;
const MAX_SHARED_BYTES = 700_000;

async function readShared(
  destination: Destination,
): Promise<ExploreResult | null> {
  const store = getStore(getConfig());
  if (!store) return null;
  try {
    const raw = await store.get(`wtv:explore:v1:${cacheKey(destination)}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ExploreResult>;
    if (!Array.isArray(parsed.editorPicks) || !Array.isArray(parsed.nearby)) {
      return null;
    }
    return {
      destination,
      editorPicks: parsed.editorPicks,
      nearby: parsed.nearby,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      aiUsed: Boolean(parsed.aiUsed),
    };
  } catch {
    return null; // a cache problem must never break a search
  }
}

async function writeShared(result: ExploreResult): Promise<void> {
  const store = getStore(getConfig());
  if (!store) return;
  try {
    const { destination, ...rest } = result;
    const raw = JSON.stringify(rest);
    if (raw.length > MAX_SHARED_BYTES) return;
    await store.set(
      `wtv:explore:v1:${cacheKey(destination)}`,
      raw,
      SHARED_TTL_SECONDS,
    );
  } catch {
    // Caching is an optimisation only.
  }
}

function cacheKey(d: Destination): string {
  const area = d.bounds
    ? [d.bounds.south, d.bounds.west, d.bounds.north, d.bounds.east]
        .map((n) => n.toFixed(4))
        .join(",")
    : "";
  return `${d.lat.toFixed(3)},${d.lon.toFixed(3)},${d.radiusM},${area}`;
}

/** Keeps only places inside the rectangle; places without a position cannot be proven inside. */
export function withinBounds<T extends { lat?: number; lon?: number }>(
  places: T[],
  bounds: Destination["bounds"],
): T[] {
  if (!bounds) return places;
  return places.filter(
    (p) =>
      p.lat !== undefined &&
      p.lon !== undefined &&
      inBounds({ lat: p.lat, lon: p.lon }, bounds),
  );
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : "unknown error";
}

/**
 * Orders places so the top few of every type and tier come first. Photo
 * lookups have a small budget, so they go to the places people see first.
 */
export function prioritise(places: Place[]): Place[] {
  const seen = new Map<string, number>();
  return places
    .map((place, index) => {
      const key = `${place.category}|${place.tier}`;
      const position = seen.get(key) ?? 0;
      seen.set(key, position + 1);
      return { place, index, position };
    })
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map((entry) => entry.place);
}

type Gathered = {
  wikivoyage: PromiseSettledResult<
    Awaited<ReturnType<typeof fetchWikivoyagePlaces>>
  >;
  osm: PromiseSettledResult<Awaited<ReturnType<typeof fetchOsmPlaces>>>;
  merged: ReturnType<typeof mergePlaces>;
};

/** Fetches both sources for a destination and merges what came back. */
async function gather(
  destination: Destination,
  config: ReturnType<typeof getConfig>,
): Promise<Gathered> {
  const [wikivoyage, osm] = await Promise.allSettled([
    fetchWikivoyagePlaces(destination, config.wikimediaContact),
    fetchOsmPlaces(destination, config.geoapifyKey as string),
  ]);
  const merged = mergePlaces(
    destination,
    wikivoyage.status === "fulfilled" ? wikivoyage.value : [],
    osm.status === "fulfilled"
      ? withinBounds(osm.value, destination.bounds)
      : [],
  );
  return { wikivoyage, osm, merged };
}

/**
 * Finds recommended places (food, shopping, sights, museums, parks) for a destination.
 * Wikivoyage supplies editor recommendations; OpenStreetMap (via Geoapify)
 * supplies practical details and "more nearby" places.
 */
export async function explore(
  destination: Destination,
): Promise<ExploreResult> {
  const cached = results.get(cacheKey(destination));
  if (cached) return { ...cached, destination };
  const shared = await readShared(destination);
  if (shared) {
    results.set(cacheKey(destination), shared);
    return shared;
  }

  const config = getConfig();
  if (!config.geoapifyKey) throw new ConfigError("GEOAPIFY_API_KEY");

  let attempt = await gather(destination, config);
  let widenedFrom: number | undefined;

  // Too few places to eat? Look further out once, so a search is never empty-handed.
  if (
    !destination.bounds &&
    destination.radiusM < WIDE_RADIUS_M &&
    attempt.osm.status === "fulfilled" &&
    foodCount(attempt.merged.editorPicks) + foodCount(attempt.merged.nearby) <
      MIN_FOOD_PLACES
  ) {
    const wider = await gather(
      { ...destination, radiusM: WIDE_RADIUS_M },
      config,
    );
    const before =
      foodCount(attempt.merged.editorPicks) + foodCount(attempt.merged.nearby);
    const after =
      foodCount(wider.merged.editorPicks) + foodCount(wider.merged.nearby);
    if (after > before) {
      widenedFrom = destination.radiusM;
      attempt = wider;
    }
  }
  const { wikivoyage, osm, merged } = attempt;

  if (wikivoyage.status === "rejected" && osm.status === "rejected") {
    throw osm.reason;
  }

  const notes: string[] = [];
  if (wikivoyage.status === "rejected") {
    console.warn(`[explore] Wikivoyage failed: ${describe(wikivoyage.reason)}`);
    notes.push(
      "Travel-editor recommendations could not be loaded right now, so only map data is shown.",
    );
  }
  if (osm.status === "rejected") {
    console.warn(`[explore] Geoapify failed: ${describe(osm.reason)}`);
    const why = failureReason(osm.reason);
    const hint =
      process.env.NODE_ENV === "production"
        ? ""
        : " (Development: open /api/status to see exactly which request fails.)";
    notes.push(
      why === "key-rejected"
        ? `The map-data key was rejected, so only travel-editor picks are shown. The site owner should check GEOAPIFY_API_KEY.${hint}`
        : why === "quota"
          ? `Today’s map-data allowance is used up, so only travel-editor picks are shown. Try again tomorrow.${hint}`
          : `Nearby map data could not be loaded right now, so only travel-editor picks are shown and practical details may be missing.${hint}`,
    );
  }

  if (widenedFrom !== undefined) {
    notes.push(
      `Only a few places to eat were found within ${(widenedFrom / 1000).toFixed(1).replace(/\.0$/, "")} km, so the search was widened to ${WIDE_RADIUS_M / 1000} km.`,
    );
  }

  const editorCandidates = capPerType(merged.editorPicks, MAX_PER_TYPE);
  const nearbyCandidates = capPerType(merged.nearby, MAX_PER_TYPE);

  const polish = await polishPlaces(
    [...editorCandidates, ...nearbyCandidates],
    config,
  );

  // Photos are best-effort and time-boxed: the page never waits long for them.
  const priority = prioritise(polish.places);
  const withPhotos = await withTimeout(
    addPhotos(priority, config.wikimediaContact).catch(() => priority),
    7000,
    priority,
  );
  const byId = new Map(withPhotos.map((p) => [p.id, p]));
  const finished = polish.places.map((p) => byId.get(p.id) ?? p);
  const editorPicks: Place[] = finished.filter((p) => p.tier === "editor");
  const nearby: Place[] = finished.filter((p) => p.tier === "nearby");

  if (
    editorPicks.length === 0 &&
    wikivoyage.status === "fulfilled" &&
    nearby.length > 0
  ) {
    notes.push(
      "No travel-editor recommendations were found for this area yet. The places below come from OpenStreetMap and are ordered by how complete their information is, not by quality.",
    );
  }

  const result: ExploreResult = {
    destination,
    editorPicks,
    nearby,
    notes,
    aiUsed: polish.used,
  };
  // Only cache complete results so a temporary upstream failure is retried.
  if (wikivoyage.status === "fulfilled" && osm.status === "fulfilled") {
    results.set(cacheKey(destination), result);
    await writeShared(result);
  }
  return result;
}
