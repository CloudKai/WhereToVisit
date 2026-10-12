import { expect, test } from "@playwright/test";

test("visitor can navigate discovery, import and trips", async ({
  page,
}, testInfo) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.screenshot({
      path: testInfo.outputPath(`home-${width}.png`),
      fullPage: true,
    });
    const navigation = page.getByRole("navigation", { name: "Primary" });
    for (const [name, path, heading] of [
      ["Discover", "/discover", "Discover Shanghai"],
      ["Import", "/import", "Bring your inspiration"],
      ["Trips", "/trips", "Your Trips"],
    ]) {
      const link = navigation.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("visitor sees the bounded source-backed shortlist on phone and desktop", async ({
  page,
}, testInfo) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/discover");
    await expect(
      page.getByRole("region", { name: "Discovery list" }).getByRole("status"),
    ).toContainText("Six source-backed Shanghai food and café branches");
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
    const first = page.getByRole("article").first();
    await first.getByText("Sources and place details", { exact: true }).click();
    await expect(
      first.getByRole("link", { name: "Search address on Apple Maps" }),
    ).toHaveAttribute("href", /https:\/\/maps\.apple\.com\/.*q=/);
    await expect(first).toContainText("Hours unknown");
    await page.screenshot({
      path: testInfo.outputPath(`discover-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  }
});

test("public catalogue exposes six real branches without substituting development scenarios", async ({
  request,
}) => {
  const response = await request.get("/api/catalogue");
  expect(response.status()).toBe(200);
  expect(response.headers().server).toMatch(/^nginx/);
  expect(await response.json()).toMatchObject({
    status: "available",
    data: { dataKind: "real" },
  });
  const result = await response.json();
  expect(result.data.places).toHaveLength(6);
  expect(result.data.places.map((place: { id: string }) => place.id)).toEqual([
    "roastery-shanghai",
    "bluebottle-zhangyuan",
    "bluebottle-westbund",
    "jiajia-huanghe",
    "lostheaven-bund",
    "lostheaven-gaoyou",
  ]);
  for (const place of result.data.places) {
    expect(place).toMatchObject({
      coordinates: null,
      price: null,
      hours: null,
      rating: null,
      classifications: [],
      operationStatus: "unknown",
    });
    expect(place.providerReferences[0]).toMatchObject({
      linkKind: "search",
      placeId: null,
      coordinates: null,
      returnedName: null,
      returnedAddress: null,
    });
  }
  expect(JSON.stringify(result)).not.toMatch(
    /fictional-cafe|organiserUserId|savedPlaces/,
  );
  expect((await request.get("/development")).status()).toBe(404);
  const area = await (
    await request.get(
      "/api/catalogue?north=31.4&south=31&east=121.8&west=121.2&areaSystem=WGS-84",
    )
  ).json();
  expect(area.data.places).toEqual([]);
  expect(area.data.dataKind).toBe("real");
  expect(area.data.areaSearch.excludedCoordinateCount).toBe(6);
  expect(area.data.coverageMessage).toContain(
    "missing or incompatible coordinates",
  );
  expect(area.data.coverageMessage).toContain(
    "An empty result does not mean there are no venues here",
  );
  const unknown = await request.get(
    "/api/catalogue?budget=unknown&recommendationType=unclassified&distance=unknown",
  );
  expect((await unknown.json()).data.places).toHaveLength(6);
  for (const query of [
    "budget=low",
    "recommendationType=trending",
    "latitude=31.23&longitude=121.47&system=WGS-84&radiusMetres=1000",
  ]) {
    expect(
      (await (await request.get(`/api/catalogue?${query}`)).json()).data.places,
    ).toEqual([]);
  }
});

test("production ignores import fixture injection and exposes no invented result", async ({
  request,
}) => {
  const created = await request.post("/api/imports", {
    headers: { Origin: "http://127.0.0.1:8180" },
    data: { sourceUrl: "https://en.wikivoyage.org/wiki/Fixture_Multiple" },
  });
  expect(created.status()).toBe(202);
  const id = (await created.json()).job.id;
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/imports/${id}`)).json()).job.status,
    )
    .toBe("unsupported");
  const job = (await (await request.get(`/api/imports/${id}`)).json()).job;
  expect(job).toMatchObject({
    dataKind: "real",
    reason: { code: "credentials-missing" },
    mentions: [],
    evidence: null,
  });
});
