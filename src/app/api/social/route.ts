import { NextResponse } from "next/server";
import { addPost, listPosts } from "@/lib/community";
import { getConfig } from "@/lib/config";
import {
  fail,
  handleError,
  json,
  limit,
  readJson,
  requireStore,
} from "@/lib/room-http";
import { cellOf, MAX_CELLS_PER_REQUEST, parsePlaceKey } from "@/lib/social";

function disabled(): NextResponse | null {
  return getConfig().communityPosts
    ? null
    : fail(503, "Shared social links are switched off on this site.");
}

/** Posts shared for the places in the requested ~11 km cells. */
export async function GET(request: Request) {
  const off = disabled();
  if (off) return off;
  const found = requireStore();
  if (found.response) return found.response;
  try {
    const limited = await limit(found.store, request, "social-read", 120, 60);
    if (limited) return limited;
    const cells = (new URL(request.url).searchParams.get("cells") ?? "")
      .split(",")
      .filter(Boolean)
      .slice(0, MAX_CELLS_PER_REQUEST);
    return json({ posts: await listPosts(found.store, cells) });
  } catch (error) {
    return handleError(error);
  }
}

/** Shares a post link for a place. */
export async function POST(request: Request) {
  const off = disabled();
  if (off) return off;
  const found = requireStore();
  if (found.response) return found.response;
  try {
    const perHour = await limit(
      found.store,
      request,
      "social-add-hour",
      8,
      3600,
    );
    if (perHour) return perHour;
    const perMinute = await limit(
      found.store,
      request,
      "social-add-min",
      3,
      60,
    );
    if (perMinute) return perMinute;

    const body = await readJson(request);
    const at = parsePlaceKey(body.placeKey);
    const posts = await addPost(found.store, {
      placeKey: body.placeKey,
      url: body.url,
    });
    return json({ posts, cell: at ? cellOf(at.lat, at.lon) : undefined }, 201);
  } catch (error) {
    return handleError(error);
  }
}
