import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:8180" };
test.use({ timezoneId: "America/Los_Angeles" });
test("solo organiser saves a Shanghai one-day draft without optional preferences or votes", async ({
  page,
}, testInfo) => {
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
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
      await page.request.post("/api/trips", {
        headers,
        data: { title: "One Shanghai day", city: "Shanghai" },
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
  await page.goto("/trips");
  await page.getByLabel("Select Zhangyuan for a day plan").click();
  await expect(
    page.getByLabel("Select Zhangyuan for a day plan"),
  ).toBeChecked();
  const panel = page.getByRole("region", { name: "Plan my day" });
  await panel.getByLabel("Visit date (Shanghai)").fill("2026-12-31");
  await panel.getByRole("button", { name: "Save one-day draft" }).click();
  await expect(panel).toContainText("One-day draft saved");
  await page.reload();
  await expect(panel.getByLabel("Visit date (Shanghai)")).toHaveValue(
    "2026-12-31",
  );
  await expect(panel.getByLabel("Transport")).toHaveValue("walking-transit");
  const state = (
    await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  expect(state.draft.request).toEqual({
    tripId: trip.id,
    visitDate: "2026-12-31",
    selectedPlaceIds: ["bluebottle-zhangyuan"],
    mode: "walking-transit",
    startArea: null,
    budget: null,
    dietaryNeeds: null,
    pace: null,
  });
  expect(state.needsReview).toBe(false);
  expect(
    (
      await (
        await page.request.get(`/api/trips/${trip.id}/collaboration`)
      ).json()
    ).collaboration.votes,
  ).toEqual([]);
  await panel
    .getByLabel("Start area or hotel (optional)")
    .fill("Jing'an hotel area");
  await panel.getByLabel("Budget (optional)").fill("CNY 300 for food");
  await panel
    .getByLabel("Dietary needs (optional)")
    .fill("Vegetarian preference");
  await panel.getByLabel("Pace (optional)").selectOption("relaxed");
  await panel.getByLabel("Transport").selectOption("taxi-car");
  await panel.getByRole("button", { name: "Save one-day draft" }).click();
  await expect(panel).toContainText("One-day draft saved");
  await page.reload();
  await expect(panel.getByLabel("Transport")).toHaveValue("taxi-car");
  await expect(panel.getByLabel("Visit date (Shanghai)")).toHaveValue(
    "2026-12-31",
  );
  await expect(panel.getByLabel("Start area or hotel (optional)")).toHaveValue(
    "Jing'an hotel area",
  );
  await expect(panel.getByLabel("Budget (optional)")).toHaveValue(
    "CNY 300 for food",
  );
  await expect(panel.getByLabel("Dietary needs (optional)")).toHaveValue(
    "Vegetarian preference",
  );
  await expect(panel.getByLabel("Pace (optional)")).toHaveValue("relaxed");
  await expect(panel).toContainText(
    "No schedule or travel timings have been generated",
  );
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`day-plan-${width}.png`),
      fullPage: true,
    });
  }
});
