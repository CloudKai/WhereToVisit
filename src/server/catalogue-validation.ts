import {
  eligibleBranchPhoto,
  reviewedBranchPhotos,
} from "../shared/branch-photo";
import type { BranchPhoto, CatalogueBatch } from "../shared/contracts";

function invalid(): never {
  throw new Error("Invalid catalogue publication.");
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in result))
  )
    invalid();
  return result;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 4000)
    invalid();
}
function optionalText(value: unknown) {
  if (value !== null) text(value);
}
function choice(value: unknown, allowed: string[]) {
  if (typeof value !== "string" || !allowed.includes(value)) invalid();
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 1000) invalid();
  return value;
}
function date(value: unknown) {
  text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    invalid();
}
function url(value: unknown, allowHttp = false) {
  text(value);
  const parsed = new URL(value);
  if (
    !(allowHttp ? ["https:", "http:"] : ["https:"]).includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    invalid();
}
function number(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  )
    invalid();
}
function coordinates(value: unknown, allowConversion = true) {
  if (value === null) return;
  const item = record(
    value,
    allowConversion
      ? [
          "latitude",
          "longitude",
          "system",
          "source",
          "acquiredAt",
          "purpose",
          "conversion",
        ]
      : ["latitude", "longitude", "system", "source", "acquiredAt", "purpose"],
  );
  if (
    typeof item.latitude !== "number" ||
    !Number.isFinite(item.latitude) ||
    Math.abs(item.latitude) > 90 ||
    typeof item.longitude !== "number" ||
    !Number.isFinite(item.longitude) ||
    Math.abs(item.longitude) > 180
  )
    invalid();
  choice(item.system, ["WGS-84", "GCJ-02"]);
  text(item.source);
  date(item.acquiredAt);
  text(item.purpose);
  if (allowConversion && item.conversion !== null) {
    const conversion = record(item.conversion, ["method", "original"]);
    text(conversion.method);
    if (conversion.original === null) invalid();
    coordinates(conversion.original, false);
  }
}
function branchPhoto(value: unknown, placeId: string, kind: unknown) {
  if (value === null) return null;
  const photo = record(value, [
    "assetId",
    "title",
    "alt",
    "sourceUrl",
    "originalUrl",
    "author",
    "authorUrl",
    "license",
    "licenseUrl",
    "photographedAt",
    "publishedAt",
    "checkedAt",
    "relevance",
    "changes",
    "width",
    "height",
    "sha256",
    "rightsStatus",
    "rightsExpiresAt",
  ]);
  text(photo.assetId);
  const reviewed = Object.hasOwn(reviewedBranchPhotos, photo.assetId)
    ? reviewedBranchPhotos[photo.assetId]
    : null;
  if (kind !== "real" || !reviewed || reviewed.placeId !== placeId) invalid();
  for (const [key, expected] of Object.entries(reviewed.photo)) {
    if (key === "rightsStatus" || key === "rightsExpiresAt") continue;
    if (photo[key] !== expected) invalid();
  }
  choice(photo.rightsStatus, ["qualified", "unsupported", "expired"]);
  if (photo.rightsExpiresAt !== null) date(photo.rightsExpiresAt);
  return eligibleBranchPhoto(photo as BranchPhoto, placeId);
}
/** Closed publication shape prevents private or unvalidated fields leaking through JSON. */
export function validateCatalogueBatch(value: unknown): CatalogueBatch {
  const batch = record(value, [
    "version",
    "kind",
    "city",
    "status",
    "coverageMessage",
    "unavailableReason",
    "places",
  ]);
  if (batch.version !== 1 || batch.city !== "Shanghai") invalid();
  choice(batch.kind, ["real", "fixture"]);
  choice(batch.status, ["published", "unavailable"]);
  text(batch.coverageMessage);
  const places = list(batch.places);
  if (batch.status === "unavailable") {
    const reason = record(batch.unavailableReason, ["code", "message"]);
    text(reason.code);
    text(reason.message);
    if (places.length) invalid();
    return value as CatalogueBatch;
  }
  if (batch.unavailableReason !== null || !places.length) invalid();
  const placeIds = new Set<string>();
  const identities = new Set<string>();
  const evidenceIds = new Set<string>();
  const neighbourhoods = new Set<string>();
  const categories = new Set<string>();
  const normalizedPlaces = [];
  for (const raw of places) {
    const hasPhoto = raw !== null && typeof raw === "object" && "photo" in raw;
    const hasChecks =
      raw !== null && typeof raw === "object" && "visitFactChecks" in raw;
    const place = record(raw, [
      "id",
      "city",
      "category",
      "displayName",
      "localName",
      "branch",
      "address",
      "neighbourhood",
      "coordinates",
      "price",
      "operationStatus",
      "hours",
      "rating",
      "classifications",
      "evidence",
      "providerReferences",
      ...(hasPhoto ? ["photo"] : []),
      ...(hasChecks ? ["visitFactChecks"] : []),
    ]);
    text(place.id);
    text(place.displayName);
    if (place.city !== "Shanghai" || placeIds.has(place.id)) invalid();
    placeIds.add(place.id);
    choice(place.category, ["food", "cafe"]);
    categories.add(place.category as string);
    for (const field of ["localName", "branch", "address", "neighbourhood"])
      text(place[field]);
    neighbourhoods.add(place.neighbourhood as string);
    // Translated/display names do not create a second identity for an established branch.
    const identity = `${place.city}|${place.localName}|${place.address}`
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, "");
    if (identities.has(identity)) invalid();
    identities.add(identity);
    coordinates(place.coordinates);
    choice(place.operationStatus, ["current", "closed", "unknown"]);
    if (place.operationStatus === "closed" && !hasChecks) invalid();
    const evidence = list(place.evidence).map((rawEvidence) => {
      const item = record(rawEvidence, [
        "id",
        "sourceUrl",
        "capturedAt",
        "publishedAt",
        "attribution",
        "permission",
        "status",
        "establishedFacts",
        "limits",
        "recommendation",
      ]);
      text(item.id);
      if (evidenceIds.has(item.id)) invalid();
      evidenceIds.add(item.id);
      url(item.sourceUrl, true);
      date(item.capturedAt);
      if (item.publishedAt !== null) date(item.publishedAt);
      text(item.attribution);
      text(item.permission);
      text(item.limits);
      choice(item.status, ["current", "historical", "unverified"]);
      for (const fact of list(item.establishedFacts))
        choice(fact, [
          "identity",
          "category",
          "neighbourhood",
          "operation",
          "price",
          "hours",
          "rating",
          "classification",
        ]);
      if (item.recommendation !== null) {
        const recommendation = record(item.recommendation, [
          "summary",
          "mentionedExperience",
        ]);
        text(recommendation.summary);
        text(recommendation.mentionedExperience);
      }
      return item;
    });
    const hasFact = (fact: string) =>
      evidence.some(
        (item) =>
          item.status === "current" &&
          (item.establishedFacts as string[]).includes(fact),
      );
    for (const fact of ["identity", "category", "neighbourhood"])
      if (!hasFact(fact)) invalid();
    if (place.operationStatus === "current" && !hasFact("operation")) invalid();
    if (hasChecks) {
      const checks = record(place.visitFactChecks, [
        "address",
        "hours",
        "operation",
      ]);
      for (const field of ["address", "hours", "operation"]) {
        const check = record(checks[field], [
          "outcome",
          "checkedAt",
          "evidenceIds",
          "explanation",
        ]);
        choice(check.outcome, ["checked", "unknown", "failed", "conflict"]);
        text(check.explanation);
        if (check.checkedAt !== null) {
          date(check.checkedAt);
          if (Date.parse(check.checkedAt as string) > Date.now()) invalid();
        }
        const ids = list(check.evidenceIds);
        if (new Set(ids).size !== ids.length) invalid();
        for (const id of ids) {
          text(id);
          if (!evidence.some((item) => item.id === id)) invalid();
        }
        if (check.outcome === "checked") {
          const fact = field === "address" ? "identity" : field;
          if (
            check.checkedAt === null ||
            !ids.length ||
            !ids.every((id) =>
              evidence.some(
                (item) =>
                  item.id === id &&
                  item.status === "current" &&
                  (item.establishedFacts as string[]).includes(fact),
              ),
            )
          )
            invalid();
          if (
            field === "hours" &&
            (place.hours === null ||
              !ids.includes(
                (place.hours as Record<string, unknown>).sourceEvidenceId,
              ))
          )
            invalid();
          if (field === "operation" && place.operationStatus === "unknown")
            invalid();
        }
        if (
          field === "operation" &&
          place.operationStatus === "closed" &&
          check.outcome !== "checked"
        )
          invalid();
      }
    }
    const requireEvidence = (id: unknown, fact: string) => {
      text(id);
      if (
        !evidence.some(
          (item) =>
            item.id === id &&
            item.status === "current" &&
            (item.establishedFacts as string[]).includes(fact),
        )
      )
        invalid();
    };
    if (place.price !== null) {
      const price = record(place.price, [
        "amount",
        "currency",
        "sourceEvidenceId",
      ]);
      number(price.amount);
      text(price.currency);
      requireEvidence(price.sourceEvidenceId, "price");
    }
    if (place.hours !== null) {
      const hours = record(place.hours, ["description", "sourceEvidenceId"]);
      text(hours.description);
      requireEvidence(hours.sourceEvidenceId, "hours");
    }
    if (place.rating !== null) {
      const rating = record(place.rating, [
        "provider",
        "value",
        "scale",
        "count",
        "observedAt",
        "sourceEvidenceId",
      ]);
      text(rating.provider);
      number(rating.scale);
      if (rating.scale === 0) invalid();
      number(rating.value, rating.scale as number);
      if (rating.count !== null) {
        number(rating.count);
        if (!Number.isInteger(rating.count)) invalid();
      }
      date(rating.observedAt);
      requireEvidence(rating.sourceEvidenceId, "rating");
    }
    const types = new Set<string>();
    for (const rawClassification of list(place.classifications)) {
      const item = record(rawClassification, [
        "type",
        "reason",
        "rule",
        "ruleDate",
        "sourceEvidenceIds",
      ]);
      choice(item.type, ["trending", "local-favourite", "highly-reviewed"]);
      if (types.has(item.type as string)) invalid();
      types.add(item.type as string);
      text(item.reason);
      text(item.rule);
      date(item.ruleDate);
      const ids = list(item.sourceEvidenceIds);
      if (!ids.length) invalid();
      for (const id of ids) requireEvidence(id, "classification");
    }
    const references = list(place.providerReferences);
    let qualifiedHandoff = false;
    for (const rawReference of references) {
      const item = record(rawReference, [
        "provider",
        "placeId",
        "url",
        "linkKind",
        "surface",
        "apiVersion",
        "returnedName",
        "returnedAddress",
        "language",
        "coordinates",
        "verifiedAt",
        "qualification",
        "qualificationNotes",
      ]);
      text(item.provider);
      text(item.surface);
      text(item.qualificationNotes);
      date(item.verifiedAt);
      for (const field of [
        "placeId",
        "apiVersion",
        "returnedName",
        "returnedAddress",
        "language",
      ])
        optionalText(item[field]);
      if (item.url !== null) {
        url(item.url);
        choice(item.linkKind, ["place", "search"]);
      } else if (item.linkKind !== null) invalid();
      choice(item.qualification, ["qualified", "conditional", "unqualified"]);
      coordinates(item.coordinates);
      if (
        item.linkKind === "search" &&
        [
          item.placeId,
          item.returnedName,
          item.returnedAddress,
          item.coordinates,
        ].some((value) => value !== null)
      )
        invalid();
      if (item.qualification === "qualified" && item.url !== null)
        qualifiedHandoff = true;
    }
    if (!qualifiedHandoff) invalid();
    normalizedPlaces.push(
      hasPhoto
        ? {
            ...place,
            photo: branchPhoto(place.photo, place.id as string, batch.kind),
          }
        : place,
    );
  }
  if (
    batch.kind === "real" &&
    (places.length < 6 || categories.size < 2 || neighbourhoods.size < 2)
  )
    invalid();
  return { ...batch, places: normalizedPlaces } as CatalogueBatch;
}
