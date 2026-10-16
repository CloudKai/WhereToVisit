import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:8180" };
async function prepare(request: APIRequestContext) {
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
  for (const placeId of ["bluebottle-zhangyuan", "roastery-shanghai"]) {
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
  const extra = (
    await (
      await request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "lostheaven-bund" },
      })
    ).json()
  ).intent;
  expect(
    (
      await request.post(`/api/trips/${trip.id}`, {
        headers,
        data: { action: "save", intentId: extra.id },
      })
    ).status(),
  ).toBe(200);
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
          mode: "taxi-car",
          startArea: "南京西路附近酒店",
          budget: "¥200",
          dietaryNeeds: "No peanuts",
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
test("readable Day separates arrangements and unknown facts, copies Chinese addresses and preserves independent drafts", async ({
  page,
  context,
}, testInfo) => {
  const trip = await prepare(page.request);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let photoRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/catalogue/photos/")) photoRequests++;
  });
  await page.goto("/trips?view=day");
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await expect(result).toContainText("Revision 1");
  await expect(result).toContainText(
    "Shanghai · 2026-12-31 · Requested travel: Taxi / car",
  );
  await expect(result).toContainText("3 saved · 2 chosen · 2 included");
  await expect(page.locator("#day-shared-preferences")).toContainText(
    "visible to invited guests",
  );
  await expect(page.locator("#day-shared-preferences")).toContainText(
    "have not been verified",
  );
  const technical = result.locator("details").filter({
    has: page.getByText("Planning assumptions and technical evidence", {
      exact: true,
    }),
  });
  await expect(technical).not.toHaveAttribute("open", "");
  await expect(result).toContainText("Travel time unknown");
  await expect(result).not.toContainText("Fictional");
  await expect(
    result.getByRole("region", { name: "Not included in this day" }),
  ).toContainText("Saved, not chosen for this day.");
  expect(
    (
      await page.request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "fictional-cafe-east" },
      })
    ).status(),
  ).toBe(404);
  const stops = result
    .getByRole("list", { name: "Day stops" })
    .getByRole("listitem");
  await stops
    .nth(0)
    .getByRole("button", { name: "Copy local name and address" })
    .click();
  await expect(result).toContainText("Address copied for Blue Bottle");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "蓝瓶咖啡",
  );
  await stops.nth(0).getByLabel("Desired arrival (Shanghai)").fill("09:15");
  await stops.nth(1).getByLabel("Desired arrival (Shanghai)").fill("11:45");
  await expect(stops.nth(0)).toContainText("Unsaved desired arrival");
  await expect(
    page.getByRole("button", { name: "Generate day plan", exact: true }),
  ).toBeEnabled();
  await stops.nth(0).getByRole("button", { name: "Save desired time" }).click();
  await expect(result).toContainText("User-desired arrival 09:15");
  await expect(result).toContainText("not a travel estimate");
  await expect(
    stops.nth(1).getByLabel("Desired arrival (Shanghai)"),
  ).toHaveValue("11:45");
  await expect(stops.nth(1)).toContainText("Unsaved desired arrival");
  await page
    .getByRole("navigation", { name: "Trip views" })
    .getByRole("link", { name: "Places", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Trip views" })
    .getByRole("link", { name: "Day", exact: true })
    .click();
  await expect(
    stops.nth(1).getByLabel("Desired arrival (Shanghai)"),
  ).toHaveValue("11:45");
  await stops.nth(1).getByRole("button", { name: "Save desired time" }).click();
  await expect(result).toContainText("User-desired arrival 11:45");
  await stops.nth(1).getByLabel("Desired arrival (Shanghai)").fill("12:15");
  await stops
    .nth(1)
    .getByRole("button", { name: "Remove from this day" })
    .click();
  await expect(result).toContainText(
    "These unsaved arrangements belong to the earlier day",
  );
  const excluded = result.getByRole("region", {
    name: "Not included in this day",
  });
  await expect(excluded).toContainText(
    "Removed from this day by the organiser",
  );
  await expect(result).toContainText("3 saved · 2 chosen · 1 included");
  const current = (
    await (await page.request.get(`/api/trips/${trip.id}`)).json()
  ).trip;
  expect(current.savedPlaces).toHaveLength(3);
  expect(current.selectedPlaceIds).toHaveLength(2);
  await result
    .getByRole("button", { name: "Discard earlier arrival draft" })
    .click();
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Replace manual edits" }),
  ).toContainText("replace the edited order");
  await page
    .getByRole("button", { name: "Replace edited day plan", exact: true })
    .click();
  await expect(result).toContainText("Revision 5");
  await expect(
    stops.nth(0).getByLabel("Desired arrival (Shanghai)"),
  ).toHaveValue("");
  expect(photoRequests).toBe(0);
  for (const width of [320, 375, 640, 1280]) {
    await page.setViewportSize({ width, height: width === 640 ? 450 : 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const button of await result.getByRole("button").all()) {
      const box = await button.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: testInfo.outputPath(`day-${width}.png`),
      fullPage: true,
    });
  }
});

