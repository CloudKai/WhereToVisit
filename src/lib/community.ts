import { createHash } from "node:crypto";
import { RoomError as CommunityError } from "./rooms.ts";
import {
  cellOf,
  isCell,
  MAX_CELLS_PER_REQUEST,
  MAX_POSTS_PER_PLACE,
  parsePlaceKey,
  parseSocialUrl,
  type Platform,
  type SocialPost,
} from "./social.ts";
import type { Store } from "./store.ts";

/** Posts disappear after this long without a new one for that area. */
export const POST_TTL_SECONDS = 90 * 24 * 3600;
/** Different visitors who must report a post before it is hidden. */
export const REPORTS_TO_HIDE = 3;
/** Upper bound on stored posts per ~11 km cell, so storage cannot be flooded. */
export const MAX_FIELDS_PER_CELL = 2000;

type Stored = { p: Platform; u: string; t: number; x?: true };

const postsKey = (cell: string) => `wtv:social:cell:${cell}`;
const reportsKey = (cell: string) => `wtv:social:rep:${cell}`;

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function postId(canonicalUrl: string): string {
  return sha(`post:${canonicalUrl}`).slice(0, 16);
}

/** Identifies the person reporting without storing who they are. */
export function reporterKey(client: string): string {
  return sha(`reporter:${client}`).slice(0, 16);
}

function locate(key: unknown): { cell: string; key: string } {
  const at = parsePlaceKey(key);
  if (!at) throw new CommunityError(400, "That place can’t be tagged.");
  return { cell: cellOf(at.lat, at.lon), key: key as string };
}

function parseStored(json: string): Stored | null {
  try {
    const v = JSON.parse(json) as Partial<Stored>;
    if (
      (v.p === "tiktok" || v.p === "instagram" || v.p === "xiaohongshu") &&
      typeof v.u === "string" &&
      typeof v.t === "number"
    ) {
      return { p: v.p, u: v.u, t: v.t, ...(v.x ? { x: true as const } : {}) };
    }
  } catch {
    // ignore damaged entries
  }
  return null;
}

/** Visible posts for each place in the given cells, newest first. */
export async function listPosts(
  store: Store,
  cells: unknown[],
): Promise<Record<string, SocialPost[]>> {
  const valid = [...new Set(cells.filter(isCell))].slice(
    0,
    MAX_CELLS_PER_REQUEST,
  );
  const byPlace: Record<string, SocialPost[]> = {};
  const all = await Promise.all(
    valid.map((cell) => store.hgetall(postsKey(cell))),
  );
  for (const fields of all) {
    for (const [field, json] of Object.entries(fields)) {
      const sep = field.lastIndexOf("|");
      if (sep < 0) continue;
      const stored = parseStored(json);
      if (!stored || stored.x) continue; // hidden after reports
      const key = field.slice(0, sep);
      (byPlace[key] ??= []).push({
        id: field.slice(sep + 1),
        platform: stored.p,
        url: stored.u,
        at: stored.t,
      });
    }
  }
  for (const key of Object.keys(byPlace)) {
    byPlace[key] = byPlace[key]
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_POSTS_PER_PLACE);
  }
  return byPlace;
}

/** Adds a post link to a place. Repeating the same link is harmless. */
export async function addPost(
  store: Store,
  input: { placeKey: unknown; url: unknown },
  now = Date.now(),
): Promise<SocialPost[]> {
  const where = locate(input.placeKey);
  const parsed = parseSocialUrl(input.url);
  if (!parsed) {
    throw new CommunityError(
      400,
      "That doesn’t look like a TikTok, Instagram or Xiaohongshu post link. Paste the link to a single video or post.",
    );
  }
  const id = postId(parsed.url);
  const field = `${where.key}|${id}`;
  const cell = postsKey(where.cell);

  const existing = await store.hgetall(cell);
  if (existing[field]) {
    if (parseStored(existing[field])?.x) {
      throw new CommunityError(409, "That link was removed after reports.");
    }
  } else {
    if (Object.keys(existing).length >= MAX_FIELDS_PER_CELL) {
      throw new CommunityError(
        409,
        "This area has reached its limit of shared links.",
      );
    }
    const forPlace = Object.entries(existing).filter(
      ([f, json]) => f.startsWith(`${where.key}|`) && !parseStored(json)?.x,
    ).length;
    if (forPlace >= MAX_POSTS_PER_PLACE) {
      throw new CommunityError(
        409,
        "This place already has plenty of shared links.",
      );
    }
    const value: Stored = { p: parsed.platform, u: parsed.url, t: now };
    await store.hset(cell, field, JSON.stringify(value), POST_TTL_SECONDS);
  }
  return (await listPosts(store, [where.cell]))[where.key] ?? [];
}

/**
 * Counts one report. After enough different visitors report a post it is
 * hidden for good (the entry stays as a marker so it cannot simply be re-added).
 */
export async function reportPost(
  store: Store,
  input: { placeKey: unknown; postId: unknown; reporter: string },
): Promise<{ hidden: boolean }> {
  const where = locate(input.placeKey);
  if (
    typeof input.postId !== "string" ||
    !/^[0-9a-f]{16}$/.test(input.postId)
  ) {
    throw new CommunityError(400, "Unknown post.");
  }
  const field = `${where.key}|${input.postId}`;
  const cell = postsKey(where.cell);
  const stored = parseStored((await store.hgetall(cell))[field] ?? "");
  if (!stored) throw new CommunityError(404, "That post no longer exists.");
  if (stored.x) return { hidden: true };

  const reports = reportsKey(where.cell);
  await store.hset(
    reports,
    `${field}|${input.reporter}`,
    "1",
    POST_TTL_SECONDS,
  );
  const count = Object.keys(await store.hgetall(reports)).filter((f) =>
    f.startsWith(`${field}|`),
  ).length;
  if (count < REPORTS_TO_HIDE) return { hidden: false };

  await store.hset(
    cell,
    field,
    JSON.stringify({ ...stored, x: true }),
    POST_TTL_SECONDS,
  );
  return { hidden: true };
}
