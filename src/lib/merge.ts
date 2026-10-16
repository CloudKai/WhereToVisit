import { CATEGORY_INFO } from "./categories.ts";
import { haversineKm } from "./geo.ts";
import { namesMatch, slugify, truncateText } from "./text.ts";
import type {
  Destination,
  Photo,
  Place,
  RawPlace,
  Reason,
  Source,
} from "./types.ts";

export const CARD_TEXT_MAX = 170;
/** Wikivoyage listings and OSM points further apart than this are not the same venue. */
const MATCH_DISTANCE_KM = 0.5;

export function commonsPhoto(file: string): Photo {
  const encoded = encodeURIComponent(file.replace(/ /g, "_"));
  return {
    url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=720`,
    pageUrl: `https://commons.wikimedia.org/wiki/File:${encoded}`,
    credit: "Wikimedia Commons",
    kind: "place",
  };
}

/** Practical-facts line used when a place has no description at all. */
export function factsLine(raw: RawPlace, areaName: string): string {
  const info = CATEGORY_INFO[raw.category];
  const isFood = raw.category === "cafe" || raw.category === "food";
  let head: string;
  if (isFood) {
    const cuisine =
      raw.cuisines.length > 0
        ? ` serving ${raw.cuisines.map((c) => c.toLowerCase()).join(", ")}`
        : "";
    head = `${info.label}${cuisine} near ${areaName}.`;
  } else {
    const kind = raw.cuisines.length > 0 ? raw.cuisines[0] : info.label;
    head = `${kind} near ${areaName}.`;
  }
  const extras = raw.facts.length > 0 ? ` ${raw.facts.join(" · ")}.` : "";
  return `${head}${extras}`;
}

export function buildReason(raw: RawPlace, areaName: string): Reason {
  if (raw.description && raw.descriptionBasis) {
    const short = truncateText(raw.description, CARD_TEXT_MAX);
    return {
      basis: raw.descriptionBasis,
      text: short,
      fullText: short === raw.description ? undefined : raw.description,
      polished: false,
    };
  }
  return { basis: "facts", text: factsLine(raw, areaName), polished: false };
}

/** Data-richness score for places without an editorial recommendation. */
export function scoreOsm(raw: RawPlace): number {
  let score = 0;
  if (raw.flags.michelin) score += 8;
  if (raw.wikidata) score += 6;
  if (raw.flags.wikipedia) score += 4;
  if (raw.description) score += 4;
  if (raw.photoFile) score += 3;
  if (raw.website) score += 3;
  if (raw.hours) score += 3;
  if (raw.cuisines.length > 0) score += 2;
  if (raw.phone) score += 1;
  if (raw.address) score += 1;
  if (raw.flags.chain) score -= 3;
  return score;
}

function scoreEditor(raw: RawPlace, osm: RawPlace | undefined): number {
  let score = 100;
  if (raw.description) score += 10;
  if (raw.lat !== undefined) score += 5;
  if (raw.wikidata ?? osm?.wikidata) score += 5;
  if (osm?.flags.michelin) score += 4;
  if (osm) score += 2;
  return score;
}

function uniqueSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.kind}:${s.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toPlace(
  id: string,
  primary: RawPlace,
  osm: RawPlace | undefined,
  tier: Place["tier"],
  score: number,
  destination: Destination,
): Place {
  // Merged venues keep the editor text but prefer OSM's mapped position.
  const lat = osm?.lat ?? primary.lat;
  const lon = osm?.lon ?? primary.lon;
  const photoFile = primary.photoFile ?? osm?.photoFile;
  const cuisines =
    primary.cuisines.length > 0 ? primary.cuisines : (osm?.cuisines ?? []);
  const facts = [...primary.facts, ...(osm?.facts ?? [])];
  const reasonSource: RawPlace = {
    ...primary,
    cuisines,
    facts,
    description: primary.description ?? osm?.description,
    descriptionBasis: primary.description
      ? primary.descriptionBasis
      : osm?.descriptionBasis,
  };
  return {
    id,
    name: primary.name,
    localName: primary.localName ?? osm?.localName,
    category: primary.category,
    cuisines,
    lat,
    lon,
    address: primary.address ?? osm?.address,
    hours: primary.hours ?? osm?.hours,
    price: primary.price ?? osm?.price,
    phone: primary.phone ?? osm?.phone,
    website: primary.website ?? osm?.website,
    reason: buildReason(reasonSource, destination.name),
    photo: photoFile ? commonsPhoto(photoFile) : undefined,
    wikidata: primary.wikidata ?? osm?.wikidata,
    sources: uniqueSources([primary.source, ...(osm ? [osm.source] : [])]),
    tier,
    score,
    distanceKm:
      lat !== undefined && lon !== undefined
        ? Math.round(haversineKm(destination, { lat, lon }) * 10) / 10
        : undefined,
  };
}

function findMatch(
  listing: RawPlace,
  candidates: RawPlace[],
  used: Set<RawPlace>,
): RawPlace | undefined {
  let best: { place: RawPlace; km: number } | undefined;
  for (const candidate of candidates) {
    if (used.has(candidate)) continue;
    const names = [listing.name, listing.localName].filter((n): n is string =>
      Boolean(n),
    );
    const candidateNames = [candidate.name, candidate.localName].filter(
      (n): n is string => Boolean(n),
    );
    if (!names.some((a) => candidateNames.some((b) => namesMatch(a, b)))) {
      continue;
    }
    let km = 0;
    if (
      listing.lat !== undefined &&
      listing.lon !== undefined &&
      candidate.lat !== undefined &&
      candidate.lon !== undefined
    ) {
      km = haversineKm(
        { lat: listing.lat, lon: listing.lon },
        { lat: candidate.lat, lon: candidate.lon },
      );
      if (km > MATCH_DISTANCE_KM) continue;
    }
    if (!best || km < best.km) best = { place: candidate, km };
  }
  return best?.place;
}

/**
 * Drops repeats of the same venue (same name, and within `maxKm` when both
 * have coordinates). The first record is kept; missing fields are not merged.
 */
export function dedupe(places: RawPlace[], maxKm: number): RawPlace[] {
  const kept: RawPlace[] = [];
  for (const place of places) {
    const repeat = kept.some((other) => {
      if (!namesMatch(place.name, other.name)) return false;
      if (
        place.lat === undefined ||
        place.lon === undefined ||
        other.lat === undefined ||
        other.lon === undefined
      ) {
        return true;
      }
      return (
        haversineKm(
          { lat: place.lat, lon: place.lon },
          { lat: other.lat, lon: other.lon },
        ) <= maxKm
      );
    });
    if (!repeat) kept.push(place);
  }
  return kept;
}

function byScoreThenDistance(a: Place, b: Place): number {
  return (
    b.score - a.score ||
    (a.distanceKm ?? Number.POSITIVE_INFINITY) -
      (b.distanceKm ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * Combines Wikivoyage editor listings with OpenStreetMap places.
 * Editor listings become "editor" places (matched OSM data fills in practical
 * details); everything else is "nearby" and ranked only by data richness.
 */
export function mergePlaces(
  destination: Destination,
  rawListings: RawPlace[],
  rawOsmPlaces: RawPlace[],
): { editorPicks: Place[]; nearby: Place[] } {
  const listings = dedupe(rawListings, MATCH_DISTANCE_KM);
  const osmPlaces = dedupe(rawOsmPlaces, 0.05);
  const used = new Set<RawPlace>();
  const ids = new Set<string>();
  const makeId = (raw: RawPlace, prefix: string) => {
    const base = `${prefix}-${slugify(raw.name)}`;
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };

  const editorPicks: Place[] = [];
  for (const listing of listings) {
    const match = findMatch(listing, osmPlaces, used);
    if (match) used.add(match);
    editorPicks.push(
      toPlace(
        makeId(listing, "e"),
        listing,
        match,
        "editor",
        scoreEditor(listing, match),
        destination,
      ),
    );
  }

  const nearby: Place[] = [];
  for (const osm of osmPlaces) {
    if (used.has(osm)) continue;
    nearby.push(
      toPlace(
        makeId(osm, "n"),
        osm,
        undefined,
        "nearby",
        scoreOsm(osm),
        destination,
      ),
    );
  }

  return {
    editorPicks: editorPicks.sort(byScoreThenDistance),
    nearby: nearby.sort(byScoreThenDistance),
  };
}
