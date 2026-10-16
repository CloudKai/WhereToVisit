import { ConfigError, getConfig } from "./config.ts";
import { addPhotos } from "./images.ts";
import { fetchOsmPlaces } from "./geoapify.ts";
import { TtlCache, withTimeout } from "./http.ts";
import { polishPlaces } from "./llm.ts";
import { mergePlaces } from "./merge.ts";
import type { Destination, ExploreResult, Place } from "./types.ts";
import { fetchWikivoyagePlaces } from "./wikivoyage.ts";

/** Most places kept per type (café, park, ...) and tier. */
const MAX_PER_TYPE = 20;
/** The first few of each type are enriched first (they are what "All" shows). */
export const HEADLINE_PER_TYPE = 5;

const results = new TtlCache<ExploreResult>(6 * 3600 * 1000, 100);

function cacheKey(d: Destination): string {
  return `${d.lat.toFixed(3)},${d.lon.toFixed(3)},${d.radiusM}`;
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : "unknown error";
}

/** Keeps the first `max` places of each type, preserving order. */
export function capPerType(places: Place[], max: number): Place[] {
  const seen = new Map<string, number>();
  return places.filter((place) => {
    const count = seen.get(place.category) ?? 0;
    seen.set(place.category, count + 1);
    return count < max;
  });
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

  const config = getConfig();
  if (!config.geoapifyKey) throw new ConfigError("GEOAPIFY_API_KEY");

  const [wikivoyage, osm] = await Promise.allSettled([
    fetchWikivoyagePlaces(destination, config.wikimediaContact),
    fetchOsmPlaces(destination, config.geoapifyKey),
  ]);

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
    notes.push(
      "Nearby map data could not be loaded right now, so practical details may be missing.",
    );
  }

  const merged = mergePlaces(
    destination,
    wikivoyage.status === "fulfilled" ? wikivoyage.value : [],
    osm.status === "fulfilled" ? osm.value : [],
  );
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
  }
  return result;
}
