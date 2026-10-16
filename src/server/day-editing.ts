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
export function dayEditingOperation(
  userId: string,
  tripId: string,
  input: Record<string, unknown>,
) {
  const { sqlite: db } = openDatabase();
  try {
    return db.transaction(() => {
      const { trip } = collaborationAuthority(db, tripId, { userId });
      const state = generatedDayPlanState(db, trip);
      const stored = storedGeneratedDayPlan(db, trip);
      if (
        typeof input.operationId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(input.operationId)
      )
        throw new TripFailure(
          "invalid-edit",
          "A fresh operation identity is required for safe retry.",
        );
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            action: "edit",
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
            "This operation identity was used for another change. Reload the plan.",
            409,
          );
        return state;
      }
      if (!state.plan || !stored)
        throw new TripFailure(
          "missing-day-plan",
          "Generate a day plan before editing.",
        );
      if (
        state.needsReview ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision !== state.plan.revision
      )
        throw new TripFailure(
          "editing-conflict",
          "The saved plan, request or chosen Places changed. Reload and review the current plan before editing.",
          409,
        );
      if (
        !Object.keys(input).every((key) =>
          ["operationId", "expectedRevision", "stops"].includes(key),
        ) ||
        !Array.isArray(input.stops) ||
        input.stops.length > 100
      )
        throw new TripFailure(
          "invalid-edit",
          "Edit only the current stop order and desired Shanghai arrival times.",
        );
      const stops: DayPlan["stops"] = input.stops.map((value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new TripFailure(
            "invalid-edit",
            "Each edited stop needs a canonical identity and nullable desired time.",
          );
        const item = value as Record<string, unknown>;
        const previous = state.plan?.stops.find(
          (stop) => stop.placeId === item.placeId,
        );
        if (
          !previous ||
          !Object.keys(item).every((key) =>
            ["placeId", "desiredArrivalMinute"].includes(key),
          ) ||
          !(
            item.desiredArrivalMinute === null ||
            (Number.isSafeInteger(item.desiredArrivalMinute) &&
              (item.desiredArrivalMinute as number) >= 0 &&
              (item.desiredArrivalMinute as number) < 1440)
          )
        )
          throw new TripFailure(
            "invalid-edit",
            "Use currently scheduled canonical stops and a desired minute from 00:00 through 23:59, or clear it.",
          );
        return {
          ...previous,
          desiredArrivalMinute: item.desiredArrivalMinute as number | null,
          arrivalMinute: null,
          departureMinute: null,
          visitTimeAssumption: null,
        };
      });
      if (new Set(stops.map((stop) => stop.placeId)).size !== stops.length)
        throw new TripFailure(
          "invalid-edit",
          "A canonical branch can appear only once in the day.",
        );
      if (stored.receipts.length >= 10000)
        throw new TripFailure(
          "editing-limit",
          "This Trip has reached its plan update limit.",
          429,
        );
      const plan: DayPlan = {
        ...state.plan,
        revision: state.plan.revision + 1,
        updatedAt: new Date().toISOString(),
        manuallyEdited: true,
        stops,
        explanation:
          "Organiser-edited stop order and desired times. Desired times record arrangements, not verified opening hours or route arrival guarantees.",
        assumptions: [
          "Organiser-chosen order; proximity and feasibility are unverified.",
        ],
        unscheduledPlaces: [
          ...state.plan.unscheduledPlaces,
          ...state.plan.stops
            .filter(
              (stop) => !stops.some((kept) => kept.placeId === stop.placeId),
            )
            .map((stop) => ({
              placeId: stop.placeId,
              cause: "manual-removal" as const,
              restoreEligibility:
                state.plan?.operatingHours.some(
                  (hours) => hours.placeId === stop.placeId && hours.closed,
                ) ||
                state.plan?.travelLegs.some(
                  (leg) =>
                    (leg.fromPlaceId === stop.placeId ||
                      leg.toPlaceId === stop.placeId) &&
                    !["available", "permission-unqualified"].includes(
                      leg.outcome,
                    ),
                )
                  ? ("fresh-evidence-required" as const)
                  : ("current-check-required" as const),
              restore: {
                originalIndex: state.plan?.stops.indexOf(stop) ?? 0,
                desiredArrivalMinute: stop.desiredArrivalMinute ?? null,
              },
              evidenceRetrievedAt:
                state.plan?.operatingHours.find(
                  (hours) => hours.placeId === stop.placeId,
                )?.retrievedAt ?? null,
              reason:
                "Removed from this day by the organiser; retained in the Trip shortlist and selected Places.",
            })),
        ],
      };
      applyEditedPlanningEvidence(plan, planningEvidence(trip, plan.request));
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