test("external day replacement and removal retain scoped arrival drafts without applying them", async ({
  page,
  context,
}) => {
  const trip = await prepare(page.request);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/trips?view=day");
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await expect(result).toContainText("Revision 1");
  const stops = result
    .getByRole("list", { name: "Day stops" })
    .getByRole("listitem");
  await stops.nth(0).getByLabel("Desired arrival (Shanghai)").fill("07:45");
  const requestState = (
    await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  const saved = (
    await (
      await page.request.post(`/api/trips/${trip.id}/day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: requestState.draft.revision,
          selectionRevision: requestState.selectionRevision,
          visitDate: "2027-01-01",
          mode: "taxi-car",
        },
      })
    ).json()
  ).dayPlan;
  expect(
    (
      await page.request.post(`/api/trips/${trip.id}/generated-day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 1,
          requestRevision: saved.draft.revision,
          selectionRevision: saved.selectionRevision,
        },
      })
    ).status(),
  ).toBe(200);
  await stops.nth(0).getByRole("button", { name: "Move later" }).click();
  await expect(
    page.getByRole("alert", { name: "Day plan request failed" }),
  ).toContainText("changed");
  await page
    .getByRole("button", { name: "Reload day request", exact: true })
    .click();
  await expect(result).toContainText("Shanghai · 2027-01-01");
  await expect(
    stops.nth(0).getByLabel("Desired arrival (Shanghai)"),
  ).toHaveValue("");
  const retained = result.getByRole("region", {
    name: "Retained unsaved arrivals",
  });
  await expect(retained).toContainText(
    "2026-12-31 (Shanghai) · Unsaved desired arrival 07:45",
  );
  await expect(page.locator(".workspace-update")).toContainText(
    "Unsaved fields in Day",
  );
  await retained
    .getByRole("button", { name: "Copy earlier arrival draft" })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "2026-12-31 (Shanghai)\nDesired arrival: 07:45",
  );
  const beforeRemoval = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan.plan;
  expect(
    beforeRemoval.stops.every(
      (stop: { desiredArrivalMinute: number | null }) =>
        stop.desiredArrivalMinute === null,
    ),
  ).toBe(true);
  await stops.nth(1).getByLabel("Desired arrival (Shanghai)").fill("13:10");
  expect(
    (
      await page.request.patch(`/api/trips/${trip.id}/generated-day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 2,
          stops: [
            { placeId: "bluebottle-zhangyuan", desiredArrivalMinute: null },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  await stops.nth(1).getByRole("button", { name: "Move earlier" }).click();
  await expect(
    page.getByRole("alert", { name: "Day plan request failed" }),
  ).toContainText("changed");
  await page
    .getByRole("button", { name: "Reload day request", exact: true })
    .click();
  await expect(stops).toHaveCount(1);
  await expect(retained).toContainText(
    "2027-01-01 (Shanghai) · Unsaved desired arrival 13:10",
  );
  await expect(
    retained.getByRole("button", { name: "Discard earlier arrival draft" }),
  ).toHaveCount(2);
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
  await expect(result).toBeVisible();
  await retained
    .getByRole("button", { name: "Discard earlier arrival draft" })
    .nth(0)
    .click();
  await retained
    .getByRole("button", { name: "Discard earlier arrival draft" })
    .click();
  await expect(retained).toHaveCount(0);
  await expect(page.locator(".workspace-update")).not.toContainText(
    "Unsaved fields",
  );
  const final = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan.plan;
  expect(final.stops).toHaveLength(1);
  expect(final.stops[0].desiredArrivalMinute).toBeNull();
});
