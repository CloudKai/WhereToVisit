import { ConfigError, getConfig } from "./config.ts";
import { fetchOsmPlaces } from "./geoapify.ts";
import { TtlCache } from "./http.ts";
import { polishPlaces } from "./llm.ts";
import { mergePlaces } from "./merge.ts";
import type { Destination, ExploreResult, Place } from "./types.ts";
import { fetchWikivoyagePlaces } from "./wikivoyage.ts";

const MAX_EDITOR = 24;
const MAX_NEARBY = 24;

const results = new TtlCache<ExploreResult>(6 * 3600 * 1000, 100);

function cacheKey(d: Destination): string {
  return `${d.lat.toFixed(3)},${d.lon.toFixed(3)},${d.radiusM}`;
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : "unknown error";
}

/**
 * Finds recommended cafés and restaurants for a destination.
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
  const editorCandidates = merged.editorPicks.slice(0, MAX_EDITOR);
  const nearbyCandidates = merged.nearby.slice(0, MAX_NEARBY);

  const polish = await polishPlaces(
    [...editorCandidates, ...nearbyCandidates],
    config,
  );
  const editorPicks: Place[] = polish.places.filter((p) => p.tier === "editor");
  const nearby: Place[] = polish.places.filter((p) => p.tier === "nearby");

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
