import "server-only";
import { createHash } from "node:crypto";
import type { DayPlan } from "@/shared/contracts";
import { openDatabase } from "./db/connection";
import {
  generatedDayPlanState,
  storedGeneratedDayPlan,
} from "./generated-day-plan-state";
import { collaborationAuthority } from "./invitations";
import {
  applyEditedPlanningEvidence,
  planningEvidence,
} from "./planning-evidence";
import { TripFailure } from "./trips";
import { savedVisitFacts } from "./visit-facts";

export function dayRestorationOperation(
  userId: string,
  tripId: string,
  input: Record<string, unknown>,
) {
  const { sqlite: db } = openDatabase();
  try {
    return db.transaction(() => {
      // Current visibility/ownership precedes even a successful retained receipt.
      const { trip } = collaborationAuthority(db, tripId, { userId });
      const state = generatedDayPlanState(db, trip);
      const stored = storedGeneratedDayPlan(db, trip);
      if (
        typeof input.operationId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(input.operationId) ||
        !Object.keys(input).every((key) =>
          [
            "operationId",
            "placeId",
            "planId",
            "dataKind",
            "expectedRevision",
            "requestRevision",
            "selectionRevision",
          ].includes(key),
        )
      )
        throw new TripFailure(
          "invalid-restore",
          "Restore requires an explicit Place and current plan identity.",
        );
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            action: "restore",
            fields: Object.fromEntries(
              Object.entries(input)
                .filter(([key]) => key !== "operationId")
                .sort(([a], [b]) => a.localeCompare(b)),
            ),
          }),
        )
        .digest("hex");
      const receipt = stored?.receipts.find(
        (item) => item.id === input.operationId,
      );
      if (receipt) {
        if (receipt.hash !== hash)
          throw new TripFailure(
            "operation-conflict",
            "This operation identity was used for another change. Reload the day.",
            409,
          );
        // Acknowledgement returns current state; it never reinserts an obsolete stop.
        return state;
      }
      const current = state.plan;
      if (
        !current ||
        !stored ||
        state.needsReview ||
        input.dataKind !== trip.dataKind ||
        input.planId !== current.id ||
        input.expectedRevision !== current.revision ||
        input.requestRevision !== current.requestRevision ||
        input.selectionRevision !== current.selectionRevision ||
        ![
          input.expectedRevision,
          input.requestRevision,
          input.selectionRevision,
        ].every(Number.isSafeInteger)
      )
        throw new TripFailure(
          "restoration-conflict",
          "The plan, request or chosen Places changed. Reload and review the current day before restoring.",
          409,
        );
      const removed = current.unscheduledPlaces.find(
        (item) => item.placeId === input.placeId,
      );
      if (
        !removed ||
        !trip.selectedPlaceIds.includes(removed.placeId) ||
        !current.request.selectedPlaceIds.includes(removed.placeId) ||
        !trip.savedPlaces.some((item) => item.placeId === removed.placeId) ||
        current.stops.some((stop) => stop.placeId === removed.placeId)
      )
        throw new TripFailure(
          "restoration-conflict",
          "Restore only a retained chosen Place absent from the current day.",
          409,
        );
      if (stored.receipts.length >= 10000)
        throw new TripFailure(
          "restoration-limit",
          "This Trip has reached its plan update limit.",
          429,
        );
      const retainedMember = trip.savedPlaces.find(
        (item) => item.placeId === removed.placeId,
      );
      if (
        retainedMember &&
        savedVisitFacts(retainedMember).fields.operation.value === "closed"
      )
        throw new TripFailure(
          "current-closure",
          "The latest reviewed operating-status fact records closure. A newer permitted check is required before Restore.",
          409,
        );
      const evidence = planningEvidence(trip, current.request);
      const knownConstraint =
        removed.restoreEligibility !== "current-check-required" ||
        current.operatingHours.some(
          (hours) => hours.placeId === removed.placeId && hours.closed,
        ) ||
        current.travelLegs.some(
          (leg) =>
            (leg.fromPlaceId === removed.placeId ||
              leg.toPlaceId === removed.placeId) &&
            !["available", "permission-unqualified"].includes(leg.outcome),
        );
      const awaiting = () => {
        throw new TripFailure(
          "restore-awaiting-check",
          "This Place needs a fresh opening-hours and journey assessment before Restore. Current live checks are unavailable; retained choices and evidence are unchanged.",
          409,
        );
      };
      const previousEvidenceAt = Date.parse(
        removed.evidenceRetrievedAt ?? current.updatedAt,
      );
      if (
        knownConstraint &&
        (!evidence ||
          !Number.isFinite(previousEvidenceAt) ||
          Date.parse(evidence.retrievedAt) <= previousEvidenceAt)
      )
        awaiting();
      const plan: DayPlan = structuredClone(current);
      const stop: DayPlan["stops"][number] = {
        placeId: removed.placeId,
        desiredArrivalMinute:
          removed.cause === "manual-removal"
            ? (removed.restore?.desiredArrivalMinute ?? null)
            : null,
        arrivalMinute: null,
        departureMinute: null,
        visitTimeAssumption: null,
        hoursEvidence: null,
      };
      // Manual restoration returns to its saved position; exclusions append for fresh assessment.
      plan.stops.splice(
        Math.min(
          (removed.cause === "manual-removal"
            ? removed.restore?.originalIndex
            : undefined) ?? plan.stops.length,
          plan.stops.length,
        ),
        0,
        stop,
      );
      plan.unscheduledPlaces = plan.unscheduledPlaces.filter(
        (item) => item.placeId !== removed.placeId,
      );
      for (const item of plan.stops) {
        item.arrivalMinute = null;
        item.departureMinute = null;
        item.visitTimeAssumption = null;
      }
      plan.assumptions = [
        "Organiser-chosen order; proximity and feasibility are unverified.",
      ];
      applyEditedPlanningEvidence(plan, evidence);
      // A manual removal with unknown facts is allowed, while known conflicts cannot be overridden.
      if (
        evidence?.hours.some(
          (hours) => hours.placeId === removed.placeId && hours.closed,
        ) ||
        plan.travelLegs.some(
          (leg) =>
            (leg.fromPlaceId === removed.placeId ||
              leg.toPlaceId === removed.placeId) &&
            !["available", "permission-unqualified"].includes(leg.outcome),
        ) ||
        plan.warnings.some((warning) =>
          warning.startsWith(`Edited stop ${removed.placeId}:`),
        )
      )
        awaiting();
      if (
        knownConstraint &&
        (plan.stops.some((item) => item.arrivalMinute === null) ||
          plan.travelLegs.some(
            (leg) =>
              leg.outcome !== "available" || leg.durationSeconds === null,
          ) ||
          plan.warnings.some((warning) => warning.startsWith("Edited stop ")))
      )
        awaiting();
      plan.revision += 1;
      plan.updatedAt = new Date().toISOString();
      plan.manuallyEdited = true;
      plan.explanation =
        "Organiser restored a retained chosen Place after current checks. Desired times remain arrangements, not verified arrivals.";
      db.prepare("UPDATE generated_day_plans SET document=? WHERE id=?").run(
        JSON.stringify({
          plan,
          receipts: [...stored.receipts, { id: input.operationId, hash }],
        }),
        `${trip.id}:${trip.dataKind}`,
      );
      return { plan, needsReview: false };
    })();
  } finally {
    db.close();
  }
}
