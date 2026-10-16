import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { catalogueFixture } from "./catalogue-fixture";

const evidence =
  process.env.WHERETOVISIT_CAPTURE_PATH ??
  ".scratch/wheretovisit-pilot-tickets/evidence/10";

test("long English and Chinese branch names reflow with labelled keyboard controls", async ({
  page,
}) => {
  const fixture = catalogueFixture();
  fixture.places[0].displayName =
    "Fictional Shanghai neighbourhood coffee and bakery — a deliberately long eastern branch name";
  fixture.places[0].localName =
    "虚构上海街区咖啡与烘焙体验东侧分店名称用于测试中文换行和可读性";
  writeFileSync(".data/catalogue-scenario.json", JSON.stringify(fixture));
  try {
    for (const width of [320, 375, 640]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/discover");
      const first = page.getByRole("article").first();
      await expect(first.getByRole("heading")).toHaveText(
        fixture.places[0].displayName,
      );
      await expect(first).toContainText(fixture.places[0].localName);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const inspect = first.getByRole("button", { name: "Inspect branch:" });
      await inspect.focus();
      expect(
        await inspect.evaluate(
          (element) => getComputedStyle(element).outlineStyle,
        ),
      ).toBe("solid");
      await page.keyboard.press("Enter");
      await expect(first.locator("details")).toHaveAttribute("open", "");
      await page.getByRole("button", { name: "Change filters" }).click();
      await expect(page.getByLabel("Category", { exact: true })).toBeVisible();
      for (const label of [
        "Category",
        "Budget",
        "Neighbourhood",
        "Distance",
        "Recommendation type",
      ]) {
        const control = page.getByLabel(label, { exact: true });
        expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(
          44,
        );
      }
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({
        path: `${evidence}/fictional-long-names-${width}-full.png`,
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
