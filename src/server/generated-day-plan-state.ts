import "server-only";
import type { DayPlan, GeneratedDayPlanState, Trip } from "@/shared/contracts";
import { dayPlanState } from "./day-plan-state";
import type { openDatabase } from "./db/connection";
import { visitFactsNeedReview } from "./visit-facts";
export type StoredGeneratedDayPlan = {
  plan: DayPlan;
  receipts: { id: string; hash: string }[];
};
export function storedGeneratedDayPlan(
  db: ReturnType<typeof openDatabase>["sqlite"],
  trip: Trip,
): StoredGeneratedDayPlan | null {
  const row = db
    .prepare("SELECT document FROM generated_day_plans WHERE id=?")
    .get(`${trip.id}:${trip.dataKind}`) as { document: string } | undefined;
  return row ? JSON.parse(row.document) : null;
}
export function generatedDayPlanState(
  db: ReturnType<typeof openDatabase>["sqlite"],
  trip: Trip,
): GeneratedDayPlanState {
  const stored = storedGeneratedDayPlan(db, trip)?.plan ?? null;
  const plan = stored
    ? {
        ...stored,
        unscheduledPlaces: stored.unscheduledPlaces.map((item) => {
          const manual =
            item.cause === "manual-removal" &&
            item.restore &&
            ["current-check-required", "fresh-evidence-required"].includes(
              item.restoreEligibility ?? "",
            ) &&
            Number.isSafeInteger(item.restore.originalIndex) &&
            item.restore.originalIndex >= 0 &&
            (item.restore.desiredArrivalMinute === null ||
              (Number.isSafeInteger(item.restore.desiredArrivalMinute) &&
                item.restore.desiredArrivalMinute >= 0 &&
                item.restore.desiredArrivalMinute < 1440));
          const cause = manual
            ? ("manual-removal" as const)
            : ["closure", "route-conflict", "capacity-conflict"].includes(
                  item.cause ?? "",
                )
              ? item.cause
              : ("legacy-unknown" as const);
          return {
            ...item,
            cause,
            restoreEligibility:
              manual && item.restoreEligibility === "current-check-required"
                ? ("current-check-required" as const)
                : ("fresh-evidence-required" as const),
          };
        }),
      }
    : null;
  const draft = dayPlanState(db, trip);
  return {
    plan,
    needsReview:
      !!plan &&
      (draft.needsReview ||
        visitFactsNeedReview(
          trip,
          plan.request.selectedPlaceIds,
          plan.visitFactVersions,
        ) ||
        !draft.draft ||
        plan.requestRevision !== draft.draft.revision ||
        plan.selectionRevision !== draft.selectionRevision),
  };
}
export function projectedDayPlanIds(
  db: ReturnType<typeof openDatabase>["sqlite"],
  trip: Trip,
) {
  const plan = storedGeneratedDayPlan(db, trip)?.plan;
  return plan ? [plan.id] : [];
}
