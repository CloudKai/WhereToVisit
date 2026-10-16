import { expect, test } from "@playwright/test";

test("cold public pages and static fanout stay responsive through NGINX", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(95_000);
  if (!baseURL) throw new Error("The NGINX base URL is required.");
  const seed = await fetch(`${baseURL}/discover`, {
    signal: AbortSignal.timeout(20_000),
  });
  expect(seed.status).toBe(200);
  const html = await seed.text();
  const assets = [
    ...new Set(
      [
        ...html.matchAll(
          /(?:src|href)="(\/_next\/static\/[^"?]+\.(?:js|css))/g,
        ),
      ].map((match) => match[1]),
    ),
  ];
  expect(assets.length).toBeGreaterThan(0);
  let nextLoad = 0;
  let nextStatic = 0;
  let failed = false;
  const errors: string[] = [];
  const failures: string[] = [];
  const loads = Array.from({ length: 6 }, async () => {
    while (nextLoad < 100 && !failed) {
      const index = nextLoad++;
      const path = index % 2 ? "/trips" : "/discover";
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      page.on("response", (response) => {
        if (response.status() >= 500) failures.push(String(response.status()));
      });
      try {
        await page.goto(path, { waitUntil: "load", timeout: 20_000 });
        if (path === "/discover") {
          await expect(
            page.getByRole("heading", {
              name: "Jiajia Soup Dumplings — Huanghe Road",
            }),
          ).toBeVisible();
        }
      } catch {
        failed = true;
        errors.push(`Cold ${path} load ${index} failed its 20 second limit.`);
        // Preserve the original requests through NGINX's 60 second connect limit.
        await new Promise((resolve) => setTimeout(resolve, 45_000));
      } finally {
        await context.close();
      }
    }
  });
  const fanout = Array.from({ length: 32 }, async () => {
    while (nextStatic < 2_000 && !failed) {
      const index = nextStatic++;
      const started = Date.now();
      try {
        const response = await fetch(
          `${baseURL}${assets[index % assets.length]}`,
          {
            signal: AbortSignal.timeout(65_000),
          },
        );
        await response.arrayBuffer();
        if (response.status !== 200 || Date.now() - started >= 20_000) {
          failed = true;
          errors.push(`Static request ${index} exceeded its response limit.`);
        }
      } catch {
        failed = true;
        errors.push(`Static request ${index} did not complete.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
  await Promise.all([...loads, ...fanout]);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  expect(nextLoad).toBe(100);
  expect(nextStatic).toBe(2_000);
});
