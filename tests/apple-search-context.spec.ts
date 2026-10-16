import { expect, test } from "@playwright/test";

test("published Apple searches retain branch evidence and Roastery's Shanghai search context", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get("/api/catalogue");
  expect(response.status()).toBe(200);
  expect(response.headers().server).toMatch(/^nginx/);
  const catalogue = (await response.json()).data;
  expect(catalogue.dataKind).toBe("real");
  expect(catalogue.places).toHaveLength(6);
  const roastery = catalogue.places.find(
    (place: { id: string }) => place.id === "roastery-shanghai",
  );
  const reference = roastery.providerReferences[0];
  const search = new URL(reference.url);
  expect(search.pathname).toBe("/search");
  expect(search.searchParams.get("center")).toBe("31.2,121.5");
  expect(search.searchParams.get("span")).toBe("0.2,0.2");
  expect(search.searchParams.get("query")).toBe(
    "星巴克臻选上海烘焙工坊 上海市静安区南京西路789号N110及201",
  );
  expect(reference).toMatchObject({
    linkKind: "search",
    placeId: null,
    coordinates: null,
    returnedName: null,
    returnedAddress: null,
  });
  expect(roastery.coordinates).toBeNull();
  const zhangyuan = catalogue.places.find(
    (place: { id: string }) => place.id === "bluebottle-zhangyuan",
  );
  expect(zhangyuan.address).toContain("240");
  expect(zhangyuan.providerReferences[0].qualificationNotes).toContain(
    "Known wrong or conflicting results",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/discover");
  const branch = page
    .getByRole("article")
    .filter({ hasText: "Shanghai Roastery" });
  await branch.getByText("Sources and place details", { exact: true }).click();
  await expect(
    branch.getByRole("link", { name: "Search address on Apple Maps" }),
  ).toHaveAttribute("href", reference.url);
  const blueBottle = page
    .getByRole("article")
    .filter({ hasText: "Blue Bottle Coffee — Zhangyuan" });
  await blueBottle
    .getByText("Sources and place details", { exact: true })
    .click();
  await expect(blueBottle).toContainText("Known wrong or conflicting results");
  await expect(blueBottle).toContainText("240 Maoming North Road");
  await blueBottle.screenshot({
    path: testInfo.outputPath("zhangyuan-search-warning.png"),
  });
});
