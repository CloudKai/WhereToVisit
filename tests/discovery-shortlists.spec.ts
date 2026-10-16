import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { catalogueFixture } from "./catalogue-fixture";

const capture = process.env.WHERETOVISIT_CAPTURE_PATH;
function fixture() {
  const batch = catalogueFixture();
  const template = batch.places[0];
  batch.coverageMessage =
    "Fictional twelve-candidate catalogue; not real venue coverage.";
  batch.places = Array.from({ length: 12 }, (_, index) =>
    Object.assign(structuredClone(template), {
      id: `fictional-shortlist-${index}`,
      displayName: `Fictional candidate ${index}`,
      branch: `Branch ${index}`,
      address: `${index + 1} Fictional shortlist Road, Shanghai`,
      evidence: template.evidence.map((item, sourceIndex) => ({
        ...item,
        id: `shortlist-${index}-source-${sourceIndex}`,
      })),
      category: index % 2 ? "food" : "cafe",
      neighbourhood: index >= 6 ? "Later neighbourhood" : "Early neighbourhood",
      coordinates: {
        latitude: 31.23,
        longitude: 121.47,
        system: "WGS-84",
        source: "Fictional scenario",
        acquiredAt: "2026-10-12",
        purpose: "Fictional map",
        conversion: null,
      },
    }),
  );
  return batch;
}

test("reviewed cap follows server filters per category, preserves order and map identity", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.WHERETOVISIT_SHORTLIST_FIXTURE !== "1",
    "Opted-in fictional runtime only",
  );
  writeFileSync(".data/catalogue-scenario.json", JSON.stringify(fixture()));
  try {
    const api = await (await request.get("/api/catalogue")).json();
    expect(api.status).toBe("available");
    expect(api.data.places).toHaveLength(12);
    await page.goto("/discover");
    await expect(page.getByRole("article")).toHaveCount(12);
    await page.getByLabel("Places per category").selectOption("1");
    await expect(page.getByRole("article").getByRole("heading")).toHaveText([
      "Fictional candidate 0",
      "Fictional candidate 1",
    ]);
    await expect(page.getByRole("button", { name: /^Map place:/ })).toHaveCount(
      2,
    );
    await page
      .getByRole("button", { name: "Surprise me", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    const chosen = page.locator('article[data-selected="true"]');
    await expect(chosen).toHaveCount(1);
    await expect(chosen.locator("details")).toHaveAttribute("open", "");
    await expect(page.locator('.map-place[aria-pressed="true"]')).toHaveCount(
      1,
    );
    if (capture)
      await page
        .getByRole("group", { name: "Fictional coordinate diagram" })
        .screenshot({ path: `${capture}/fixture-capped-map.png` });
    await page.getByLabel("Places per category").selectOption("3");
    await expect(chosen).toHaveCount(0);
    await expect(page.getByRole("article").getByRole("heading")).toHaveText(
      [0, 1, 2, 3, 4, 5].map((id) => `Fictional candidate ${id}`),
    );
    await page.getByLabel("Places per category").selectOption("5");
    await expect(page.getByRole("article")).toHaveCount(10);
    await page.getByLabel("Places per category").selectOption("1");
    await page.getByRole("button", { name: "Change filters" }).click();
    await page
      .getByLabel("Neighbourhood", { exact: true })
      .selectOption("Later neighbourhood");
    await expect(
      page.getByRole("button", { name: "Surprise me", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(page.getByRole("article").getByRole("heading")).toHaveText([
      "Fictional candidate 6",
      "Fictional candidate 7",
    ]);
    await expect(page.locator(".shortlist-count")).toContainText(
      "2 shown / 6 available",
    );
    await page
      .getByRole("button", { name: "Surprise me", exact: true })
      .click();
    await page.getByRole("button", { name: "Pan north", exact: true }).click();
    await expect(chosen).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Surprise me", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("article")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Search this area", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "No matching places" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Surprise me", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(12);
    await expect(page.getByLabel("Places per category")).toHaveValue("10");
  } finally {
    writeFileSync(
      ".data/catalogue-scenario.json",
      JSON.stringify(catalogueFixture()),
    );
  }
});

test("suggestions stay current through dirty, loading, superseded, failed and one-result requests", async ({
  page,
}) => {
  await page.goto("/discover");
  const surprise = page.getByRole("button", {
    name: "Surprise me",
    exact: true,
  });
  const selected = page.locator('article[data-selected="true"]');
  await surprise.click();
  await expect(selected).toHaveCount(1);
  await page.getByRole("button", { name: "Change filters" }).click();
  await page.getByLabel("Category", { exact: true }).selectOption("cafe");
  await expect(selected).toHaveCount(0);
  await expect(surprise).toBeDisabled();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/catalogue?**",
    async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(surprise).toBeDisabled();
  await expect(page.locator(".shortlist-count")).toHaveText(
    "Loading matching places…",
  );
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(surprise).toBeEnabled();
  const staleResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/catalogue?") &&
      new URL(response.url()).searchParams.get("category") === "cafe",
  );
  release?.();
  await staleResponse;
  await expect(page.locator(".discovery-summary")).toContainText(
    "Food & cafés",
  );
  await expect(selected).toHaveCount(0);
  await page.unroute("**/api/catalogue?**");
  await page.route("**/api/catalogue?**", (route) => route.abort());
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Places could not be loaded" }),
  ).toBeVisible();
  await expect(surprise).toBeDisabled();
  await page.unroute("**/api/catalogue?**");
  await page
    .getByRole("button", { name: "Retry catalogue", exact: true })
    .click();
  await expect(surprise).toBeEnabled();
  await page.route("**/api/catalogue?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.places = body.data.places.slice(0, 1);
    await route.fulfill({ response, json: body });
  });
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await surprise.click();
  await expect(selected).toHaveCount(1);
  await surprise.click();
  await expect(selected).toHaveCount(1);
});

