import type { Platform } from "./social.ts";
import type { Category } from "./types.ts";

export const MAX_ENTRIES = 8;
export const MAX_TEXT_LENGTH = 1500;
export const MAX_NAMES_PER_ENTRY = 8;
export const MAX_MENTIONS = 30;
export const MAX_HINT_LENGTH = 60;

// ---------- screenshots and video frames ----------
/** Images a person can add to one post (screenshots, or frames from a recording). */
export const MAX_IMAGES_PER_ENTRY = 10;
export const MAX_IMAGES_TOTAL = 14;
/** Longest side, in pixels, that an image is shrunk to before it is sent. */
export const IMAGE_MAX_SIDE = 1024;
/** Largest single image, as a data-URL string (about 190 KB of picture). */
export const MAX_IMAGE_CHARS = 250_000;
/** Whole request. Kept under the 4.5 MB request limit common to serverless hosts. */
export const MAX_REQUEST_BYTES = 3_800_000;

// ---------- sound from a screen recording ----------
/** Only this much of a recording is used, for pictures and for sound. */
export const MAX_VIDEO_SECONDS = 120;
export const MAX_SPEECH_SEGMENTS = 150;
export const MAX_SEGMENT_CHARS = 300;
export const MAX_SPEECH_CHARS = 5000;
/** The page makes 16 kHz mono sound: 32 KB a second, so two minutes is under 4 MB. */
export const AUDIO_SAMPLE_RATE = 16000;

/** One spoken phrase from a recording's sound, and when it starts (seconds). */
export type SpeechSegment = { start: number; text: string };

const IMAGE_DATA_URL =
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** True for a small JPEG/PNG/WebP data URL; nothing else is ever forwarded. */
export function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_IMAGE_CHARS &&
    IMAGE_DATA_URL.test(value)
  );
}

/** One possible location for a place name. */
export type Candidate = {
  label: string;
  address: string;
  lat: number;
  lon: number;
  /** The kind of map object found, e.g. "amenity" or "street". */
  kind: string;
  /** 0 to 1, how well the map service thinks it matches. */
  confidence: number;
  /** True for streets, districts and cities: close, but not an exact venue. */
  approximate: boolean;
  category: Category;
};

/** Where a place name came from. */
export type NameOrigin = "caption" | "images" | "speech";

/** One place where a name was found: the caption, a picture, or the spoken sound. */
export type Evidence = {
  source: NameOrigin;
  /** Seconds into the recording, when known. */
  at?: number;
  /** For pictures without a time: which picture (1 is the first). */
  frame?: number;
  /** For speech: the phrase it was heard in. */
  quote?: string;
};

/**
 * "confirmed": found in two different ways (for example heard in the audio and
 * seen on screen) and matched to one clear place on the map.
 * "check": anything weaker. The reasons say why.
 */
export type Verdict = "confirmed" | "check";

/** A place named in one post, with the map matches found for it. */
export type Mention = {
  id: string;
  /** Exactly as it appears in the text, images or speech the person provided. */
  name: string;
  /** The first way it was found. */
  origin?: NameOrigin;
  entry: number;
  candidates: Candidate[];
  evidence: Evidence[];
  verdict: Verdict;
  /** Why a place is not confirmed; empty when it is. */
  reasons: string[];
};

export type EntryStatus = "ok" | "no-text" | "bad-link" | "no-places";

export type EntryResult = {
  index: number;
  source?: { platform: Platform; url: string };
  status: EntryStatus;
  message: string;
};

export type ExtractResponse = {
  entries: EntryResult[];
  mentions: Mention[];
  /** Whole-request notes, e.g. that the AI step was unavailable. */
  notes: string[];
};

// ---------- progress ----------

/** Where a search is up to. `done` of `total` steps within the phase are finished. */
export type Progress = {
  phase: "reading" | "images" | "names" | "locating";
  done: number;
  total: number;
};

/** What the server streams back, one JSON object per line. */
export type StreamEvent =
  | { type: "progress"; progress: Progress }
  | { type: "result"; data: ExtractResponse }
  | { type: "error"; message: string };

/** Share of the whole search each phase takes, so the bar moves steadily. */
const PHASE_SPAN: Record<Progress["phase"], [from: number, to: number]> = {
  reading: [0, 8],
  images: [8, 45],
  names: [45, 55],
  locating: [55, 100],
};

/** 0–100. Never goes backwards within a phase and never exceeds the phase's share. */
export function progressPercent(p: Progress): number {
  const [from, to] = PHASE_SPAN[p.phase];
  const fraction = p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 1;
  return Math.round(from + (to - from) * fraction);
}

export function progressLabel(p: Progress): string {
  switch (p.phase) {
    case "reading":
      return p.done >= p.total
        ? "Checking your posts…"
        : `Reading post ${p.done + 1} of ${p.total}…`;
    case "images":
      return p.done >= p.total
        ? "Finishing the images…"
        : `Reading the images for post ${p.done + 1} of ${p.total}…`;
    case "names":
      return "Finding place names…";
    case "locating":
      return p.total === 0
        ? "Finishing up…"
        : p.done >= p.total
          ? "Finishing up…"
          : `Locating place ${p.done + 1} of ${p.total}…`;
  }
}

/** What the page can tell a person before they search. */
export type ExtractCapabilities = {
  /** Geoapify is set up, so places can be located at all. */
  ready: boolean;
  /** TikTok captions are read automatically from a link. */
  tiktokCaptions: boolean;
  /** An AI key is set, so place names can be found inside longer captions. */
  ai: boolean;
  /** The AI can read screenshots and video frames (needs the same key). */
  images: boolean;
  /** The sound of a recording can be turned into text (needs the same key). */
  speech: boolean;
};

/**
 * Splits a byte stream of newline-delimited JSON into complete lines, keeping
 * any unfinished last line until more arrives.
 */
export function createLineReader(): {
  push: (chunk: string) => string[];
  flush: () => string[];
} {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.map((line) => line.trim()).filter(Boolean);
    },
    flush() {
      const rest = buffer.trim();
      buffer = "";
      return rest ? [rest] : [];
    },
  };
}

/** Parses one streamed line; null for anything that is not a known event. */
export function parseStreamEvent(line: string): StreamEvent | null {
  try {
    const v = JSON.parse(line) as Partial<StreamEvent> & {
      progress?: Progress;
    };
    if (
      v.type === "progress" &&
      v.progress &&
      typeof v.progress.done === "number" &&
      typeof v.progress.total === "number"
    ) {
      return { type: "progress", progress: v.progress };
    }
    if (v.type === "result" && (v as { data?: unknown }).data) {
      return { type: "result", data: (v as { data: ExtractResponse }).data };
    }
    if (
      v.type === "error" &&
      typeof (v as { message?: unknown }).message === "string"
    ) {
      return { type: "error", message: (v as { message: string }).message };
    }
  } catch {
    // ignore a damaged line
  }
  return null;
}
