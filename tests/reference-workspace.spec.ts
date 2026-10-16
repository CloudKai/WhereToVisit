import { join } from "node:path";
import { expect, test } from "@playwright/test";

const origin =
  process.env.WHERETOVISIT_SOCIAL_TEST_ORIGIN ?? "http://127.0.0.1:8815";
const captures = process.env.WHERETOVISIT_CAPTURE_PATH;
const post = "https://www.instagram.com/p/Workspace06/";
const noteLabel = "Your note (optional, original words only)";

test("empty entry, keyboard close/reopen, save focus and returning collection fit phones and desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const outbound: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) outbound.push(request.url());
  });
  await page.goto("/references");
  const url = page.getByLabel("Canonical social post URL");
  await expect(url).toBeVisible();
  await expect(page.getByText(/Private to this browser/)).toBeVisible();
  const inputBox = await url.boundingBox();
  if (!inputBox) throw Error("URL input missing");
  if (captures)
    await page.screenshot({ path: join(captures, "empty-phone375.png") });
  expect(inputBox.y + inputBox.height).toBeLessThan(812);
  await url.fill(`${post}?tracking=discard#fragment`);
  await page
    .getByLabel(noteLabel)
    .fill("My own reminder\n<script>plain text</script>");
  await expect(
    page.getByText(`Will save: ${post}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Query parameters and fragments will not be saved/),
  ).toBeVisible();
  const close = page.getByRole("button", {
    name: "Close entry — keep typed inputs",
    exact: true,
  });
  await close.focus();
  await page.keyboard.press("Enter");
  const add = page.getByRole("button", { name: "Add a link", exact: true });
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(url).toBeFocused();
  await expect(url).toHaveValue(`${post}?tracking=discard#fragment`);
  await expect(page.getByLabel(noteLabel)).toHaveValue(
    "My own reminder\n<script>plain text</script>",
  );
  await page
    .getByRole("button", { name: "Keep social draft", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const card = page.getByRole("article", { name: "Instagram draft" });
  await expect(card).toBeFocused();
  await expect(url).toHaveCount(0);
  await expect(page.getByRole("status").first()).toContainText(
    "Social draft saved",
  );
  await expect(card.getByText(/<script>plain text/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Browser social drafts (1/20)" }),
  ).toBeVisible();
  await page.reload();
  await expect(card).toBeVisible();
  await expect(add).toBeVisible();
  await expect(url).toHaveCount(0);
  const source = card.getByRole("link", {
    name: "Open source on Instagram (new tab)",
  });
  await expect(source).toHaveAttribute("href", post);
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
  await expect(source).toHaveAttribute("referrerpolicy", "no-referrer");
  for (const [width, height] of [
    [375, 812],
    [1280, 900],
    [320, 812],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await source.boundingBox();
    if (!box) throw Error("Source action missing");
    expect(box.y + box.height).toBeLessThan(height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (captures)
      await page.screenshot({ path: join(captures, `returning-${width}.png`) });
  }
  await add.click();
  await expect(url).toHaveValue("");
  await expect(page.getByLabel(noteLabel)).toHaveValue("");
  expect(outbound).toEqual([]);
});

test("refresh failure preserves drafts and unsaved inputs, recovery and deletion never move entry focus", async ({
  page,
}) => {
  const created = await page.request.post("/api/social-references", {
    headers: { Origin: origin },
    data: { sourceUrl: post, note: "Prior useful draft" },
  });
  expect(created.status()).toBe(201);
  await page.goto("/references");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Add a link", exact: true }).click();
  const url = page.getByLabel("Canonical social post URL");
  await url.fill("https://www.tiktok.com/@my_note/video/123");
  await page.getByLabel(noteLabel).fill("Unsaved original note");
  let fail = true;
  await page.route("**/api/social-references", async (route) => {
    if (route.request().method() === "GET" && fail)
      await route.fulfill({
        status: 503,
        json: { error: { message: "Controlled refresh failure" } },
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Refresh social drafts" }).click();
  await expect(
    page.locator(".social-references").getByRole("alert"),
  ).toContainText("Controlled refresh failure");
  await expect(page.locator(".reference-status")).toContainText(
    "Showing previously loaded drafts",
  );
  await expect(page.locator(".reference-status")).not.toContainText(
    "up to date",
  );
  await expect(
    page.getByRole("article").getByText("Prior useful draft", { exact: true }),
  ).toBeVisible();
  await expect(url).toHaveValue("https://www.tiktok.com/@my_note/video/123");
  fail = false;
  await page.getByRole("button", { name: "Refresh social drafts" }).click();
  await expect(
    page.locator(".social-references").getByRole("alert"),
  ).toHaveCount(0);
  await expect(page.locator(".reference-status")).toContainText("up to date");
  await expect(url).toHaveValue("https://www.tiktok.com/@my_note/video/123");
  await page.getByRole("button", { name: "Delete Instagram draft" }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Browser social drafts (0/20)" }),
  ).toBeVisible();
  await expect(page.getByLabel(noteLabel)).toHaveValue("Unsaved original note");
  await page
    .getByRole("button", {
      name: "Close entry — keep typed inputs",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Refresh social drafts" }).click();
  await expect(url).toHaveCount(0);
  await page.getByRole("button", { name: "Add a link", exact: true }).click();
  await expect(url).toHaveValue("https://www.tiktok.com/@my_note/video/123");
});

test("a delayed initial collection response cannot close a deliberately opened typed form or steal focus", async ({
  page,
}) => {
  await page.request.post("/api/social-references", {
    headers: { Origin: origin },
    data: { sourceUrl: post },
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/social-references", async (route) => {
    if (route.request().method() === "GET") await gate;
    await route.continue();
  });
  await page.goto("/references", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add a link", exact: true }).click();
  const url = page.getByLabel("Canonical social post URL");
  await url.fill("https://www.instagram.com/reel/Unsaved06/");
  await page.getByLabel(noteLabel).fill("Still typing");
  release();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByLabel(noteLabel)).toBeFocused();
  await expect(url).toHaveValue("https://www.instagram.com/reel/Unsaved06/");
  await expect(page.getByLabel(noteLabel)).toHaveValue("Still typing");
});