test("production default keeps six branches, phone actions and explicit reviewed Save", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.WHERETOVISIT_SHORTLIST_FIXTURE === "1",
    "Real publication only",
  );
  const canonical = await (await page.request.get("/api/catalogue")).json();
  expect(canonical.data.dataKind).toBe("real");
  expect(canonical.data.places).toHaveLength(6);
  const headers = { Origin: baseURL as string };
  await page.request.post("/api/auth/sign-up/email", {
    headers,
    data: {
      name: "Shortlist organiser",
      email: `shortlist-${randomBytes(6).toString("hex")}@example.invalid`,
      password: "Shortlist-test-password-123",
    },
  });
  const created = await page.request.post("/api/trips", {
    headers,
    data: { title: "Shortlist inspection", city: "Shanghai" },
  });
  expect(created.status()).toBe(201);
  const trip = (await created.json()).trip;
  for (const [width, height] of [
    [375, 812],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/discover");
    await expect(page.getByRole("article")).toHaveCount(6);
    const action = page
      .getByRole("article")
      .first()
      .getByRole("link", { name: /^Review Save/ });
    const bounds = await action.boundingBox();
    if (!bounds) throw new Error("Save action must be visible");
    expect(bounds.y + bounds.height).toBeLessThan(height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (capture) {
      mkdirSync(capture, { recursive: true });
      await page.screenshot({ path: `${capture}/discover-${width}.png` });
    }
  }
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") mutations.push(request.url());
  });
  await page.getByRole("button", { name: "Surprise me", exact: true }).click();
  await expect(page.locator('article[data-selected="true"]')).toHaveCount(1);
  expect(mutations).toEqual([]);
  const before = (
    await (await page.request.get(`/api/trips/${trip.id}`)).json()
  ).trip;
  expect(before.savedPlaces).toEqual([]);
  expect(before.selectedPlaceIds).toEqual([]);
  const chosen = page.locator('article[data-selected="true"]');
  const href = await chosen
    .getByRole("link", { name: /^Review Save/ })
    .getAttribute("href");
  if (!href) throw new Error("Reviewed Save needs a canonical target");
  const target = new URL(href, baseURL);
  const id = target.searchParams.get("placeId");
  await chosen.getByRole("link", { name: /^Review Save/ }).click();
  await expect(
    page.getByRole("region", { name: "Pending save" }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
      .savedPlaces,
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Save reviewed branch", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).toBeVisible();
  expect(
    (
      await (await page.request.get(`/api/trips/${trip.id}`)).json()
    ).trip.savedPlaces.map((place: { placeId: string }) => place.placeId),
  ).toEqual([id]);
  expect(
    (await (await page.request.get("/api/catalogue?budget=low")).json()).data
      .places,
  ).toEqual([]);
});
