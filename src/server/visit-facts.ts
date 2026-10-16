import type {
  CatalogueBatch,
  Place,
  SavedVisitFacts,
  Trip,
  VisitFactCheck,
  VisitFactField,
} from "../shared/contracts";

const fields: VisitFactField[] = ["address", "hours", "operation"];
type Member = Trip["savedPlaces"][number];
function check(place: Place, field: VisitFactField): VisitFactCheck {
  if (place.visitFactChecks) return place.visitFactChecks[field];
  const fact = field === "address" ? "identity" : field;
  const ids = place.evidence
    .filter(
      (item) =>
        item.status === "current" && item.establishedFacts.includes(fact),
    )
    .map((item) => item.id);
  const value =
    field === "address"
      ? place.address
      : field === "hours"
        ? place.hours?.description
        : place.operationStatus === "unknown"
          ? null
          : place.operationStatus;
  const qualified = !!value && ids.length > 0;
  return {
    outcome: qualified ? "checked" : "unknown",
    checkedAt: qualified
      ? (place.evidence
          .filter((item) => ids.includes(item.id))
          .map((item) => item.capturedAt)
          .sort()
          .at(-1) ?? null)
      : null,
    evidenceIds: qualified ? ids : [],
    explanation: qualified
      ? "Reviewed catalogue source observation; this is not a live or selected-date guarantee."
      : "No checked practical fact is available in the reviewed catalogue.",
  };
}
function nextFacts(
  member: Member,
  place: Place | null,
  previous?: SavedVisitFacts,
): SavedVisitFacts {
  const baseline = previous;
  const result = {} as SavedVisitFacts["fields"];
  for (const field of fields) {
    const item = place
      ? check(place, field)
      : {
          outcome: "unknown" as const,
          checkedAt: null,
          evidenceIds: [],
          explanation:
            "This canonical branch is absent from the available reviewed publication. Current facts are unknown; absence does not establish closure.",
        };
    const sources =
      place?.evidence
        .filter((source) => item.evidenceIds.includes(source.id))
        .map((source) => ({ ...source, recommendation: null })) ?? [];
    const value =
      item.outcome !== "checked"
        ? null
        : field === "address"
          ? (place?.address ?? null)
          : field === "hours"
            ? (place?.hours?.description ?? null)
            : place?.operationStatus === "unknown"
              ? null
              : (place?.operationStatus ?? null);
    const old = baseline?.fields[field];
    const lastChecked =
      value === null
        ? (old?.lastChecked ??
          (old?.value
            ? {
                value: old.value,
                checkedAt: old.checkedAt,
                sources: old.sources,
              }
            : null))
        : { value, checkedAt: item.checkedAt, sources };
    const material =
      !old || old.outcome !== item.outcome || old.value !== value;
    const metadata =
      !old ||
      JSON.stringify({ ...item, sources, value }) !==
        JSON.stringify({
          outcome: old.outcome,
          checkedAt: old.checkedAt,
          evidenceIds: old.evidenceIds,
          explanation: old.explanation,
          sources: old.sources,
          value: old.value,
        });
    result[field] = {
      ...item,
      value,
      sources,
      lastChecked,
      version: (old?.version ?? -1) + (metadata ? 1 : 0),
      contentVersion: (old?.contentVersion ?? -1) + (material ? 1 : 0),
    };
  }
  return {
    fields: result,
    identityReviewRequired:
      result.address.outcome === "conflict" ||
      (result.address.lastChecked !== null &&
        result.address.lastChecked.value !== member.place.address),
  };
}
/** Original snapshot is never replaced. Legacy documents receive a read-only baseline. */
export function savedVisitFacts(member: Member) {
  return member.visitFacts ?? nextFacts(member, member.place);
}
export function projectVisitFacts(trip: Trip): Trip {
  return {
    ...trip,
    savedPlaces: trip.savedPlaces.map((member) => ({
      ...member,
      visitFacts: savedVisitFacts(member),
    })),
  };
}
export function refreshTripVisitFacts(trip: Trip, batch: CatalogueBatch) {
  for (const member of trip.savedPlaces) {
    const previous = savedVisitFacts(member);
    member.visitFacts = nextFacts(
      member,
      batch.status === "published"
        ? (batch.places.find((place) => place.id === member.placeId) ?? null)
        : null,
      previous,
    );
  }
}
export function visitFactVersions(trip: Trip, ids: string[]) {
  return Object.fromEntries(
    trip.savedPlaces
      .filter((member) => ids.includes(member.placeId))
      .map((member) => [
        member.placeId,
        Object.fromEntries(
          fields.map((field) => [
            field,
            savedVisitFacts(member).fields[field].contentVersion,
          ]),
        ),
      ]),
  ) as Record<string, Record<VisitFactField, number>>;
}
export function visitFactsNeedReview(
  trip: Trip,
  ids: string[],
  captured?: Record<string, Record<VisitFactField, number>>,
) {
  return trip.savedPlaces.some(
    (member) =>
      ids.includes(member.placeId) &&
      (savedVisitFacts(member).identityReviewRequired ||
        fields.some(
          (field) =>
            savedVisitFacts(member).fields[field].contentVersion !==
            (captured?.[member.placeId]?.[field] ?? 0),
        )),
  );
}
