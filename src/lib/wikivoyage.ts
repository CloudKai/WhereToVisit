import { haversineKm, isLat, isLon } from "./geo.ts";
import { getJson } from "./http.ts";
import {
  cleanWikitext,
  commonsFileName,
  humanize,
  safeHttpUrl,
} from "./text.ts";
import type { Category, Destination, RawPlace } from "./types.ts";

export type ListingType = "eat" | "drink" | "see" | "do" | "buy";
const LISTING_TYPES: ListingType[] = ["eat", "drink", "see", "do", "buy"];

export type WikivoyageListing = {
  type: ListingType;
  name: string;
  alt?: string;
  address?: string;
  lat?: number;
  lon?: number;
  hours?: string;
  price?: string;
  phone?: string;
  url?: string;
  description?: string;
  image?: string;
  wikidata?: string;
  page: string;
};

/** Bodies of the top-level {{...}} templates in a wikitext document. */
export function extractTemplates(text: string): string[] {
  const bodies: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("{{", i)) {
      if (depth === 0) start = i + 2;
      depth++;
      i++;
    } else if (depth > 0 && text.startsWith("}}", i)) {
      depth--;
      i++;
      if (depth === 0 && start >= 0) {
        bodies.push(text.slice(start, i - 1));
        start = -1;
      }
    }
  }
  return bodies;
}

/** Splits template parameters on top-level pipes only. */
export function splitParams(body: string): string[] {
  const parts: string[] = [];
  let braces = 0;
  let brackets = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith("{{", i)) {
      braces++;
      current += "{{";
      i++;
    } else if (body.startsWith("}}", i)) {
      braces = Math.max(0, braces - 1);
      current += "}}";
      i++;
    } else if (body.startsWith("[[", i)) {
      brackets++;
      current += "[[";
      i++;
    } else if (body.startsWith("]]", i)) {
      brackets = Math.max(0, brackets - 1);
      current += "]]";
      i++;
    } else if (body[i] === "|" && braces === 0 && brackets === 0) {
      parts.push(current);
      current = "";
    } else {
      current += body[i];
    }
  }
  parts.push(current);
  return parts;
}

function parseCoordinate(
  value: string | undefined,
  valid: (n: number) => boolean,
): number | undefined {
  if (!value) return undefined;
  const n = Number.parseFloat(value.trim());
  return valid(n) ? n : undefined;
}

/** Extracts Eat/Drink listings from one article's wikitext. */
export function parseListings(
  wikitext: string,
  page: string,
): WikivoyageListing[] {
  const listings: WikivoyageListing[] = [];
  for (const body of extractTemplates(wikitext)) {
    const [head, ...rest] = splitParams(body);
    const templateName = head.trim().toLowerCase();
    if (
      templateName !== "listing" &&
      !LISTING_TYPES.includes(templateName as ListingType)
    ) {
      continue;
    }

    const params: Record<string, string> = {};
    for (const part of rest) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      params[part.slice(0, eq).trim().toLowerCase()] = part
        .slice(eq + 1)
        .trim();
    }

    const type =
      templateName === "listing"
        ? params.type?.trim().toLowerCase()
        : templateName;
    if (!LISTING_TYPES.includes(type as ListingType)) continue;

    const name = cleanWikitext(params.name);
    if (!name) continue;

    const wikidata = params.wikidata?.trim();
    listings.push({
      type: type as ListingType,
      name,
      alt: cleanWikitext(params.alt) || undefined,
      address: cleanWikitext(params.address) || undefined,
      lat: parseCoordinate(params.lat, isLat),
      lon: parseCoordinate(params.long ?? params.lon, isLon),
      hours: cleanWikitext(params.hours) || undefined,
      price: cleanWikitext(params.price) || undefined,
      phone: cleanWikitext(params.phone) || undefined,
      url: safeHttpUrl(cleanWikitext(params.url)),
      description: cleanWikitext(params.content) || undefined,
      image: commonsFileName(params.image),
      wikidata: wikidata && /^Q\d+$/.test(wikidata) ? wikidata : undefined,
      page,
    });
  }
  return listings;
}

const CAFE_WORDS =
  /\b(caf[eé]s?|coffee|espresso|roaster(?:y|s)?|tea\s?house|tea\s?room|teahouse|bakery|patisserie|pâtisserie|boulangerie|brunch)\b/i;
const NOT_FOOD_WORDS =
  /\b(night\s?club|nightclub|pub|brewery|cocktail|wine bar|beer|sake bar|karaoke|lounge|disco|dive bar|speakeasy)\b/i;
const PARK_WORDS =
  /\b(parks?|gardens?|botanical|nature reserve|national park|forest|beach|lake|waterfall|hill|mount(?:ain)?|island|promenade)\b/i;
