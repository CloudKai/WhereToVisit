import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const evidence =
  process.env.WHERETOVISIT_CAPTURE_PATH ??
  ".scratch/wheretovisit-pilot-tickets/evidence/10";
mkdirSync(evidence, { recursive: true });
const headers = { Origin: "http://127.0.0.1:8180" };

async function capture(page: import("@playwright/test").Page, name: string) {
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${name}-initial.png` });
  await page.screenshot({
    path: `${evidence}/${name}-full.png`,
    fullPage: true,
  });
}

test("Home gives truthful entries and keyboard navigation marks the current page", async ({
  page,
}) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Find places worth going to." }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Current opening hours, journey times and exact maps/navigation",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Import a Wikivoyage listing" }),
    ).toHaveAttribute("href", "/import");
    await capture(page, `home-${width}`);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    for (const [name, href] of [
      ["Discover", "/discover"],
      ["Import", "/import"],
      ["Trips", "/trips"],
      ["Home", "/"],
    ]) {
      const link = page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name, exact: true });
      await link.focus();
      expect(
        await link.evaluate(
          (element) => getComputedStyle(element).outlineStyle,
        ),
      ).toBe("solid");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(link).toHaveAttribute("aria-current", "page");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("real default Discover exposes the first branch, why-go and inspect/Save in the first screen", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/catalogue");
  expect(response.status()).toBe(200);
  expect(response.headers().server).toMatch(/^nginx/);
  const catalogue = (await response.json()).data;
  expect(catalogue.dataKind).toBe("real");
  expect(catalogue.places).toHaveLength(6);
  writeFileSync(
    `${evidence}/public-catalogue.json`,
    JSON.stringify(catalogue, null, 2),
  );
  const metrics = [];
  for (const [width, height] of [
    [375, 812],
    [1280, 900],
    [320, 812],
    [640, 450],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/discover");
    const first = page.getByRole("article").first();
    await expect(first.getByRole("heading")).toHaveText(
      "Starbucks Reserve Shanghai Roastery",
    );
    await expect(first).toContainText("星巴克臻选®上海烘焙工坊");
    await expect(first.locator(".why-go")).toContainText("On-site roasting");
    const positions = {} as Record<string, unknown>;
    for (const [name, locator] of [
      ["name", first.getByRole("heading")],
      ["whyGo", first.locator(".why-go")],
      ["inspect", first.getByRole("button", { name: "Inspect branch:" })],
      [
        "save",
        first.getByRole("link", { name: "Save Shanghai Roastery to a Trip" }),
      ],
    ] as const) {
      const box = await locator.boundingBox();
      expect(box).toBeTruthy();
      positions[name] = box;
      if (width === 375 || width === 1280)
        expect((box?.y ?? height) + (box?.height ?? 0)).toBeLessThanOrEqual(
          height,
        );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await capture(
      page,
      `discover-${width}${width === 640 ? "-200pct-reflow" : ""}`,
    );
    metrics.push({ width, height, positions });
  }
  writeFileSync(
    `${evidence}/first-screen-metrics.json`,
    JSON.stringify(metrics, null, 2),
  );
  await expect(
    page
      .getByRole("article", {
        name: "Blue Bottle Coffee — West Bund Dream Center, West Bund Dream Center",
      })
      .locator(".why-go"),
  ).toContainText("No sourced visit experience yet");
  await page.getByRole("button", { name: "Show map", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Map unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(6);
});

test("filters recover from empty and failed requests, with busy controls and selected detail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/discover");
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: "Inspect branch:" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("article").first().locator("details"),
  ).toHaveAttribute("open", "");
  await expect(page.getByRole("article").first()).toContainText(
    "Full reviews and exact navigation are not qualified",
  );
  await capture(page, "branch-inspection-375");
  await page.getByRole("button", { name: "Change filters" }).click();
  await expect(
    page.getByText("Filters and search options", { exact: true }),
  ).toBeFocused();
  await page.getByLabel("Budget", { exact: true }).selectOption("low");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching places" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No matching places" }),
  ).toBeInViewport();
  await capture(page, "empty-375");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(6);
  let release: (() => void) | undefined;
  await page.route("**/api/catalogue?*", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.abort();
  });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("button", { name: "Applying filters…" }),
  ).toBeDisabled();
  await expect(page.getByRole("article")).toHaveCount(0);
  release?.();
  await expect(
    page.getByRole("alert").filter({
      has: page.getByRole("heading", { name: "Places could not be loaded" }),
    }),
  ).toContainText("Please try again");
  await expect(
    page.getByRole("button", { name: "Retry catalogue" }),
  ).toBeInViewport();
  await capture(page, "error-375");
  await page.unroute("**/api/catalogue?*");
  await page.getByRole("button", { name: "Retry catalogue" }).click();
  await expect(page.getByRole("article")).toHaveCount(6);
});

test("card Save retains canonical branch and explicit named account/destination review", async ({
  page,
}) => {
  const email = `home-${randomBytes(8).toString("hex")}@example.invalid`;
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          email,
          password: "Home-discover-password-123",
          name: "Guide organiser",
        },
      })
    ).status(),
  ).toBe(200);
  const trips = [];
  for (const title of ["First destination", "Second destination"]) {
    const response = await page.request.post("/api/trips", {
      headers,
      data: { title, city: "Shanghai" },
    });
    expect(response.status()).toBe(201);
    trips.push((await response.json()).trip);
  }
  await page.goto("/discover?placeId=bluebottle-zhangyuan");
  const branch = page.getByRole("article", {
    name: "Blue Bottle Coffee — Zhangyuan, Zhangyuan",
  });
  await expect(branch.locator("details")).toHaveAttribute("open", "");
  await branch.getByRole("link", { name: "Save Zhangyuan to a Trip" }).click();
  const review = page.getByRole("region", { name: "Pending save" });
  await expect(review).toContainText(`Account: ${email}`);
  await expect(review).toContainText("Zhangyuan");
  await expect(review).toContainText("上海市静安区茂名北路240号W5-1A号");
  await page.getByLabel("Your Trip", { exact: true }).selectOption(trips[0].id);
  await expect(review).toContainText(
    "Destination: First destination · Shanghai",
  );
  for (const trip of trips)
    expect(
      (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
        .savedPlaces,
    ).toEqual([]);
  await review.scrollIntoViewIfNeeded();
  await capture(page, "card-save-review");
  await page
    .getByRole("button", { name: "Save reviewed branch", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Reviewed branch saved to “First destination”.",
  );
  expect(
    (
      await (await page.request.get(`/api/trips/${trips[0].id}`)).json()
    ).trip.savedPlaces.map((place: { placeId: string }) => place.placeId),
  ).toEqual(["bluebottle-zhangyuan"]);
  expect(
    (await (await page.request.get(`/api/trips/${trips[1].id}`)).json()).trip
      .savedPlaces,
  ).toEqual([]);
});
