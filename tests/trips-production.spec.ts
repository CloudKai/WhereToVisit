import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8180";
test("production real accounts save source-backed canonical branches and recover private Trips", async ({
  page,
  playwright,
}, testInfo) => {
  const headers = { Origin: origin };
  const email = `real-local-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = "Production-local-password-123";
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: { name: "Local organiser", email, password },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await page.request.post("/api/trips", {
        headers,
        data: { title: "Shanghai source shortlist", city: "Shanghai" },
      })
    ).json()
  ).trip;
  for (const placeId of [
    "bluebottle-zhangyuan",
    "bluebottle-westbund",
    "bluebottle-zhangyuan",
  ]) {
    const prepared = await page.request.post("/api/trip-save-intents", {
      headers,
      data: { placeId },
    });
    expect(prepared.status()).toBe(201);
    const saved = await page.request.post(`/api/trips/${trip.id}`, {
      headers,
      data: { action: "save", intentId: (await prepared.json()).intent.id },
    });
    expect(saved.status()).toBe(200);
  }
  const savedTrip = (
    await (await page.request.get(`/api/trips/${trip.id}`)).json()
  ).trip;
  expect(savedTrip.dataKind).toBe("real");
  expect(
    savedTrip.savedPlaces.map((member: { placeId: string }) => member.placeId),
  ).toEqual(["bluebottle-zhangyuan", "bluebottle-westbund"]);
  expect(savedTrip.savedPlaces[0].place).toMatchObject({
    address: "上海市静安区茂名北路240号W5-1A号",
    coordinates: null,
    operationStatus: "unknown",
    providerReferences: [{ placeId: null, linkKind: "search" }],
  });
  expect(savedTrip.savedPlaces[0].place.evidence.length).toBeGreaterThan(0);
  const stranger = await playwright.request.newContext({ baseURL: origin });
  expect((await stranger.get(`/api/trips/${trip.id}`)).status()).toBe(401);
  await stranger.dispose();
  await page.request.post("/api/auth/sign-out", { headers, data: {} });
  expect((await page.request.get(`/api/trips/${trip.id}`)).status()).toBe(401);
  await page.request.post("/api/auth/sign-in/email", {
    headers,
    data: { email, password },
  });
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip,
  ).toEqual(savedTrip);
  await page.goto("/trips", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("region", { name: "Trip workspace", exact: true }),
  ).toContainText("Shanghai source shortlist");
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`private-trip-${width}.png`),
      fullPage: true,
    });
  }
  expect(
    (
      await page.request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "fictional-cafe-east" },
      })
    ).status(),
  ).toBe(404);
});
