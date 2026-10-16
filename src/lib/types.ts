export type Category = "cafe" | "food";

export type Destination = {
  name: string;
  country?: string;
  lat: number;
  lon: number;
  /** Search radius in metres around the destination centre. */
  radiusM: number;
};

export type Source = {
  kind: "wikivoyage" | "openstreetmap";
  label: string;
  url: string;
  license: string;
};

export type Photo = {
  url: string;
  pageUrl: string;
  credit: string;
};

/**
 * Why a place is shown.
 * - editor: written by Wikivoyage travel editors (a real recommendation)
 * - community: a free-text description added by OpenStreetMap contributors
 * - facts: only practical facts from the map data; NOT a recommendation
 */
export type ReasonBasis = "editor" | "community" | "facts";

export type Reason = {
  basis: ReasonBasis;
  /** Short text shown on the card. */
  text: string;
  /** Original source text when `text` is a shortened or AI-condensed version. */
  fullText?: string;
  /** True when `text` was condensed by the language model from `fullText`. */
  polished: boolean;
};

export type Place = {
  id: string;
  name: string;
  localName?: string;
  category: Category;
  cuisines: string[];
  lat?: number;
  lon?: number;
  address?: string;
  hours?: string;
  price?: string;
  phone?: string;
  website?: string;
  reason: Reason;
  photo?: Photo;
  sources: Source[];
  /** "editor" places have a travel-editor recommendation; "nearby" do not. */
  tier: "editor" | "nearby";
  score: number;
  distanceKm?: number;
};

/** Normalised record from one upstream source, before merging. */
export type RawPlace = {
  origin: "wikivoyage" | "openstreetmap";
  name: string;
  localName?: string;
  category: Category;
  cuisines: string[];
  lat?: number;
  lon?: number;
  address?: string;
  hours?: string;
  price?: string;
  phone?: string;
  website?: string;
  description?: string;
  descriptionBasis?: "editor" | "community";
  /** Wikimedia Commons file name without the "File:" prefix. */
  photoFile?: string;
  wikidata?: string;
  facts: string[];
  flags: { michelin?: boolean; chain?: boolean; wikipedia?: boolean };
  source: Source;
};

export type ExploreResult = {
  destination: Destination;
  editorPicks: Place[];
  nearby: Place[];
  notes: string[];
  aiUsed: boolean;
};

export type Suggestion = {
  label: string;
  name: string;
  country?: string;
  lat: number;
  lon: number;
  radiusM: number;
};
