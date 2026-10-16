import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
const captures = process.env.WHERETOVISIT_CAPTURE_PATH;
test("supported import puts input first, discloses retention and recovers a draft-list failure", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("**/api/imports", async (route) => {
    if (route.request().method() === "GET" && unavailable)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            message: "Drafts temporarily unavailable. Refresh to retry.",
          },
        },
      });
    await route.continue();
  });
  await page.goto("/import", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "temporarily unavailable" }),
  ).toContainText("Drafts temporarily unavailable");
  if (captures)
    await page.screenshot({
      path: join(captures, "import-list-error.png"),
      fullPage: true,
    });
  unavailable = false;
  await page
    .getByRole("button", { name: "Reload drafts", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Import article", exact: true }),
  ).toBeEnabled();
  const positions = [];
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const button = await page
      .getByRole("button", { name: "Import article", exact: true })
      .boundingBox();
    const disclosure = await page
      .getByText("Supported sources, privacy and retention", { exact: true })
      .boundingBox();
    expect(
      button && disclosure && button.y + button.height < disclosure.y,
    ).toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    positions.push({ width, button, disclosure });
    if (captures)
      await page.screenshot({
        path: join(captures, `import-input-${width}.png`),
        fullPage: true,
      });
  }
  const summary = page.getByText("Supported sources, privacy and retention", {
    exact: true,
  });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(/Social links, videos, other blogs/),
  ).toBeVisible();
  await expect(
    page.getByText(/Source text is deleted immediately/),
  ).toBeVisible();
  expect(
    await summary.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  if (captures) {
    await page.screenshot({
      path: join(captures, "import-keyboard-disclosure.png"),
      fullPage: true,
    });
    writeFileSync(
      join(captures, "input-positions.json"),
      JSON.stringify(positions, null, 2),
    );
  }
});

test("idle and hidden progress requests stop while completion survives explicit refresh and return", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/imports" &&
      request.method() === "GET"
    )
      requests++;
  });
  await page.goto("/import", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: "Import article", exact: true }),
  ).toBeEnabled();
  const idleStart = requests;
  await page.waitForTimeout(6000);
  const idleRequests = requests - idleStart;
  expect(idleRequests).toBe(0);
  await page
    .getByLabel("Supported article URL")
    .fill("https://en.wikivoyage.org/wiki/Fixture_Slow");
  await page
    .getByRole("button", { name: "Import article", exact: true })
    .click();
  await expect(page.getByRole("article").getByRole("status")).toContainText(
    /Queued|Processing/,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenStart = requests;
  await page.waitForTimeout(6000);
  const hiddenRequests = requests - hiddenStart;
  expect(hiddenRequests).toBe(0);
  await page
    .getByRole("button", { name: "Refresh drafts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Café 🥟 One", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByText("Drafts are up to date. Refresh to check for changes."),
  ).toBeVisible();
  await page.waitForTimeout(300);
  const completeStart = requests;
  await page.waitForTimeout(6000);
  expect(requests - completeStart).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: "Café 🥟 One", exact: true }),
  ).toBeVisible();
  if (captures)
    writeFileSync(
      join(captures, "current-progress.json"),
      JSON.stringify(
        {
          windowMs: 6000,
          idleRequests,
          simulatedHiddenActiveRequests: hiddenRequests,
          completedIdleRequests: 0,
          visibilityMethod:
            "Browser document visibilityState override and visibilitychange event; actual OS tab concealment unrun",
        },
        null,
        2,
      ),
    );
});

