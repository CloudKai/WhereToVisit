import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { DayPlan, DayPlanDraft, Trip } from "@/shared/contracts";
import { dayPlanState } from "./day-plan-state";
import { openDatabase } from "./db/connection";
import {
  generatedDayPlanState,
  storedGeneratedDayPlan,
} from "./generated-day-plan-state";
import { collaborationAuthority } from "./invitations";
import { applyPlanningEvidence, planningEvidence } from "./planning-evidence";
import { TripFailure } from "./trips";

function propose(
  trip: Trip,
  draft: DayPlanDraft,
  previous: DayPlan | null,
): DayPlan {
  const now = new Date().toISOString();
  const request = draft.request;
  // No qualified live routes/coordinates/hours exist. Canonical saved order is an explicit ordering assumption.
  const ids = trip.savedPlaces
    .filter((member) => request.selectedPlaceIds.includes(member.placeId))
    .map((member) => member.placeId);
  const plan: DayPlan = {
    id: previous?.id ?? randomUUID(),
    revision: (previous?.revision ?? 0) + 1,
    request,
    requestRevision: draft.revision,
    selectionRevision: draft.selectionRevision,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    dataKind: trip.dataKind,
    operatingHours: [],
    assumptions: [
      "Saved shortlist order is the proposed order; proximity is unverified.",
      "No visit-duration or day-window assumption is applied while travel times and hours are unresolved.",
    ],
    explanation:
      "Uses only your confirmed selected branches in saved shortlist order. Votes guide your selection and do not guarantee feasibility.",
    stops: ids.map((placeId) => ({
      placeId,
      visitTimeAssumption: null,
      arrivalMinute: null,
      departureMinute: null,
      hoursEvidence: null,
    })),
    travelLegs: ids.slice(1).map((toPlaceId, index) => ({
      fromPlaceId: ids[index],
      toPlaceId,
      requestedMode: request.mode,
      actualSubmode: null,
      provider: null,
      retrievedAt: null,
      resultKind: null,
      durationSeconds: null,
      distanceMetres: null,
      outcome: "permission-unqualified",
      apiVersion: null,
      coordinateProvenance: null,
      visitTimeContext: `${request.visitDate} Asia/Shanghai; no departure time established`,
    })),
    warnings: [
      "Opening hours and current operation are unknown; verify each branch before visiting.",
      "Mode-specific routes are permission-unqualified. Timing and one-day feasibility are unresolved.",
      ...(request.startArea
        ? [
            "Start area is free text without a qualified origin; no start route was invented.",
          ]
        : []),
      ...(request.budget
        ? [
            "Budget recorded; branch prices are unknown, so affordability cannot be established.",
          ]
        : []),
      ...(request.dietaryNeeds
        ? [
            "Dietary preference recorded; venue suitability and allergy safety are unknown.",
          ]
        : []),
      ...(request.pace
        ? ["Pace recorded; no venue dwell duration can be inferred from it."]
        : []),
    ],
    unscheduledPlaces: [],
  };
  const evidence = planningEvidence(trip, request);
  if (evidence) applyPlanningEvidence(plan, evidence);
  return plan;
}
export function dayGenerationOperation(
  userId: string,
  tripId: string,
  input?: Record<string, unknown>,
) {
  const { sqlite: db } = openDatabase();
  try {
    return db.transaction(() => {
      const { trip } = collaborationAuthority(db, tripId, { userId });
      const state = generatedDayPlanState(db, trip);
      if (!input) return state;
      if (
        typeof input.operationId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(input.operationId)
      )
        throw new TripFailure(
          "invalid-generation",
          "A fresh operation identity is required for safe retry.",
        );
      const hash = createHash("sha256")
        .update(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(input)
                .filter(([key]) => key !== "operationId")
                .sort(([a], [b]) => a.localeCompare(b)),
            ),
          ),
        )
        .digest("hex");
      const stored = storedGeneratedDayPlan(db, trip);
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
      if (
        !Object.keys(input).every((key) =>
          [
            "operationId",
            "expectedRevision",
            "requestRevision",
            "selectionRevision",
          ].includes(key),
        )
      )
        throw new TripFailure(
          "invalid-generation",
          "Generate only from the saved day request; client places or route facts are not accepted.",
        );
      const draftState = dayPlanState(db, trip);
      if (!draftState.draft)
        throw new TripFailure(
          "missing-day-request",
          "Save a one-day draft before generation.",
        );
      if (
        draftState.needsReview ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision !== (state.plan?.revision ?? 0) ||
        !Number.isSafeInteger(input.requestRevision) ||
        input.requestRevision !== draftState.draft.revision ||
        !Number.isSafeInteger(input.selectionRevision) ||
        input.selectionRevision !== draftState.selectionRevision
      )
        throw new TripFailure(
          "generation-conflict",
          "The plan, request or chosen Places changed. Reload, review and save current inputs before generation.",
          409,
        );
      const selected = draftState.draft.request.selectedPlaceIds;
      if (
        !selected.length ||
        selected.length !== trip.selectedPlaceIds.length ||
        selected.some(
          (id) =>
            !trip.selectedPlaceIds.includes(id) ||
            !trip.savedPlaces.some(
              (member) =>
                member.placeId === id &&
                member.place.city === "Shanghai" &&
                !!member.place.address,
            ),
        )
      )
        throw new TripFailure(
          "invalid-generation",
          "Choose confirmed Shanghai branches and save current inputs.",
        );
      if ((stored?.receipts.length ?? 0) >= 10000)
        throw new TripFailure(
          "generation-limit",
          "This Trip has reached its generation update limit.",
          429,
        );
      const plan = propose(trip, draftState.draft, state.plan);
      const accounted = [
        ...plan.stops.map((stop) => stop.placeId),
        ...plan.unscheduledPlaces.map((stop) => stop.placeId),
      ];
      if (
        accounted.length !== selected.length ||
        new Set(accounted).size !== selected.length ||
        accounted.some((id) => !selected.includes(id))
      )
        throw new TripFailure(
          "invalid-generated-output",
          "The generated result could not account for every selected Place.",
          503,
        );
      db.prepare(
        "INSERT INTO generated_day_plans(id,trip_id,document) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
      ).run(
        `${trip.id}:${trip.dataKind}`,
        trip.id,
        JSON.stringify({
          plan,
          receipts: [
            ...(stored?.receipts ?? []),
            { id: input.operationId, hash },
          ],
        }),
      );
      return { plan, needsReview: false };
    })();
  } finally {
    db.close();
  }
}
