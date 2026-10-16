import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { DayPlanRequest } from "@/shared/contracts";
import {
  normalizedText,
  type TextPolicy,
  textError,
  textPolicies,
} from "@/shared/text-policy";
import { dayPlanState, storedDayPlan } from "./day-plan-state";
import { openDatabase } from "./db/connection";
import { collaborationAuthority } from "./invitations";
import { TripFailure } from "./trips";

function invalid(message: string): never {
  throw new TripFailure("invalid-day-plan", message);
}
function optionalText(value: unknown, policy: TextPolicy) {
  const error = textError(value, policy);
  if (error) invalid(error);
  return typeof value === "string"
    ? normalizedText(value, policy) || null
    : null;
}
function visitDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    invalid("Choose a valid Shanghai calendar date (YYYY-MM-DD).");
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1])
    invalid("Choose a valid Shanghai calendar date (YYYY-MM-DD).");
  return value;
}
export function dayPlanOperation(
  userId: string,
  tripId: string,
  input?: Record<string, unknown>,
) {
  const { sqlite: db } = openDatabase();
  try {
    return db.transaction(() => {
      const { trip } = collaborationAuthority(db, tripId, { userId });
      const state = dayPlanState(db, trip);
      if (!input) return state;
      const stored = storedDayPlan(db, trip);
      if (
        typeof input.operationId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(input.operationId)
      )
        invalid("A fresh operation identity is required for safe retry.");
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
      const receipt = stored?.receipts.find(
        (item) => item.id === input.operationId,
      );
      if (receipt) {
        if (receipt.hash !== hash)
          throw new TripFailure(
            "operation-conflict",
            "This operation identity was used for another change. Reload and save a new draft.",
            409,
          );
        return state;
      }
      if (
        !Object.keys(input).every((key) =>
          [
            "operationId",
            "expectedRevision",
            "selectionRevision",
            "visitDate",
            "mode",
            "startArea",
            "budget",
            "dietaryNeeds",
            "pace",
          ].includes(key),
        )
      )
        invalid("Supply only the one-day date and supported preferences.");
      if (
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision !== (stored?.draft.revision ?? 0) ||
        !Number.isSafeInteger(input.selectionRevision) ||
        input.selectionRevision !== state.selectionRevision
      )
        throw new TripFailure(
          "day-plan-conflict",
          "The draft or chosen Places changed. Reload the draft, review current selections and save again.",
          409,
        );
      if (!trip.selectedPlaceIds.length)
        invalid(
          "Select at least one confirmed Place from your saved shortlist before saving a day draft.",
        );
      if (
        trip.selectedPlaceIds.some(
          (id) =>
            !trip.savedPlaces.some(
              (member) =>
                member.placeId === id &&
                member.place.city === "Shanghai" &&
                !!member.place.address,
            ),
        )
      )
        invalid(
          "Only confirmed Shanghai shortlist branches with an address can become chosen stops. Confirm the branch in Group decisions or deselect it.",
        );
      const mode = input.mode === undefined ? "walking-transit" : input.mode;
      if (
        typeof mode !== "string" ||
        !["walking-transit", "taxi-car"].includes(mode)
      )
        invalid("Choose walking/public transit or taxi/car.");
      const pace = input.pace ?? null;
      if (
        ![null, "relaxed", "balanced", "busy"].includes(pace as string | null)
      )
        invalid("Choose an optional pace or leave it unset.");
      const request: DayPlanRequest = {
        tripId,
        visitDate: visitDate(input.visitDate),
        selectedPlaceIds: [...trip.selectedPlaceIds],
        mode: mode as DayPlanRequest["mode"],
        startArea: optionalText(input.startArea, textPolicies.startArea),
        budget: optionalText(input.budget, textPolicies.budget),
        dietaryNeeds: optionalText(
          input.dietaryNeeds,
          textPolicies.dietaryNeeds,
        ),
        pace: pace as DayPlanRequest["pace"],
      };
      if ((stored?.receipts.length ?? 0) >= 10000)
        throw new TripFailure(
          "day-plan-limit",
          "This Trip has reached its draft update limit.",
          429,
        );
      const now = new Date().toISOString();
      const draft = {
        id: stored?.draft.id ?? randomUUID(),
        revision: (stored?.draft.revision ?? 0) + 1,
        selectionRevision: state.selectionRevision,
        request,
        createdAt: stored?.draft.createdAt ?? now,
        updatedAt: now,
      };
      db.prepare(
        "INSERT INTO day_plan_requests(id,trip_id,document) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
      ).run(
        `${trip.id}:${trip.dataKind}`,
        trip.id,
        JSON.stringify({
          draft,
          receipts: [
            ...(stored?.receipts ?? []),
            { id: input.operationId, hash },
          ],
        }),
      );
      return {
        draft,
        selectionRevision: state.selectionRevision,
        needsReview: false,
      };
    })();
  } finally {
    db.close();
  }
}
