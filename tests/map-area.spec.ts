import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { catalogueFixture } from "./catalogue-fixture";

function mapFixture() {
  const batch = catalogueFixture();
  for (const [index, place] of batch.places.entries()) {
    Object.assign(place, {
      coordinates: {
        latitude: 31.23,
        longitude: index === 0 ? 121.47 : 121.4,
        system: "WGS-84",
        source: "Fictional map scenario",
        acquiredAt: "2026-10-12",
        purpose: "Development map behavior only",
        conversion: null,
      },
    });
  }
  return batch;
}

test("area requests intersect bounded coverage and filters without inventing coordinates", async ({
  request,
}) => {
  const fixture = mapFixture();
  writeFileSync(".data/catalogue-scenario.json", JSON.stringify(fixture));
  try {
    const response = await request.get(
      "/api/catalogue?north=31.25&south=31.21&east=121.49&west=121.45&areaSystem=WGS-84&category=cafe&budget=unknown",
    );
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.data.places.map((place: { id: string }) => place.id)).toEqual(
      ["fictional-cafe-east"],
    );
    expect(result.data.areaSearch).toMatchObject({
      outcome: "searched",
      searchedArea: {
        north: 31.25,
        south: 31.21,
        east: 121.49,
        west: 121.45,
        system: "WGS-84",
      },
    });
    expect(
      (
        await (
          await request.get(
            "/api/catalogue?north=31.25&south=31.21&east=121.49&west=121.45&areaSystem=WGS-84&category=food",
          )
        ).json()
      ).data.places,
    ).toEqual([]);
    const partial = await (
      await request.get(
        "/api/catalogue?north=32&south=31.21&east=121.49&west=121.45&areaSystem=WGS-84",
      )
    ).json();
    expect(partial.data.areaSearch.searchedArea.north).toBe(31.6);
    expect(partial.data.areaSearch.outcome).toBe("clipped");
    const outside = await (
      await request.get(
        "/api/catalogue?north=40&south=39&east=117&west=116&areaSystem=WGS-84",
      )
    ).json();
    expect(outside.data.places).toEqual([]);
    expect(outside.data.areaSearch.outcome).toBe("outside-coverage");
    expect(outside.data.coverageMessage).toContain(
      "outside the bounded Shanghai discovery envelope",
    );
    expect(
      (
        await (
          await request.get(
            "/api/catalogue?north=31.25&south=31.21&east=121.49&west=121.45&areaSystem=GCJ-02",
          )
        ).json()
      ).reason,
    ).toBe("coordinate-system-unsupported");
    Object.assign(fixture.places[0], { coordinates: null });
    Object.assign(fixture.places[1].coordinates ?? {}, { system: "GCJ-02" });
    writeFileSync(".data/catalogue-scenario.json", JSON.stringify(fixture));
    const unlocated = await (
      await request.get(
        "/api/catalogue?north=31.25&south=31.21&east=121.49&west=121.35&areaSystem=WGS-84",
      )
    ).json();
    expect(unlocated.data.places).toEqual([]);
    expect(unlocated.data.areaSearch.excludedCoordinateCount).toBe(2);
    expect(unlocated.data.coverageMessage).toContain(
      "missing or incompatible coordinates",
    );
    for (const query of [
      "north=31",
      "north=30&south=31&east=122&west=121&areaSystem=WGS-84",
      "north=NaN&south=31&east=122&west=121&areaSystem=WGS-84",
      "north=32&south=31&east=122&west=121&areaSystem=unqualified",
      "north=32&north=33&south=31&east=122&west=121&areaSystem=WGS-84",
    ]) {
      expect((await request.get(`/api/catalogue?${query}`)).status()).toBe(400);
    }
  } finally {
    writeFileSync(
      ".data/catalogue-scenario.json",
      JSON.stringify(catalogueFixture()),
    );
  }
});

test("fictional map and list share selection while explicit area search keeps active filters", async ({
  page,
}, testInfo) => {
  writeFileSync(".data/catalogue-scenario.json", JSON.stringify(mapFixture()));
  try {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/discover");
      await expect(
        page.getByText("Fictional map — development behavior only", {
          exact: true,
        }),
      ).toBeVisible();
      const first = page.getByRole("article").first();
      await first.getByRole("button", { name: "Select place" }).focus();
      await page.keyboard.press("Enter");
      await expect(first.locator("details")).toHaveAttribute("open", "");
      await expect(
        page.getByRole("button", {
          name: "Map place: Fictional Scenario Café, East branch",
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", {
          name: "Map place: Fictional Scenario Café, West branch",
        })
        .click();
      await expect(
        page.getByRole("article").last().locator("details"),
      ).toHaveAttribute("open", "");
      await expect(page.getByRole("article").last()).toContainText(
        "Fictional praise for the coffee",
      );
      await page.getByLabel("Category", { exact: true }).selectOption("cafe");
      await page.getByLabel("Budget", { exact: true }).selectOption("unknown");
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(page.getByRole("article")).toHaveCount(2);
      await page.getByRole("button", { name: "Zoom in" }).click();
      await expect(
        page.getByRole("button", { name: "Search this area", exact: true }),
      ).toBeEnabled();
      await expect(page.getByRole("article")).toHaveCount(2);
      await page.getByRole("button", { name: "Pan east" }).click();
      await page
        .getByRole("button", { name: "Search this area", exact: true })
        .click();
      await expect(page.getByRole("article")).toHaveCount(1);
      await expect(page.getByRole("article")).toContainText("East branch");
      await expect(
        page.getByText("Last completed area search:", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Map place:", exact: false }),
      ).toHaveCount(1);
      await page.getByRole("button", { name: "Show map", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Discovery map" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Show list", exact: true })
        .click();
      await expect(page.getByRole("article")).toHaveCount(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "Show both views" }).click();
      await page
        .getByRole("article")
        .first()
        .getByRole("button", { name: "Select place" })
        .click();
      await page.screenshot({
        path: testInfo.outputPath(`map-area-${width}.png`),
        fullPage: true,
      });
    }
  } finally {
    writeFileSync(
      ".data/catalogue-scenario.json",
      JSON.stringify(catalogueFixture()),
    );
  }
});

