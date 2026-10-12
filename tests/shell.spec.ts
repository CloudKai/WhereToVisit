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
      ["Trips", "/trips", "Your next trip"],
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

test("visitor sees truthful unavailable discovery on phone and desktop", async ({
  page,
}, testInfo) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/discover");
    await expect(page.getByRole("status")).toContainText(
      "The Shanghai shortlist is not available yet",
    );
    await page.screenshot({
      path: testInfo.outputPath(`discover-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  }
});

test("public catalogue never substitutes development examples for unavailable data", async ({
  request,
}) => {
  const response = await request.get("/api/catalogue");
  expect(response.status()).toBe(503);
  expect(response.headers().server).toMatch(/^nginx/);
  expect(await response.json()).toMatchObject({
    status: "unavailable",
    reason: "catalogue-not-ready",
  });
  expect((await request.get("/development")).status()).toBe(404);
});
