import { getConfig } from "@/lib/config";
import { extractPlaces } from "@/lib/extract";
import { WindowCounter } from "@/lib/http";
import { clientId, fail, handleError, json, readJson } from "@/lib/room-http";
import { allow } from "@/lib/rooms";
import { getStore } from "@/lib/store";

// Used only when no shared store is configured (local development).
const localHour = new WindowCounter(3600_000);
const localMinute = new WindowCounter(60_000);

/** Finds the places named in the posts a person provided and where they are. */
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
    return json(
      await extractPlaces({ entries: body.entries, hint: body.hint }, config),
    );
  } catch (error) {
    return handleError(error);
  }
}
