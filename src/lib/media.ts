import {
  AUDIO_SAMPLE_RATE,
  IMAGE_MAX_SIDE,
  MAX_IMAGE_CHARS,
  MAX_VIDEO_SECONDS,
} from "./extract-types.ts";
import { formatTime } from "./evidence.ts";

/** Scales a size down so its longest side is at most `max`; never scales up. */
export function fitSize(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Moments in a video to take a picture of: evenly spread, away from the very
 * start and end (which are often black or a title card).
 */
export function evenTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || count < 1) return [0];
  const margin = Math.min(0.4, duration / 10);
  const span = Math.max(0, duration - 2 * margin);
  if (count === 1) return [round(margin + span / 2)];
  return Array.from({ length: count }, (_, i) =>
    round(margin + (span * i) / (count - 1)),
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

export const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_FILE_BYTES = 400 * 1024 * 1024;
/** Sound is decoded in memory, so only recordings up to this size are listened to. */
export const MAX_AUDIO_SOURCE_BYTES = 150 * 1024 * 1024;
/** Pictures taken from one screen recording. */
export const FRAMES_PER_VIDEO = 8;
/** Quieter than this (average level, 0 to 1) is treated as silence. */
export const SILENCE_LEVEL = 0.003;

export class MediaError extends Error {}

// ---------- sound (pure helpers) ----------

/** Average loudness from 0 (silent) to 1 (full scale). */
export function loudness(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Packs mono samples (-1 to 1) into a 16-bit WAV file. */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number = AUDIO_SAMPLE_RATE,
): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // plain PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      44 + i * 2,
      Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff)),
      true,
    );
  }
  return bytes;
}

/** The part of a recording that is used: at most the first two minutes. */
export function usedSeconds(duration: number): {
  seconds: number;
  truncated: boolean;
} {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return {
    seconds: Math.min(d, MAX_VIDEO_SECONDS),
    truncated: d > MAX_VIDEO_SECONDS + 0.5,
  };
}

// ---------- browser-only below: needs a canvas ----------

/** Draws to a canvas and returns a JPEG data URL small enough to send. */
function canvasToJpeg(
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  sourceWidth: number,
  sourceHeight: number,
): string {
  let side = IMAGE_MAX_SIDE;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { width, height } = fitSize(sourceWidth, sourceHeight, side);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new MediaError("This browser can’t prepare images.");
    ctx.fillStyle = "#fff"; // a flat background for transparent screenshots
    ctx.fillRect(0, 0, width, height);
    draw(ctx, width, height);
    const url = canvas.toDataURL("image/jpeg", attempt < 2 ? 0.8 : 0.6);
    if (url.length <= MAX_IMAGE_CHARS) return url;
    side = Math.round(side * 0.8);
  }
  throw new MediaError("That picture is too detailed to shrink enough.");
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall back to an <img> below
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new MediaError(
      `“${file.name}” can’t be read here. Use a screenshot saved as PNG or JPEG.`,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imageToDataUrl(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new MediaError(`“${file.name}” is too large (over 25 MB).`);
  }
  const image = await loadImage(file);
  const w = "naturalWidth" in image ? image.naturalWidth : image.width;
  const h = "naturalHeight" in image ? image.naturalHeight : image.height;
  return canvasToJpeg(
    (ctx, width, height) => ctx.drawImage(image, 0, 0, width, height),
    w,
    h,
  );
}

function waitFor(
  target: HTMLVideoElement,
  event: string,
  ms: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new MediaError("The video took too long to read.")),
      ms,
    );
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    target.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(
          new MediaError(
            "This browser can’t play that video. Try screenshots instead.",
          ),
        );
      },
      { once: true },
    );
  });
}

type AudioWindow = Window &
  typeof globalThis & { webkitAudioContext?: typeof AudioContext };

/**
 * The sound of a recording as a small mono WAV (first two minutes), made on
 * this device. Null, with the reason, when there is nothing to listen to.
 */
