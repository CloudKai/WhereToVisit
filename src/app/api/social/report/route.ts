import { reporterKey, reportPost } from "@/lib/community";
import { getConfig } from "@/lib/config";
import {
  clientId,
  fail,
  handleError,
  json,
  limit,
  readJson,
  requireStore,
} from "@/lib/room-http";

/** Reports a shared link. Enough different visitors hide it. */
export async function POST(request: Request) {
  if (!getConfig().communityPosts) {
    return fail(503, "Shared social links are switched off on this site.");
  }
  const found = requireStore();
  if (found.response) return found.response;
  try {
    const limited = await limit(
      found.store,
      request,
      "social-report",
      20,
      3600,
    );
    if (limited) return limited;
    const body = await readJson(request);
    const result = await reportPost(found.store, {
      placeKey: body.placeKey,
      postId: body.postId,
      reporter: reporterKey(clientId(request)),
    });
    return json(result);
  } catch (error) {
    return handleError(error);
  }
}