test("partial import keeps exact no-match evidence and exposes a specific branch choice before Save", async ({
  page,
}) => {
  await page.goto("/import", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await page
    .getByLabel("Supported article URL")
    .fill("https://en.wikivoyage.org/wiki/Fixture_Resolution");
  await page
    .getByRole("button", { name: "Import article", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fictional Scenario Café", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Find candidate branches", exact: true })
    .click();
  await expect(
    page.getByText(/No-match covers only our six canonical catalogue branches/),
  ).toBeVisible();
  await expect(
    page.getByText("1 Fictional East Road, Shanghai", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2 Fictional West Road, Shanghai", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/imports")).json()).resolvedPlaces,
  ).toHaveLength(0);
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (captures)
      await page.screenshot({
        path: join(captures, `import-candidates-${width}.png`),
        fullPage: true,
      });
  }
  await page
    .getByRole("button", { name: "Confirm West branch", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("User-confirmed branch", { exact: true }),
  ).toBeVisible();
  const list = await (await page.request.get("/api/imports")).json();
  expect(list.resolvedPlaces[0].place.id).toBe("fictional-cafe-west");
  expect(
    list.resolvedPlaces[0].importedEvidence[0].confirmation
      .independentVerification,
  ).toBe(false);
  expect(list.jobs[0].mentions[1].placeId).toBeNull();
  expect(list.jobs[0].mentions[1].extraction.quote).toBe(
    "Unknown Fictional Dumplings",
  );
  await page
    .getByRole("link", { name: "Save confirmed branch to a Trip", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to save" }),
  ).toBeVisible();
  expect((await page.request.get("/api/trips")).status()).toBe(401);
  const pendingId = new URL(page.url()).searchParams.get("intentId");
  const email = `import-${randomBytes(8).toString("hex")}@example.invalid`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          email,
          password: "Import-journey-password-123",
          name: "Import organiser",
        },
      })
    ).status(),
  ).toBe(200);
  const destination = await page.request.post("/api/trips", {
    headers,
    data: { title: "Imported branch review", city: "Shanghai" },
  });
  expect(destination.status()).toBe(201);
  const trip = (await destination.json()).trip;
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
  const review = page.getByRole("region", { name: "Pending save" });
  await expect(review).toContainText(`Account: ${email}`);
  await expect(review).toContainText(
    "Destination: Imported branch review · Shanghai",
  );
  await expect(review).toContainText("West branch");
  expect(new URL(page.url()).searchParams.get("intentId")).toBe(pendingId);
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
      .savedPlaces,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Save reviewed branch", exact: true })
    .click();
  const saved = (await (await page.request.get(`/api/trips/${trip.id}`)).json())
    .trip;
  expect(saved.savedPlaces).toHaveLength(1);
  expect(saved.savedPlaces[0].importedEvidence[0].extraction.quote).toBe(
    "Fictional Scenario Café",
  );
  expect(
    saved.savedPlaces[0].importedEvidence[0].confirmation
      .independentVerification,
  ).toBe(false);
  const sourceId = list.jobs[0].id;
  const configuration = JSON.parse(
    readFileSync(
      process.env.WHERETOVISIT_TEST_STORAGE_CONFIG ??
        ".data/trip-storage-test.json",
      "utf8",
    ),
  );
  const storage = new Database(configuration.databasePath);
  try {
    storage
      .prepare(
        "UPDATE import_jobs SET expires_at=?, document=json_set(document, '$.expiresAt', ?) WHERE id=?",
      )
      .run(
        Date.now() + 3500,
        new Date(Date.now() + 3500).toISOString(),
        sourceId,
      );
  } finally {
    storage.close();
  }
  await page.goto("/import", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await expect(
    page.getByText("User-confirmed branch", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/An expired temporary import was removed/),
  ).toBeVisible();
  expect((await page.request.get(`/api/imports/${sourceId}`)).status()).toBe(
    404,
  );
  const afterExpiry = (
    await (await page.request.get(`/api/trips/${trip.id}`)).json()
  ).trip;
  expect(afterExpiry.savedPlaces).toEqual(saved.savedPlaces);
  if (captures)
    await page.screenshot({
      path: join(captures, "import-expiry.png"),
      fullPage: true,
    });
});

test("a failed progress refresh pauses polling and explicit refresh recovers the same completed job", async ({
  page,
}) => {
  let failProgress = false;
  let failedRequests = 0;
  await page.route("**/api/imports", async (route) => {
    if (route.request().method() === "GET" && failProgress) {
      failedRequests++;
      return route.fulfill({
        status: 503,
        json: { error: { message: "Progress temporarily unavailable." } },
      });
    }
    await route.continue();
  });
  await page.goto("/import", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await page
    .getByLabel("Supported article URL")
    .fill("https://en.wikivoyage.org/wiki/Fixture_Slow");
  await page
    .getByRole("button", { name: "Import article", exact: true })
    .click();
  await expect(page.getByRole("article").getByRole("status")).toContainText(
    /Queued|Processing/,
  );
  failProgress = true;
  await expect(
    page.getByRole("alert").filter({ hasText: "temporarily unavailable" }),
  ).toContainText("Progress temporarily unavailable");
  const paused = failedRequests;
  await page.waitForTimeout(3500);
  expect(failedRequests).toBe(paused);
  failProgress = false;
  await page
    .getByRole("button", { name: "Refresh drafts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Café 🥟 One", exact: true }),
  ).toBeVisible();
  const jobs = (await (await page.request.get("/api/imports")).json()).jobs;
  expect(jobs).toHaveLength(1);
  expect(jobs[0].attempt).toBe(1);
  if (captures)
    await page.screenshot({
      path: join(captures, "import-progress-recovered.png"),
      fullPage: true,
    });
});

test("active visible work completes through bounded progress polling then becomes idle", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/imports" &&
      request.method() === "GET"
    )
      requests++;
  });
  await page.goto("/import", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await page
    .getByLabel("Supported article URL")
    .fill("https://en.wikivoyage.org/wiki/Fixture_Slow");
  await page
    .getByRole("button", { name: "Import article", exact: true })
    .click();
  await expect(page.getByRole("article").getByRole("status")).toContainText(
    /Queued|Processing/,
  );
  const activeStart = requests;
  await expect(
    page.getByRole("heading", { name: "Café 🥟 One", exact: true }),
  ).toBeVisible();
  const activeRequests = requests - activeStart;
  expect(activeRequests).toBeGreaterThan(0);
  expect(activeRequests).toBeLessThanOrEqual(3);
  const completeStart = requests;
  await page.waitForTimeout(6000);
  expect(requests - completeStart).toBe(0);
  if (captures)
    writeFileSync(
      join(captures, "active-progress.json"),
      JSON.stringify(
        {
          activeRequests,
          completedIdleRequests: requests - completeStart,
          idleWindowMs: 6000,
        },
        null,
        2,
      ),
    );
});
