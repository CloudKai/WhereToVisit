import "server-only";
import type { DayPlanDraft, DayPlanDraftState, Trip } from "@/shared/contracts";
import type { openDatabase } from "./db/connection";
export type StoredDayPlan = {
  draft: DayPlanDraft;
  receipts: { id: string; hash: string }[];
};
export function storedDayPlan(
  db: ReturnType<typeof openDatabase>["sqlite"],
  trip: Trip,
): StoredDayPlan | null {
  const row = db
    .prepare("SELECT document FROM day_plan_requests WHERE id=?")
    .get(`${trip.id}:${trip.dataKind}`) as { document: string } | undefined;
  return row ? JSON.parse(row.document) : null;
}
export function dayPlanState(
  db: ReturnType<typeof openDatabase>["sqlite"],
  trip: Trip,
): DayPlanDraftState {
  const draft = storedDayPlan(db, trip)?.draft ?? null;
  const selectionRevision = trip.selectionRevision ?? 0;
  return {
    draft,
    selectionRevision,
    needsReview: !!draft && draft.selectionRevision !== selectionRevision,
  };
}
