import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });
async function owner(request: APIRequestContext) {
  const email = `invitation-${randomBytes(8).toString("hex")}@example.invalid`;
  await expect
    .poll(
      async () =>
        (
          await request.post("/api/auth/sign-up/email", {
            headers,
            data: {
              name: "Organiser",
              email,
              password: "Invitation-password-123",
            },
          })
        ).status(),
      { timeout: 70_000, intervals: [1000, 5000] },
    )
    .toBe(200);
  const response = await request.post("/api/trips", {
    headers,
    data: { title: "Private guest coffee", city: "Shanghai" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).trip;
}
test("owner invitation explicitly joins and resumes a guest without leaking private authority", async ({
  request,
  playwright,
}) => {
  const trip = await owner(request);
  const created = await request.post(`/api/trips/${trip.id}/invitation`, {
    headers,
    data: { action: "create" },
  });
  expect(created.status()).toBe(201);
  const invitation = (await created.json()).invitation;
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    expect(
      (await guest.get(`/api/invitations/${invitation.token}`)).status(),
    ).toBe(200);
    expect(
      (await (await request.get(`/api/trips/${trip.id}/invitation`)).json())
        .participants,
    ).toEqual([]);
    const joined = await guest.post(`/api/invitations/${invitation.token}`, {
      headers,
      data: { displayName: "Alex" },
    });
    expect(joined.status()).toBe(201);
    const shared = (await joined.json()).shared;
    expect(shared.trip).toEqual({
      id: trip.id,
      title: "Private guest coffee",
      city: "Shanghai",
      dataKind: "real",
      savedPlaces: [],
      selectedPlaceIds: [],
      dayPlanIds: [],
      dayPlan: { draft: null, selectionRevision: 0, needsReview: false },
    });
    expect(shared.participant.displayName).toBe("Alex");
    expect(
      (await (await guest.get(`/api/guest-trips/${trip.id}`)).json()).shared
        .participant.id,
    ).toBe(shared.participant.id);
    expect(
      (
        await (
          await guest.post(`/api/invitations/${invitation.token}`, {
            headers,
            data: { displayName: "Another name" },
          })
        ).json()
      ).shared.participant.id,
    ).toBe(shared.participant.id);
    expect(
      (await (await request.get(`/api/trips/${trip.id}/invitation`)).json())
        .participants,
    ).toHaveLength(1);
    expect((await guest.get(`/api/trips/${trip.id}`)).status()).toBe(401);
    expect(
      (
        await guest.post(`/api/trips/${trip.id}/invitation`, {
          headers,
          data: { action: "disable", organiserUserId: trip.organiserUserId },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await guest.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "select", placeId: "guessed", selected: true },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await guest.dispose();
  }
});

test("browser guests have distinct duplicate names, return once, and lose generation access without erasing history", async ({
  page,
  browser,
}, testInfo) => {
  const trip = await owner(page.request);
  await page.goto("/trips", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  const token = link.split("/").at(-1);
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const guest = await first.newPage();
    await guest.goto(link);
    await expect(
      guest.getByRole("heading", { name: "Join a Trip" }),
    ).toBeVisible();
    await expect(guest.getByText(trip.title, { exact: true })).toHaveCount(0);
    await guest.getByLabel("Display name").fill("Alex");
    await guest.getByRole("button", { name: "Join as guest" }).click();
    await expect(
      guest.getByRole("heading", { name: trip.title }),
    ).toBeVisible();
    await expect(
      guest.getByText("You are Alex · Guest 1", { exact: true }),
    ).toBeVisible();
    const secondPage = await second.newPage();
    await secondPage.goto(link);
    await secondPage.getByLabel("Display name").fill("Alex");
    await secondPage.getByRole("button", { name: "Join as guest" }).click();
    await expect(
      secondPage.getByText("You are Alex · Guest 2", { exact: true }),
    ).toBeVisible();
    await guest.reload();
    await expect(
      guest.getByText("You are Alex · Guest 1", { exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("region", { name: "Trip participants" }),
    ).toContainText("Alex · Guest 2");
    const before = (
      await (await page.request.get(`/api/trips/${trip.id}/invitation`)).json()
    ).participants;
    expect(before).toHaveLength(2);
    expect(before[0].id).not.toBe(before[1].id);
    for (const width of [375, 1280]) {
      await guest.setViewportSize({ width, height: 900 });
      expect(
        await guest.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await guest.screenshot({
        path: testInfo.outputPath(`guest-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Disable invitation" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Invitation disabled" }),
    ).toBeVisible();
    expect(
      (await first.request.get(`/api/guest-trips/${trip.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await second.request.post(`/api/invitations/${token}`, {
          headers,
          data: { displayName: "Again" },
        })
      ).status(),
    ).toBe(404);
    await guest.getByRole("button", { name: "Refresh shared Trip" }).click();
    await expect(
      guest.getByRole("alert", { name: "Guest access unavailable" }),
    ).toBeVisible();
    await expect(guest.getByRole("heading", { name: trip.title })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Replace invitation" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Invitation replaced" }),
    ).toBeVisible();
    const replacement = await page
      .getByLabel("Invitation link", { exact: true })
      .inputValue();
    expect(replacement).not.toBe(link);
    expect(
      (await first.request.get(`/api/invitations/${token}`)).status(),
    ).toBe(404);
    const after = (
      await (await page.request.get(`/api/trips/${trip.id}/invitation`)).json()
    ).participants;
    expect(after).toEqual(
      before.map((participant: object) => ({
        ...participant,
        accessActive: false,
      })),
    );
    expect(
      (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip,
    ).toEqual(trip);
    await guest.goto(replacement);
    await guest.getByLabel("Display name").fill("Alex");
    await guest.getByRole("button", { name: "Join as guest" }).click();
    await expect(
      guest.getByText("You are Alex · Guest 3", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Invitation and participants" }),
    ).toContainText("Alex · Guest 1 — access ended");
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath("owner-invitation-375.png"),
      fullPage: true,
    });
  } finally {
    await first.close();
    await second.close();
  }
});

test("invitation and join storage failures preserve authority and honest retries, with copy recovery", async ({
  page,
  browser,
}) => {
  const trip = await owner(page.request);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("Clipboard denied")) },
    }),
  );
  await page.goto("/trips");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Copy invitation link" }).click();
  await expect(
    page.getByRole("alert", { name: "Invitation request failed" }),
  ).toContainText("Copy failed");
  await expect(
    page.getByRole("status").filter({ hasText: "copied" }),
  ).toHaveCount(0);
  const config = JSON.parse(
    readFileSync(".data/trip-storage-test.json", "utf8"),
  );
  const lock = new Database(config.databasePath);
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto(link);
    await guest.getByLabel("Display name").fill("Storage guest");
    lock.exec("BEGIN IMMEDIATE");
    await guest.getByRole("button", { name: "Join as guest" }).click();
    await expect(
      guest.getByRole("alert", { name: "Guest access unavailable" }),
    ).toContainText("could not be saved", { timeout: 15_000 });
    expect(
      (
        await (
          await page.request.get(`/api/trips/${trip.id}/invitation`)
        ).json()
      ).participants,
    ).toEqual([]);
    lock.exec("ROLLBACK");
    await guest.getByRole("button", { name: "Retry guest request" }).click();
    await expect(
      guest.getByText("You are Storage guest · Guest 1", { exact: true }),
    ).toBeVisible();
    lock.exec("BEGIN IMMEDIATE");
    await page.getByRole("button", { name: "Replace invitation" }).click();
    await expect(
      page.getByRole("alert", { name: "Invitation request failed" }),
    ).toContainText("could not be saved", { timeout: 15_000 });
    expect(
      await page.getByLabel("Invitation link", { exact: true }).inputValue(),
    ).toBe(link);
    expect(
      (await guestContext.request.get(`/api/guest-trips/${trip.id}`)).status(),
    ).toBe(200);
    lock.exec("ROLLBACK");
    await page.getByRole("button", { name: "Retry invitation" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Invitation replaced" }),
    ).toBeVisible();
    expect(
      await page.getByLabel("Invitation link", { exact: true }).inputValue(),
    ).not.toBe(link);
    expect(
      (await guestContext.request.get(`/api/guest-trips/${trip.id}`)).status(),
    ).toBe(404);
    const newLink = await page
      .getByLabel("Invitation link", { exact: true })
      .inputValue();
    await page.route("**/api/trips/*/invitation", (route) => route.abort());
    await page.getByRole("button", { name: "Disable invitation" }).click();
    await expect(
      page.getByRole("alert", { name: "Invitation request failed" }),
    ).toBeVisible();
    expect(
      (
        await guestContext.request.get(
          `/api/invitations/${newLink.split("/").at(-1)}`,
        )
      ).status(),
    ).toBe(200);
    await page.unroute("**/api/trips/*/invitation");
    await page.getByRole("button", { name: "Retry invitation" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Invitation disabled" }),
    ).toBeVisible();
  } finally {
    lock.close();
    await guestContext.close();
  }
});

test("link possession needs explicit bounded join and cannot forge owner or another Trip authority", async ({
  request,
  playwright,
}) => {
  const trip = await owner(request);
  const created = (
    await (
      await request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await playwright.request.newContext({ baseURL: origin });
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    const otherTrip = await owner(other);
    for (const action of ["create", "disable", "replace"])
      expect(
        (
          await other.post(`/api/trips/${trip.id}/invitation`, {
            headers,
            data: { action },
          })
        ).status(),
      ).toBe(404);
    expect((await other.get(`/api/trips/${trip.id}/invitation`)).status()).toBe(
      404,
    );
    for (const displayName of ["", "   ", "a".repeat(81), "Line\nBreak"])
      expect(
        (
          await guest.post(`/api/invitations/${created.token}`, {
            headers,
            data: { displayName },
          })
        ).status(),
      ).toBe(400);
    expect(
      (
        await guest.post(`/api/invitations/${created.token}`, {
          headers: { Origin: "https://other.invalid" },
          data: { displayName: "Alex" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await guest.get(`/api/invitations/${created.token}`)).headers()[
        "set-cookie"
      ],
    ).toBeUndefined();
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
    expect(
      (
        await guest.post(`/api/invitations/${created.token}`, {
          headers,
          data: { displayName: "Alex", role: "organiser" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await guest.post(`/api/invitations/${created.token}`, {
          headers,
          data: { displayName: "Alex" },
        })
      ).status(),
    ).toBe(201);
    for (const data of [
      { action: "update", title: "Forged", city: "Shanghai" },
      { action: "save", intentId: "guessed" },
      { action: "remove", placeId: "guessed" },
      { action: "select", placeId: "guessed", selected: true },
    ])
      expect(
        (await guest.post(`/api/trips/${trip.id}`, { headers, data })).status(),
      ).toBe(401);
    expect((await guest.get(`/api/guest-trips/${otherTrip.id}`)).status()).toBe(
      404,
    );
    expect(
      (
        await guest.post(`/api/guest-trips/${trip.id}`, {
          headers,
          data: { action: "select", selected: true },
        })
      ).status(),
    ).toBe(405);
    expect(
      (await guest.get(`/api/invitations/${"a".repeat(43)}`)).status(),
    ).toBe(404);
    const unavailable = await (
      await guest.get(`/api/invitations/${"a".repeat(43)}`)
    ).text();
    expect(unavailable).not.toContain(trip.title);
    expect(unavailable).not.toContain(trip.organiserUserId);
    expect(
      await (await guest.get("/api/catalogue?city=Shanghai")).text(),
    ).not.toContain(trip.title);
    // Storage loss cannot recover or impersonate a previous participant by reusing its display name.
    await guest.dispose();
    const fresh = await playwright.request.newContext({ baseURL: origin });
    try {
      expect((await fresh.get(`/api/guest-trips/${trip.id}`)).status()).toBe(
        404,
      );
      const join = await fresh.post(`/api/invitations/${created.token}`, {
        headers,
        data: { displayName: "Alex" },
      });
      expect((await join.json()).shared.participant.displayNumber).toBe(2);
    } finally {
      await fresh.dispose();
    }
  } finally {
    await other.dispose();
  }
});

test("invalid guest name remains correctable and an unsupported clipboard offers manual copying", async ({
  page,
  browser,
}) => {
  const trip = await owner(page.request);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: undefined }),
  );
  await page.goto("/trips");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Copy invitation link" }).click();
  await expect(
    page.getByRole("alert", { name: "Invitation request failed" }),
  ).toContainText("copy the invitation link manually");
  const guest = await browser.newContext();
  try {
    const joined = await guest.newPage();
    await joined.goto(link);
    await joined.getByLabel("Display name").fill("   ");
    await joined.getByRole("button", { name: "Join as guest" }).click();
    await expect(
      joined.getByRole("alert", { name: "Guest access unavailable" }),
    ).toContainText("display name");
    await joined.getByLabel("Display name").fill("Corrected name");
    await joined.getByRole("button", { name: "Join as guest" }).click();
    await expect(
      joined.getByRole("heading", { name: trip.title }),
    ).toBeVisible();
    expect(
      (
        await (
          await page.request.get(`/api/trips/${trip.id}/invitation`)
        ).json()
      ).participants,
    ).toHaveLength(1);
  } finally {
    await guest.close();
  }
});

test("changing an empty Trip's data kind permanently ends the previous invitation generation", async ({
  request,
  playwright,
}) => {
  const trip = await owner(request);
  const created = (
    await (
      await request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await playwright.request.newContext({ baseURL: origin });
  const path = ".data/catalogue-scenario.json";
  const before = readFileSync(path);
  try {
    const first = await guest.post(`/api/invitations/${created.token}`, {
      headers,
      data: { displayName: "Original real guest" },
    });
    expect(first.status()).toBe(201);
    const participant = (await first.json()).shared.participant;
    const fictional = (
      await (
        await request.post("/api/trip-save-intents", {
          headers,
          data: { placeId: "fictional-cafe-east" },
        })
      ).json()
    ).intent;
    expect(
      (
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "save", intentId: fictional.id },
        })
      ).status(),
    ).toBe(200);
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
    await request.post(`/api/trips/${trip.id}`, {
      headers,
      data: { action: "remove", placeId: "fictional-cafe-east" },
    });
    writeFileSync(path, readFileSync("data/catalogue/shanghai.json"));
    const real = (
      await (
        await request.post("/api/trip-save-intents", {
          headers,
          data: { placeId: "bluebottle-zhangyuan" },
        })
      ).json()
    ).intent;
    expect(
      (
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "save", intentId: real.id },
        })
      ).status(),
    ).toBe(200);
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
    expect(
      (
        await guest.post(`/api/invitations/${created.token}`, {
          headers,
          data: { displayName: "Must not revive" },
        })
      ).status(),
    ).toBe(404);
    const management = await (
      await request.get(`/api/trips/${trip.id}/invitation`)
    ).json();
    expect(management.invitation.state).toBe("disabled");
    expect(management.participants).toEqual([
      { ...participant, accessActive: false },
    ]);
  } finally {
    writeFileSync(path, before);
    await guest.dispose();
  }
});
