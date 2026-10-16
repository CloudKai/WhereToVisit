import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:8180" };
test("organiser generates a grounded real day order with unavailable timing and reload", async ({
  page,
  browser,
}, testInfo) => {
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Planner",
          email: `plan-${randomUUID()}@example.invalid`,
          password: "Planning-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await page.request.post("/api/trips", {
        headers,
        data: { title: "Grounded day", city: "Shanghai" },
      })
    ).json()
  ).trip;
  for (const placeId of ["bluebottle-zhangyuan", "roastery-shanghai"]) {
    const intent = (
      await (
        await page.request.post("/api/trip-save-intents", {
          headers,
          data: { placeId },
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
        await page.request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "select", placeId, selected: true },
        })
      ).status(),
    ).toBe(200);
  }
  await page.goto("/trips?view=day");
  const inputs = page.getByRole("region", { name: "Plan my day", exact: true });
  await inputs.getByLabel("Visit date (Shanghai)").fill("2026-12-31");
  await inputs.getByRole("button", { name: "Save one-day draft" }).click();
  await expect(inputs).toContainText("One-day draft saved");
  await inputs
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await expect(result).toContainText("Timing unresolved");
  await expect(result).toContainText("Zhangyuan");
  await expect(result).toContainText("Shanghai Roastery");
  const state = (
    await (
      await page.request.get(`/api/trips/${trip.id}/generated-day-plan`)
    ).json()
  ).generatedDayPlan;
  expect(state.plan.request.visitDate).toBe("2026-12-31");
  expect(
    new Set([
      ...state.plan.stops.map((s: { placeId: string }) => s.placeId),
      ...state.plan.unscheduledPlaces.map(
        (s: { placeId: string }) => s.placeId,
      ),
    ]),
  ).toEqual(new Set(["bluebottle-zhangyuan", "roastery-shanghai"]));
  expect(state.plan.travelLegs).toHaveLength(1);
  expect(state.plan.travelLegs[0]).toMatchObject({
    requestedMode: "walking-transit",
    provider: null,
    durationSeconds: null,
    outcome: "permission-unqualified",
  });
  expect(
    state.plan.stops.every(
      (s: { arrivalMinute: number | null }) => s.arrivalMinute === null,
    ),
  ).toBe(true);
  expect(state.plan.warnings.join(" ")).toContain("hours");
  await page.reload();
  await expect(result).toContainText("Timing unresolved");
  const invitation = (
    await (
      await page.request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await browser.newContext();
  let guestStage = "guest invitation join";
  try {
    expect(
      (
        await guest.request.post(
          `http://127.0.0.1:8180/api/invitations/${invitation.token}`,
          { headers, data: { displayName: "Shared planner" } },
        )
      ).status(),
    ).toBe(201);
    const guestPage = await guest.newPage();
    guestStage = "guest Day page load";
    await guestPage.goto(
      `http://127.0.0.1:8180/shared-trips/${trip.id}?view=day`,
    );
    guestStage = "guest generated Day read";
    const sharedPlan = guestPage.getByRole("region", {
      name: "Generated day plan",
      exact: true,
    });
    await expect(sharedPlan).toContainText("Timing unresolved");
    await expect(sharedPlan).toContainText("Shanghai Roastery");
    guestStage = "guest Group organiser-authority disclosure";
    await guestPage
      .getByRole("navigation", { name: "Trip views" })
      .getByRole("link", { name: "Group", exact: true })
      .click();
    await expect(
      guestPage.getByText(
        "Only the organiser can generate a day plan. Guests can read the saved result. Live routes and real travel timings remain unavailable.",
        { exact: true },
      ),
    ).toBeVisible();
    guestStage = "guest read-only Day authority";
    await guestPage
      .getByRole("navigation", { name: "Trip views" })
      .getByRole("link", { name: "Day", exact: true })
      .click();
    await expect(
      guestPage.getByText("Generation is not available yet.", { exact: false }),
    ).toHaveCount(0);
    await expect(
      guestPage.getByRole("button", { name: "Generate day plan", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await guest.request.post(
          `http://127.0.0.1:8180/api/trips/${trip.id}/generated-day-plan`,
          {
            headers,
            data: {
              operationId: randomUUID(),
              expectedRevision: 1,
              requestRevision: 1,
              selectionRevision: state.plan.selectionRevision,
            },
          },
        )
      ).status(),
    ).toBe(401);
    await guestPage.screenshot({
      path: testInfo.outputPath("generated-real-guest.png"),
      fullPage: true,
    });
  } catch (failure) {
    const message = (
      failure instanceof Error ? failure.message : String(failure)
    )
      .replace(/\?[^\s"']*/g, "?<REDACTED>")
      .replace(
        /(\/(?:join|invitations|shared-trips|guest-trips|trip-save-intents|trips)\/)[^/\s?"']+/g,
        "$1<ID>",
      );
    writeFileSync(
      testInfo.outputPath("primary-guest-failure.json"),
      JSON.stringify(
        {
          stage: guestStage,
          name: failure instanceof Error ? failure.name : "Unknown",
          message,
          observedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    throw failure;
  } finally {
    await guest.close();
  }
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`generation-${width}.png`),
      fullPage: true,
    });
  }
});