async function videoToAudio(
  file: File,
  seconds: number,
): Promise<{ wav: Uint8Array } | { reason: string }> {
  if (file.size > MAX_AUDIO_SOURCE_BYTES) {
    return {
      reason: `“${file.name}” is too large (over 150 MB) to listen to here, so only its pictures are used.`,
    };
  }
  const w = window as AudioWindow;
  const Ctx = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctx || typeof OfflineAudioContext === "undefined") {
    return {
      reason: "This browser can’t read sound from a recording here.",
    };
  }
  const context = new Ctx();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const length = Math.max(
      1,
      Math.ceil(Math.min(seconds, decoded.duration) * AUDIO_SAMPLE_RATE),
    );
    // Rendering through an offline context mixes to mono and resamples.
    const offline = new OfflineAudioContext(1, length, AUDIO_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    if (loudness(samples) < SILENCE_LEVEL) {
      return {
        reason: `“${file.name}” has no audible speech, so only its pictures are used.`,
      };
    }
    return { wav: encodeWav(samples) };
  } catch {
    return {
      reason: `The sound in “${file.name}” couldn’t be read in this browser, so only its pictures are used.`,
    };
  } finally {
    void context.close().catch(() => undefined);
  }
}

/** Pictures (with the second each was taken) from the first two minutes of a video. */
async function videoToFrames(
  file: File,
  count: number,
): Promise<{
  frames: string[];
  times: number[];
  seconds: number;
  truncated: boolean;
}> {
  if (file.size > MAX_VIDEO_FILE_BYTES) {
    throw new MediaError(`“${file.name}” is too large (over 400 MB).`);
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    video.src = url;
    await waitFor(video, "loadedmetadata", 10000);
    if (!video.videoWidth || !video.videoHeight) {
      throw new MediaError(
        "This browser can’t read that video. Try screenshots instead.",
      );
    }
    const { seconds, truncated } = usedSeconds(video.duration);
    const times = evenTimes(seconds, count);
    const frames: string[] = [];
    for (const time of times) {
      const seeked = waitFor(video, "seeked", 8000);
      video.currentTime = time;
      await seeked;
      frames.push(
        canvasToJpeg(
          (ctx, width, height) => ctx.drawImage(video, 0, 0, width, height),
          video.videoWidth,
          video.videoHeight,
        ),
      );
    }
    return { frames, times, seconds, truncated };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

/** What picked files turned into, all made on this device. */
export type PreparedMedia = {
  images: string[];
  /** The second each image was taken at; undefined for a screenshot. */
  times: (number | undefined)[];
  /** Sound from the first video that has any, ready to be turned into text. */
  audio?: { wav: Uint8Array; name: string };
  notes: string[];
};

/**
 * Turns picked files into pictures (images directly, videos as several frames
 * with their times) and, for a video with sound, a small audio file. Videos are
 * never uploaded.
 */
export async function prepareFiles(
  files: File[],
  room: number,
  wantAudio: boolean,
): Promise<PreparedMedia> {
  const out: PreparedMedia = { images: [], times: [], notes: [] };
  for (const file of files) {
    const left = room - out.images.length;
    if (left <= 0) break;
    if (file.type.startsWith("video/")) {
      const { frames, times, seconds, truncated } = await videoToFrames(
        file,
        Math.min(FRAMES_PER_VIDEO, left),
      );
      out.images.push(...frames);
      out.times.push(...times);
      if (truncated) {
        out.notes.push(
          `“${file.name}” is longer than ${formatTime(MAX_VIDEO_SECONDS)}, so only the first ${formatTime(MAX_VIDEO_SECONDS)} is used.`,
        );
      }
      if (wantAudio) {
        if (out.audio) {
          out.notes.push(
            `Only the sound of the first video is used; “${file.name}” adds pictures only.`,
          );
        } else {
          const heard = await videoToAudio(file, seconds);
          if ("wav" in heard) out.audio = { wav: heard.wav, name: file.name };
          else out.notes.push(heard.reason);
        }
      }
    } else if (file.type.startsWith("image/")) {
      out.images.push(await imageToDataUrl(file));
      out.times.push(undefined);
    } else {
      throw new MediaError(`“${file.name}” isn’t a picture or a video.`);
    }
  }
  out.images = out.images.slice(0, room);
  out.times = out.times.slice(0, room);
  return out;
}
