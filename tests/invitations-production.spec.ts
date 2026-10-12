import { randomBytes, randomUUID } from "node:crypto";
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
    const collaborationPath = `/api/guest-trips/${trip.id}/collaboration`;
    const vote = {
      action: "vote",
      placeId: "bluebottle-zhangyuan",
      choice: "must-go",
      operationId: randomUUID(),
    };
    expect(
      (
        await guest.request.post(collaborationPath, { headers, data: vote })
      ).status(),
    ).toBe(200);
    expect(
      (
        await guest.request.post(collaborationPath, {
          headers,
          data: {
            action: "comment",
            placeId: "bluebottle-zhangyuan",
            text: "Source-backed coffee choice",
            operationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await guest.request.post(collaborationPath, {
          headers,
          data: {
            action: "suggest",
            placeId: "fictional-cafe-west",
            operationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(400);
    const suggested = await guest.request.post(collaborationPath, {
      headers,
      data: {
        action: "suggest",
        placeId: "bluebottle-westbund",
        operationId: randomUUID(),
      },
    });
    expect(suggested.status()).toBe(200);
    const suggestion = (await suggested.json()).collaboration.suggestions[0];
    for (let index = 0; index < 2; index++)
      expect(
        (
          await page.request.post(`/api/trips/${trip.id}/collaboration`, {
            headers,
            data: {
              action: "accept",
              suggestionId: suggestion.id,
              operationId: randomUUID(),
            },
          })
        ).status(),
      ).toBe(200);
    const chosen = (
      await (await page.request.get(`/api/trips/${trip.id}`)).json()
    ).trip;
    expect(chosen.savedPlaces).toHaveLength(2);
    expect(chosen.selectedPlaceIds).toEqual([]);
    await guestPage.reload();
    await expect(
      guestPage.getByRole("region", { name: "Group decisions" }),
    ).toContainText("Must go 1 · Interested 0 · Skip 0");
    await expect(
      guestPage.getByRole("region", { name: "Group decisions" }),
    ).toContainText("Source-backed coffee choice");
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
    expect((await guest.request.get(collaborationPath)).status()).toBe(404);
    expect(
      (
        await guest.request.post(collaborationPath, { headers, data: vote })
      ).status(),
    ).toBe(404);
    const history = (
      await (await page.request.get(`/api/trips/${trip.id}/invitation`)).json()
    ).participants;
    expect(history).toEqual([{ ...shared.participant, accessActive: false }]);
    expect(
      (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
        .savedPlaces,
    ).toHaveLength(2);
  } finally {
    await guest.close();
  }
});
