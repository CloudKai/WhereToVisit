import type { Platform } from "./social.ts";
import type { Category } from "./types.ts";

export const MAX_ENTRIES = 8;
export const MAX_TEXT_LENGTH = 1500;
export const MAX_NAMES_PER_ENTRY = 8;
export const MAX_MENTIONS = 30;
export const MAX_HINT_LENGTH = 60;

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

/** A place named in one post, with the map matches found for it. */
export type Mention = {
  id: string;
  /** Exactly as it appears in the text the person provided. */
  name: string;
  entry: number;
  candidates: Candidate[];
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
