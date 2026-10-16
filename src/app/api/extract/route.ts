import { getConfig } from "@/lib/config";
import type { ExtractCapabilities } from "@/lib/extract-types";
import { extractPlaces, validateExtractInput } from "@/lib/extract";
import { extractStream } from "@/lib/extract-stream";
import { WindowCounter } from "@/lib/http";
import { clientId, fail, handleError, json, readJson } from "@/lib/room-http";
import { allow } from "@/lib/rooms";
import { getStore } from "@/lib/store";

// Used only when no shared store is configured (local development).
const localHour = new WindowCounter(3600_000);
const localMinute = new WindowCounter(60_000);

/** What this site can do, so the page can set honest expectations. No secrets. */
export async function GET() {
  const config = getConfig();
  const capabilities: ExtractCapabilities = {
    ready: Boolean(config.geoapifyKey),
    tiktokCaptions: config.tiktokOembed,
    ai: Boolean(config.openaiKey),
  };
  return json(capabilities);
}

/**
 * Finds the places named in the posts a person provided and where they are.
 * The reply is a stream of JSON lines (progress, then the result) so the page
 * can show how far along the search is.
 */
export async function POST(request: Request) {
  const config = getConfig();
  if (!config.geoapifyKey) {
    return fail(503, "Finding places needs a Geoapify key (GEOAPIFY_API_KEY).");
  }
  try {
    // This is the one endpoint that spends AI and map-lookup allowance.
    const client = clientId(request);
    const store = getStore(config);
    const allowed = store
      ? (await allow(store, "extract-hour", client, 12, 3600)) &&
        (await allow(store, "extract-min", client, 3, 60))
      : localHour.take(client, 12) && localMinute.take(client, 3);
    if (!allowed) {
      return fail(
        429,
        "Too many searches. Please wait a little and try again.",
        {
          "retry-after": "60",
        },
      );
    }
    const body = await readJson(request);
    // Reject a bad request with a proper status before streaming begins.
    validateExtractInput({ entries: body.entries, hint: body.hint });

    const stream = extractStream((onProgress) =>
      extractPlaces(
        { entries: body.entries, hint: body.hint },
        config,
        undefined,
        onProgress,
      ),
    );
    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        // Ask proxies not to hold the stream back, or the bar would jump.
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
