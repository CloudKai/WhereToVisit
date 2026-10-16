import { slugify } from "./text.ts";

export const PLATFORMS = ["tiktok", "instagram", "xiaohongshu"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  xiaohongshu: "Xiaohongshu",
};

/** A post link a visitor shared for a place. Never verified by us. */
export type SocialPost = {
  id: string;
  platform: Platform;
  /** Rebuilt by us from the parts we accept, never the raw pasted text. */
  url: string;
  at: number;
};

export const MAX_POSTS_PER_PLACE = 20;

// ---------- accepting post links ----------

const MAX_URL_LENGTH = 300;

type Parsed = { platform: Platform; url: string };

/**
 * Accepts only real post links on the three platforms and rebuilds a clean
 * link from the parts that matter. Anything else returns null: other sites,
 * profile or search pages, ports, embedded logins, odd encodings.
 * Query strings and fragments are dropped (a Xiaohongshu link may then need
 * to be opened from the original share to display).
 */
export function parseSocialUrl(input: unknown): Parsed | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (text.length === 0 || text.length > MAX_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`,
    );
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  if (url.pathname.includes("%") || url.pathname.includes("..")) return null;

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");

  if (host === "www.tiktok.com" || host === "tiktok.com") {
    const m = /^\/@([A-Za-z0-9._]{1,24})\/video\/(\d{5,25})$/.exec(path);
    if (m) {
      return {
        platform: "tiktok",
        url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`,
      };
    }
    return null;
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    const m = /^\/([A-Za-z0-9]{6,15})$/.exec(path);
    return m ? { platform: "tiktok", url: `https://${host}/${m[1]}/` } : null;
  }

  if (host === "www.instagram.com" || host === "instagram.com") {
    const m =
      /^(?:\/[A-Za-z0-9._]{1,30})?\/(p|reel|tv)\/([A-Za-z0-9_-]{5,40})$/.exec(
        path,
      );
    return m
      ? {
          platform: "instagram",
          url: `https://www.instagram.com/${m[1]}/${m[2]}/`,
        }
      : null;
  }

  if (host === "www.xiaohongshu.com" || host === "xiaohongshu.com") {
    const m = /^\/(?:explore|discovery\/item)\/([0-9a-f]{24})$/.exec(path);
    return m
      ? {
          platform: "xiaohongshu",
          url: `https://www.xiaohongshu.com/explore/${m[1]}`,
        }
      : null;
  }
  if (host === "xhslink.com" || host === "www.xhslink.com") {
    const m = /^\/(?:[a-z]\/)?([A-Za-z0-9]{4,24})$/.exec(path);
    return m
      ? { platform: "xiaohongshu", url: `https://xhslink.com${path}` }
      : null;
  }
  return null;
}

// ---------- which place a post belongs to ----------

/** Stable identity of a place across searches: its name and rounded position. */
export function placeKey(place: {
  name: string;
  lat: number;
  lon: number;
}): string {
  const name = slugify(place.name).slice(0, 40);
  return `${name}@${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
}

const PLACE_KEY =
  /^([\p{L}\p{N}-]{1,40})@(-?\d{1,3}\.\d{4}),(-?\d{1,3}\.\d{4})$/u;

/** Reads a place key back into coordinates; null unless it is well formed. */
export function parsePlaceKey(
  key: unknown,
): { lat: number; lon: number } | null {
  if (typeof key !== "string" || key.length > 80) return null;
  const m = PLACE_KEY.exec(key);
  if (!m) return null;
  const lat = Number(m[2]);
  const lon = Number(m[3]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
    ? { lat, lon }
    : null;
}

/** About 11 km square. Posts are stored per cell so one read covers a whole city view. */
export function cellOf(lat: number, lon: number): string {
  return `${Math.floor(lat * 10)}_${Math.floor(lon * 10)}`;
}

const CELL = /^-?\d{1,4}_-?\d{1,4}$/;

export function isCell(value: unknown): value is string {
  return typeof value === "string" && CELL.test(value);
}

export const MAX_CELLS_PER_REQUEST = 9;

/** The distinct cells that a set of places touches. */
export function cellsFor(places: { lat?: number; lon?: number }[]): string[] {
  const cells = new Set<string>();
  for (const p of places) {
    if (p.lat !== undefined && p.lon !== undefined)
      cells.add(cellOf(p.lat, p.lon));
  }
  return [...cells].slice(0, MAX_CELLS_PER_REQUEST);
}

// ---------- looking a place up on each platform (plain links) ----------

export type SearchLink = { platform: Platform; label: string; href: string };

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

/** A hashtag-safe version of a name: letters and digits only. */
export function hashtagFor(name: string): string {
  return [...name.normalize("NFKC")]
    .filter((ch) => /[\p{L}\p{N}]/u.test(ch))
    .join("")
    .toLowerCase()
    .slice(0, 40);
}

/**
 * Links that open each app's own search for a place. They do not say anything
 * about popularity: they just save the person typing the name.
 */
export function socialSearchLinks(
  place: { name: string; localName?: string },
  city: string,
): SearchLink[] {
  const q = (text: string) => encodeURIComponent(text.trim());
  const links: SearchLink[] = [
    {
      platform: "tiktok",
      label: PLATFORM_LABEL.tiktok,
      href: `https://www.tiktok.com/search?q=${q(`${place.name} ${city}`)}`,
    },
  ];
  const tag = hashtagFor(place.name);
  if (tag.length >= 3) {
    links.push({
      platform: "instagram",
      label: PLATFORM_LABEL.instagram,
      href: `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`,
    });
  }
  // Xiaohongshu is mostly Chinese: prefer the local name when it is Chinese.
  const keyword =
    place.localName && CJK.test(place.localName)
      ? place.localName
      : `${place.name} ${city}`;
  links.push({
    platform: "xiaohongshu",
    label: PLATFORM_LABEL.xiaohongshu,
    href: `https://www.xiaohongshu.com/search_result?keyword=${q(keyword)}`,
  });
  return links;
}

/** "TikTok ×2 · Instagram ×1" ordering helper: counts per platform, most first. */
export function countByPlatform(
  posts: Pick<SocialPost, "platform">[],
): { platform: Platform; count: number }[] {
  const counts = new Map<Platform, number>();
  for (const post of posts) {
    counts.set(post.platform, (counts.get(post.platform) ?? 0) + 1);
  }
  return [...counts]
    .map(([platform, count]) => ({ platform, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform),
    );
}
