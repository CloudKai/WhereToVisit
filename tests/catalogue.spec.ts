import { unlinkSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { catalogueFixture } from "./catalogue-fixture";

test("anonymous visitor sees distinct branches and dated sourced recommendations with unknown facts", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get("/api/catalogue");
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.data.places.map((place: { id: string }) => place.id)).toEqual([
    "fictional-cafe-east",
    "fictional-cafe-west",
  ]);
  expect(result.data.places[0]).toMatchObject({
    price: null,
    hours: null,
    rating: null,
    classifications: [],
    coordinates: null,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /organiserUserId|invitationGeneration|savedPlaces/,
  );
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/discover");
    await expect(
      page.getByText("Fictional test catalogue.", { exact: false }),
    ).toBeVisible();
    const firstBranch = page.getByRole("article").first();
    await expect(firstBranch).toContainText("East branch");
    await firstBranch
      .getByText("Sources and place details", { exact: true })
      .click();
    await expect(firstBranch).toContainText(
      "A second fictional recommendation",
    );
    await expect(firstBranch).toContainText("Fictional scenario author");
    await expect(firstBranch).toContainText("2026-10-12");
    await expect(firstBranch).toContainText("Price unknown");
    await expect(firstBranch).toContainText("Hours unknown");
    await expect(firstBranch).toContainText("Rating unknown");
    await expect(firstBranch).toContainText("Unclassified");
    await expect(
      firstBranch.getByRole("link", { name: "Search address on Scenario map" }),
    ).toHaveAttribute("href", "https://example.invalid/map-search");
    await expect(page.getByRole("article")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`catalogue-${width}.png`),
      fullPage: true,
    });
  }
});

test("invalid source batches cannot replace the last valid public catalogue", async ({
  request,
}) => {
  const original = await (await request.get("/api/catalogue")).json();
  const path = ".data/catalogue-scenario.json";
  const duplicateIdentity = catalogueFixture();
  duplicateIdentity.places[1] = {
    ...duplicateIdentity.places[0],
    id: "duplicate-internal-id",
  };
  const duplicateId = catalogueFixture();
  duplicateId.places[1].id = duplicateId.places[0].id;
  const unsupportedPlaceCity = catalogueFixture();
  unsupportedPlaceCity.places[1].city = "London";
  const unsupportedCity = { ...catalogueFixture(), city: "London" };
  const malformed = {
    ...catalogueFixture(),
    places: [{ id: "incomplete-record" }],
  };
  const privateData = {
    ...catalogueFixture(),
    organiserUserId: "private-owner",
  };
  for (const invalid of [
    duplicateIdentity,
    duplicateId,
    unsupportedPlaceCity,
    unsupportedCity,
    malformed,
    privateData,
  ]) {
    try {
      writeFileSync(path, JSON.stringify(invalid));
      const rejected = await request.get("/api/catalogue");
      expect(rejected.status()).toBe(503);
      expect(await rejected.json()).toMatchObject({
        status: "error",
        reason: "catalogue-invalid",
      });
      unlinkSync(path);
      const retained = await request.get("/api/catalogue");
      expect(retained.status()).toBe(200);
      expect(await retained.json()).toEqual(original);
    } finally {
      writeFileSync(path, JSON.stringify(catalogueFixture()));
    }
  }
  expect((await request.get("/api/catalogue?category=cafe")).status()).toBe(
    200,
  );
  expect(
    await (await request.get("/api/catalogue?city=London")).json(),
  ).toMatchObject({ status: "unavailable", reason: "city-not-supported" });
});

test("evidenced optional facts and classifications show their sources while unsupported claims are rejected", async ({
  page,
  request,
}) => {
  const path = ".data/catalogue-scenario.json";
  const supported = catalogueFixture();
  const first = supported.places[0];
  first.evidence[0].establishedFacts.push(
    "price",
    "hours",
    "rating",
    "classification",
  );
  Object.assign(first, {
    price: {
      amount: 25,
      currency: "CNY",
      sourceEvidenceId: "fictional-cafe-east-source",
    },
    hours: {
      description: "Fictional hours 10:00–18:00",
      sourceEvidenceId: "fictional-cafe-east-source",
    },
    rating: {
      provider: "Fictional ratings",
      value: 4,
      scale: 5,
      count: null,
      observedAt: "2026-10-12T00:00:00Z",
      sourceEvidenceId: "fictional-cafe-east-source",
    },
    classifications: [
      {
        type: "local-favourite",
        reason: "Fictional recurring neighbourhood recommendation",
        rule: "Scenario rule with explicit source evidence",
        ruleDate: "2026-10-12T00:00:00Z",
        sourceEvidenceIds: ["fictional-cafe-east-source"],
      },
    ],
  });
  try {
    writeFileSync(path, JSON.stringify(supported));
    await page.goto("/discover");
    const branch = page.getByRole("article").first();
    await branch
      .getByText("Sources and place details", { exact: true })
      .click();
    await expect(branch).toContainText("CNY 25");
    await expect(branch).toContainText("Fictional hours 10:00–18:00");
    await expect(branch).toContainText("Fictional ratings: 4/5");
    await expect(branch).toContainText(
      "Scenario rule with explicit source evidence",
    );
    await expect(branch).toContainText(
      "Hours source: Fictional scenario author, 2026-10-12",
    );
    await expect(branch).toContainText("Rating observed: 2026-10-12");
    const unsupported = catalogueFixture();
    Object.assign(unsupported.places[0], {
      classifications: [
        {
          type: "trending",
          reason: "Guess",
          rule: "",
          ruleDate: "2026-10-12T00:00:00Z",
          sourceEvidenceIds: [],
        },
      ],
    });
    writeFileSync(path, JSON.stringify(unsupported));
    expect(await (await request.get("/api/catalogue")).json()).toMatchObject({
      status: "error",
      reason: "catalogue-invalid",
    });
    Object.assign(unsupported.places[0], {
      classifications: [],
      hours: {
        description: "Made-up hours",
        sourceEvidenceId: "missing-source",
      },
    });
    writeFileSync(path, JSON.stringify(unsupported));
    expect(await (await request.get("/api/catalogue")).json()).toMatchObject({
      status: "error",
      reason: "catalogue-invalid",
    });
  } finally {
    writeFileSync(path, JSON.stringify(catalogueFixture()));
  }
});
