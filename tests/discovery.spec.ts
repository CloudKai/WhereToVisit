import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { catalogueFixture } from "./catalogue-fixture";

function discoveryFixture() {
  const batch = catalogueFixture();
  const first = batch.places[0];
  first.evidence[0].establishedFacts.push("price", "classification");
  Object.assign(first, {
    price: {
      amount: 25,
      currency: "CNY",
      sourceEvidenceId: first.evidence[0].id,
    },
    coordinates: {
      latitude: 31.23,
      longitude: 121.47,
      system: "WGS-84",
      source: "Fictional scenario",
      acquiredAt: "2026-10-12",
      purpose: "Fictional distance testing",
      conversion: null,
    },
    classifications: [
      {
        type: "local-favourite",
        reason: "Fictional neighbourhood praise",
        rule: "Scenario evidence rule",
        ruleDate: "2026-10-12",
        sourceEvidenceIds: [first.evidence[0].id],
      },
    ],
  });
  return batch;
}

test("combined discovery filters use evidence, explicit origins and unknown choices", async ({
  request,
}) => {
  writeFileSync(
    ".data/catalogue-scenario.json",
    JSON.stringify(discoveryFixture()),
  );
  try {
    const response = await request.get(
      "/api/catalogue?city=Shanghai&category=cafe&budget=low&neighbourhood=Fictional%20neighbourhood&recommendationType=local-favourite&latitude=31.23&longitude=121.47&system=WGS-84&radiusMetres=1000",
    );
    expect(response.status()).toBe(200);
    expect(
      (await response.json()).data.places.map(
        (place: { id: string }) => place.id,
      ),
    ).toEqual(["fictional-cafe-east"]);
    for (const query of [
      "latitude=31.24&longitude=121.47&system=WGS-84&radiusMetres=1000",
      "latitude=31.23&longitude=121.47&system=GCJ-02&radiusMetres=1000",
      "recommendationType=trending",
      "recommendationType=highly-reviewed",
      "neighbourhood=Other%20area",
    ]) {
      expect(
        (await (await request.get(`/api/catalogue?${query}`)).json()).data
          .places,
      ).toEqual([]);
    }
    const unknown = await request.get(
      "/api/catalogue?budget=unknown&recommendationType=unclassified&distance=unknown",
    );
    expect(
      (await unknown.json()).data.places.map(
        (place: { id: string }) => place.id,
      ),
    ).toEqual(["fictional-cafe-west"]);
    expect(
      (await request.get("/api/catalogue?budget=low&category=food")).status(),
    ).toBe(200);
    expect(
      (
        await (
          await request.get("/api/catalogue?budget=low&category=food")
        ).json()
      ).data.places,
    ).toEqual([]);
    for (const [amount, band] of [
      [50, "low"],
      [50.01, "mid"],
      [150, "mid"],
      [150.01, "high"],
    ] as const) {
      const fixture = discoveryFixture();
      Object.assign(fixture.places[0], {
        price: {
          amount,
          currency: "CNY",
          sourceEvidenceId: fixture.places[0].evidence[0].id,
        },
      });
      writeFileSync(".data/catalogue-scenario.json", JSON.stringify(fixture));
      expect(
        (
          await (await request.get(`/api/catalogue?budget=${band}`)).json()
        ).data.places.map((place: { id: string }) => place.id),
      ).toEqual(["fictional-cafe-east"]);
    }
    for (const query of [
      "radiusMetres=1000",
      "category=invalid",
      "latitude=NaN&longitude=121&system=WGS-84&radiusMetres=1000",
      "category=cafe&category=food",
      "unknown=true",
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

test("visitor combines filters, opens attributed details and recovers on phone and desktop", async ({
  page,
}, testInfo) => {
  writeFileSync(
    ".data/catalogue-scenario.json",
    JSON.stringify(discoveryFixture()),
  );
  try {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/discover");
      await page.getByRole("button", { name: "Change filters" }).click();
      await page.getByLabel("Category", { exact: true }).selectOption("cafe");
      await page.getByLabel("Budget", { exact: true }).selectOption("low");
      await page
        .getByLabel("Neighbourhood", { exact: true })
        .selectOption("Fictional neighbourhood");
      await page
        .getByLabel("Recommendation type", { exact: true })
        .selectOption("local-favourite");
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(page.getByRole("article")).toHaveCount(1);
      await expect(page.getByRole("article")).toContainText("East branch");
      const details = page.getByText("Sources and place details", {
        exact: true,
      });
      await details.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("article")).toContainText(
        "A second fictional recommendation",
      );
      await expect(
        page.getByRole("link", { name: "Search address on Scenario map" }),
      ).toHaveAttribute("href", "https://example.invalid/map-search");
      await expect(page.getByRole("article")).toContainText(
        "Full reviews and exact navigation are not qualified",
      );
      await page.getByLabel("Category", { exact: true }).selectOption("food");
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(
        page.getByRole("heading", { name: "No matching places" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Reset filters", exact: true })
        .click();
      await expect(page.getByRole("article")).toHaveCount(2);
      await page.getByLabel("Budget", { exact: true }).selectOption("unknown");
      await page
        .getByLabel("Recommendation type", { exact: true })
        .selectOption("unclassified");
      await page
        .getByLabel("Distance", { exact: true })
        .selectOption("unknown");
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(page.getByRole("article")).toHaveCount(1);
      await expect(page.getByRole("article")).toContainText("West branch");
      await page
        .getByRole("button", { name: "Reset filters", exact: true })
        .click();
      await expect(page.getByRole("article")).toHaveCount(2);
      await page.getByLabel("Distance", { exact: true }).selectOption("within");
      await page.getByLabel("Origin latitude", { exact: true }).fill("31.23");
      await page.getByLabel("Origin longitude", { exact: true }).fill("121.47");
      await page.getByRole("button", { name: "Apply filters" }).focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText("Distance origin: 31.23, 121.47 (WGS-84)", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(page.getByRole("article")).toHaveCount(1);
      await expect(page.getByRole("article")).toContainText("East branch");
      await page
        .getByRole("button", { name: "Reset filters", exact: true })
        .click();
      await expect(page.getByRole("article")).toHaveCount(2);
      await page.getByLabel("City", { exact: true }).fill("London");
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(
        page.getByText("The initial catalogue covers Shanghai only.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("article")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Reset filters", exact: true })
        .click();
      await expect(page.getByRole("article")).toHaveCount(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`discovery-${width}.png`),
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

test("failed catalogue requests hide stale places and retry the current filters", async ({
  page,
}) => {
  const path = ".data/catalogue-scenario.json";
  writeFileSync(path, JSON.stringify(discoveryFixture()));
  try {
    await page.goto("/discover");
    await page.getByRole("button", { name: "Change filters" }).click();
    await expect(page.getByRole("article")).toHaveCount(2);
    writeFileSync(path, JSON.stringify({ invalid: "publication" }));
    await page.getByLabel("Budget", { exact: true }).selectOption("low");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(
      page.getByRole("alert").filter({
        has: page.getByRole("heading", {
          name: "Places could not be loaded",
        }),
      }),
    ).toContainText("No new records were published");
    await expect(page.getByRole("article")).toHaveCount(0);
    writeFileSync(path, JSON.stringify(discoveryFixture()));
    await page.getByRole("button", { name: "Retry catalogue" }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText("East branch");
    await page.route("**/api/catalogue?*", (route) => route.abort());
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(
      page.getByRole("alert").filter({
        has: page.getByRole("heading", {
          name: "Places could not be loaded",
        }),
      }),
    ).toContainText("Please try again");
    await expect(page.getByRole("article")).toHaveCount(0);
    await page.unroute("**/api/catalogue?*");
    await page.getByRole("button", { name: "Retry catalogue" }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
  } finally {
    writeFileSync(path, JSON.stringify(catalogueFixture()));
  }
});
