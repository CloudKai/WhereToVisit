import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { prepareRestoreTrip, restoreInput } from "./restoration-setup";

const headers = { Origin: "http://127.0.0.1:8180" };

test("manual Remove save reload Restore is durable with retained sources votes and guest read-only authority", async ({
  page,
  browser,
}, info) => {
  expect(
    (
      await page.request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "fictional-cafe-east" },
      })
    ).status(),
  ).toBe(404);
  const trip = await prepareRestoreTrip(page.request);
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  const saved = (await (await page.request.get(`/api/trips/${trip.id}`)).json())
    .trip.savedPlaces;
  const collaboration = `/api/trips/${trip.id}/collaboration`;
  expect(
    (
      await page.request.post(collaboration, {
        headers,
        data: {
          action: "vote",
          operationId: randomUUID(),
          placeId: "bluebottle-zhangyuan",
          choice: "must-go",
        },
      })
    ).status(),
  ).toBe(200);
  const votes = (await (await page.request.get(collaboration)).json())
    .collaboration;
  await page.goto("/trips?view=day");
  const day = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await expect(day).toContainText("Revision 1");
  const stops = day
    .getByRole("list", { name: "Day stops" })
    .getByRole("listitem");
  await stops.nth(0).getByLabel("Desired arrival (Shanghai)").fill("10:15");
  await stops.nth(0).getByRole("button", { name: "Save desired time" }).click();
  await expect(day).toContainText("Revision 2");
  await stops
    .nth(0)
    .getByRole("button", { name: "Remove from this day" })
    .click();
  await expect(day).toContainText("Revision 3");
  await page.reload();
  await expect(day).toContainText("Manually removed");
  await expect(stops).toHaveCount(1);
  const invitation = (
    await (
      await page.request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await browser.newContext();
  // Retain primary operation failures rather than hiding them behind finally/close.
  expect(
    (
      await guest.request.post(
        `http://127.0.0.1:8180/api/invitations/${invitation.token}`,
        { headers, data: { displayName: "Restore reader" } },
      )
    ).status(),
  ).toBe(201);
  const guestPage = await guest.newPage();
  await guestPage.goto(
    `http://127.0.0.1:8180/shared-trips/${trip.id}?view=day`,
  );
  await expect(
    guestPage.getByRole("region", { name: "Generated day plan", exact: true }),
  ).toContainText("Manually removed");
  await expect(
    guestPage.getByRole("button", { name: "Restore to this day" }),
  ).toHaveCount(0);
  const removed = (await (await page.request.get(url)).json()).generatedDayPlan
    .plan;
  expect(
    (
      await guest.request.post(`http://127.0.0.1:8180${url}/restore`, {
        headers,
        data: restoreInput(removed, "bluebottle-zhangyuan"),
      })
    ).status(),
  ).toBe(401);
  await page.setViewportSize({ width: 320, height: 900 });
  const restore = day.getByRole("button", { name: "Restore to this day" });
  const target = await restore.boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(44);
  await restore.focus();
  await expect(restore).toBeFocused();
  await page.screenshot({
    path: info.outputPath("removed-320.png"),
    fullPage: true,
  });
  await restore.press("Enter");
  await expect(day).toContainText("Revision 4");
  await page.reload();
  await expect(stops).toHaveCount(2);
  await expect(stops.nth(0)).toContainText("User-desired arrival 10:15");
  await expect(day).toContainText(
    "Opening hours and current operation are unknown",
  );
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
      .savedPlaces,
  ).toEqual(saved);
  const retained = (await (await page.request.get(collaboration)).json())
    .collaboration;
  expect(retained.votes).toEqual(votes.votes);
  expect(retained.comments).toEqual(votes.comments);
  await stops.nth(0).getByLabel("Desired arrival (Shanghai)").fill("13:45");
  await stops
    .nth(0)
    .getByRole("button", { name: "Remove from this day" })
    .click();
  await expect(day).toContainText("Revision 5");
  const orphan = day.getByRole("region", { name: "Retained unsaved arrivals" });
  await expect(orphan).toContainText("Unsaved desired arrival 13:45");
  await day.getByRole("button", { name: "Restore to this day" }).click();
  await expect(day).toContainText("Revision 6");
  await expect(
    stops.nth(0).getByLabel("Desired arrival (Shanghai)"),
  ).toHaveValue("10:15");
  await expect(orphan).toContainText("Unsaved desired arrival 13:45");
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  expect(dialogs).toBe(1);
  await expect(day).toBeVisible();
  await orphan
    .getByRole("button", { name: "Discard earlier arrival draft" })
    .click();
  await expect(orphan).toHaveCount(0);
  await guestPage.reload();
  await expect(
    guestPage.getByRole("list", { name: "Day stops" }).getByRole("listitem"),
  ).toHaveCount(2);
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`restored-${width}.png`),
      fullPage: true,
    });
  }
  await guest.close();
});

test("Restore validates revisions selection membership current accounts and no-replay after later removal", async ({
  page,
  browser,
}) => {
  const trip = await prepareRestoreTrip(page.request);
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  const read = async () =>
    (await (await page.request.get(url)).json()).generatedDayPlan;
  expect(
    (
      await page.request.patch(url, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 1,
          stops: [{ placeId: "roastery-shanghai", desiredArrivalMinute: null }],
        },
      })
    ).status(),
  ).toBe(200);
  const removed = (await read()).plan;
  const input = restoreInput(removed, "bluebottle-zhangyuan");
  for (const mismatch of [
    { expectedRevision: 1 },
    { requestRevision: 0 },
    { selectionRevision: 0 },
    { dataKind: "fixture" },
    { planId: randomUUID() },
  ]) {
    expect(
      (
        await page.request.post(`${url}/restore`, {
          headers,
          data: { ...input, ...mismatch, operationId: randomUUID() },
        })
      ).status(),
    ).toBe(409);
  }
  expect(
    (
      await page.request.post(`${url}/restore`, { headers, data: input })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(`${url}/restore`, {
        headers,
        data: { ...input, operationId: randomUUID(), expectedRevision: 3 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.patch(url, {
        headers,
        data: { operationId: randomUUID(), expectedRevision: 3, stops: [] },
      })
    ).status(),
  ).toBe(200);
  const current = await read();
  expect(
    (
      await page.request.post(`${url}/restore`, { headers, data: input })
    ).status(),
  ).toBe(200);
  expect(await read()).toEqual(current);
  expect(
    (
      await page.request.post(`${url}/restore`, {
        headers,
        data: { ...input, placeId: "roastery-shanghai" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post(`/api/trips/${trip.id}`, {
        headers,
        data: {
          action: "select",
          placeId: "bluebottle-zhangyuan",
          selected: false,
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(`${url}/restore`, {
        headers,
        data: restoreInput(current.plan, "bluebottle-zhangyuan"),
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post(`${url}/restore`, { headers, data: input })
    ).status(),
  ).toBe(200);
  expect((await read()).plan.stops).toEqual([]);
  const other = await browser.newContext();
  expect(
    (
      await other.request.post(`http://127.0.0.1:8180/api/auth/sign-up/email`, {
        headers,
        data: {
          name: "Other",
          email: `restore-${randomUUID()}@example.invalid`,
          password: "Other-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await other.request.post(`http://127.0.0.1:8180${url}/restore`, {
        headers,
        data: input,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.post("/api/auth/sign-out", { headers, data: {} })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(`${url}/restore`, { headers, data: input })
    ).status(),
  ).toBe(401);
  await other.close();
});
