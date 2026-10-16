import { join } from "node:path";
import { expect, test } from "@playwright/test";

const captures = process.env.WHERETOVISIT_CAPTURE_PATH;
test("production unsupported sources and missing source qualification remain recoverable without fixtures", async ({
  page,
}) => {
  await page.goto("/import", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  for (const sourceUrl of [
    "https://www.youtube.com/watch?v=unsupported",
    "https://en.wikivoyage.org/wiki/Fixture_Resolution",
  ]) {
    await page.getByLabel("Supported article URL").fill(sourceUrl);
    await page
      .getByRole("button", { name: "Import article", exact: true })
      .click();
    await expect(
      page.getByRole("article").first().getByRole("status"),
    ).toHaveText("Unsupported import");
    const jobs = (await (await page.request.get("/api/imports")).json()).jobs;
    expect(jobs[0].mentions).toEqual([]);
    expect(jobs[0].evidence).toBeNull();
    expect(jobs[0].dataKind).toBe("real");
  }
  await expect(
    page.getByRole("button", { name: "Refresh drafts", exact: true }),
  ).toBeEnabled();
  if (captures)
    await page.screenshot({
      path: join(captures, "import-production-unsupported.png"),
      fullPage: true,
    });
});
