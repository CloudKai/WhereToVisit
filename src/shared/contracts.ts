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
  /** Optional for legacy publications and retained saved branch snapshots. */
  photo?: BranchPhoto | null;
  /** Manually reviewed practical checks; no fetch or provider permission is implied. */
  visitFactChecks?: Record<VisitFactField, VisitFactCheck>;
};
export type VisitFactField = "address" | "hours" | "operation";
export type VisitFactCheck = {
  outcome: "checked" | "unknown" | "failed" | "conflict";
  checkedAt: string | null;
  evidenceIds: string[];
  explanation: string;
};
export type SavedVisitFacts = {
  fields: Record<
    VisitFactField,
    VisitFactCheck & {
      value: string | null;
      version: number;
      contentVersion: number;
      sources: SourceEvidence[];
      lastChecked: {
        value: string;
        checkedAt: string | null;
        sources: SourceEvidence[];
      } | null;
    }
  >;
  identityReviewRequired: boolean;
};
export type BranchPhoto = {
  assetId: string;
  title: string;
  alt: string;
  sourceUrl: string;
  originalUrl: string;
  author: string;
  authorUrl: string;
  license: string;
  licenseUrl: string;
  photographedAt: string;
  publishedAt: string;
  checkedAt: string;
  relevance: string;
  changes: string;
  width: number;
  height: number;
  sha256: string;
  rightsStatus: "qualified" | "unsupported" | "expired";
  rightsExpiresAt: string | null;
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
    visitFacts?: SavedVisitFacts;
  }[];
  selectedPlaceIds: string[];
  selectionRevision?: number;
  createdAt: string;
  updatedAt: string;
  dayPlanIds: string[];
};
export type DayPlanRequest = {
  tripId: string;
  visitDate: string;
  selectedPlaceIds: string[];
  mode: "walking-transit" | "taxi-car";
  startArea: string | null;
  budget: string | null;
  dietaryNeeds: string | null;
  pace: "relaxed" | "balanced" | "busy" | null;
};
/** Persisted inputs only. A stale selection requires a fresh explicit draft save. */
export type DayPlanDraft = {
  id: string;
  revision: number;
  selectionRevision: number;
  request: DayPlanRequest;
  createdAt: string;
  updatedAt: string;
};
export type DayPlanDraftState = {
  draft: DayPlanDraft | null;
  selectionRevision: number;
  needsReview: boolean;
};
export type GeneratedDayPlanState = {
  plan: DayPlan | null;
  needsReview: boolean;
};
export type DayPlan = {
  id: string;
  revision: number;
  request: DayPlanRequest;
  requestRevision: number;
  selectionRevision: number;
  visitFactVersions?: Record<string, Record<VisitFactField, number>>;
  createdAt: string;
  updatedAt: string;
  dataKind: "real" | "fixture";
  manuallyEdited?: boolean;
  operatingHours: {
    placeId: string;
    visitDate: string;
    timeZone: "Asia/Shanghai";
    provider: string;
    retrievedAt: string;
    closed: boolean;
    opensMinute: number;
    closesMinute: number;
    sourceExplanation: string;
  }[];
  assumptions: string[];
  explanation: string;
  stops: {
    placeId: string;
    desiredArrivalMinute?: number | null;
    visitTimeAssumption: string | null;
    arrivalMinute: number | null;
    departureMinute: number | null;
    hoursEvidence: string | null;
  }[];
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
    apiVersion: string | null;
    coordinateProvenance: string | null;
    visitTimeContext: string;
  }[];
  warnings: string[];
  unscheduledPlaces: {
    placeId: string;
    reason: string;
    // Absent metadata is an ambiguous legacy exclusion, never inferred from prose.
    cause?:
      | "manual-removal"
      | "closure"
      | "route-conflict"
      | "capacity-conflict"
      | "legacy-unknown";
    restoreEligibility?: "current-check-required" | "fresh-evidence-required";
    restore?: {
      originalIndex: number;
      desiredArrivalMinute: number | null;
    };
    evidenceRetrievedAt?: string | null;
  }[];
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

/** Display names label attribution; only the server session grants guest authority. */
export type GuestParticipant = {
  id: string;
  displayName: string;
  displayNumber: number;
  accessActive: boolean;
};
export type TripInvitation = {
  generation: string;
  token: string;
  url: string;
  state: "active" | "disabled";
};
export type InvitationManagement = {
  invitation: TripInvitation | null;
  participants: GuestParticipant[];
};
/** Deliberate shared projection excludes organiser and temporary-import identities. */
export type SharedGuestTrip = {
  trip: Pick<
    Trip,
    "id" | "title" | "city" | "dataKind" | "selectedPlaceIds" | "dayPlanIds"
  > & {
    dayPlan: DayPlanDraftState;
    generatedDayPlan: GeneratedDayPlanState;
    savedPlaces: {
      placeId: string;
      place: Place;
      visitFacts?: SavedVisitFacts;
      importedEvidence: Omit<
        ResolvedImportPlace["importedEvidence"][number],
        "importId" | "mentionId"
      >[];
    }[];
  };
  participant: GuestParticipant;
  participants: GuestParticipant[];
};

export type Collaboration = {
  actorId: string;
  participants: GuestParticipant[];
  comments: { id: string; actorId: string; placeId: string; text: string }[];
  suggestions: {
    id: string;
    actorId: string;
    name: string;
    place: Place | null;
    state: "pending" | "accepted" | "rejected";
  }[];
  votes: {
    actorId: string;
    placeId: string;
    choice: "must-go" | "interested" | "skip";
  }[];
};
