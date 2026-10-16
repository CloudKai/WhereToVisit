import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
test("obsolete Trip-scoped group reads and absolute guest expiry preserve current authority and attribution", async ({
  page,
  browser,
}, info) => {
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Organiser",
          email: `boundary-${randomUUID()}@example.invalid`,
          password: "Boundary-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await page.request.post("/api/trips", {
        headers,
        data: { title: "Guest update boundaries", city: "Shanghai" },
      })
    ).json()
  ).trip;
  const intent = (
    await (
      await page.request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "bluebottle-zhangyuan" },
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
  const invitation = (
    await (
      await page.request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const context = await browser.newContext();
  const guest = await context.newPage();
  expect(
    (
      await context.request.post(
        `${origin}/api/invitations/${invitation.token}`,
        { headers, data: { displayName: "Expiry guest" } },
      )
    ).status(),
  ).toBe(201);
  const endpoint = `${origin}/api/guest-trips/${trip.id}/collaboration`;
  const second = (
    await (
      await page.request.post("/api/trips", {
        headers,
        data: { title: "Current Trip", city: "Shanghai" },
      })
    ).json()
  ).trip;
  const secondIntent = (
    await (
      await page.request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "bluebottle-zhangyuan" },
      })
    ).json()
  ).intent;
  expect(
    (
      await page.request.post(`/api/trips/${second.id}`, {
        headers,
        data: { action: "save", intentId: secondIntent.id },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(`/api/trips/${second.id}/collaboration`, {
        headers,
        data: {
          operationId: randomUUID(),
          action: "vote",
          placeId: "bluebottle-zhangyuan",
          choice: "skip",
        },
      })
    ).status(),
  ).toBe(200);
  let release: (() => void) | undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  let captured = false;
  let oldReleased = false;
  await page.route(`**/api/trips/${trip.id}/collaboration`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const old = await route.fetch();
    expect((await old.json()).collaboration.votes).toEqual([]);
    captured = true;
    await held;
    await route.fulfill({ response: old });
    oldReleased = true;
  });
  await page.goto(`/trips?tripId=${trip.id}&view=group`);
  await expect.poll(() => captured).toBe(true);
  await page.getByText("Choose or create a Trip", { exact: true }).click();
  await page.getByLabel("Your Trip", { exact: true }).selectOption(second.id);
  await page
    .getByRole("navigation", { name: "Trip views" })
    .getByRole("link", { name: "Group", exact: true })
    .click();
  await expect(page.getByLabel("Your preference for Zhangyuan")).toHaveValue(
    "skip",
  );
  release?.();
  await expect.poll(() => oldReleased).toBe(true);
  await expect(page.getByLabel("Your preference for Zhangyuan")).toHaveValue(
    "skip",
  );
  await expect(
    page.getByRole("heading", { name: "Current Trip", exact: true }),
  ).toBeVisible();
  await page.unroute(`**/api/trips/${trip.id}/collaboration`);
  await guest.goto(`/shared-trips/${trip.id}`);
  await expect(guest.getByLabel("Your preference for Zhangyuan")).toBeVisible();
  const operation = {
    operationId: randomUUID(),
    action: "comment",
    placeId: "bluebottle-zhangyuan",
    text: "Keep my historical attribution",
  };
  expect(
    (
      await context.request.post(endpoint, { headers, data: operation })
    ).status(),
  ).toBe(200);
  await page.goto(`/trips?tripId=${trip.id}&view=manage`);
  await expect(
    page.getByRole("region", { name: "Trip participants" }),
  ).toContainText("Expiry guest · Guest 1");
  const config = JSON.parse(
    readFileSync(".data/trip-storage-test.json", "utf8"),
  );
  const databasePath = resolve(config.databasePath);
  if (
    !databasePath.startsWith(`${resolve(".data")}/`) ||
    !/^(test-|ticket14-)/.test(basename(databasePath))
  )
    throw new Error(
      "Only isolated task/test storage may be used for expiry evidence.",
    );
  const db = new Database(databasePath);
  const participant = (await (await context.request.get(endpoint)).json())
    .collaboration.actorId;
  const expiresAt = new Date(Date.now() + 500).toISOString();
  try {
    expect(
      db
        .prepare(
          "UPDATE guest_sessions SET expires_at=? WHERE participant_id=?",
        )
        .run(expiresAt, participant).changes,
    ).toBe(1);
  } finally {
    db.close();
  }
  await expect.poll(() => Date.now() >= Date.parse(expiresAt)).toBe(true);
  expect((await context.request.get(endpoint)).status()).toBe(404);
  expect(
    (
      await context.request.post(endpoint, { headers, data: operation })
    ).status(),
  ).toBe(404);
  await page
    .getByRole("button", { name: "Refresh invitation and participants" })
    .click();
  await expect(
    page.getByRole("region", { name: "Trip participants" }),
  ).toContainText("Expiry guest · Guest 1 — access ended");
  await page.screenshot({
    path: info.outputPath("manage-expired-guest.png"),
    mask: [page.getByLabel("Invitation link", { exact: true })],
    fullPage: true,
  });
  const history = (
    await (await page.request.get(`/api/trips/${trip.id}/collaboration`)).json()
  ).collaboration;
  expect(history.comments).toHaveLength(1);
  expect(history.comments[0].actorId).toBe(participant);
  expect(history.comments[0].text).toBe(operation.text);
  await guest.getByRole("button", { name: "Refresh collaboration" }).click();
  await expect(
    guest.getByRole("alert", { name: "Guest access unavailable" }),
  ).toBeVisible();
  await context.close();
});
