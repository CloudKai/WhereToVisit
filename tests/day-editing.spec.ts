import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const headers = { Origin: "http://127.0.0.1:8180" };
const source = ".data/day-planning-scenario.json";
function evidence() {
  return {
    kind: "fixture",
    visitDate: "2026-12-31",
    requestedMode: "walking-transit",
    provider: "Fictional scenario provider",
    apiVersion: "scenario-v1",
    retrievedAt: "2026-10-13T00:00:00Z",
    coordinateProvenance: "Fictional endpoint coordinates",
    hours: [
      {
        placeId: "fictional-cafe-east",
        closed: false,
        opensMinute: 540,
        closesMinute: 1080,
        evidence: "Fictional east dated hours",
      },
      {
        placeId: "fictional-cafe-west",
        closed: false,
        opensMinute: 540,
        closesMinute: 1080,
        evidence: "Fictional west dated hours",
      },
    ],
    legs: [
      {
        fromPlaceId: "fictional-cafe-east",
        toPlaceId: "fictional-cafe-west",
        outcome: "available",
        actualSubmode: "transit",
        resultKind: "route",
        durationSeconds: 900,
        distanceMetres: 1500,
      },
    ],
  };
}
async function prepare(
  request: APIRequestContext,
  pace: "balanced" | null = "balanced",
) {
  writeFileSync(source, JSON.stringify(evidence()));
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Fixture editor",
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
        data: { title: "Fixture edited day", city: "Shanghai" },
      })
    ).json()
  ).trip;
  for (const placeId of ["fictional-cafe-east", "fictional-cafe-west"]) {
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
  const state = (
    await (await request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  const draft = (
    await (
      await request.post(`/api/trips/${trip.id}/day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 0,
          selectionRevision: state.selectionRevision,
          visitDate: "2026-12-31",
          pace,
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
          requestRevision: draft.draft.revision,
          selectionRevision: draft.selectionRevision,
        },
      })
    ).status(),
  ).toBe(200);
  return trip;
}
test("edited desired times expose fictional hours, travel and next-day conflicts", async ({
  page,
}) => {
  const trip = await prepare(page.request, null);
  await page.goto("/trips");
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  const stops = result
    .getByRole("list", { name: "Day stops" })
    .getByRole("listitem");
  await expect(result).toContainText("10:00");
  await stops.nth(0).getByLabel("Desired arrival (Shanghai)").fill("23:45");
  await stops.nth(0).getByRole("button", { name: "Save desired time" }).click();
  await expect(result).toContainText("User-desired arrival 23:45");
  await expect(result).toContainText(
    "Assumed departure 00:30 (+1 day, beyond selected day)",
  );
  await expect(result).toContainText(
    "visit conflicts with evidenced opening hours",
  );
  await expect(result).toContainText("Opening interval 09:00–18:00");
  const plan = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan.plan;
  expect(plan.stops[0]).toMatchObject({
    desiredArrivalMinute: 1425,
    arrivalMinute: 1425,
    departureMinute: 1470,
  });
  expect(plan.travelLegs[0]).toMatchObject({
    durationSeconds: 900,
    actualSubmode: "transit",
  });
  await stops.nth(1).getByRole("button", { name: "Move earlier" }).click();
  await expect(result).toContainText("Timing unresolved");
  await expect(result).toContainText("no-route");
  const reverse = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan.plan;
  expect(reverse.travelLegs[0]).toMatchObject({
    fromPlaceId: "fictional-cafe-west",
    toPlaceId: "fictional-cafe-east",
    durationSeconds: null,
    outcome: "no-route",
  });
  expect(
    reverse.stops.every(
      (stop: { arrivalMinute: number | null }) => stop.arrivalMinute === null,
    ),
  ).toBe(true);
  await page.reload();
  await expect(result).toContainText("User-desired arrival 23:45");
  await expect(result).toContainText(
    "Missing hours or unavailable travel legs",
  );
});

test("removal retains provenance and votes, prior exclusions and authority-first no-replay receipts", async ({
  page,
  browser,
}) => {
  const trip = await prepare(page.request);
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  const imported = await page.request.post("/api/imports", {
    headers,
    data: { sourceUrl: "https://en.wikivoyage.org/wiki/Fixture_Resolution" },
  });
  expect(imported.status()).toBe(202);
  const id = (await imported.json()).job.id;
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/imports/${id}`)).json()).job
          .status,
    )
    .not.toMatch(/^(queued|processing)$/);
  const resolved = (
    await (
      await page.request.post(`/api/imports/${id}/resolution`, {
        headers,
        data: { action: "resolve" },
      })
    ).json()
  ).job;
  expect(
    (
      await page.request.post(`/api/imports/${id}/resolution`, {
        headers,
        data: {
          action: "confirm",
          mentionId: resolved.mentions[0].id,
          candidateId: "fictional-cafe-east",
        },
      })
    ).status(),
  ).toBe(200);
  const intent = (
    await (
      await page.request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "fictional-cafe-east", importId: id },
      })
    ).json()
  ).intent;
  expect(
    (
      await page.request.post(`/api/trips/${trip.id}`, {
        headers,
        data: { action: "save", intentId: intent.id },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(`/api/trips/${trip.id}/collaboration`, {
        headers,
        data: {
          action: "vote",
          operationId: randomUUID(),
          placeId: "fictional-cafe-east",
          choice: "must-go",
        },
      })
    ).status(),
  ).toBe(200);
  const beforeTrip = (
    await (await page.request.get(`/api/trips/${trip.id}`)).json()
  ).trip;
  expect(beforeTrip.savedPlaces[0].importedEvidence.length).toBeGreaterThan(0);
  const beforeVotes = (
    await (await page.request.get(`/api/trips/${trip.id}/collaboration`)).json()
  ).collaboration;
  const patch = {
    operationId: randomUUID(),
    expectedRevision: 1,
    stops: [{ placeId: "fictional-cafe-west", desiredArrivalMinute: 600 }],
  };
  expect(
    (await page.request.patch(url, { headers, data: patch })).status(),
  ).toBe(200);
  const removed = (await (await page.request.get(url)).json()).generatedDayPlan;
  expect(removed.plan.unscheduledPlaces).toEqual([
    {
      placeId: "fictional-cafe-east",
      reason:
        "Removed from this day by the organiser; retained in the Trip shortlist and selected Places.",
    },
  ]);
  const afterTrip = (
    await (await page.request.get(`/api/trips/${trip.id}`)).json()
  ).trip;
  expect(afterTrip.savedPlaces).toEqual(beforeTrip.savedPlaces);
  expect(afterTrip.selectedPlaceIds).toEqual(beforeTrip.selectedPlaceIds);
  expect(
    (
      await (
        await page.request.get(`/api/trips/${trip.id}/collaboration`)
      ).json()
    ).collaboration,
  ).toEqual(beforeVotes);
  expect(
    (
      await page.request.patch(url, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 2,
          stops: [
            { placeId: "fictional-cafe-east", desiredArrivalMinute: null },
          ],
        },
      })
    ).status(),
  ).toBe(400);
  const newer = {
    operationId: randomUUID(),
    expectedRevision: 2,
    stops: [{ placeId: "fictional-cafe-west", desiredArrivalMinute: 660 }],
  };
  expect(
    (await page.request.patch(url, { headers, data: newer })).status(),
  ).toBe(200);
  const current = (await (await page.request.get(url)).json()).generatedDayPlan;
  writeFileSync(source, "invalid JSON");
  expect(
    (await page.request.patch(url, { headers, data: patch })).status(),
  ).toBe(200);
  expect((await (await page.request.get(url)).json()).generatedDayPlan).toEqual(
    current,
  );
  expect(
    (
      await page.request.patch(url, {
        headers,
        data: { ...newer, operationId: randomUUID(), expectedRevision: 3 },
      })
    ).status(),
  ).toBe(503);
  expect((await (await page.request.get(url)).json()).generatedDayPlan).toEqual(
    current,
  );
  const other = await browser.newContext();
  try {
    expect(
      (
        await other.request.post(
          "http://127.0.0.1:8180/api/auth/sign-up/email",
          {
            headers,
            data: {
              name: "Other",
              email: `other-edit-${randomUUID()}@example.invalid`,
              password: "Editing-password-123",
            },
          },
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await other.request.patch(`http://127.0.0.1:8180${url}`, {
          headers,
          data: patch,
        })
      ).status(),
    ).toBe(404);
  } finally {
    await other.close();
  }
  writeFileSync(source, JSON.stringify(evidence()));
  const draft = (
    await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  expect(
    (
      await page.request.post(url, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 3,
          requestRevision: draft.draft.revision,
          selectionRevision: draft.selectionRevision,
          replaceEdited: true,
        },
      })
    ).status(),
  ).toBe(200);
  const closed = evidence();
  closed.hours[0].closed = true;
  writeFileSync(source, JSON.stringify(closed));
  expect(
    (
      await page.request.post(url, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 4,
          requestRevision: draft.draft.revision,
          selectionRevision: draft.selectionRevision,
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.patch(url, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 5,
          stops: [
            { placeId: "fictional-cafe-west", desiredArrivalMinute: 660 },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  const excluded = (await (await page.request.get(url)).json()).generatedDayPlan
    .plan;
  expect(excluded.unscheduledPlaces).toHaveLength(1);
  expect(excluded.unscheduledPlaces[0]).toMatchObject({
    placeId: "fictional-cafe-east",
  });
  expect(excluded.unscheduledPlaces[0].reason).toContain("closed");
  expect(
    (
      await page.request.patch(url, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 6,
          stops: [
            { placeId: "fictional-cafe-east", desiredArrivalMinute: 660 },
          ],
        },
      })
    ).status(),
  ).toBe(400);
});

test("failed edit persistence and a lost response retain the saved day and captured retry", async ({
  page,
}) => {
  test.setTimeout(120000);
  const trip = await prepare(page.request);
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  const before = (await (await page.request.get(url)).json()).generatedDayPlan;
  await page.goto("/trips");
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  const edit = result
    .getByRole("list", { name: "Day stops" })
    .getByRole("listitem")
    .nth(1)
    .getByRole("button", { name: "Move earlier" });
  const { databasePath } = JSON.parse(
    readFileSync(".data/trip-storage-test.json", "utf8"),
  );
  await expect(result).toContainText("Revision 1");
  await expect(
    page.getByText("Waiting for day request confirmation…", { exact: true }),
  ).toHaveCount(0);
  const lock = new Database(databasePath);
  try {
    lock.exec("BEGIN IMMEDIATE");
    const rejectedWrite = page.waitForResponse(
      (response) =>
        response.url().endsWith(url) && response.request().method() === "PATCH",
    );
    await edit.click();
    expect((await rejectedWrite).status()).toBe(503);
    await expect(
      page.getByRole("alert", { name: "Day plan request failed" }),
    ).toContainText("could not be saved");
    await expect(result).toContainText("Revision 1");
    expect(
      (await (await page.request.get(url)).json()).generatedDayPlan,
    ).toEqual(before);
    lock.exec("ROLLBACK");
    await page
      .getByRole("button", { name: "Retry day request", exact: true })
      .click();
    await expect(result).toContainText("Revision 2");
  } finally {
    if (lock.inTransaction) lock.exec("ROLLBACK");
    lock.close();
  }
  let lost = false;
  await page.route(`**${url}`, async (route) => {
    if (route.request().method() === "PATCH" && !lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await edit.click();
  await expect(
    page.getByRole("alert", { name: "Day plan request failed" }),
  ).toContainText("No new change is confirmed saved");
  await expect(result).toContainText("Revision 2");
  const committed = (await (await page.request.get(url)).json())
    .generatedDayPlan.plan;
  expect(committed.revision).toBe(3);
  expect(
    (
      await page.request.patch(url, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 3,
          stops: [
            { placeId: "fictional-cafe-east", desiredArrivalMinute: 660 },
            { placeId: "fictional-cafe-west", desiredArrivalMinute: null },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  writeFileSync(source, "invalid JSON");
  await page
    .getByRole("button", { name: "Retry day request", exact: true })
    .click();
  await expect(result).toContainText("Revision 4");
  await expect(result).toContainText("User-desired arrival 11:00");
  expect(
    (await (await page.request.get(url)).json()).generatedDayPlan.plan.revision,
  ).toBe(4);
});
