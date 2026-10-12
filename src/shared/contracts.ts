/** Portable JSON contracts. Dates are ISO strings; unknown facts stay null. */
export type Actor =
  | { kind: "visitor" }
  | { kind: "organiser"; userId: string }
  | {
      kind: "guest";
      participantId: string;
      tripId: string;
      invitationGeneration: string;
    };
export type OperationResult<T> =
  | { status: "available"; data: T }
  | { status: "unavailable"; reason: string; message: string }
  | { status: "error"; reason: string; message: string; retryable: boolean };
export type Coordinates = {
  latitude: number;
  longitude: number;
  system: "WGS-84" | "GCJ-02" | "unqualified";
  source: string;
  acquiredAt: string;
  purpose: string;
  conversion: {
    method: string;
    original: Omit<Coordinates, "conversion">;
  } | null;
};
export type ProviderReference = {
  provider: string;
  placeId: string | null;
  url: string | null;
  linkKind: "place" | "search" | null;
  surface: string;
  apiVersion: string | null;
  returnedName: string | null;
  returnedAddress: string | null;
  language: string | null;
  coordinates: Coordinates | null;
  verifiedAt: string;
  qualification: "qualified" | "conditional" | "unqualified";
  qualificationNotes: string;
};
export type SourceEvidence = {
  id: string;
  sourceUrl: string;
  capturedAt: string;
  publishedAt: string | null;
  attribution: string;
  permission: string;
  status: "historical" | "current" | "unverified";
  establishedFacts: (
    | "identity"
    | "category"
    | "neighbourhood"
    | "operation"
    | "price"
    | "hours"
    | "rating"
    | "classification"
  )[];
  limits: string;
  recommendation: { summary: string; mentionedExperience: string } | null;
};
export type Place = {
  id: string;
  city: string;
  category: "food" | "cafe";
  displayName: string;
  localName: string | null;
  branch: string | null;
  address: string | null;
  neighbourhood: string | null;
  coordinates: Coordinates | null;
  price: { amount: number; currency: string; sourceEvidenceId: string } | null;
  operationStatus: "current" | "closed" | "unknown";
  hours: { description: string; sourceEvidenceId: string } | null;
  rating: {
    provider: string;
    value: number;
    scale: number;
    count: number | null;
    observedAt: string;
    sourceEvidenceId: string;
  } | null;
  classifications: {
    type: RecommendationType;
    reason: string;
    rule: string;
    ruleDate: string;
    sourceEvidenceIds: string[];
  }[];
  evidence: SourceEvidence[];
  providerReferences: ProviderReference[];
};
export type RecommendationType =
  | "trending"
  | "local-favourite"
  | "highly-reviewed";
export type CatalogueQuery = {
  city: string;
  area?: {
    north: number;
    south: number;
    east: number;
    west: number;
    system: Coordinates["system"];
  };
  category?: Place["category"];
  budget?: { maximum: number; currency: string };
  neighbourhood?: string;
  distance?: { origin: Coordinates; radiusMetres: number };
  recommendationType?: RecommendationType;
};
export type CatalogueResult = {
  places: Place[];
  coverageMessage: string;
  dataKind: "real" | "fixture";
};
/** A complete curated publication; source array order is the stable display order. */
export type CatalogueBatch = {
  version: 1;
  kind: "real" | "fixture";
  city: "Shanghai";
  status: "published" | "unavailable";
  coverageMessage: string;
  unavailableReason: { code: string; message: string } | null;
  places: Place[];
};
export type Import = {
  id: string;
  sourceUrl: string;
  city: string;
  owner: Actor;
  createdAt: string;
  updatedAt: string;
  status:
    | "queued"
    | "processing"
    | "awaiting-confirmation"
    | "completed"
    | "unsupported"
    | "failed";
  reason: { code: string; message: string; retryable: boolean } | null;
  mentions: Mention[];
};
export type Mention = {
  id: string;
  originalText: string;
  placeId: string | null;
  sourceEvidenceId: string;
  extraction: {
    method: string;
    version: string;
    canonicalUrl: string;
    revision: string | null;
    normalizedSourceHash: string;
    quote: string;
    codePointStart: number;
    codePointEnd: number;
  };
  candidates: {
    providerReference: ProviderReference;
    branchEvidence: SourceEvidence[];
    reason: string;
  }[];
};
export type Trip = {
  id: string;
  organiserUserId: string;
  title: string;
  city: string;
  savedPlaces: { placeId: string; evidenceIds: string[] }[];
  dayPlanIds: string[];
};
export type DayPlanRequest = {
  tripId: string;
  visitDate: string;
  selectedPlaceIds: string[];
  mode: "walking-transit" | "taxi-car";
  startArea?: string;
  budget?: string;
  dietaryNeeds?: string;
  pace?: string;
};
export type DayPlan = {
  id: string;
  revision: number;
  request: DayPlanRequest;
  stops: { placeId: string; visitTimeAssumption: string | null }[];
  travelLegs: {
    fromPlaceId: string;
    toPlaceId: string;
    requestedMode: DayPlanRequest["mode"];
    actualSubmode: string | null;
    provider: string | null;
    retrievedAt: string | null;
    resultKind: "route" | "eta-only" | null;
    durationSeconds: number | null;
    distanceMetres: number | null;
    outcome: string;
  }[];
  warnings: string[];
  unscheduledPlaces: { placeId: string; reason: string }[];
};
