import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
test("manual group review keeps drafts, current choices and successful receipt retries", async ({
  page,
  browser,
}, info) => {
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Organiser",
          email: `group-${randomUUID()}@example.invalid`,
          password: "Group-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await page.request.post("/api/trips", {
        headers,
        data: {
          title: "上海朋友的咖啡与午餐安排 · A long group decision journey",
          city: "Shanghai",
        },
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
  await guest.goto(invitation.url);
  await guest
    .getByLabel("Display name")
    .fill("上海朋友 · Companion with a long name");
  await guest.getByRole("button", { name: "Join as guest" }).click();
  await expect(guest.getByLabel("Your preference for Zhangyuan")).toBeVisible();
  await page.goto(`/trips?tripId=${trip.id}&view=group`);
  const ownerDraft = page.getByLabel("Your comment for Zhangyuan");
  await ownerDraft.fill("Unsubmitted organiser draft\nKeep this line");
  await guest
    .getByLabel("Your preference for Zhangyuan")
    .selectOption("must-go");
  await expect(guest.getByLabel("Your preference for Zhangyuan")).toHaveValue(
    "must-go",
  );
  await guest
    .getByLabel("Your comment for Zhangyuan")
    .fill("Coffee first\nPlease review");
  await guest
    .getByRole("button", { name: "Save comment for Zhangyuan" })
    .click();
  await expect(
    guest.getByRole("region", { name: "Discussion for Zhangyuan" }),
  ).toContainText("Coffee first");
  await page.getByRole("button", { name: "Refresh collaboration" }).click();
  await expect(ownerDraft).toHaveValue(
    "Unsubmitted organiser draft\nKeep this line",
  );
  await expect(
    page.getByRole("region", { name: "Group decisions" }),
  ).toContainText("Group changed since your previous review");
  await expect(
    page.getByRole("region", { name: "Discussion for Zhangyuan" }),
  ).toContainText("Must go 1 · Interested 0 · Skip 0");
  await expect(
    page.getByRole("region", { name: "Discussion for Zhangyuan" }),
  ).toContainText("Outstanding decision");
  await guest
    .getByLabel("Your comment for Zhangyuan")
    .fill("Guest unsaved draft");
  await guest
    .getByLabel("Unresolved Place name")
    .fill("Another unsaved suggestion");
  await guest.getByRole("button", { name: "Refresh collaboration" }).click();
  await expect(guest.getByLabel("Your comment for Zhangyuan")).toHaveValue(
    "Guest unsaved draft",
  );
  await expect(guest.getByLabel("Unresolved Place name")).toHaveValue(
    "Another unsaved suggestion",
  );
  // Commit a vote, lose its response, then commit a distinct newer write in the same browser session.
  let oldOperation: Record<string, unknown> | undefined;
  await guest.route("**/api/guest-trips/*/collaboration", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    oldOperation = route.request().postDataJSON();
    expect((await route.fetch()).status()).toBe(200);
    await route.abort();
  });
  await guest
    .getByLabel("Your preference for Zhangyuan")
    .selectOption("interested");
  await expect(
    guest.getByRole("alert", { name: "Collaboration request failed" }),
  ).toContainText("No new change is confirmed");
  await expect(
    guest.getByRole("button", { name: "Refresh collaboration" }),
  ).toBeEnabled();
  expect(oldOperation).toBeDefined();
  expect(
    (
      await context.request.post(
        `${origin}/api/guest-trips/${trip.id}/collaboration`,
        {
          headers,
          data: {
            operationId: randomUUID(),
            action: "vote",
            placeId: "bluebottle-zhangyuan",
            choice: "skip",
          },
        },
      )
    ).status(),
  ).toBe(200);
  await guest.unroute("**/api/guest-trips/*/collaboration");
  await guest.getByRole("button", { name: "Refresh collaboration" }).click();
  await expect(guest.getByLabel("Your preference for Zhangyuan")).toHaveValue(
    "skip",
  );
  await expect(
    guest.getByRole("button", { name: "Retry collaboration" }),
  ).toBeVisible();
  await guest.getByRole("button", { name: "Retry collaboration" }).click();
  await expect(guest.getByLabel("Your preference for Zhangyuan")).toHaveValue(
    "skip",
  );
  await expect(guest.getByLabel("Your comment for Zhangyuan")).toHaveValue(
    "Guest unsaved draft",
  );
  await guest
    .getByLabel("Canonical branch to suggest")
    .selectOption("bluebottle-westbund");
  await guest.getByRole("button", { name: "Suggest canonical branch" }).click();
  await expect(
    guest.getByRole("region", { name: "Place suggestions" }),
  ).toContainText("pending");
  await page.getByRole("button", { name: "Refresh collaboration" }).click();
  await page.getByRole("button", { name: "Accept suggestion" }).click();
  await expect(
    page.getByRole("region", { name: "Place suggestions" }),
  ).toContainText("accepted");
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
      .selectedPlaceIds,
  ).toEqual([]);
  for (const width of [320, 375, 1280]) {
    await guest.setViewportSize({ width, height: 900 });
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await guest.screenshot({
      path: info.outputPath(`group-${width}.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole("navigation", { name: "Trip views" })
    .getByRole("link", { name: "Manage", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Invitation and participants" }),
  ).toContainText("returning does not extend");
  await page
    .getByRole("button", { name: "Replace invitation", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Invitation and participants" }),
  ).toContainText("access ended");
  expect(
    (
      await context.request.post(
        `${origin}/api/guest-trips/${trip.id}/collaboration`,
        { headers, data: oldOperation },
      )
    ).status(),
  ).toBe(404);
  await guest.getByRole("button", { name: "Refresh collaboration" }).click();
  await expect(
    guest.getByRole("alert", { name: "Guest access unavailable" }),
  ).toBeVisible();
  await expect(guest.getByLabel("Your comment for Zhangyuan")).toHaveCount(0);
  await context.close();
});
