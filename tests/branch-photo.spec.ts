import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { CatalogueBatch } from "../src/shared/contracts";

const evidence = process.env.WHERETOVISIT_CAPTURE_PATH;
const photoUrl = "/api/catalogue/photos/roastery-codas-2024";
const realBatch = JSON.parse(
  readFileSync("data/catalogue/shanghai.json", "utf8"),
) as CatalogueBatch;

function publish(batch: unknown) {
  if (!process.cwd().endsWith("/.data/ticket11-runtime"))
    throw new Error(
      "Media publication checks require the isolated ticket11 runtime.",
    );
  const path = resolve(".data/photo-publication.json");
  writeFileSync(path, JSON.stringify(batch));
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/server/catalogue-load.ts", path],
    {
      env: {
        ...process.env,
        DATABASE_PATH: resolve(".data/ticket11-production.sqlite"),
      },
      encoding: "utf8",
    },
  ).status;
}

test("reviewed original photo and attribution reach real Discover and branch detail without moving first-screen actions", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get("/api/catalogue");
  expect(response.status()).toBe(200);
  expect(response.headers().server).toMatch(/^nginx/);
  const result = (await response.json()).data;
  expect(result.places.map((place: { id: string }) => place.id)).toEqual(
    realBatch.places.map((place) => place.id),
  );
  expect(result.places[0].photo).toEqual(realBatch.places[0].photo);
  expect(result.places[0]).toMatchObject({
    operationStatus: "unknown",
    coordinates: null,
    hours: null,
  });
  const original = await request.get(photoUrl);
  expect(original.status()).toBe(200);
  expect(original.headers()["content-type"]).toBe("image/jpeg");
  expect(original.headers()["cache-control"]).toBe("no-store");
  expect(original.headers().link).toContain(
    "creativecommons.org/licenses/by-sa/4.0/",
  );
  expect(
    createHash("sha256")
      .update(await original.body())
      .digest("hex"),
  ).toBe(realBatch.places[0].photo?.sha256);
  const metrics = [];
  for (const [width, height] of [
    [375, 812],
    [1280, 900],
    [320, 812],
    [640, 450],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/discover");
    const branch = page.getByRole("article").first();
    await expect(branch.getByRole("heading")).toHaveText(
      realBatch.places[0].displayName,
    );
    await expect(branch).toContainText("星巴克臻选®上海烘焙工坊");
    await expect(branch.locator(".why-go")).toContainText("On-site roasting");
    await expect(branch.locator(".branch-photo-frame").first()).toHaveAttribute(
      "data-photo-state",
      "loaded",
    );
    await expect(branch.getByRole("img")).toHaveJSProperty(
      "src",
      new URL(photoUrl, page.url()).href,
    );
    const recommendationSource = await branch
      .locator(".branch-attribution")
      .boundingBox();
    const image = await branch
      .locator(".branch-photo-frame")
      .first()
      .boundingBox();
    expect(recommendationSource).toBeTruthy();
    expect(image).toBeTruthy();
    expect(
      (recommendationSource?.y ?? 0) + (recommendationSource?.height ?? 0),
    ).toBeLessThan(image?.y ?? 0);
    const positions = {} as Record<string, unknown>;
    for (const [name, locator] of [
      ["name", branch.getByRole("heading")],
      ["whyGo", branch.locator(".why-go")],
      ["inspect", branch.getByRole("button", { name: "Inspect branch:" })],
      [
        "save",
        branch.getByRole("link", { name: "Save Shanghai Roastery to a Trip" }),
      ],
    ] as const) {
      const box = await locator.boundingBox();
      expect(box).toBeTruthy();
      positions[name] = box;
      if (width !== 640)
        expect((box?.y ?? height) + (box?.height ?? 0)).toBeLessThanOrEqual(
          height,
        );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`photo-${width}-initial.png`),
    });
    await page.screenshot({
      path: testInfo.outputPath(`photo-${width}-full.png`),
      fullPage: true,
    });
    metrics.push({ width, height, positions });
  }
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      `${evidence}/photo-first-screen-metrics.json`,
      JSON.stringify(metrics, null, 2),
    );
    writeFileSync(
      `${evidence}/public-photo-catalogue.json`,
      JSON.stringify(result, null, 2),
    );
  }
  await page.setViewportSize({ width: 375, height: 812 });
  const first = page.getByRole("article").first();
  await first.getByRole("button", { name: "Inspect branch:" }).focus();
  await page.keyboard.press("Enter");
  await expect(first.locator("details")).toHaveAttribute("open", "");
  const detail = first.locator("details");
  await expect(detail.locator(".branch-photo-frame")).toHaveAttribute(
    "data-photo-state",
    "loaded",
  );
  await expect(detail.getByRole("img")).toBeVisible();
  await expect(detail).toContainText(
    "rights and branch relevance checked 2026-10-14",
  );
  await expect(detail).toContainText(
    "Original unchanged; displayed smaller without cropping",
  );
  await expect(
    detail.getByRole("link", { name: "Codas", exact: true }),
  ).toHaveAttribute("href", realBatch.places[0].photo?.authorUrl ?? "");
  await expect(
    detail.getByRole("link", { name: "CC BY-SA 4.0", exact: true }),
  ).toHaveAttribute("href", realBatch.places[0].photo?.licenseUrl ?? "");
  await detail.getByRole("link", { name: "Open full original photo" }).focus();
  expect(
    await detail
      .getByRole("link", { name: "Open full original photo" })
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
  await page.screenshot({
    path: testInfo.outputPath("photo-detail-375.png"),
    fullPage: true,
  });
  const missing = page.getByRole("article").nth(1);
  await expect(missing).toContainText("No reviewed branch photo yet");
  await expect(missing.locator(".why-go")).toContainText("Architecture");
  await expect(
    missing.getByRole("link", { name: "Save Zhangyuan to a Trip" }),
  ).toBeVisible();
});

