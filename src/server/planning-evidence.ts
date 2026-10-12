import "server-only";
import { readFileSync, statSync } from "node:fs";
import type { DayPlan, DayPlanRequest, Trip } from "@/shared/contracts";
import { TripFailure } from "./trips";

type Hours = {
  placeId: string;
  closed: boolean;
  opensMinute: number;
  closesMinute: number;
  evidence: string;
};
type Evidence = {
  provider: string;
  apiVersion: string;
  retrievedAt: string;
  coordinateProvenance: string;
  hours: Hours[];
  legs: Omit<
    DayPlan["travelLegs"][number],
    | "provider"
    | "retrievedAt"
    | "apiVersion"
    | "coordinateProvenance"
    | "visitTimeContext"
    | "requestedMode"
  >[];
};
const outcomes = [
  "available",
  "no-route",
  "out-of-coverage",
  "mode-unsupported",
  "provider-unavailable",
  "quota-exceeded",
  "coordinate-unqualified",
];
function rejected(): never {
  throw new TripFailure(
    "planning-evidence-invalid",
    "Planning evidence is unavailable or mismatched. The saved request and previous plan are retained; retry after recovery.",
    503,
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) rejected();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Array.from(value).length > 300 ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  )
    rejected();
  return value;
}
function minute(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 1440
  )
    rejected();
  return value as number;
}
function measure(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 10000000
  )
    rejected();
  return value;
}
/** Authored external response boundary; impossible to enable for a real Trip or in production. */
export function planningEvidence(
  trip: Trip,
  request: DayPlanRequest,
): Evidence | null {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.ENABLE_DEVELOPMENT_TRIP_FIXTURE !== "1" ||
    process.env.ENABLE_DEVELOPMENT_DAY_PLAN_FIXTURE !== "1" ||
    trip.dataKind !== "fixture"
  )
    return null;
  const filename = process.env.DAY_PLAN_DEVELOPMENT_SOURCE;
  if (!filename) return null;
  try {
    const metadata = statSync(filename);
    if (!metadata.isFile() || metadata.size > 65536) rejected();
    const result = object(JSON.parse(readFileSync(filename, "utf8")));
    if (
      result.kind !== "fixture" ||
      result.visitDate !== request.visitDate ||
      result.requestedMode !== request.mode
    )
      rejected();
    if (result.outcome === "provider-unavailable")
      throw new TripFailure(
        "planning-provider-unavailable",
        "The fictional provider failed. The saved request and previous plan are retained; retry after recovery.",
        503,
      );
    if (result.provider !== "Fictional scenario provider") rejected();
    const provider = text(result.provider),
      apiVersion = text(result.apiVersion),
      retrievedAt = text(result.retrievedAt),
      coordinateProvenance = text(result.coordinateProvenance);
    if (
      !/^\d{4}-\d{2}-\d{2}T/.test(retrievedAt) ||
      !Number.isFinite(Date.parse(retrievedAt))
    )
      rejected();
    if (
      !Array.isArray(result.hours) ||
      !Array.isArray(result.legs) ||
      result.hours.length > 100 ||
      result.legs.length > 10000
    )
      rejected();
    const ids = new Set(request.selectedPlaceIds);
    const hours = result.hours.map((value) => {
      const item = object(value);
      const placeId = text(item.placeId);
      if (!ids.has(placeId) || typeof item.closed !== "boolean") rejected();
      const opensMinute = minute(item.opensMinute),
        closesMinute = minute(item.closesMinute);
      if (opensMinute >= closesMinute) rejected();
      return {
        placeId,
        closed: item.closed,
        opensMinute,
        closesMinute,
        evidence: text(item.evidence),
      };
    });
    if (new Set(hours.map((item) => item.placeId)).size !== hours.length)
      rejected();
    const legs = result.legs.map((value) => {
      const item = object(value),
        fromPlaceId = text(item.fromPlaceId),
        toPlaceId = text(item.toPlaceId),
        outcome = text(item.outcome);
      if (
        !ids.has(fromPlaceId) ||
        !ids.has(toPlaceId) ||
        fromPlaceId === toPlaceId ||
        !outcomes.includes(outcome)
      )
        rejected();
      if (outcome !== "available") {
        if (
          [
            item.actualSubmode,
            item.resultKind,
            item.durationSeconds,
            item.distanceMetres,
          ].some((value) => value !== null)
        )
          rejected();
        return {
          fromPlaceId,
          toPlaceId,
          outcome,
          actualSubmode: null,
          resultKind: null,
          durationSeconds: null,
          distanceMetres: null,
        };
      }
      const actualSubmode = text(item.actualSubmode);
      if (
        !(
          request.mode === "walking-transit"
            ? ["walking", "transit"]
            : ["driving"]
        ).includes(actualSubmode) ||
        !["route", "eta-only"].includes(item.resultKind as string)
      )
        rejected();
      return {
        fromPlaceId,
        toPlaceId,
        outcome,
        actualSubmode,
        resultKind: item.resultKind as "route" | "eta-only",
        durationSeconds: measure(item.durationSeconds),
        distanceMetres:
          item.distanceMetres === null ? null : measure(item.distanceMetres),
      };
    });
    if (
      new Set(legs.map((item) => `${item.fromPlaceId}:${item.toPlaceId}`))
        .size !== legs.length
    )
      rejected();
    return {
      provider,
      apiVersion,
      retrievedAt,
      coordinateProvenance,
      hours,
      legs,
    };
  } catch (failure) {
    if (failure instanceof TripFailure) throw failure;
    rejected();
  }
}
export function applyPlanningEvidence(plan: DayPlan, evidence: Evidence) {
  plan.operatingHours = evidence.hours.map(
    ({ evidence: sourceExplanation, ...hours }) => ({
      ...hours,
      sourceExplanation,
      visitDate: plan.request.visitDate,
      timeZone: "Asia/Shanghai",
      provider: evidence.provider,
      retrievedAt: evidence.retrievedAt,
    }),
  );
  const requested = plan.stops.map((stop) => stop.placeId);
  const closed = new Set(
    evidence.hours
      .filter((hours) => hours.closed)
      .map((hours) => hours.placeId),
  );
  plan.unscheduledPlaces = requested
    .filter((id) => closed.has(id))
    .map((placeId) => ({
      placeId,
      reason:
        "Reliable fictional hours report this branch closed on the selected date; review your selection. Must go cannot override closure.",
    }));
  plan.stops = plan.stops.filter((stop) => !closed.has(stop.placeId));
  const hoursFor = (id: string) =>
    evidence.hours.find((hours) => hours.placeId === id);
  // Earlier opening first; stable saved order for ties or unknown hours. No proximity claim.
  plan.stops.sort(
    (a, b) =>
      (hoursFor(a.placeId)?.opensMinute ?? 1440) -
      (hoursFor(b.placeId)?.opensMinute ?? 1440),
  );
  plan.explanation =
    "Only selected confirmed branches are considered. Earlier evidenced opening is first; saved shortlist order breaks ties. This is a simple availability heuristic, not distance optimization.";
  const legFor = (
    fromPlaceId: string,
    toPlaceId: string,
  ): DayPlan["travelLegs"][number] => ({
    fromPlaceId,
    toPlaceId,
    requestedMode: plan.request.mode,
    actualSubmode: null,
    provider: evidence.provider,
    retrievedAt: evidence.retrievedAt,
    resultKind: null,
    durationSeconds: null,
    distanceMetres: null,
    outcome: "no-route",
    apiVersion: evidence.apiVersion,
    coordinateProvenance: evidence.coordinateProvenance,
    visitTimeContext: `${plan.request.visitDate} Asia/Shanghai; hypothetical future-day fixture`,
    ...evidence.legs.find(
      (leg) => leg.fromPlaceId === fromPlaceId && leg.toPlaceId === toPlaceId,
    ),
  });
  const legs = plan.stops
    .slice(1)
    .map((stop, index) => legFor(plan.stops[index].placeId, stop.placeId));
  plan.travelLegs = legs;
  for (const stop of plan.stops)
    stop.hoursEvidence = hoursFor(stop.placeId)?.evidence ?? null;
  plan.warnings = plan.warnings.filter(
    (warning) =>
      !warning.startsWith("Opening hours") &&
      !warning.startsWith("Mode-specific"),
  );
  plan.warnings.push(
    "Fictional provider evidence proves application behavior only; no real routes or operating hours are qualified.",
  );
  if (closed.size)
    plan.warnings.push(
      "Closed selected Places remain explicitly unscheduled for review.",
    );
  const missing =
    plan.stops.some((stop) => !hoursFor(stop.placeId)) ||
    legs.some(
      (leg) => leg.durationSeconds === null || leg.outcome !== "available",
    );
  if (missing) {
    plan.warnings.push(
      "Missing hours or unavailable travel legs: precise timing and one-day feasibility remain unresolved.",
    );
    return;
  }
  const dwell =
    plan.request.pace === "relaxed"
      ? 60
      : plan.request.pace === "busy"
        ? 30
        : 45;
  plan.assumptions = [
    `Assumed Shanghai planning window 09:00–18:00; not a venue fact or requested start time.`,
    `Assumed ${dwell} minute visit per stop (${plan.request.pace ?? "unset/default balanced"} pace), not a venue duration.`,
    "No travel from the optional start area is assumed. Driving estimates exclude taxi wait, booking and fares.",
  ];
  let cursor = 540;
  const scheduled: DayPlan["stops"] = [];
  for (const stop of plan.stops) {
    const hours = hoursFor(stop.placeId) as Hours;
    const leg = scheduled.length
      ? legFor(scheduled[scheduled.length - 1].placeId, stop.placeId)
      : null;
    if (leg && (leg.durationSeconds === null || leg.outcome !== "available")) {
      plan.unscheduledPlaces.push({
        placeId: stop.placeId,
        reason:
          "No available mode-specific route from the preceding scheduled stop after earlier conflicts; review before scheduling.",
      });
      continue;
    }
    const arrival = Math.max(
      cursor + (leg ? Math.ceil((leg.durationSeconds as number) / 60) : 0),
      hours.opensMinute,
    );
    const departure = arrival + dwell;
    if (departure > Math.min(1080, hours.closesMinute)) {
      plan.unscheduledPlaces.push({
        placeId: stop.placeId,
        reason:
          "Cannot fit evidenced opening hours and the assumed 09:00–18:00 day window with travel and dwell estimates. Must go is a preference, not a scheduling guarantee.",
      });
      continue;
    }
    scheduled.push({
      ...stop,
      arrivalMinute: arrival,
      departureMinute: departure,
      visitTimeAssumption: `${dwell} minute assumed visit; verify suitability`,
    });
    cursor = departure;
  }
  plan.stops = scheduled;
  plan.travelLegs = scheduled
    .slice(1)
    .map((stop, index) => legFor(scheduled[index].placeId, stop.placeId));
  if (plan.unscheduledPlaces.length)
    plan.warnings.push(
      "Selected Places do not all fit; inspect unscheduled reasons and revise inputs.",
    );
}
