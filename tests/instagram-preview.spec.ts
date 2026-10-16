import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const qualifiedRuntime = Boolean(
  process.env.WHERETOVISIT_SOCIAL_TEST_ORIGIN &&
    process.env.INSTAGRAM_PREVIEW_WRAPPER_ORIGIN,
);
const origin =
  process.env.WHERETOVISIT_SOCIAL_TEST_ORIGIN ?? "http://127.0.0.1:8380";
const wrapper =
  process.env.INSTAGRAM_PREVIEW_WRAPPER_ORIGIN ?? "http://localhost:8381";
test.skip(!qualifiedRuntime, "Use the isolated preview acceptance runtime.");
const headers = { Origin: origin };
const post = "https://www.instagram.com/p/Fixture_03/";

test("wrapper public HTTP boundary accepts only bounded public display requests", async ({
  playwright,
}) => {
  const client = await playwright.request.newContext();
  try {
    const response = await client.get(`${wrapper}/display`, {
      params: { source: post },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(response.headers()["content-security-policy"]).toContain(
      `frame-ancestors ${origin}`,
    );
    const html = await response.text();
    expect(html).toContain('class="instagram-media"');
    expect(html).toContain("https://platform.instagram.com/en_US/embeds.js");
    expect(html).not.toContain("/embed/");
    for (const source of [
      "https://evil.test/p/a/",
      "http://www.instagram.com/p/a/",
      `${post}?note=secret`,
      "https://www.instagram.com/p/%41/",
      "<script>alert(1)</script>",
    ])
      expect(
        (
          await client.get(`${wrapper}/display`, { params: { source } })
        ).status(),
      ).toBe(400);
    const rejectedHeaders: Record<string, string>[] = [
      { Cookie: "synthetic_app_authority=not_real" },
      { Host: "127.0.0.1:8381" },
      { Origin: "https://evil.test" },
    ];
    for (const extraHeaders of rejectedHeaders)
      expect(
        (
          await client.get(`${wrapper}/display`, {
            params: { source: post },
            headers: extraHeaders,
          })
        ).status(),
      ).toBe(400);
    expect(
      (
        await client.post(`${wrapper}/display`, { data: { source: post } })
      ).status(),
    ).toBe(400);
    expect(
      (
        await client.get(
          `${wrapper}/display?source=${encodeURIComponent(post)}&note=private`,
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await client.get(
          `${wrapper}/display?source=${encodeURIComponent(post)}&source=${encodeURIComponent(post)}`,
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await client.get(`${wrapper}/anything`, { params: { source: post } })
      ).status(),
    ).toBe(400);
  } finally {
    await client.dispose();
  }
});

test("explicit preview, private boundary, single frame and lifecycle teardown with provider failure fixture", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const providerRequests: string[] = [];
  await context.route(
    /https:\/\/(?:platform\.)?instagram\.com\//,
    async (route) => {
      providerRequests.push(route.request().url());
      await route.abort(); // Deliberately unavailable fixture; never live-provider evidence.
    },
  );
  await context.route("https://www.instagram.com/**", (route) => route.abort());
  const wrapperRequests: {
    url: string;
    cookie: string | undefined;
    referer: string | undefined;
  }[] = [];
  page.on("request", async (request) => {
    if (request.url().startsWith(wrapper)) {
      const values = await request.allHeaders();
      wrapperRequests.push({
        url: request.url(),
        cookie: values.cookie,
        referer: values.referer,
      });
    }
  });
  const first = (
    await (
      await page.request.post("/api/social-references", {
        headers,
        data: { sourceUrl: post, note: "PRIVATE ORIGINAL NOTE 03" },
      })
    ).json()
  ).reference;
  const second = (
    await (
      await page.request.post("/api/social-references", {
        headers,
        data: { sourceUrl: "https://www.instagram.com/reel/Fixture_Second/" },
      })
    ).json()
  ).reference;
  expect(
    (
      await page.request.patch(`/api/social-references/${first.id}`, {
        headers,
        data: { branchId: "bluebottle-zhangyuan", expectedRevision: 0 },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/references");
  await expect(
    page.getByText("PRIVATE ORIGINAL NOTE 03", { exact: true }),
  ).toBeVisible();
  expect(wrapperRequests).toHaveLength(0);
  expect(providerRequests).toHaveLength(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  const firstCard = page
    .getByRole("article")
    .filter({ hasText: "PRIVATE ORIGINAL NOTE 03" });
  const load = firstCard.getByRole("button", {
    name: "Load Instagram preview",
    exact: true,
  });
  await load.focus();
  await load.press("Enter");
  await expect(
    firstCard.getByRole("button", { name: "Hide preview", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("iframe")).toHaveCount(1);
  expect(
    await page
      .locator("iframe")
      .evaluate(
        (element: HTMLIFrameElement) => element.contentDocument === null,
      ),
  ).toBe(true);
  expect(
    await page
      .frameLocator("iframe")
      .locator("body")
      .evaluate(() => {
        try {
          return window.parent.document.cookie === "inaccessible";
        } catch {
          return true;
        }
      }),
  ).toBe(true);
  await expect(
    firstCard.getByText(/Preview requested; we cannot confirm/),
  ).toBeVisible();
  await expect.poll(() => wrapperRequests.length).toBe(1);
  expect(wrapperRequests[0]).toEqual({
    url: `${wrapper}/display?source=${encodeURIComponent(post)}`,
    cookie: undefined,
    referer: undefined,
  });
  await expect.poll(() => providerRequests.length).toBeGreaterThan(0);
  expect(wrapperRequests[0].url).not.toMatch(
    /PRIVATE|note|session|reference|actor/i,
  );
  await expect(
    page.getByRole("link", { name: "Open source on Instagram (new tab)" }),
  ).toHaveCount(2);
  const box = await firstCard
    .getByRole("button", { name: "Hide preview", exact: true })
    .boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await firstCard
    .getByRole("button", { name: "Hide preview", exact: true })
    .click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await load.click();
  const secondCard = page
    .getByRole("article")
    .filter({ hasText: "https://www.instagram.com/reel/Fixture_Second/" });
  await secondCard
    .getByRole("button", { name: "Load Instagram preview", exact: true })
    .click();
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(
    firstCard.getByRole("button", {
      name: "Load Instagram preview",
      exact: true,
    }),
  ).toBeVisible();
  await secondCard
    .getByRole("button", { name: "Delete Instagram draft", exact: true })
    .click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await load.click();
  await page.goto("/import");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.goto("/references");
  await expect(load).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  // Shorten this isolated record before a fresh read; no application clock override.
  const path = process.env.WHERETOVISIT_SOCIAL_TEST_STORAGE_CONFIG;
  if (!path) throw new Error("Isolated storage required.");
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!/test-social-[a-f0-9]+\.sqlite$/.test(config.databasePath))
    throw new Error("Isolated test database required.");
  const db = new Database(config.databasePath);
  db.prepare("UPDATE social_references SET expires_at = ? WHERE id = ?").run(
    Date.now() + 3000,
    first.id,
  );
  db.close();
  await page
    .getByRole("button", { name: "Refresh social drafts", exact: true })
    .click();
  await load.click();
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(page.locator("iframe")).toHaveCount(0, { timeout: 8000 });
  expect(
    (await page.request.get(`/api/social-references/${first.id}`)).status(),
  ).toBe(404);
  expect(
    (await page.request.get(`/api/social-references/${second.id}`)).status(),
  ).toBe(404);
});

test("unqualified request host does not receive an enabled preview configuration", async ({
  request,
}) => {
  const response = await request.get("/references", {
    headers: { Host: new URL(origin).host.replace("127.0.0.1", "localhost") },
  });
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain(
    "No previews, embeds or source retrieval are enabled.",
  );
  expect(html).not.toContain(`${wrapper}/display`);
});

test("default-off configuration retains references and source links without preview controls", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.WHERETOVISIT_PREVIEW_DISABLED !== "1",
    "Run against the same isolated app with the preview flag disabled.",
  );
  const external: string[] = [];
  await context.route(
    /https:\/\/(?:www\.|platform\.)?instagram\.com\//,
    (route) => {
      external.push(route.request().url());
      return route.abort();
    },
  );
  await page.request.post("/api/social-references", {
    headers,
    data: { sourceUrl: post, note: "Original disabled-preview reminder" },
  });
  await page.goto("/references");
  await expect(
    page.getByText("Original disabled-preview reminder", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No previews, embeds or source retrieval are enabled.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load Instagram preview", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open source on Instagram (new tab)" }),
  ).toHaveAttribute("href", post);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(external).toHaveLength(0);
});