test("loading and failed photos preserve useful branch identity, experience and Save", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let release: (() => void) | undefined;
  await page.route(`**${photoUrl}`, async (route) => {
    await new Promise<void>((done) => {
      release = done;
    });
    await route.abort();
  });
  await page.goto("/discover", { waitUntil: "domcontentloaded" });
  const first = page.getByRole("article").first();
  await expect(first).toContainText("Loading branch photo…");
  await expect(first.locator(".why-go")).toContainText("On-site roasting");
  await expect(
    first.getByRole("link", { name: "Save Shanghai Roastery to a Trip" }),
  ).toBeInViewport();
  release?.();
  await expect(first).toContainText(
    "Photo unavailable. Branch details and Save are still available.",
  );
  await expect(first.getByRole("heading")).toHaveText(
    realBatch.places[0].displayName,
  );
  await expect(first.getByRole("img")).toHaveCount(0);
  await expect(
    first.getByRole("link", { name: "Save Shanghai Roastery to a Trip" }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("photo-failed-375.png"),
    fullPage: true,
  });
  await page.unroute(`**${photoUrl}`);
});

test("invalid media metadata or original bytes cannot replace the last valid publication or serve arbitrary assets", async ({
  request,
}) => {
  const original = await (await request.get("/api/catalogue")).json();
  for (const field of [
    "assetId",
    "sourceUrl",
    "authorUrl",
    "licenseUrl",
    "sha256",
    "relevance",
  ] as const) {
    const invalid = structuredClone(realBatch);
    if (!invalid.places[0].photo) throw new Error("Missing actual photo.");
    invalid.places[0].photo[field] =
      field === "assetId"
        ? "../../.env.local"
        : "https://example.invalid/unreviewed";
    expect(publish(invalid)).toBe(1);
    expect(await (await request.get("/api/catalogue")).json()).toEqual(
      original,
    );
  }
  const wrongBranch = structuredClone(realBatch);
  wrongBranch.places[1].photo = wrongBranch.places[0].photo;
  expect(publish(wrongBranch)).toBe(1);
  expect(await (await request.get("/api/catalogue")).json()).toEqual(original);
  const assetPath = "data/catalogue/photos/roastery-codas-2024.jpg";
  const bytes = readFileSync(assetPath);
  try {
    const changed = Buffer.from(bytes);
    changed[1000] ^= 1;
    writeFileSync(assetPath, changed);
    expect(publish(realBatch)).toBe(1);
    expect(await (await request.get("/api/catalogue")).json()).toEqual(
      original,
    );
    expect((await request.get(photoUrl)).status()).toBe(404);
  } finally {
    writeFileSync(assetPath, bytes);
  }
  expect((await request.get(photoUrl)).status()).toBe(200);
  for (const path of [
    "/api/catalogue/photos/unknown",
    "/api/catalogue/photos/__proto__",
    `${photoUrl}?url=https://example.invalid/photo.jpg`,
  ])
    expect((await request.get(path)).status()).toBe(404);
});

