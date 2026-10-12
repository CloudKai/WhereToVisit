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
export type MapArea = {
  north: number;
  south: number;
  east: number;
  west: number;
  system: "WGS-84" | "GCJ-02";
};
export type CatalogueQuery = {
  city: string;
  area?: MapArea;
  category?: Place["category"];
  budget?: "low" | "mid" | "high" | "unknown";
  neighbourhood?: string;
  distance?: {
    origin: Pick<Coordinates, "latitude" | "longitude" | "system">;
    radiusMetres: number;
  };
  unknownDistance?: boolean;
  recommendationType?: RecommendationType | "unclassified";
};
export type CatalogueResult = {
  places: Place[];
  coverageMessage: string;
  dataKind: "real" | "fixture";
  areaSearch?: {
    requestedArea: MapArea;
    searchedArea: MapArea | null;
    outcome: "searched" | "clipped" | "outside-coverage";
    excludedCoordinateCount: number;
  };
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
  dataKind: "real" | "fixture";
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
  attempt: number;
  expiresAt: string;
  partial: boolean;
  sourceReplayAvailable: boolean;
  evidence: ImportSourceEvidence | null;
};
export type Mention = {
  id: string;
  originalText: string;
  nameHint: string;
  resolutionStatus: "unresolved" | "user-confirmed";
  resolution?: {
    outcome: "uncertain" | "no-match" | "provider-unavailable";
    scope: "canonical-catalogue";
    message: string;
    policy: "canonical-names-v1";
  };
  confirmation?: {
    candidateId: string;
    confirmedAt: string;
    method: "user-selection";
    independentVerification: false;
    outsideCityAcknowledged: boolean;
  };
  cityHint: { value: string; origin: "selected-city" };
  branchHint: null;
  addressHint: null;
  placeId: string | null;
  sourceEvidenceId: string;
  extraction: {
    method: string;
    version: string;
    canonicalUrl: string;
    revision: string | null;
    normalizedSourceHash: string;
    normalizationVersion: "verbatim-decoded-api-wikitext-v1";
    quote: string;
    codePointStart: number;
    codePointEnd: number;
  };
  candidates: ResolutionCandidate[];
};
export type Trip = {
  id: string;
  organiserUserId: string;
  title: string;
  city: string;
  dataKind: "real" | "fixture";
  savedPlaces: {
    placeId: string;
    evidenceIds: string[];
    place: Place;
    importedEvidence: ResolvedImportPlace["importedEvidence"];
  }[];
  selectedPlaceIds: string[];
  createdAt: string;
  updatedAt: string;
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

export type ImportSourceEvidence = {
  id: string;
  sourceUrl: string;
  canonicalUrl: string;
  revision: string;
  revisionUrl: string | null;
  historyUrl: string | null;
  capturedAt: string;
  attribution: string;
  license: "CC BY-SA 4.0";
  licenseUrl: string;
  changes: string;
  normalizedSourceHash: string;
  normalizationVersion: "verbatim-decoded-api-wikitext-v1";
  limits: string;
};

/** A source-backed canonical branch snapshot; outbound searches never establish a POI. */
export type ResolutionCandidate = {
  id: string;
  place: Place;
  providerReference: ProviderReference;
  branchEvidence: SourceEvidence[];
  reason: string;
  outsideCity: boolean;
};

/** Session-owned temporary confirmations; editorial evidence remains on the canonical Place. */
export type ResolvedImportPlace = {
  place: Place;
  dataKind: Import["dataKind"];
  importedEvidence: {
    importId: string;
    mentionId: string;
    source: ImportSourceEvidence;
    extraction: Mention["extraction"];
    confirmation: NonNullable<Mention["confirmation"]>;
  }[];
};

/** Explicit save continuation, bound to its initiating browser and first authenticated organiser. */
export type TripSaveIntent = {
  id: string;
  requestedImportId: string | null;
  organiserUserId: string | null;
  expiresAt: string;
  dataKind: "real" | "fixture";
  place: Place;
  importedEvidence: ResolvedImportPlace["importedEvidence"];
};
