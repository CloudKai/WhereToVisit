import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
test.setTimeout(120_000);
async function account(request: APIRequestContext) {
  const identity = {
    email: `organiser-${randomBytes(8).toString("hex")}@example.invalid`,
    password: "Local-test-password-123",
  };
  await expect
    .poll(
      async () => {
        const response = await request.post("/api/auth/sign-up/email", {
          headers,
          data: { ...identity, name: "Organiser" },
        });
        return response.status();
      },
      { timeout: 70_000, intervals: [1000, 5000, 5000] },
    )
    .toBe(200);
  return identity;
}
async function imported(request: APIRequestContext, title = "Resolution") {
  let id = "";
  await expect
    .poll(
      async () => {
        const response = await request.post("/api/imports", {
          headers,
          data: {
            sourceUrl: `https://en.wikivoyage.org/wiki/Fixture_${title}`,
          },
        });
        if (response.status() === 202) id = (await response.json()).job.id;
        return response.status();
      },
      { timeout: 70_000, intervals: [1000, 5000, 5000] },
    )
    .toBe(202);
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/imports/${id}`)).json()).job.status,
    )
    .not.toMatch(/^(queued|processing)$/);
  return id;
}
async function confirmed(
  request: APIRequestContext,
  id: string,
  candidateId = "fictional-cafe-east",
  outside = false,
) {
  const job = (
    await (
      await request.post(`/api/imports/${id}/resolution`, {
        headers,
        data: { action: "resolve" },
      })
    ).json()
  ).job;
  expect(
    (
      await request.post(`/api/imports/${id}/resolution`, {
        headers,
        data: {
          action: "confirm",
          mentionId: job.mentions[0].id,
          candidateId,
          ...(outside ? { acknowledgeOutsideCity: true } : {}),
        },
      })
    ).status(),
  ).toBe(200);
}
async function intent(
  request: APIRequestContext,
  placeId: string,
  importId?: string,
) {
  const response = await request.post("/api/trip-save-intents", {
    headers,
    data: { placeId, ...(importId ? { importId } : {}) },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).intent;
}
async function trip(request: APIRequestContext, title: string) {
  const response = await request.post("/api/trips", {
    headers,
    data: { title, city: "Shanghai" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).trip;
}
test("real organiser account persists a private Shanghai Trip across sign-in sessions and denies guessed identities", async ({
  request,
  playwright,
}) => {
  const identity = await account(request);
  const saved = await trip(request, "Shanghai coffee");
  await request.post("/api/auth/sign-out", { headers, data: {} });
  expect((await request.get(`/api/trips/${saved.id}`)).status()).toBe(401);
  const other = await playwright.request.newContext({ baseURL: origin });
  await account(other);
  expect((await other.get(`/api/trips/${saved.id}`)).status()).toBe(404);
  for (const data of [
    { action: "update", title: "Stolen", city: "Shanghai" },
    { action: "save", intentId: "guessed" },
    { action: "select", placeId: "bluebottle-zhangyuan", selected: true },
    { action: "remove", placeId: "bluebottle-zhangyuan" },
  ])
    expect(
      (await other.post(`/api/trips/${saved.id}`, { headers, data })).status(),
    ).toBe(404);
  expect(
    (
      await request.post("/api/auth/sign-in/email", { headers, data: identity })
    ).status(),
  ).toBe(200);
  expect(
    (await (await request.get(`/api/trips/${saved.id}`)).json()).trip.title,
  ).toBe("Shanghai coffee");
  await other.dispose();
});
test("explicit authenticated saves retain licensed evidence after draft deletion, deduplicate branches and separate selection", async ({
  request,
  playwright,
}) => {
  const id = await imported(request);
  await confirmed(request, id);
  const pending = await intent(request, "fictional-cafe-east", id);
  await account(request);
  expect(
    (await request.get(`/api/trip-save-intents/${pending.id}`)).status(),
  ).toBe(200);
  const saved = await trip(request, "Source collection");
  for (let repeat = 0; repeat < 2; repeat++)
    expect(
      (
        await request.post(`/api/trips/${saved.id}`, {
          headers,
          data: { action: "save", intentId: pending.id },
        })
      ).status(),
    ).toBe(200);
  await request.post(`/api/imports/${id}`, {
    headers,
    data: { action: "delete" },
  });
  const persisted = (await (await request.get(`/api/trips/${saved.id}`)).json())
    .trip;
  expect(persisted.savedPlaces).toHaveLength(1);
  expect(persisted.selectedPlaceIds).toEqual([]);
  expect(persisted.savedPlaces[0].importedEvidence).toEqual(
    pending.importedEvidence,
  );
  expect(persisted.savedPlaces[0].importedEvidence[0]).toMatchObject({
    source: {
      license: "CC BY-SA 4.0",
      revision: expect.any(String),
      historyUrl: null,
    },
    extraction: {
      quote: "Fictional Scenario Café",
      codePointStart: expect.any(Number),
    },
    confirmation: { independentVerification: false },
  });
  const west = await intent(request, "fictional-cafe-west");
  await request.post(`/api/trips/${saved.id}`, {
    headers,
    data: { action: "save", intentId: west.id },
  });
  const selected = await request.post(`/api/trips/${saved.id}`, {
    headers,
    data: { action: "select", placeId: "fictional-cafe-east", selected: true },
  });
  expect((await selected.json()).trip).toMatchObject({
    selectedPlaceIds: ["fictional-cafe-east"],
    savedPlaces: [
      { placeId: "fictional-cafe-east" },
      { placeId: "fictional-cafe-west" },
    ],
  });
  await request.post(`/api/trips/${saved.id}`, {
    headers,
    data: { action: "select", placeId: "fictional-cafe-east", selected: false },
  });
  await request.post(`/api/trips/${saved.id}`, {
    headers,
    data: { action: "select", placeId: "fictional-cafe-east", selected: true },
  });
  await request.post(`/api/trips/${saved.id}`, {
    headers,
    data: { action: "remove", placeId: "fictional-cafe-east" },
  });
  const removed = (await (await request.get(`/api/trips/${saved.id}`)).json())
    .trip;
  expect(removed.selectedPlaceIds).toEqual([]);
  expect(removed.savedPlaces).toHaveLength(1);
  expect(
    (await (await request.get("/api/catalogue?city=Shanghai")).json()).data
      .places,
  ).toHaveLength(2);
  await request.post("/api/auth/sign-out", { headers, data: {} });
  await account(request);
  expect(
    (await request.get(`/api/trip-save-intents/${pending.id}`)).status(),
  ).toBe(404);
  const unsigned = await playwright.request.newContext({ baseURL: origin });
  expect(
    (
      await unsigned.post(`/api/trips/${saved.id}`, {
        headers,
        data: { action: "remove", placeId: "fictional-cafe-west" },
      })
    ).status(),
  ).toBe(401);
  await unsigned.dispose();
});
test("anonymous discovery continues through real account creation and visible durable save with retry", async ({
  page,
}, testInfo) => {
  await page.goto("/discover", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Save East branch to a Trip" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to save" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create an account" }).click();
  await page
    .getByLabel("Email")
    .fill(`browser-${randomBytes(8).toString("hex")}@example.invalid`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review your pending save" }),
  ).toBeVisible();
  await expect(
    page.getByText("1 Fictional East Road, Shanghai", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("New Trip title").fill("Weekend coffee");
  await page.getByRole("button", { name: "Create Trip", exact: true }).click();
  await page.route("**/api/trips/*", (route) => route.abort());
  await page
    .getByRole("button", { name: "Save reviewed branch", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Trip request failed" }),
  ).toContainText("Retry");
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).not.toContainText("East branch");
  await page.unroute("**/api/trips/*");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).toContainText("East branch");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).toContainText("East branch");
  await page.getByLabel("Select East branch for a day plan").click();
  await expect(
    page.getByText(/1 selected for a future day plan/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove East branch" }).click();
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).not.toContainText("East branch");
  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("trips-375.png"),
    fullPage: true,
  });
});
test("a reviewed import continuation cannot be reassigned after switching accounts, and invalid/outside-city saves are denied", async ({
  request,
}) => {
  const id = await imported(request, "ResolutionSecond");
  expect(
    (
      await request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "fictional-cafe-east", importId: id },
      })
    ).status(),
  ).toBe(404);
  await confirmed(request, id);
  const pending = await intent(request, "fictional-cafe-east", id);
  await account(request);
  expect(
    (await request.get(`/api/trip-save-intents/${pending.id}`)).status(),
  ).toBe(200);
  await request.post("/api/auth/sign-out", { headers, data: {} });
  await account(request);
  expect(
    (
      await request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "fictional-cafe-east", importId: id },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/trips", {
        headers: { Origin: "https://other.invalid" },
        data: { title: "Wrong origin", city: "Shanghai" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/trips", {
        headers,
        data: { title: "Wrong city", city: "Hangzhou" },
      })
    ).status(),
  ).toBe(400);
  const outsideId = await imported(request, "Outside");
  await confirmed(request, outsideId, "fictional-outside-cafe", true);
  const denied = await request.post("/api/trip-save-intents", {
    headers,
    data: { placeId: "fictional-outside-cafe", importId: outsideId },
  });
  expect(denied.status()).toBe(400);
  expect((await denied.json()).error.code).toBe("city-not-supported");
});
test("a real storage write failure leaves the private Trip unchanged and offers visible retry", async ({
  page,
}) => {
  await account(page.request);
  const saved = await trip(page.request, "Before storage failure");
  await page.goto("/trips", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Before storage failure" }),
  ).toBeVisible();
  const configuration = JSON.parse(
    readFileSync(".data/trip-storage-test.json", "utf8"),
  );
  // Inject an external storage fault; observe persistence only through public HTTP/UI.
  const lock = new Database(configuration.databasePath);
  try {
    lock.exec("BEGIN IMMEDIATE");
    await page
      .getByLabel("Trip title", { exact: true })
      .fill("Recovered after retry");
    await page.getByRole("button", { name: "Update title" }).click();
    await expect(
      page.getByRole("alert", { name: "Trip request failed" }),
    ).toContainText("could not be saved", { timeout: 15_000 });
    expect(
      (await (await page.request.get(`/api/trips/${saved.id}`)).json()).trip
        .title,
    ).toBe("Before storage failure");
    lock.exec("ROLLBACK");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(
      page.getByRole("heading", { name: "Recovered after retry" }),
    ).toBeVisible();
    expect(
      (await (await page.request.get(`/api/trips/${saved.id}`)).json()).trip
        .title,
    ).toBe("Recovered after retry");
  } finally {
    lock.close();
  }
});

test("failed selection and deselection retry preserves the organiser's requested state", async ({
  page,
}) => {
  await account(page.request);
  const pending = await intent(page.request, "fictional-cafe-east");
  const saved = await trip(page.request, "Selection retry");
  await page.request.post(`/api/trips/${saved.id}`, {
    headers,
    data: { action: "save", intentId: pending.id },
  });
  await page.goto("/trips", { waitUntil: "domcontentloaded" });
  const selection = page.getByLabel("Select East branch for a day plan");
  await expect(selection).not.toBeChecked();
  for (const requested of [true, false]) {
    await page.route("**/api/trips/*", (route) => route.abort());
    await selection.click();
    await expect(
      page.getByRole("alert", { name: "Trip request failed" }),
    ).toContainText("Retry");
    const before = (
      await (await page.request.get(`/api/trips/${saved.id}`)).json()
    ).trip.selectedPlaceIds;
    expect(before).toEqual(requested ? [] : ["fictional-cafe-east"]);
    await page.unroute("**/api/trips/*");
    await page.getByRole("button", { name: "Retry" }).click();
    if (requested) await expect(selection).toBeChecked();
    else await expect(selection).not.toBeChecked();
    expect(
      (await (await page.request.get(`/api/trips/${saved.id}`)).json()).trip
        .selectedPlaceIds,
    ).toEqual(requested ? ["fictional-cafe-east"] : []);
  }
});

test("a fresh import after account switching saves only eligible provenance, including a later anonymous continuation", async ({
  request,
}) => {
  const firstId = await imported(request, "Resolution");
  await confirmed(request, firstId);
  const firstPending = await intent(request, "fictional-cafe-east", firstId);
  await account(request);
  expect(
    (await request.get(`/api/trip-save-intents/${firstPending.id}`)).status(),
  ).toBe(200);
  await request.post("/api/auth/sign-out", { headers, data: {} });
  const secondIdentity = await account(request);
  const secondId = await imported(request, "ResolutionSecond");
  await confirmed(request, secondId);
  const secondPending = await intent(request, "fictional-cafe-east", secondId);
  expect(
    secondPending.importedEvidence.map(
      (item: { importId: string }) => item.importId,
    ),
  ).toEqual([secondId]);
  const saved = await trip(request, "Second organiser's fresh source");
  expect(
    (
      await request.post(`/api/trips/${saved.id}`, {
        headers,
        data: { action: "save", intentId: secondPending.id },
      })
    ).status(),
  ).toBe(200);
  await request.post("/api/auth/sign-out", { headers, data: {} });
  const anonymousPending = await intent(
    request,
    "fictional-cafe-east",
    secondId,
  );
  const protectedPending = await intent(
    request,
    "fictional-cafe-east",
    firstId,
  );
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        headers,
        data: secondIdentity,
      })
    ).status(),
  ).toBe(200);
  const reviewed = await request.get(
    `/api/trip-save-intents/${anonymousPending.id}`,
  );
  expect(reviewed.status()).toBe(200);
  expect(
    (await reviewed.json()).intent.importedEvidence.map(
      (item: { importId: string }) => item.importId,
    ),
  ).toEqual([secondId]);
  expect(
    (
      await request.get(`/api/trip-save-intents/${protectedPending.id}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "fictional-cafe-east", importId: firstId },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`/api/trips/${saved.id}`, {
        headers,
        data: { action: "save", intentId: anonymousPending.id },
      })
    ).status(),
  ).toBe(200);
  const persisted = (await (await request.get(`/api/trips/${saved.id}`)).json())
    .trip;
  expect(
    persisted.savedPlaces[0].importedEvidence.map(
      (item: { importId: string }) => item.importId,
    ),
  ).toEqual([secondId]);
  expect(persisted.savedPlaces[0].importedEvidence[0].source).toEqual(
    secondPending.importedEvidence[0].source,
  );
  expect((await request.get(`/api/imports/${firstId}`)).status()).toBe(200);
});