const MUSEUM_WORDS =
  /\b(museums?|galler(?:y|ies)|exhibition|art cent(?:re|er)|theat(?:re|er)|opera|concert hall|planetarium|aquarium)\b/i;

/**
 * Chooses our category for a Wikivoyage listing, or null to skip it.
 * "Drink" listings are mostly bars, so only cafés and tea rooms are kept.
 * Park and museum are decided from the name only, because descriptions
 * mention nearby parks and museums all the time.
 */
export function listingCategory(listing: WikivoyageListing): Category | null {
  if (listing.type === "buy") return "shopping";
  if (listing.type === "see" || listing.type === "do") {
    if (MUSEUM_WORDS.test(listing.name)) return "museum";
    if (PARK_WORDS.test(listing.name)) return "park";
    return "attraction";
  }
  const text = `${listing.name} ${listing.description ?? ""}`;
  if (CAFE_WORDS.test(text) && !NOT_FOOD_WORDS.test(listing.name)) {
    return "cafe";
  }
  return listing.type === "drink" ? null : "food";
}

export function pageUrl(title: string): string {
  const path = title
    .replace(/ /g, "_")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `https://en.wikivoyage.org/wiki/${path}`;
}

export function listingToRaw(listing: WikivoyageListing): RawPlace | null {
  const category = listingCategory(listing);
  if (!category) return null;
  return {
    origin: "wikivoyage",
    name: listing.name,
    localName:
      listing.alt && listing.alt !== listing.name ? listing.alt : undefined,
    category,
    cuisines: [],
    lat: listing.lat,
    lon: listing.lon,
    address: listing.address,
    hours: listing.hours,
    price: listing.price,
    phone: listing.phone,
    website: listing.url,
    description: listing.description,
    descriptionBasis: listing.description ? "editor" : undefined,
    photoFile: listing.image,
    wikidata: listing.wikidata,
    facts: [],
    flags: {},
    source: {
      kind: "wikivoyage",
      label: `Wikivoyage: ${humanize(listing.page)}`,
      url: pageUrl(listing.page),
      license: "CC BY-SA 4.0",
    },
  };
}

type GeoSearchResponse = {
  query?: { geosearch?: { title: string; ns: number; dist: number }[] };
};

type PagesResponse = {
  query?: {
    pages?: {
      title: string;
      missing?: boolean;
      revisions?: { slots?: { main?: { content?: string } } }[];
    }[];
  };
};

function userAgent(contact: string | undefined): string {
  return `WhereToVisit/0.2 (${contact || "travel planning prototype"})`;
}

/**
 * Finds Wikivoyage destination articles around the point and reads their
 * Eat/Drink listings. Listings with coordinates outside the radius are dropped.
 */
export async function fetchWikivoyagePlaces(
  destination: Destination,
  contact?: string,
): Promise<RawPlace[]> {
  const headers = { "user-agent": userAgent(contact) };
  const radius = Math.min(10000, Math.max(10, Math.round(destination.radiusM)));
  const geo = new URL("https://en.wikivoyage.org/w/api.php");
  geo.search = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${destination.lat}|${destination.lon}`,
    gsradius: String(radius),
    gslimit: "20",
    gsnamespace: "0",
    format: "json",
    formatversion: "2",
  }).toString();

  const found = await getJson<GeoSearchResponse>("Wikivoyage", geo.toString(), {
    headers,
    revalidate: 86400,
  });
  const titles = (found.query?.geosearch ?? [])
    .filter((entry) => entry.ns === 0)
    // Big cities keep their listings in district articles (e.g. "Tokyo/Shibuya").
    .slice(0, 10)
    .map((entry) => entry.title);
  if (titles.length === 0) return [];

  const content = new URL("https://en.wikivoyage.org/w/api.php");
  content.search = new URLSearchParams({
    action: "query",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    redirects: "1",
    titles: titles.join("|"),
    format: "json",
    formatversion: "2",
  }).toString();
  const pages = await getJson<PagesResponse>("Wikivoyage", content.toString(), {
    headers,
    revalidate: 86400,
    timeoutMs: 20000,
  });

  const maxKm = (radius / 1000) * 1.5;
  const places: RawPlace[] = [];
  for (const page of pages.query?.pages ?? []) {
    const text = page.revisions?.[0]?.slots?.main?.content;
    if (page.missing || !text) continue;
    for (const listing of parseListings(text, page.title)) {
      if (listing.lat !== undefined && listing.lon !== undefined) {
        const km = haversineKm(destination, {
          lat: listing.lat,
          lon: listing.lon,
        });
        if (km > maxKm) continue;
      }
      const raw = listingToRaw(listing);
      if (raw) places.push(raw);
    }
  }
  return places;
}
