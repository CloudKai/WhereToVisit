import type { Config } from "./config.ts";
import {
  MAX_SEGMENT_CHARS,
  MAX_SPEECH_CHARS,
  MAX_SPEECH_SEGMENTS,
  MAX_VIDEO_SECONDS,
  type SpeechSegment,
} from "./extract-types.ts";
import { WindowCounter } from "./http.ts";
import { RoomError } from "./rooms.ts";

export const MAX_AUDIO_BYTES = 4_000_000;
const WAV_HEADER_BYTES = 44;

const calls = new WindowCounter(24 * 3600 * 1000);

/**
 * Checks that the bytes are the plain WAV file the page makes (mono, 16-bit,
 * 8–48 kHz, at most two minutes) and returns how long it is. Anything else is
 * refused before it is sent anywhere.
 */
export function checkWav(bytes: Uint8Array): { seconds: number } {
  const bad = (message: string) => new RoomError(400, message);
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw new RoomError(413, "That audio is too long. Use up to 2 minutes.");
  }
  if (bytes.length <= WAV_HEADER_BYTES) throw bad("That audio is empty.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt ") {
    throw bad("That isn’t a sound file this site can read.");
  }
  const format = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const rate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  if (format !== 1 || channels !== 1 || bits !== 16) {
    throw bad("Expected mono 16-bit sound.");
  }
  if (rate < 8000 || rate > 48000) throw bad("Unsupported sound quality.");
  if (tag(36) !== "data")
    throw bad("That isn’t a sound file this site can read.");
  const dataBytes = Math.min(
    view.getUint32(40, true),
    bytes.length - WAV_HEADER_BYTES,
  );
  const seconds = dataBytes / (rate * 2);
  if (seconds < 0.5) throw bad("That audio is too short.");
  if (seconds > MAX_VIDEO_SECONDS + 3) {
    throw new RoomError(413, "That audio is too long. Use up to 2 minutes.");
  }
  return { seconds };
}

type RawSegment = {
  start?: unknown;
  text?: unknown;
  no_speech_prob?: unknown;
  avg_logprob?: unknown;
};

/**
 * Cleans what the speech model returned. Speech models sometimes invent text
 * over silence or noise, so phrases the model itself is unsure about are dropped.
 */
export function cleanSegments(raw: unknown): SpeechSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: SpeechSegment[] = [];
  let chars = 0;
  for (const item of raw as RawSegment[]) {
    if (typeof item?.text !== "string") continue;
    const start = typeof item.start === "number" ? item.start : Number.NaN;
    if (!Number.isFinite(start) || start < 0 || start > MAX_VIDEO_SECONDS + 5)
      continue;
    if (typeof item.no_speech_prob === "number" && item.no_speech_prob > 0.6)
      continue;
    if (typeof item.avg_logprob === "number" && item.avg_logprob < -1.5)
      continue;
    const text = item.text
      .replace(/[\p{Cc}\p{Cf}<>]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SEGMENT_CHARS);
    if (text.length < 2) continue;
    if (chars + text.length > MAX_SPEECH_CHARS) break;
    chars += text.length;
    out.push({ start: Math.round(start * 10) / 10, text });
    if (out.length >= MAX_SPEECH_SEGMENTS) break;
  }
  return out;
}

/** Turns the sound into timed text with OpenAI. Throws on any problem. */
export async function transcribe(
  wav: Uint8Array,
  config: Pick<Config, "openaiKey" | "openaiTranscribeModel" | "llmDailyCap">,
  fetchImpl: typeof fetch = fetch,
): Promise<SpeechSegment[]> {
  if (!config.openaiKey) throw new Error("no key");
  if (!calls.take("transcribe", config.llmDailyCap))
    throw new Error("daily cap");
  const form = new FormData();
  form.append(
    "file",
    new Blob([wav as unknown as BlobPart], { type: "audio/wav" }),
    "audio.wav",
  );
  form.append("model", config.openaiTranscribeModel);
  form.append("response_format", "verbose_json");
  const response = await fetchImpl(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.openaiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok) throw new Error(`transcription HTTP ${response.status}`);
  const body = (await response.json()) as { segments?: unknown };
  return cleanSegments(body.segments);
}