test("unsupported and expired rights exclude media while retaining the same real branches and Save", async ({
  page,
  request,
}) => {
  try {
    for (const status of ["unsupported", "expired", "past-expiry"] as const) {
      const excluded = structuredClone(realBatch);
      const photo = excluded.places[0].photo;
      if (!photo) throw new Error("Missing actual photo.");
      if (status === "past-expiry") photo.rightsExpiresAt = "2020-01-01";
      else photo.rightsStatus = status;
      expect(publish(excluded)).toBe(0);
      const result = (await (await request.get("/api/catalogue")).json()).data;
      expect(result.places[0].photo).toBeNull();
      expect(result.places.map((place: { id: string }) => place.id)).toEqual(
        realBatch.places.map((place) => place.id),
      );
      expect((await request.get(photoUrl)).status()).toBe(404);
      await page.goto("/discover");
      const first = page.getByRole("article").first();
      await expect(first).toContainText("No reviewed branch photo yet");
      await expect(first.locator(".why-go")).toContainText("On-site roasting");
      await expect(
        first.getByRole("link", { name: "Save Shanghai Roastery to a Trip" }),
      ).toBeVisible();
      await expect(first.getByRole("img")).toHaveCount(0);
    }
  } finally {
    expect(publish(realBatch)).toBe(0);
  }
});

test("legacy publications and saved no-photo snapshots retain canonical facts and provenance after photo publication", async ({
  page,
}) => {
  const legacy = structuredClone(realBatch);
  for (const place of legacy.places) delete place.photo;
  const headers = { Origin: "http://127.0.0.1:8180" };
  let tripId = "";
  let savedBefore: unknown;
  try {
    expect(publish(legacy)).toBe(0);
    expect(
      (
        await page.request.post("/api/auth/sign-up/email", {
          headers,
          data: {
            name: "Photo compatibility organiser",
            email: `photo-${randomBytes(8).toString("hex")}@example.invalid`,
            password: "Photo-compatibility-password-123",
          },
        })
      ).status(),
    ).toBe(200);
    const trip = await page.request.post("/api/trips", {
      headers,
      data: { title: "Original branch choice", city: "Shanghai" },
    });
    expect(trip.status()).toBe(201);
    tripId = (await trip.json()).trip.id;
    const intent = await page.request.post("/api/trip-save-intents", {
      headers,
      data: { placeId: "roastery-shanghai" },
    });
    expect(intent.status()).toBe(201);
    expect(
      (
        await page.request.post(`/api/trips/${tripId}`, {
          headers,
          data: { action: "save", intentId: (await intent.json()).intent.id },
        })
      ).status(),
    ).toBe(200);
    savedBefore = (
      await (await page.request.get(`/api/trips/${tripId}`)).json()
    ).trip;
  } finally {
    expect(publish(realBatch)).toBe(0);
  }
  const savedAfter = (
    await (await page.request.get(`/api/trips/${tripId}`)).json()
  ).trip;
  expect(savedAfter).toEqual(savedBefore);
  expect(savedAfter.savedPlaces[0].place.photo).toBeUndefined();
  expect(savedAfter.savedPlaces[0].place.id).toBe("roastery-shanghai");
  expect(savedAfter.savedPlaces[0].place.evidence).toEqual(
    legacy.places[0].evidence,
  );
  expect(savedAfter.selectedPlaceIds).toEqual([]);
  await page.goto("/trips");
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).toContainText("Original branch choice");
  const currentTripResponse = await page.request.post("/api/trips", {
    headers,
    data: { title: "Reviewed photo branch", city: "Shanghai" },
  });
  expect(currentTripResponse.status()).toBe(201);
  const currentTripId = (await currentTripResponse.json()).trip.id;
  const currentIntentResponse = await page.request.post(
    "/api/trip-save-intents",
    {
      headers,
      data: { placeId: "roastery-shanghai" },
    },
  );
  expect(currentIntentResponse.status()).toBe(201);
  const currentIntent = (await currentIntentResponse.json()).intent;
  expect(currentIntent.place.photo).toEqual(realBatch.places[0].photo);
  expect(
    (
      await page.request.post(`/api/trips/${currentTripId}`, {
        headers,
        data: { action: "save", intentId: currentIntent.id },
      })
    ).status(),
  ).toBe(200);
  const currentSaved = (
    await (await page.request.get(`/api/trips/${currentTripId}`)).json()
  ).trip;
  expect(currentSaved.savedPlaces[0].place.photo).toEqual(
    realBatch.places[0].photo,
  );
  expect(currentSaved.savedPlaces[0].place.evidence).toEqual(
    realBatch.places[0].evidence,
  );
  expect(currentSaved.selectedPlaceIds).toEqual([]);
  expect(
    (await (await page.request.get(`/api/trips/${tripId}`)).json()).trip,
  ).toEqual(savedBefore);
});
