import { getConfig } from "@/lib/config";
import { WindowCounter } from "@/lib/http";
import { clientId, fail, handleError, json } from "@/lib/room-http";
import { allow, RoomError } from "@/lib/rooms";
import { getStore } from "@/lib/store";
import { checkWav, MAX_AUDIO_BYTES, transcribe } from "@/lib/transcribe";

/** Reading pictures and audio can take a while; the host default is too short. */
export const maxDuration = 60;

// Used only when no shared store is configured (local development).
const localHour = new WindowCounter(3600_000);
const localMinute = new WindowCounter(60_000);

/**
 * Turns the sound of a screen recording into timed text. The page makes a small
 * mono WAV file on the person's device (the video itself is never uploaded) and
 * sends just that. Nothing is stored.
 */
export async function POST(request: Request) {
  const config = getConfig();
  if (!config.openaiKey) {
    return fail(
      503,
      "Listening to audio needs an OpenAI key (OPENAI_API_KEY).",
    );
  }
  try {
    // Requiring a non-form content type means other websites cannot post here.
    if (
      !request.headers.get("content-type")?.toLowerCase().includes("audio/wav")
    ) {
      throw new RoomError(415, "Expected a WAV sound file.");
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_AUDIO_BYTES) {
      throw new RoomError(413, "That audio is too long. Use up to 2 minutes.");
    }

    const client = clientId(request);
    const store = getStore(config);
    const allowed = store
      ? (await allow(store, "listen-hour", client, 16, 3600)) &&
        (await allow(store, "listen-min", client, 4, 60))
      : localHour.take(client, 16) && localMinute.take(client, 4);
    if (!allowed) {
      return fail(
        429,
        "Too many requests. Please wait a little and try again.",
        {
          "retry-after": "60",
        },
      );
    }

    const wav = new Uint8Array(await request.arrayBuffer());
    const { seconds } = checkWav(wav);
    try {
      const segments = await transcribe(wav, config);
      return json({ segments, seconds });
    } catch (error) {
      console.warn(
        `[transcribe] failed: ${error instanceof Error ? error.message : "error"}`,
      );
      return fail(
        502,
        "Couldn’t listen to the audio right now. The pictures are still used.",
      );
    }
  } catch (error) {
    return handleError(error);
  }
}
