import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";

import Database from "better-sqlite3";

const headers = { Origin: "http://127.0.0.1:8180" };
const source = ".data/day-planning-scenario.json";
function evidence(outcome = "available", minutes = 15, closed = false) {
  return {
    kind: "fixture",
    visitDate: "2026-12-31",
    requestedMode: "walking-transit",
    provider: "Fictional scenario provider",
    apiVersion: "scenario-v1",
    retrievedAt: "2026-10-12T00:00:00Z",
    coordinateProvenance: "Fictional endpoint coordinates; no real provider",
    hours: [
      {
        placeId: "fictional-cafe-east",
        closed,
        opensMinute: 540,
        closesMinute: 1080,
        evidence: "Fictional dated hours",
      },
      {
        placeId: "fictional-cafe-west",
        closed: false,
        opensMinute: 540,
        closesMinute: 1080,
        evidence: "Fictional dated hours",
      },
    ],
    legs: [
      {
        fromPlaceId: "fictional-cafe-east",
        toPlaceId: "fictional-cafe-west",
        outcome,
        actualSubmode: outcome === "available" ? "transit" : null,
        resultKind: outcome === "available" ? "route" : null,
        durationSeconds: outcome === "available" ? minutes * 60 : null,
        distanceMetres: outcome === "available" ? 1500 : null,
      },
    ],
  };
}
async function setup(request: APIRequestContext) {
  writeFileSync(source, JSON.stringify(evidence()));
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Planner",
          email: `fixture-plan-${randomUUID()}@example.invalid`,
          password: "Planning-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await request.post("/api/trips", {
        headers,
        data: { title: "Fictional planning", city: "Shanghai" },
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
  expect(
    (
      await request.post(`/api/trips/${trip.id}/day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 0,
          selectionRevision: state.selectionRevision,
          visitDate: "2026-12-31",
          dietaryNeeds: "Nut allergy",
          budget: "CNY 100",
          pace: "balanced",
        },
      })
    ).status(),
  ).toBe(200);
  return trip;
}
async function generationInput(request: APIRequestContext, id: string) {
  const draft = (await (await request.get(`/api/trips/${id}/day-plan`)).json())
    .dayPlan;
  const generated = (
    await (await request.get(`/api/trips/${id}/generated-day-plan`)).json()
  ).generatedDayPlan;
  return {
    operationId: randomUUID(),
    expectedRevision: generated.plan?.revision ?? 0,
    requestRevision: draft.draft.revision,
    selectionRevision: draft.selectionRevision,
  };
}
test("fictional provider evidence gives visible estimated timing and preserves unknown suitability", async ({
  page,
}) => {
  const trip = await setup(page.request);
  await page.goto("/trips");
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await expect(result).toContainText("09:00");
  await expect(result).toContainText("10:00");
  await expect(result).toContainText("Fictional development plan");
  await expect(result).toContainText("allergy safety are unknown");
  const plan = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan.plan;
  expect(plan.stops).toHaveLength(2);
  expect(plan.stops[1].arrivalMinute).toBe(600);
  expect(plan.travelLegs[0]).toMatchObject({
    requestedMode: "walking-transit",
    actualSubmode: "transit",
    durationSeconds: 900,
    resultKind: "route",
    provider: "Fictional scenario provider",
  });
  expect(plan.assumptions.join(" ")).toContain("45");
  expect(plan.operatingHours).toEqual([
    {
      placeId: "fictional-cafe-east",
      visitDate: "2026-12-31",
      timeZone: "Asia/Shanghai",
      provider: "Fictional scenario provider",
      retrievedAt: "2026-10-12T00:00:00Z",
      closed: false,
      opensMinute: 540,
      closesMinute: 1080,
      sourceExplanation: "Fictional dated hours",
    },
    {
      placeId: "fictional-cafe-west",
      visitDate: "2026-12-31",
      timeZone: "Asia/Shanghai",
      provider: "Fictional scenario provider",
      retrievedAt: "2026-10-12T00:00:00Z",
      closed: false,
      opensMinute: 540,
      closesMinute: 1080,
      sourceExplanation: "Fictional dated hours",
    },
  ]);
  await expect(result).toContainText("Opening interval 09:00–18:00");
  await expect(result).toContainText("Assumed departure 09:45");
});

export { evidence, generationInput, headers, setup, source };

test("closed and overfull fictional selections stay accounted for despite Must go", async ({
  page,
}) => {
  const trip = await setup(page.request);
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
  writeFileSync(source, JSON.stringify(evidence("available", 15, true)));
  await page.goto("/trips");
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await expect(result).toContainText("closed on the selected date");
  let plan = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan.plan;
  expect(plan.stops.map((stop: { placeId: string }) => stop.placeId)).toEqual([
    "fictional-cafe-west",
  ]);
  expect(plan.unscheduledPlaces[0]).toMatchObject({
    placeId: "fictional-cafe-east",
  });
  expect(
    plan.operatingHours.find(
      (hours: { placeId: string }) => hours.placeId === "fictional-cafe-east",
    ),
  ).toMatchObject({
    closed: true,
    visitDate: "2026-12-31",
    timeZone: "Asia/Shanghai",
  });
  await expect(result).toContainText("Closed on the selected date");
  writeFileSync(source, JSON.stringify(evidence("available", 600)));
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  await expect(result).toContainText("Cannot fit evidenced opening hours");
  plan = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan.plan;
  expect(plan.stops).toHaveLength(1);
  expect(plan.unscheduledPlaces).toHaveLength(1);
  expect(
    new Set(
      [...plan.stops, ...plan.unscheduledPlaces].map(
        (stop: { placeId: string }) => stop.placeId,
      ),
    ),
  ).toEqual(new Set(["fictional-cafe-east", "fictional-cafe-west"]));
});
test("unavailable legs and missing hours never become precise timeline facts", async ({
  page,
}) => {
  const trip = await setup(page.request);
  writeFileSync(source, JSON.stringify(evidence("mode-unsupported")));
  await page.goto("/trips");
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await expect(result).toContainText("Timing unresolved");
  await expect(result).toContainText("mode-unsupported");
  let plan = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan.plan;
  expect(
    plan.stops.every(
      (stop: { arrivalMinute: number | null }) => stop.arrivalMinute === null,
    ),
  ).toBe(true);
  expect(plan.travelLegs[0]).toMatchObject({
    durationSeconds: null,
    requestedMode: "walking-transit",
    actualSubmode: null,
  });
  writeFileSync(source, JSON.stringify({ ...evidence(), hours: [] }));
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  await expect(result).toContainText("Opening hours unknown");
  plan = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan.plan;
  expect(
    plan.stops.every(
      (stop: { arrivalMinute: number | null }) => stop.arrivalMinute === null,
    ),
  ).toBe(true);
});
test("provider failure and mismatched or fabricated responses preserve request and prior plan with retry", async ({
  page,
}) => {
  const trip = await setup(page.request);
  await page.goto("/trips");
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Generated day plan", exact: true }),
  ).toContainText("09:00");
  const before = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan;
  const draftBefore = (
    await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  const wrong = evidence();
  wrong.requestedMode = "taxi-car";
  const unknown = evidence();
  unknown.hours[0].placeId = "invented-venue";
  const driving = evidence();
  driving.legs[0].actualSubmode = "driving";
  for (const malformed of [
    wrong,
    unknown,
    driving,
    { ...evidence(), visitDate: "2026-12-30" },
    { ...evidence(), legs: [{ ...evidence().legs[0], durationSeconds: -5 }] },
  ]) {
    writeFileSync(source, JSON.stringify(malformed));
    expect(
      (
        await page.request.post(`/api/trips/${trip.id}/generated-day-plan`, {
          headers,
          data: await generationInput(page.request, trip.id),
        })
      ).status(),
    ).toBe(503);
    expect(
      (
        await (
          await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
        ).json()
      ).generatedDayPlan,
    ).toEqual(before);
  }
  writeFileSync(
    source,
    JSON.stringify({ ...evidence(), outcome: "provider-unavailable" }),
  );
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Day plan request failed" }),
  ).toContainText("previous plan are retained");
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json())
      .dayPlan,
  ).toEqual(draftBefore);
  expect(
    (
      await (
        await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
      ).json()
    ).generatedDayPlan,
  ).toEqual(before);
  writeFileSync(source, JSON.stringify(evidence()));
  await page
    .getByRole("button", { name: "Retry day request", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Generated day plan", exact: true }),
  ).toContainText("Revision 2");
});
test("current owner authority revisions and known receipts protect generated shared results", async ({
  page,
  playwright,
}) => {
  const trip = await setup(page.request);
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  const original = await generationInput(page.request, trip.id);
  expect(
    (
      await page.request.post(url, {
        headers,
        data: { ...original, selectedPlaceIds: ["invented"] },
      })
    ).status(),
  ).toBe(400);
  expect(
    (await page.request.post(url, { headers, data: original })).status(),
  ).toBe(200);
  const saved = (await (await page.request.get(url)).json()).generatedDayPlan;
  const invitation = (
    await (
      await page.request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:8180",
  });
  const other = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:8180",
  });
  try {
    expect(
      (
        await guest.post(`/api/invitations/${invitation.token}`, {
          headers,
          data: { displayName: "Planning guest" },
        })
      ).status(),
    ).toBe(201);
    const shared = (
      await (await guest.get(`/api/guest-trips/${trip.id}`)).json()
    ).shared;
    expect(shared.trip.generatedDayPlan).toEqual(saved);
    expect(shared.trip.dayPlanIds).toEqual([saved.plan.id]);
    expect(JSON.stringify(shared)).not.toMatch(
      /organiserUserId|receipts|tokenDigest|operationId/,
    );
    expect((await guest.post(url, { headers, data: original })).status()).toBe(
      401,
    );
    expect(
      (
        await other.post("/api/auth/sign-up/email", {
          headers,
          data: {
            name: "Other",
            email: `other-plan-${randomUUID()}@example.invalid`,
            password: "Planning-password-123",
          },
        })
      ).status(),
    ).toBe(200);
    expect((await other.get(url)).status()).toBe(404);
    expect((await other.post(url, { headers, data: original })).status()).toBe(
      404,
    );
    expect(
      (
        await page.request.post(url, {
          headers,
          data: { ...original, requestRevision: 99 },
        })
      ).status(),
    ).toBe(409);
    const current = await generationInput(page.request, trip.id);
    const competing = { ...current, operationId: randomUUID() };
    const responses = await Promise.all([
      page.request.post(url, { headers, data: current }),
      page.request.post(url, { headers, data: competing }),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    writeFileSync(source, "invalid JSON");
    expect(
      (await page.request.post(url, { headers, data: original })).status(),
    ).toBe(200);
    expect(
      (await (await page.request.get(url)).json()).generatedDayPlan.plan
        .revision,
    ).toBe(2);
    writeFileSync(source, JSON.stringify(evidence()));
    const stale = await generationInput(page.request, trip.id);
    const draft = (
      await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json()
    ).dayPlan;
    expect(
      (
        await page.request.post(`/api/trips/${trip.id}/day-plan`, {
          headers,
          data: {
            operationId: randomUUID(),
            expectedRevision: draft.draft.revision,
            selectionRevision: draft.selectionRevision,
            visitDate: "2026-12-31",
            mode: "taxi-car",
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await (await page.request.get(url)).json()).generatedDayPlan.needsReview,
    ).toBe(true);
    expect(
      (await page.request.post(url, { headers, data: stale })).status(),
    ).toBe(409);
    const taxi = evidence();
    taxi.requestedMode = "taxi-car";
    taxi.legs[0].actualSubmode = "driving";
    writeFileSync(source, JSON.stringify(taxi));
    expect(
      (
        await page.request.post(url, {
          headers,
          data: await generationInput(page.request, trip.id),
        })
      ).status(),
    ).toBe(200);
    expect(
      (await (await page.request.get(url)).json()).generatedDayPlan.plan
        .travelLegs[0],
    ).toMatchObject({ requestedMode: "taxi-car", actualSubmode: "driving" });
    for (const selected of [false, true])
      expect(
        (
          await page.request.post(`/api/trips/${trip.id}`, {
            headers,
            data: {
              action: "select",
              placeId: "fictional-cafe-east",
              selected,
            },
          })
        ).status(),
      ).toBe(200);
    expect(
      (await (await page.request.get(url)).json()).generatedDayPlan.needsReview,
    ).toBe(true);
    expect(
      (
        await page.request.post(url, {
          headers,
          data: await generationInput(page.request, trip.id),
        })
      ).status(),
    ).toBe(409);
    await page.request.post(`/api/trips/${trip.id}/invitation`, {
      headers,
      data: { action: "disable" },
    });
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
  } finally {
    await guest.dispose();
    await other.dispose();
  }
});

test("actual failed generation persistence and lost response preserve prior result and captured retry", async ({
  page,
}) => {
  test.setTimeout(120000);
  const trip = await setup(page.request);
  await page.goto("/trips");
  const generate = page.getByRole("button", {
    name: "Generate day plan",
    exact: true,
  });
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await generate.click();
  await expect(result).toContainText("Revision 1");
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  const before = (await (await page.request.get(url)).json()).generatedDayPlan;
  const { databasePath } = JSON.parse(
    readFileSync(".data/trip-storage-test.json", "utf8"),
  );
  const lock = new Database(databasePath);
  try {
    lock.exec("BEGIN IMMEDIATE");
    await generate.click();
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
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await generate.click();
  await expect(
    page.getByRole("alert", { name: "Day plan request failed" }),
  ).toContainText("No new change is confirmed saved");
  await expect(result).toContainText("Revision 2");
  expect(
    (await (await page.request.get(url)).json()).generatedDayPlan.plan.revision,
  ).toBe(3);
  writeFileSync(source, "invalid JSON");
  await page
    .getByRole("button", { name: "Retry day request", exact: true })
    .click();
  await expect(result).toContainText("Revision 3");
  expect(
    (await (await page.request.get(url)).json()).generatedDayPlan.plan.revision,
  ).toBe(3);
});

test("a fixture to real to fixture cycle never revives old plan freshness IDs or guest authority", async ({
  request,
  playwright,
}) => {
  const trip = await setup(request);
  const payload = await generationInput(request, trip.id);
  expect(
    (
      await request.post(`/api/trips/${trip.id}/generated-day-plan`, {
        headers,
        data: payload,
      })
    ).status(),
  ).toBe(200);
  const original = (
    await (await request.get(`/api/trips/${trip.id}/generated-day-plan`)).json()
  ).generatedDayPlan;
  const invitation = (
    await (
      await request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:8180",
  });
  const cataloguePath = ".data/catalogue-scenario.json",
    before = readFileSync(cataloguePath);
  try {
    expect(
      (
        await guest.post(`/api/invitations/${invitation.token}`, {
          headers,
          data: { displayName: "Cycle planner" },
        })
      ).status(),
    ).toBe(201);
    for (const placeId of ["fictional-cafe-east", "fictional-cafe-west"])
      expect(
        (
          await request.post(`/api/trips/${trip.id}`, {
            headers,
            data: { action: "remove", placeId },
          })
        ).status(),
      ).toBe(200);
    writeFileSync(cataloguePath, readFileSync("data/catalogue/shanghai.json"));
    const realIntent = (
      await (
        await request.post("/api/trip-save-intents", {
          headers,
          data: { placeId: "bluebottle-zhangyuan" },
        })
      ).json()
    ).intent;
    expect(
      (
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "save", intentId: realIntent.id },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await (
          await request.get(`/api/trips/${trip.id}/generated-day-plan`)
        ).json()
      ).generatedDayPlan.plan,
    ).toBeNull();
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .dayPlanIds,
    ).toEqual([]);
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
    expect(
      (
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "remove", placeId: "bluebottle-zhangyuan" },
        })
      ).status(),
    ).toBe(200);
    writeFileSync(cataloguePath, before);
    const intent = (
      await (
        await request.post("/api/trip-save-intents", {
          headers,
          data: { placeId: "fictional-cafe-east" },
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
          data: {
            action: "select",
            placeId: "fictional-cafe-east",
            selected: true,
          },
        })
      ).status(),
    ).toBe(200);
    const returned = (
      await (
        await request.get(`/api/trips/${trip.id}/generated-day-plan`)
      ).json()
    ).generatedDayPlan;
    expect(returned.plan).toEqual(original.plan);
    expect(returned.needsReview).toBe(true);
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .dayPlanIds,
    ).toEqual([original.plan.id]);
    expect(
      (
        await request.post(`/api/trips/${trip.id}/generated-day-plan`, {
          headers,
          data: payload,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await (
          await request.get(`/api/trips/${trip.id}/generated-day-plan`)
        ).json()
      ).generatedDayPlan,
    ).toEqual(returned);
    expect(
      (
        await request.post(`/api/trips/${trip.id}/generated-day-plan`, {
          headers,
          data: await generationInput(request, trip.id),
        })
      ).status(),
    ).toBe(409);
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
    expect(
      (await guest.get(`/api/invitations/${invitation.token}`)).status(),
    ).toBe(404);
  } finally {
    writeFileSync(cataloguePath, before);
    await guest.dispose();
  }
});

test("loading a generated result never resets an organiser edit to saved day inputs", async ({
  page,
}) => {
  const trip = await setup(page.request);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/trips/${trip.id}/generated-day-plan`,
    async (route) => {
      if (route.request().method() === "GET") await held;
      await route.continue();
    },
  );
  await page.goto("/trips");
  const panel = page.getByRole("region", { name: "Plan my day", exact: true });
  await panel.getByLabel("Visit date (Shanghai)").fill("2026-12-30");
  release();
  await expect(
    panel.getByRole("button", { name: "Save one-day draft", exact: true }),
  ).toBeEnabled();
  await expect(panel.getByLabel("Visit date (Shanghai)")).toHaveValue(
    "2026-12-30",
  );
  await panel
    .getByRole("button", { name: "Save one-day draft", exact: true })
    .click();
  await expect(panel).toContainText("One-day draft saved");
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json())
      .dayPlan.draft.request.visitDate,
  ).toBe("2026-12-30");
});
