import "server-only";
import type { DayPlan, GeneratedDayPlanState, Trip } from "@/shared/contracts";
import { dayPlanState } from "./day-plan-state";
import type { openDatabase } from "./db/connection";
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
  const plan = storedGeneratedDayPlan(db, trip)?.plan ?? null;
  const draft = dayPlanState(db, trip);
  return {
    plan,
    needsReview:
      !!plan &&
      (draft.needsReview ||
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
