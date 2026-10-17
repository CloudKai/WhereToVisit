import type { SpeechSegment } from "./extract-types.ts";

/**
 * Sends the small audio file made on this device and gets back timed text.
 * Throws an Error with a message that is safe to show.
 */
export async function listen(wav: Uint8Array): Promise<SpeechSegment[]> {
  let response: Response;
  try {
    response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: new Blob([wav as unknown as BlobPart], { type: "audio/wav" }),
    });
  } catch {
    throw new Error("Can’t reach the server to listen to the audio.");
  }
  const data = (await response.json().catch(() => ({}))) as {
    segments?: unknown;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? "Couldn’t listen to the audio right now.");
  }
  return Array.isArray(data.segments) ? (data.segments as SpeechSegment[]) : [];
}
