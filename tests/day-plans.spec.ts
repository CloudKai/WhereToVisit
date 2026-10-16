import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
test.setTimeout(120_000);
async function setup(request: APIRequestContext) {
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Organiser",
          email: `day-${randomUUID()}@example.invalid`,
          password: "Day-plan-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await request.post("/api/trips", {
        headers,
        data: { title: "Fictional day inputs", city: "Shanghai" },
      })
    ).json()
  ).trip;
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
  return trip;
}
async function select(
  request: APIRequestContext,
  id: string,
  selected: boolean,
) {
  return request.post(`/api/trips/${id}`, {
    headers,
    data: { action: "select", placeId: "fictional-cafe-east", selected },
  });
}
async function read(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/trips/${id}/day-plan`)).json())
    .dayPlan;
}
async function input(request: APIRequestContext, id: string) {
  const state = await read(request, id);
  return {
    operationId: randomUUID(),
    expectedRevision: state.draft?.revision ?? 0,
    selectionRevision: state.selectionRevision,
    visitDate: "2028-02-29",
  };
}
async function save(request: APIRequestContext, id: string, data: unknown) {
  return request.post(`/api/trips/${id}/day-plan`, { headers, data });
}
test("stale browser draft reload reviews the current chosen stops before another save", async ({
  page,
}) => {
  const trip = await setup(page.request);
  await select(page.request, trip.id, true);
  await page.goto("/trips?view=day");
  const panel = page.getByRole("region", { name: "Plan my day" });
  await panel.getByLabel("Visit date (Shanghai)").fill("2026-10-25");
  await select(page.request, trip.id, false);
  await panel.getByRole("button", { name: "Save one-day draft" }).click();
  await expect(panel.getByRole("alert")).toContainText("chosen Places changed");
  await panel.getByRole("button", { name: "Reload day request" }).click();
  await page
    .getByRole("navigation", { name: "Trip views" })
    .getByRole("link", { name: "Places", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }).getByRole("checkbox"),
  ).not.toBeChecked();
  await page
    .getByRole("navigation", { name: "Trip views" })
    .getByRole("link", { name: "Day", exact: true })
    .click();
  await expect(panel).toContainText("0 confirmed Places selected");
  await panel.getByLabel("Visit date (Shanghai)").fill("2026-10-25");
  await panel.getByRole("button", { name: "Save one-day draft" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Select at least one confirmed Place",
  );
  expect((await read(page.request, trip.id)).draft).toBeNull();
});
test("day draft accepts only real calendar dates and bounded typed preferences", async ({
  request,
}) => {
  const trip = await setup(request);
  expect(
    (await save(request, trip.id, await input(request, trip.id))).status(),
  ).toBe(400);
  await select(request, trip.id, true);
  for (const fields of [
    { mode: ["taxi-car"] },
    { mode: null },
    { mode: {} },
    { visitDate: "2026-02-29" },
    { visitDate: "2026-04-31" },
    { visitDate: "0000-01-01" },
    { visitDate: "2026-10-12T00:00:00Z" },
    { pace: "fast" },
    { startArea: "x".repeat(201) },
    { budget: "x".repeat(121) },
    { dietaryNeeds: "x".repeat(501) },
    { dietaryNeeds: "allergy\u0000" },
    { selectedPlaceIds: ["unresolved"] },
    { organiserUserId: "forged" },
  ]) {
    expect(
      (
        await save(request, trip.id, {
          ...(await input(request, trip.id)),
          ...fields,
        })
      ).status(),
    ).toBe(400);
    expect((await read(request, trip.id)).draft).toBeNull();
  }
  expect(
    (
      await save(request, trip.id, {
        ...(await input(request, trip.id)),
        startArea: "  ",
        budget: null,
        dietaryNeeds: null,
        pace: null,
      })
    ).status(),
  ).toBe(200);
  expect((await read(request, trip.id)).draft.request).toMatchObject({
    visitDate: "2028-02-29",
    mode: "walking-transit",
    startArea: null,
    budget: null,
    dietaryNeeds: null,
    pace: null,
  });
});
test("unresolved requests, guest and other-owner authority cannot change chosen day inputs", async ({
  page,
  playwright,
  browser,
}) => {
  const trip = await setup(page.request);
  const invitation = (
    await (
      await page.request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await browser.newContext();
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    const joined = await guest.request.post(
      `/api/invitations/${invitation.token}`,
      { headers, data: { displayName: "Alex" } },
    );
    expect(joined.status()).toBe(201);
    const suggestion = (
      await (
        await guest.request.post(`/api/guest-trips/${trip.id}/collaboration`, {
          headers,
          data: {
            action: "suggest",
            name: "Unresolved hotel café",
            operationId: randomUUID(),
          },
        })
      ).json()
    ).collaboration.suggestions[0];
    expect(
      (
        await page.request.post(`/api/trips/${trip.id}/collaboration`, {
          headers,
          data: {
            action: "accept",
            suggestionId: suggestion.id,
            operationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "select", placeId: suggestion.id, selected: true },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await save(page.request, trip.id, await input(page.request, trip.id))
      ).status(),
    ).toBe(400);
    await select(page.request, trip.id, true);
    expect(
      (
        await guest.request.post(`/api/guest-trips/${trip.id}/collaboration`, {
          headers,
          data: {
            action: "vote",
            placeId: "fictional-cafe-east",
            choice: "skip",
            operationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(200);
    const votes = (
      await (
        await guest.request.get(`/api/guest-trips/${trip.id}/collaboration`)
      ).json()
    ).collaboration.votes;
    const shortlist = (
      await (await page.request.get(`/api/trips/${trip.id}`)).json()
    ).trip.savedPlaces;
    const payload = {
      ...(await input(page.request, trip.id)),
      mode: "taxi-car",
      startArea: "Hotel area",
      budget: "CNY 200",
      dietaryNeeds: "Vegetarian",
      pace: "balanced",
    };
    expect((await save(page.request, trip.id, payload)).status()).toBe(200);
    const before = await read(page.request, trip.id);
    expect((await save(guest.request, trip.id, payload)).status()).toBe(401);
    expect(
      (await guest.request.get(`/api/trips/${trip.id}/day-plan`)).status(),
    ).toBe(401);
    expect(
      (
        await guest.request.post(`/api/guest-trips/${trip.id}`, {
          headers,
          data: {
            action: "select",
            placeId: "fictional-cafe-east",
            selected: false,
          },
        })
      ).status(),
    ).toBe(405);
    expect(
      (
        await other.post("/api/auth/sign-up/email", {
          headers,
          data: {
            name: "Other",
            email: `other-day-${randomUUID()}@example.invalid`,
            password: "Day-plan-password-123",
          },
        })
      ).status(),
    ).toBe(200);
    expect((await save(other, trip.id, payload)).status()).toBe(404);
    const denied = await other.get(`/api/trips/${trip.id}/day-plan`);
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain("Vegetarian");
    const shared = (
      await (await guest.request.get(`/api/guest-trips/${trip.id}`)).json()
    ).shared;
    expect(shared.trip.dayPlan).toEqual(before);
    const serialized = JSON.stringify(shared);
    for (const privateField of [
      "organiserUserId",
      "receipts",
      "operationId",
      "token",
      "sessionDigest",
      "importId",
      "mentionId",
    ])
      expect(serialized).not.toContain(`"${privateField}"`);
    const guestPage = await guest.newPage();
    await guestPage.goto(`/shared-trips/${trip.id}?view=day`);
    await expect(
      guestPage.getByRole("region", { name: "Shared day-plan context" }),
    ).toContainText("Vegetarian");
    await expect(
      guestPage.getByRole("button", { name: "Save one-day draft" }),
    ).toHaveCount(0);
    await page.goto("/trips?view=day");
    await expect(
      page.getByRole("region", { name: "Plan my day" }),
    ).toContainText("explicitly confirm a canonical branch and address");
    expect(await read(page.request, trip.id)).toEqual(before);
    expect(
      (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
        .savedPlaces,
    ).toEqual(shortlist);
    expect(
      (
        await (
          await guest.request.get(`/api/guest-trips/${trip.id}/collaboration`)
        ).json()
      ).collaboration.votes,
    ).toEqual(votes);
    await page.request.post(`/api/trips/${trip.id}/invitation`, {
      headers,
      data: { action: "disable" },
    });
    expect(
      (await guest.request.get(`/api/guest-trips/${trip.id}`)).status(),
    ).toBe(404);
    await guestPage
      .getByRole("button", { name: "Refresh shared Trip" })
      .click();
    await expect(
      guestPage.getByRole("region", { name: "Shared day-plan context" }),
    ).toHaveCount(0);
    await page.request.post("/api/auth/sign-out", { headers, data: {} });
    expect((await save(page.request, trip.id, payload)).status()).toBe(401);
  } finally {
    await guest.close();
    await other.dispose();
  }
});
test("draft revisions and known retries never replay an older selection or preference", async ({
  request,
}) => {
  const trip = await setup(request);
  await select(request, trip.id, true);
  const first = await input(request, trip.id);
  expect((await save(request, trip.id, first)).status()).toBe(200);
  const second = { ...(await input(request, trip.id)), mode: "taxi-car" };
  const competing = {
    ...second,
    operationId: randomUUID(),
    mode: "walking-transit",
  };
  const responses = await Promise.all([
    save(request, trip.id, second),
    save(request, trip.id, competing),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ]);
  const committed = await read(request, trip.id);
  expect((await save(request, trip.id, first)).status()).toBe(200);
  expect(await read(request, trip.id)).toEqual(committed);
  expect(
    (await save(request, trip.id, { ...first, mode: "taxi-car" })).status(),
  ).toBe(409);
  await select(request, trip.id, false);
  const stale = await read(request, trip.id);
  expect(stale.needsReview).toBe(true);
  expect((await save(request, trip.id, first)).status()).toBe(200);
  expect(await read(request, trip.id)).toEqual(stale);
  expect(
    (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
      .selectedPlaceIds,
  ).toEqual([]);
  expect(
    (await save(request, trip.id, await input(request, trip.id))).status(),
  ).toBe(400);
  await select(request, trip.id, true);
  expect(
    (await save(request, trip.id, await input(request, trip.id))).status(),
  ).toBe(200);
  await request.post(`/api/trips/${trip.id}`, {
    headers,
    data: { action: "remove", placeId: "fictional-cafe-east" },
  });
  expect((await read(request, trip.id)).needsReview).toBe(true);
  expect((await save(request, trip.id, first)).status()).toBe(200);
  expect(
    (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
      .selectedPlaceIds,
  ).toEqual([]);
});
test("failed durable writes and lost responses preserve captured draft retry", async ({
  page,
}) => {
  const trip = await setup(page.request);
  await select(page.request, trip.id, true);
  await page.goto("/trips?view=day");
  const panel = page.getByRole("region", { name: "Plan my day" });
  await panel.getByLabel("Visit date (Shanghai)").fill("2026-11-12");
  await expect(
    panel.getByRole("button", { name: "Save one-day draft" }),
  ).toBeEnabled();
  const config = JSON.parse(
    readFileSync(".data/trip-storage-test.json", "utf8"),
  );
  const lock = new Database(config.databasePath);
  try {
    lock.exec("BEGIN IMMEDIATE");
    await panel.getByRole("button", { name: "Save one-day draft" }).click();
    await expect(panel.getByRole("alert")).toContainText(
      "No new change is confirmed saved",
      { timeout: 15_000 },
    );
    expect((await read(page.request, trip.id)).draft).toBeNull();
    lock.exec("ROLLBACK");
    await panel.getByLabel("Visit date (Shanghai)").fill("2026-11-13");
    await panel.getByRole("button", { name: "Retry day request" }).click();
    await expect(panel).toContainText("One-day draft saved");
    expect((await read(page.request, trip.id)).draft.request.visitDate).toBe(
      "2026-11-12",
    );
    await expect(panel.getByLabel("Visit date (Shanghai)")).toHaveValue(
      "2026-11-12",
    );
    await page.reload();
    await panel.getByLabel("Transport").selectOption("taxi-car");
    await page.route("**/api/trips/*/day-plan", async (route) => {
      if (route.request().method() === "POST") {
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await panel.getByRole("button", { name: "Save one-day draft" }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    const committed = await read(page.request, trip.id);
    expect(committed.draft.revision).toBe(2);
    await page.unroute("**/api/trips/*/day-plan");
    await panel.getByRole("button", { name: "Retry day request" }).click();
    await expect(panel).toContainText("One-day draft saved");
    expect(await read(page.request, trip.id)).toEqual(committed);
  } finally {
    lock.close();
  }
});
test("returning to a prior data kind cannot revive a reviewed day draft or guest access", async ({
  request,
  playwright,
}) => {
  const trip = await setup(request);
  await select(request, trip.id, true);
  const payload = await input(request, trip.id);
  expect((await save(request, trip.id, payload)).status()).toBe(200);
  const original = await read(request, trip.id);
  const invitation = (
    await (
      await request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await playwright.request.newContext({ baseURL: origin });
  const path = ".data/catalogue-scenario.json",
    before = readFileSync(path);
  try {
    expect(
      (
        await guest.post(`/api/invitations/${invitation.token}`, {
          headers,
          data: { displayName: "Cycle guest" },
        })
      ).status(),
    ).toBe(201);
    await request.post(`/api/trips/${trip.id}`, {
      headers,
      data: { action: "remove", placeId: "fictional-cafe-east" },
    });
    writeFileSync(path, readFileSync("data/catalogue/shanghai.json"));
    const real = (
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
          data: { action: "save", intentId: real.id },
        })
      ).status(),
    ).toBe(200);
    expect((await read(request, trip.id)).draft).toBeNull();
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
    await request.post(`/api/trips/${trip.id}`, {
      headers,
      data: { action: "remove", placeId: "bluebottle-zhangyuan" },
    });
    writeFileSync(path, before);
    const fixture = (
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
          data: { action: "save", intentId: fixture.id },
        })
      ).status(),
    ).toBe(200);
    await select(request, trip.id, true);
    const returned = await read(request, trip.id);
    expect(returned.draft).toEqual(original.draft);
    expect(returned.needsReview).toBe(true);
    expect((await save(request, trip.id, payload)).status()).toBe(200);
    expect((await read(request, trip.id)).needsReview).toBe(true);
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
    expect(
      (await save(request, trip.id, await input(request, trip.id))).status(),
    ).toBe(200);
    expect((await read(request, trip.id)).needsReview).toBe(false);
  } finally {
    writeFileSync(path, before);
    await guest.dispose();
  }
});
