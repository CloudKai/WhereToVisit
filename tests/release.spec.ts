import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { catalogueFixture } from "./catalogue-fixture";

const headers = { Origin: "http://127.0.0.1:8180" };
test.setTimeout(120_000);

async function fit(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}
function scenario(solo = false) {
  const batch = catalogueFixture();
  for (const [index, place] of batch.places.entries()) {
    Object.assign(place, {
      coordinates: {
        latitude: 31.23,
        longitude: index === 0 ? 121.47 : 121.4,
        system: "WGS-84",
        source: "Fictional acceptance coordinates",
        acquiredAt: "2026-10-13",
        purpose: "Development behavior only",
        conversion: null,
      },
    });
  }
  writeFileSync(".data/catalogue-scenario.json", JSON.stringify(batch));
  writeFileSync(
    ".data/day-planning-scenario.json",
    JSON.stringify({
      kind: "fixture",
      visitDate: "2026-12-31",
      requestedMode: "walking-transit",
      provider: "Fictional scenario provider",
      apiVersion: "scenario-v1",
      retrievedAt: "2026-10-12T00:00:00Z",
      coordinateProvenance: "Fictional endpoints; no live provider",
      hours: (solo
        ? ["fictional-cafe-east"]
        : ["fictional-cafe-east", "fictional-cafe-west"]
      ).map((placeId) => ({
        placeId,
        closed: false,
        opensMinute: 540,
        closesMinute: 1080,
        evidence: "Fictional dated hours",
      })),
      legs: solo
        ? []
        : [
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
    }),
  );
}
async function source(page: Page, title: string) {
  await page.goto("/import", { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("Supported article URL")
    .fill(`https://en.wikivoyage.org/wiki/Fixture_${title}`);
  await page
    .getByRole("button", { name: "Import article", exact: true })
    .click();
  await expect(
    page
      .getByRole("heading", { name: "Fictional Scenario Café", exact: true })
      .last(),
  ).toBeVisible();
  const job = page
    .getByRole("article")
    .filter({ hasText: `https://en.wikivoyage.org/wiki/Fixture_${title}` });
  const resolving = page.waitForResponse(
    (response) =>
      response.url().endsWith("/resolution") &&
      response.request().postDataJSON()?.action === "resolve",
  );
  await job.getByRole("button", { name: "Find candidate branches" }).click();
  expect((await resolving).status()).toBe(200);
  await expect(job).toContainText("1 Fictional East Road, Shanghai");
  await expect(job).toContainText("2 Fictional West Road, Shanghai");
  await job
    .getByRole("button", { name: "Confirm East branch", exact: true })
    .click();
  await expect(job).toContainText("User-confirmed branch");
  await page
    .getByRole("link", { name: "Save confirmed branch to a Trip", exact: true })
    .click();
}
async function newTrip(page: Page, title: string) {
  const email = `release-${randomUUID()}@example.invalid`;
  const password = "Release-test-password-123";
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review your pending save" }),
  ).toBeVisible();
  await page.getByLabel("New Trip title").fill(title);
  await page.getByRole("button", { name: "Create Trip", exact: true }).click();
  await page
    .getByRole("button", { name: "Save reviewed branch", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Pending save" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).toContainText("East branch");
  return {
    email,
    password,
    id: await page.getByLabel("Your Trip", { exact: true }).inputValue(),
  };
}
async function tripView(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Trip views" })
    .getByRole("link", { name, exact: true })
    .click();
}
async function plan(page: Page) {
  await tripView(page, "Day");
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
  await expect(result).toContainText("Fictional development plan");
  await expect(inputs).toContainText("allergy safety are unknown");
  return result;
}

for (const width of [375, 1280]) {
  test(`organiser and guest complete the integrated fictional journey at ${width}px`, async ({
    page,
    browser,
  }, info) => {
    scenario();
    await page.setViewportSize({ width, height: 900 });
    const guestContext = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const otherContext = await browser.newContext();
    try {
      await page.goto("/discover");
      await expect(
        page.getByText("Fictional map — development behavior only", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByLabel("Category", { exact: true }).selectOption("cafe");
      await page.getByLabel("Budget", { exact: true }).selectOption("unknown");
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(page.getByRole("article")).toHaveCount(2);
      await page.getByRole("button", { name: "Zoom in" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Pan east" }).click();
      await expect(page.getByRole("article")).toHaveCount(2);
      await page
        .getByRole("button", { name: "Search this area", exact: true })
        .click();
      await expect(page.getByRole("article")).toHaveCount(1);
      await expect(page.getByRole("article")).toContainText("East branch");
      await fit(page, info, "discovery");
      await source(page, "Resolution");
      const identity = await newTrip(page, "Acceptance with companion");
      await source(page, "ResolutionSecond");
      await page
        .getByRole("button", { name: "Save reviewed branch", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Pending save" }),
      ).toHaveCount(0);
      const ownerState = (
        await (await page.request.get(`/api/trips/${identity.id}`)).json()
      ).trip;
      expect(ownerState.savedPlaces).toHaveLength(1);
      expect(ownerState.savedPlaces[0].importedEvidence).toHaveLength(2);
      expect(ownerState.selectedPlaceIds).toEqual([]);
      for (const saved of ownerState.savedPlaces[0].importedEvidence) {
        expect(saved.source.license).toBe("CC BY-SA 4.0");
        expect(saved.confirmation.independentVerification).toBe(false);
        expect(
          (
            await page.request.post(`/api/imports/${saved.importId}`, {
              headers,
              data: { action: "delete" },
            })
          ).status(),
        ).toBe(200);
      }
      await page.reload();
      await page
        .getByText("Saved sources and branch evidence", { exact: true })
        .click();
      await expect(
        page.getByText("Original wording: “Fictional Scenario Café”", {
          exact: true,
        }),
      ).toHaveCount(2);
      await tripView(page, "Manage");
      await page.getByRole("button", { name: "Create invitation" }).click();
      const link = await page
        .getByLabel("Invitation link", { exact: true })
        .inputValue();
      const guest = await guestContext.newPage();
      await guest.goto(link);
      await guest.getByLabel("Display name").fill("Acceptance companion");
      await guest.getByRole("button", { name: "Join as guest" }).click();
      await guest
        .getByLabel("Your preference for East branch")
        .selectOption("must-go");
      await tripView(guest, "Group");
      await expect(
        guest.getByRole("region", { name: "Discussion for East branch" }),
      ).toContainText("Must go 1");
      await guest
        .getByLabel("Your comment for East branch")
        .fill("Keep the source when editing our day");
      await guest
        .getByRole("button", { name: "Save comment for East branch" })
        .click();
      await expect(
        guest.getByRole("region", { name: "Discussion for East branch" }),
      ).toContainText("Keep the source");
      await guest
        .getByLabel("Canonical branch to suggest")
        .selectOption("fictional-cafe-west");
      await guest
        .getByRole("button", { name: "Suggest canonical branch" })
        .click();
      await expect(
        guest.getByRole("region", { name: "Place suggestions" }),
      ).toContainText("pending");
      await tripView(page, "Group");
      await page.getByRole("button", { name: "Refresh collaboration" }).click();
      await page.getByRole("button", { name: "Accept suggestion" }).click();
      await tripView(page, "Places");
      await expect(
        page.getByLabel("Select West branch for a day plan"),
      ).not.toBeChecked();
      for (const branch of ["East", "West"]) {
        await page.getByLabel(`Select ${branch} branch for a day plan`).click();
        await expect(
          page.getByLabel(`Select ${branch} branch for a day plan`),
        ).toBeChecked();
      }
      const result = await plan(page);
      const stops = result
        .getByRole("list", { name: "Day stops" })
        .getByRole("listitem");
      await expect(stops).toHaveCount(2);
      await stops.nth(1).getByRole("button", { name: "Move earlier" }).focus();
      await page.keyboard.press("Enter");
      await expect(stops.nth(0)).toContainText("West branch");
      await expect(result).toContainText("Timing unresolved");
      await stops.nth(0).getByLabel("Desired arrival (Shanghai)").fill("11:30");
      await stops
        .nth(0)
        .getByRole("button", { name: "Save desired time" })
        .click();
      await expect(result).toContainText("User-desired arrival 11:30");
      await stops
        .nth(1)
        .getByRole("button", { name: "Remove from this day" })
        .click();
      await expect(stops).toHaveCount(1);
      await page
        .getByRole("button", { name: "Generate day plan", exact: true })
        .click();
      await expect(
        page.getByRole("alert", { name: "Replace manual edits" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Keep edited day plan" }).click();
      await page.reload();
      await expect(result).toContainText("User-desired arrival 11:30");
      await expect(stops).toHaveCount(1);
      const persisted = (
        await (await page.request.get(`/api/trips/${identity.id}`)).json()
      ).trip;
      expect(persisted.savedPlaces).toHaveLength(2);
      expect(persisted.savedPlaces[0].importedEvidence).toEqual(
        ownerState.savedPlaces[0].importedEvidence,
      );
      expect(persisted.selectedPlaceIds).toEqual([
        "fictional-cafe-east",
        "fictional-cafe-west",
      ]);
      await guest.reload();
      await tripView(guest, "Day");
      await expect(
        guest.getByRole("region", { name: "Generated day plan", exact: true }),
      ).toContainText("User-desired arrival 11:30");
      await expect(
        guest.getByRole("button", { name: "Move earlier" }),
      ).toHaveCount(0);
      await expect(
        guest.getByRole("region", { name: "Discussion for East branch" }),
      ).toContainText("Must go 1");
      await tripView(guest, "Places");
      await guest
        .getByText("Shared sources and branch evidence", { exact: true })
        .first()
        .click();
      await expect(
        guest.getByText("Original wording: “Fictional Scenario Café”", {
          exact: true,
        }),
      ).toHaveCount(2);
      const shared = (
        await (
          await guest.request.get(`/api/guest-trips/${identity.id}`)
        ).json()
      ).shared.trip;
      expect(
        shared.generatedDayPlan.plan.stops.map(
          (stop: { placeId: string }) => stop.placeId,
        ),
      ).toEqual(["fictional-cafe-west"]);
      for (const key of [
        "organiserUserId",
        "invitation",
        "receipts",
        "operationHash",
        "saveIntent",
      ])
        expect(shared).not.toHaveProperty(key);
      for (const member of shared.savedPlaces)
        for (const retained of member.importedEvidence) {
          for (const key of ["importId", "mentionId", "browserId"])
            expect(retained).not.toHaveProperty(key);
        }
      expect(shared.generatedDayPlan).not.toHaveProperty("receipts");
      expect(shared).not.toHaveProperty("invitation");
      for (const path of ["day-plan", "generated-day-plan"]) {
        expect(
          (
            await guest.request.post(`/api/trips/${identity.id}/${path}`, {
              headers,
              data: {},
            })
          ).status(),
        ).toBe(401);
      }
      expect(
        (
          await guest.request.patch(
            `/api/trips/${identity.id}/generated-day-plan`,
            { headers, data: {} },
          )
        ).status(),
      ).toBe(401);
      const other = otherContext.request;
      expect(
        (
          await other.post("/api/auth/sign-up/email", {
            headers,
            data: {
              name: "Other organiser",
              email: `other-${randomUUID()}@example.invalid`,
              password: identity.password,
            },
          })
        ).status(),
      ).toBe(200);
      for (const path of [
        "",
        "/day-plan",
        "/generated-day-plan",
        "/invitation",
        "/collaboration",
      ]) {
        expect(
          (await other.get(`/api/trips/${identity.id}${path}`)).status(),
        ).toBe(404);
      }
      expect(
        (
          await other.patch(`/api/trips/${identity.id}/generated-day-plan`, {
            headers,
            data: {},
          })
        ).status(),
      ).toBe(404);
      await fit(page, info, "owner-edited");
      await fit(guest, info, "guest-edited");
      await tripView(page, "Manage");
      await page.getByRole("button", { name: "Disable invitation" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Invitation disabled" }),
      ).toBeVisible();
      await guest.getByRole("button", { name: "Refresh shared Trip" }).click();
      await expect(
        guest.getByRole("alert", { name: "Guest access unavailable" }),
      ).toBeVisible();
      expect(
        (await guest.request.get(`/api/guest-trips/${identity.id}`)).status(),
      ).toBe(404);
      expect(
        (
          await guest.request.post(
            `/api/guest-trips/${identity.id}/collaboration`,
            {
              headers,
              data: {
                operationId: randomUUID(),
                action: "vote",
                placeId: "fictional-cafe-east",
                choice: "skip",
              },
            },
          )
        ).status(),
      ).toBe(404);
      await fit(guest, info, "revoked");
      await tripView(page, "Manage");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      const returningContext = await browser.newContext({
        viewport: { width, height: 900 },
      });
      try {
        const returning = await returningContext.newPage();
        await returning.goto("/trips");
        await returning
          .getByLabel("Email", { exact: true })
          .fill(identity.email);
        await returning
          .getByLabel("Password", { exact: true })
          .fill(identity.password);
        await returning
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await tripView(returning, "Day");
        await expect(
          returning.getByRole("region", {
            name: "Generated day plan",
            exact: true,
          }),
        ).toContainText("User-desired arrival 11:30");
        await tripView(returning, "Group");
        await expect(
          returning.getByRole("region", { name: "Discussion for East branch" }),
        ).toContainText("Keep the source");
        expect(
          (
            await (
              await returning.request.get(`/api/trips/${identity.id}`)
            ).json()
          ).trip,
        ).toEqual(persisted);
        await fit(returning, info, "fresh-session-return");
      } finally {
        await returningContext.close();
      }
    } finally {
      await guestContext.close();
      await otherContext.close();
      writeFileSync(
        ".data/catalogue-scenario.json",
        JSON.stringify(catalogueFixture()),
      );
    }
  });

  test(`solo organiser plans without guests or invitations at ${width}px`, async ({
    page,
  }, info) => {
    scenario(true);
    await page.setViewportSize({ width, height: 900 });
    try {
      await page.goto("/discover");
      await page
        .getByRole("link", { name: "Save East branch to a Trip" })
        .click();
      const identity = await newTrip(page, "Solo acceptance");
      const refreshed = page.waitForResponse(
        (response) =>
          response.url().endsWith("/day-plan") &&
          response.request().method() === "GET",
      );
      await page.getByLabel("Select East branch for a day plan").click();
      expect((await refreshed).status()).toBe(200);
      await expect(
        page.getByLabel("Select East branch for a day plan"),
      ).toBeChecked();
      const result = await plan(page);
      await result.getByLabel("Desired arrival (Shanghai)").fill("12:15");
      await result.getByRole("button", { name: "Save desired time" }).click();
      await expect(result).toContainText("User-desired arrival 12:15");
      await page.reload();
      await expect(result).toContainText("User-desired arrival 12:15");
      const invitation = (
        await (
          await page.request.get(`/api/trips/${identity.id}/invitation`)
        ).json()
      ).invitation;
      expect(invitation).toBeNull();
      const collaboration = (
        await (
          await page.request.get(`/api/trips/${identity.id}/collaboration`)
        ).json()
      ).collaboration;
      expect(collaboration.votes).toEqual([]);
      await fit(page, info, "solo-edited");
    } finally {
      writeFileSync(
        ".data/catalogue-scenario.json",
        JSON.stringify(catalogueFixture()),
      );
    }
  });
}

test("a stale import continuation leaves the current organiser's private Trips available", async ({
  page,
}) => {
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Returning organiser",
          email: `return-${randomUUID()}@example.invalid`,
          password: "Returning-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const saved = (
    await (
      await page.request.post("/api/trips", {
        headers,
        data: { title: "Retained private Trip", city: "Shanghai" },
      })
    ).json()
  ).trip;
  await page.goto("/trips?placeId=fictional-cafe-east&importId=expired-import");
  await expect(
    page.getByRole("alert", { name: "Trip request failed" }),
  ).toContainText("Confirmed branch not found");
  await expect(
    page.getByRole("heading", { name: saved.title, exact: true }),
  ).toBeVisible();
  if (await page.getByRole("navigation", { name: "Trip views" }).count())
    await tripView(page, "Manage");
  else await page.getByText("Manage account", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to save" }),
  ).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/trips/${saved.id}`)).json()).trip
      .savedPlaces,
  ).toEqual([]);
});

test("an anonymous save review survives reordered initial HTTP responses", async ({
  page,
}) => {
  writeFileSync(
    ".data/catalogue-scenario.json",
    JSON.stringify(catalogueFixture()),
  );
  let firstDelivered: () => void = () => {};
  const delivered = new Promise<void>((resolve) => {
    firstDelivered = resolve;
  });
  let first = true;
  await page.route("**/api/trip-save-intents", async (route) => {
    if (route.request().method() !== "POST" || !first) return route.continue();
    first = false;
    const response = await route.fetch();
    // A delayed real public response recreates anonymous cookie delivery ordering.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ response });
    firstDelivered();
  });
  await page.goto("/trips?placeId=fictional-cafe-east");
  await delivered;
  await expect(
    page.getByRole("heading", { name: "Sign in to save" }),
  ).toBeVisible();
  const identity = await newTrip(page, "Reordered response collection");
  expect(
    (
      await (await page.request.get(`/api/trips/${identity.id}`)).json()
    ).trip.savedPlaces.map((member: { placeId: string }) => member.placeId),
  ).toEqual(["fictional-cafe-east"]);
});

test("a transient initial save failure offers an actionable retry after current-account loading", async ({
  page,
}) => {
  writeFileSync(
    ".data/catalogue-scenario.json",
    JSON.stringify(catalogueFixture()),
  );
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Retry organiser",
          email: `retry-${randomUUID()}@example.invalid`,
          password: "Retry-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  await page.route("**/api/trip-save-intents", (route) => route.abort());
  await page.route("**/api/trips", async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ response });
  });
  await page.goto("/trips?placeId=fictional-cafe-east");
  const failure = page.getByRole("alert", { name: "Trip request failed" });
  await expect(failure).toContainText("Retry");
  if (await page.getByRole("navigation", { name: "Trip views" }).count())
    await tripView(page, "Manage");
  else await page.getByText("Manage account", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/trip-save-intents");
  await failure.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Review your pending save",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Pending save" }),
  ).toContainText("1 Fictional East Road, Shanghai");
  expect((await (await page.request.get("/api/trips")).json()).trips).toEqual(
    [],
  );
});

test("leaving a pending save URL loads the current Trips page without waiting forever", async ({
  page,
}) => {
  writeFileSync(
    ".data/catalogue-scenario.json",
    JSON.stringify(catalogueFixture()),
  );
  let reached: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/trip-save-intents", async (route) => {
    const response = await route.fetch();
    reached();
    await released;
    await route.fulfill({ response });
  });
  try {
    await page.goto("/trips?placeId=fictional-cafe-east");
    await pending;
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Trips", exact: true })
      .click();
    await expect(page).toHaveURL("http://127.0.0.1:8180/trips");
    release();
    await expect(
      page.getByRole("heading", { name: "Sign in to save", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Waiting for the server" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Loading your account" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Pending save" }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

test("an obsolete initial account response cannot replace a confirmed current Trip", async ({
  page,
}) => {
  writeFileSync(
    ".data/catalogue-scenario.json",
    JSON.stringify(catalogueFixture()),
  );
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Current organiser",
          email: `current-${randomUUID()}@example.invalid`,
          password: "Current-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  let reached: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/api/trips", async (route) => {
    if (route.request().method() !== "GET" || !first) return route.continue();
    first = false;
    const response = await route.fetch();
    reached();
    await released;
    await route.fulfill({ response });
  });
  try {
    await page.goto("/trips?placeId=fictional-cafe-east");
    await held;
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Trips", exact: true })
      .click();
    await expect(page).toHaveURL("http://127.0.0.1:8180/trips");
    await page.getByLabel("New Trip title").fill("Confirmed current Trip");
    await page
      .getByRole("button", { name: "Create Trip", exact: true })
      .click();
    const current = page.getByRole("heading", {
      name: "Confirmed current Trip",
      exact: true,
    });
    await expect(current).toBeVisible();
    const id = await page.getByLabel("Your Trip", { exact: true }).inputValue();
    const obsolete = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/trips") &&
        response.request().method() === "GET",
    );
    release();
    await obsolete;
    // Let the delivered obsolete response reach the rendered browser boundary.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      (await (await page.request.get(`/api/trips/${id}`)).json()).trip.title,
    ).toBe("Confirmed current Trip");
    await expect(current).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Pending save" }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});
