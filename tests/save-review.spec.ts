import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:8180" };
const password = "Save-review-password-123";
const evidence = ".scratch/wheretovisit-pilot-tickets/evidence/02";
test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});

async function account(request: APIRequestContext) {
  const email = `save-${randomBytes(8).toString("hex")}@example.invalid`;
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers,
        data: { email, password, name: "Save organiser" },
      })
    ).status(),
  ).toBe(200);
  return email;
}
async function createTrip(request: APIRequestContext, title: string) {
  const response = await request.post("/api/trips", {
    headers,
    data: { title, city: "Shanghai" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).trip;
}
async function savedPlaces(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/trips/${id}`)).json()).trip
    .savedPlaces;
}

test("review names the chosen existing and newly created Trip beside the actual branch and account", async ({
  page,
}) => {
  const email = await account(page.request);
  const first = await createTrip(page.request, "Saturday cafés");
  const second = await createTrip(page.request, "Sunday with friends");
  await page.goto("/trips?placeId=bluebottle-zhangyuan");
  const review = page.getByRole("region", { name: "Pending save" });
  await expect(review).toContainText(`Account: ${email}`);
  await expect(review).toContainText(
    "Destination: Sunday with friends · Shanghai",
  );
  await expect(review).toContainText("Zhangyuan");
  await expect(review).toContainText("上海市静安区茂名北路240号W5-1A号");
  await page.getByLabel("Your Trip", { exact: true }).selectOption(first.id);
  await expect(review).toContainText("Destination: Saturday cafés · Shanghai");
  expect(await savedPlaces(page.request, first.id)).toEqual([]);
  expect(await savedPlaces(page.request, second.id)).toEqual([]);
  await page.getByLabel("New Trip title").fill("Friday arrival coffee");
  await page.getByRole("button", { name: "Create Trip", exact: true }).click();
  await expect(review).toContainText(
    "Destination: Friday arrival coffee · Shanghai",
  );
  const createdId = await page
    .getByLabel("Your Trip", { exact: true })
    .inputValue();
  expect(await savedPlaces(page.request, createdId)).toEqual([]);
  mkdirSync(evidence, { recursive: true });
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(review).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${evidence}/save-review-${width}.png`,
      fullPage: true,
    });
    await review.screenshot({
      path: `${evidence}/save-review-detail-${width}.png`,
    });
  }
  await page
    .getByRole("button", { name: "Save reviewed branch", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Reviewed branch saved" }),
  ).toContainText("Reviewed branch saved to “Friday arrival coffee”.");
  expect(
    (await savedPlaces(page.request, createdId)).map(
      (place: { placeId: string }) => place.placeId,
    ),
  ).toEqual(["bluebottle-zhangyuan"]);
  expect(await savedPlaces(page.request, first.id)).toEqual([]);
  expect(await savedPlaces(page.request, second.id)).toEqual([]);
});

test("sign-in retries preserve the same pending branch and require destination review before saving", async ({
  page,
}) => {
  const email = await account(page.request);
  const trip = await createTrip(page.request, "Return to Shanghai");
  await page.request.post("/api/auth/sign-out", { headers, data: {} });
  await page.goto("/trips?placeId=bluebottle-westbund");
  const entry = page.getByRole("region", { name: "Organiser account" });
  await expect(entry).toContainText("West Bund");
  await expect(entry).toContainText("Password recovery is unavailable");
  const pendingId = new URL(page.url()).searchParams.get("intentId");
  expect(pendingId).toBeTruthy();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.setViewportSize({ width: 375, height: 900 });
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({
    path: `${evidence}/account-entry-375.png`,
    fullPage: true,
  });
  // Authentication succeeds but loading the review is interrupted. Retry must
  // load the review instead of signing in again or saving.
  let signInCount = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/sign-in/email")) signInCount++;
  });
  await page.route("**/api/trips", (route) => route.abort());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert", { name: "Trip request failed" }),
  ).toBeVisible();
  await page.unroute("**/api/trips");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  const review = page.getByRole("region", { name: "Pending save" });
  await expect(review).toContainText(`Account: ${email}`);
  await expect(review).toContainText(
    "Destination: Return to Shanghai · Shanghai",
  );
  await expect(review).toContainText("West Bund");
  expect(signInCount).toBe(1);
  expect(await savedPlaces(page.request, trip.id)).toEqual([]);
  await page.reload();
  await expect(review).toContainText("West Bund");
  expect(new URL(page.url()).searchParams.get("intentId")).toBe(pendingId);
  expect(await savedPlaces(page.request, trip.id)).toEqual([]);
  await page
    .getByRole("button", { name: "Save reviewed branch", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).toContainText("West Bund");
});

test("a lost Save response refreshes the review and repeat Save keeps one membership in the reviewed destination", async ({
  page,
}) => {
  await account(page.request);
  const first = await createTrip(page.request, "Reviewed destination");
  const second = await createTrip(page.request, "Other destination");
  await page.goto("/trips?placeId=bluebottle-zhangyuan");
  await page.getByLabel("Your Trip", { exact: true }).selectOption(first.id);
  await page.route(`**/api/trips/${first.id}`, async (route) => {
    if (route.request().method() === "POST") {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Save reviewed branch", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Trip request failed" }),
  ).toBeVisible();
  expect(await savedPlaces(page.request, first.id)).toHaveLength(1);
  expect(await savedPlaces(page.request, second.id)).toEqual([]);
  await page.unroute(`**/api/trips/${first.id}`);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Pending save" }),
  ).toContainText("Destination: Reviewed destination · Shanghai");
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).toContainText("Zhangyuan");
  await page
    .getByRole("button", { name: "Save reviewed branch", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Pending save" }),
  ).not.toBeVisible();
  expect(await savedPlaces(page.request, first.id)).toHaveLength(1);
  expect(await savedPlaces(page.request, second.id)).toEqual([]);
});