test("pending movement, reordered responses and reset cannot publish a stale area", async ({
  page,
}) => {
  writeFileSync(".data/catalogue-scenario.json", JSON.stringify(mapFixture()));
  try {
    await page.goto("/discover");
    const held: { complete: () => Promise<void>; west: string | null }[] = [];
    await page.route("**/api/catalogue?*", async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has("north")) return route.continue();
      const response = await route.fetch();
      await new Promise<void>((resolve) => {
        held.push({
          west: url.searchParams.get("west"),
          complete: async () => {
            await route.fulfill({ response });
            resolve();
          },
        });
      });
    });
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Pan east" }).click();
    await page
      .getByRole("button", { name: "Search this area", exact: true })
      .click();
    await expect.poll(() => held.length).toBe(1);
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Map place:", exact: false }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Pan west" }).click();
    await held[0].complete();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText("East branch");
    await expect(
      page.getByRole("button", { name: "Search this area", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText("Last completed area search:", { exact: false }),
    ).toContainText("west 121.4350");
    await page.getByRole("button", { name: "Pan west" }).click();
    await page
      .getByRole("button", { name: "Search this area", exact: true })
      .click();
    await expect.poll(() => held.length).toBe(2);
    await page.getByRole("button", { name: "Pan east" }).click();
    await page.getByRole("button", { name: "Pan east" }).click();
    await page
      .getByRole("button", { name: "Search this area", exact: true })
      .click();
    await expect.poll(() => held.length).toBe(3);
    await held[2].complete();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText("East branch");
    await held[1].complete();
    await expect(page.getByRole("article")).toContainText("East branch");
    await expect(
      page.getByText("Last completed area search:", { exact: false }),
    ).toContainText("west 121.4350");
    await page.getByRole("button", { name: "Pan west" }).click();
    await page
      .getByRole("button", { name: "Search this area", exact: true })
      .click();
    await expect.poll(() => held.length).toBe(4);
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(2);
    await held[3].complete();
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(
      page.getByText("Last completed area search:", { exact: false }),
    ).toHaveCount(0);
  } finally {
    writeFileSync(
      ".data/catalogue-scenario.json",
      JSON.stringify(catalogueFixture()),
    );
  }
});

test("map failure preserves selected details and clipped or outside searches complete explicitly", async ({
  page,
}) => {
  writeFileSync(".data/catalogue-scenario.json", JSON.stringify(mapFixture()));
  try {
    await page.goto("/discover");
    await page
      .getByRole("article")
      .first()
      .getByRole("button", { name: "Select place" })
      .click();
    await page.getByRole("button", { name: "Simulate map failure" }).click();
    await expect(
      page.getByRole("heading", { name: "Map unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(
      page.getByRole("article").first().locator("details"),
    ).toHaveAttribute("open", "");
    await expect(page.getByRole("article").first()).toContainText(
      "A second fictional recommendation",
    );
    await page.getByRole("button", { name: "Retry development map" }).click();
    for (let count = 0; count < 5; count++)
      await page.getByRole("button", { name: "Zoom out" }).click();
    await page
      .getByRole("button", { name: "Search this area", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Fictional test catalogue" }),
    ).toContainText("Only the intersection");
    await expect(
      page.getByRole("button", { name: "Search this area", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Return to initial area" }).click();
    for (let count = 0; count < 11; count++)
      await page.getByRole("button", { name: "Pan north" }).click();
    await page
      .getByRole("button", { name: "Search this area", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Fictional test catalogue" }),
    ).toContainText("outside the bounded Shanghai discovery envelope");
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Search this area", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Last completed area search:", { exact: false }),
    ).toBeVisible();
  } finally {
    writeFileSync(
      ".data/catalogue-scenario.json",
      JSON.stringify(catalogueFixture()),
    );
  }
});

test("development map fixtures stop when the current publication becomes real", async ({
  page,
}) => {
  writeFileSync(".data/catalogue-scenario.json", JSON.stringify(mapFixture()));
  try {
    await page.goto("/discover");
    await expect(
      page.getByText("Fictional map — development behavior only", {
        exact: true,
      }),
    ).toBeVisible();
    writeFileSync(
      ".data/catalogue-scenario.json",
      readFileSync("data/catalogue/shanghai.json"),
    );
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(6);
    await expect(
      page.getByRole("heading", { name: "Map unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByText("Fictional map — development behavior only", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Map place:", exact: false }),
    ).toHaveCount(0);
  } finally {
    writeFileSync(
      ".data/catalogue-scenario.json",
      JSON.stringify(catalogueFixture()),
    );
  }
});
