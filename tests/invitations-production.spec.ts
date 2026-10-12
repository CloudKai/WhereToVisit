import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
test("production invitation shares only sourced canonical facts and revokes derived guest authority", async ({
  page,
  browser,
}, testInfo) => {
  const registered = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data: {
      name: "Production organiser",
      email: `invitation-real-${randomBytes(8).toString("hex")}@example.invalid`,
      password: "Production-invitation-123",
    },
  });
  expect(registered.status()).toBe(200);
  const trip = (
    await (
      await page.request.post("/api/trips", {
        headers,
        data: { title: "Shared Shanghai coffee", city: "Shanghai" },
      })
    ).json()
  ).trip;
  const intent = (
    await (
      await page.request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "bluebottle-zhangyuan" },
      })
    ).json()
  ).intent;
  expect(
    (
      await page.request.post(`/api/trips/${trip.id}`, {
        headers,
        data: { action: "save", intentId: intent.id },
      })
    ).status(),
  ).toBe(200);
  const invitation = (
    await (
      await page.request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await browser.newContext();
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto(invitation.url);
    await guestPage.getByLabel("Display name").fill("Companion");
    await guestPage.getByRole("button", { name: "Join as guest" }).click();
    await expect(
      guestPage.getByRole("heading", { name: trip.title }),
    ).toBeVisible();
    await expect(
      guestPage.getByRole("region", { name: "Shared Trip" }),
    ).toContainText("上海市静安区茂名北路240号W5-1A号");
    const shared = (
      await (await guest.request.get(`/api/guest-trips/${trip.id}`)).json()
    ).shared;
    expect(shared.trip).not.toHaveProperty("organiserUserId");
    expect(shared.trip.savedPlaces[0].place).toMatchObject({
      coordinates: null,
      operationStatus: "unknown",
      providerReferences: [{ placeId: null, linkKind: "search" }],
    });
    expect(shared.trip.savedPlaces[0].place.evidence.length).toBeGreaterThan(0);
    expect(
      (
        await guest.request.post(`/api/trips/${trip.id}/invitation`, {
          headers,
          data: { action: "replace" },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await guest.request.post(`/api/trips/${trip.id}`, {
          headers,
          data: {
            action: "select",
            placeId: "bluebottle-zhangyuan",
            selected: true,
          },
        })
      ).status(),
    ).toBe(401);
    for (const width of [375, 1280]) {
      await guestPage.setViewportSize({ width, height: 900 });
      expect(
        await guestPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await guestPage.screenshot({
        path: testInfo.outputPath(`production-guest-${width}.png`),
        fullPage: true,
      });
    }
    expect(
      (
        await page.request.post(`/api/trips/${trip.id}/invitation`, {
          headers,
          data: { action: "replace" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await guest.request.get(`/api/guest-trips/${trip.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await guest.request.post(`/api/invitations/${invitation.token}`, {
          headers,
          data: { displayName: "Again" },
        })
      ).status(),
    ).toBe(404);
    const history = (
      await (await page.request.get(`/api/trips/${trip.id}/invitation`)).json()
    ).participants;
    expect(history).toEqual([{ ...shared.participant, accessActive: false }]);
    expect(
      (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
        .savedPlaces,
    ).toHaveLength(1);
  } finally {
    await guest.close();
  }
});
