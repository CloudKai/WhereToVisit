import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:8180" };
export async function prepareRestoreTrip(
  request: APIRequestContext,
  fixture = false,
) {
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Editor",
          email: `edit-${randomUUID()}@example.invalid`,
          password: "Editing-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await request.post("/api/trips", {
        headers,
        data: { title: "Edited real day", city: "Shanghai" },
      })
    ).json()
  ).trip;
  for (const placeId of [
    ...(fixture
      ? ["fictional-cafe-east", "fictional-cafe-west"]
      : ["bluebottle-zhangyuan", "roastery-shanghai"]),
  ]) {
    const intent = (
      await (
        await request.post("/api/trip-save-intents", {
          headers,
          data: { placeId },
        })
      ).json()
    ).intent;
    expect(
      (
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "save", intentId: intent.id },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "select", placeId, selected: true },
        })
      ).status(),
    ).toBe(200);
  }
  const draft = (
    await (await request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  const saved = (
    await (
      await request.post(`/api/trips/${trip.id}/day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 0,
          selectionRevision: draft.selectionRevision,
          visitDate: "2026-12-31",
        },
      })
    ).json()
  ).dayPlan;
  expect(
    (
      await request.post(`/api/trips/${trip.id}/generated-day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 0,
          requestRevision: saved.draft.revision,
          selectionRevision: saved.selectionRevision,
        },
      })
    ).status(),
  ).toBe(200);
  return trip;
}

export function restoreInput(
  plan: {
    id: string;
    revision: number;
    dataKind: string;
    requestRevision: number;
    selectionRevision: number;
  },
  placeId: string,
) {
  return {
    operationId: randomUUID(),
    placeId,
    planId: plan.id,
    dataKind: plan.dataKind,
    expectedRevision: plan.revision,
    requestRevision: plan.requestRevision,
    selectionRevision: plan.selectionRevision,
  };
}
