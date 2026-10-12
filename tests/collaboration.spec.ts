import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });
async function setup(request: APIRequestContext) {
  await expect
    .poll(
      async () =>
        (
          await request.post("/api/auth/sign-up/email", {
            headers,
            data: {
              name: "Organiser",
              email: `choices-${randomUUID()}@example.invalid`,
              password: "Choices-password-123",
            },
          })
        ).status(),
      { timeout: 70_000, intervals: [1000, 5000] },
    )
    .toBe(200);
  const trip = (
    await (
      await request.post("/api/trips", {
        headers,
        data: { title: "Coffee choices", city: "Shanghai" },
      })
    ).json()
  ).trip;
  const intent = (
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
        data: { action: "save", intentId: intent.id },
      })
    ).status(),
  ).toBe(200);
  const invitation = (
    await (
      await request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  return { trip, invitation };
}
async function mutate(
  request: APIRequestContext,
  id: string,
  data: Record<string, unknown>,
  owner = false,
) {
  return request.post(
    `/api/${owner ? "trips" : "guest-trips"}/${id}/collaboration`,
    { headers, data: { operationId: randomUUID(), ...data } },
  );
}
test("preferences persist, replace and clear without selecting the organiser's stops", async ({
  request,
  playwright,
}) => {
  const { trip, invitation } = await setup(request);
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    expect(
      (
        await guest.post(`/api/invitations/${invitation.token}`, {
          headers,
          data: { displayName: "Alex" },
        })
      ).status(),
    ).toBe(201);
    const vote = {
      action: "vote",
      placeId: "fictional-cafe-east",
      choice: "must-go",
    };
    expect((await mutate(guest, trip.id, vote)).status()).toBe(200);
    const read = async () =>
      (
        await (
          await guest.get(`/api/guest-trips/${trip.id}/collaboration`)
        ).json()
      ).collaboration;
    expect((await read()).votes).toHaveLength(1);
    expect((await read()).votes[0].choice).toBe("must-go");
    expect(
      (await mutate(guest, trip.id, { ...vote, choice: "skip" })).status(),
    ).toBe(200);
    expect((await read()).votes).toHaveLength(1);
    expect((await read()).votes[0].choice).toBe("skip");
    expect(
      (await mutate(guest, trip.id, { ...vote, choice: null })).status(),
    ).toBe(200);
    expect((await read()).votes).toEqual([]);
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .selectedPlaceIds,
    ).toEqual([]);
    expect(
      (
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: {
            action: "select",
            placeId: "fictional-cafe-east",
            selected: true,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .selectedPlaceIds,
    ).toEqual(["fictional-cafe-east"]);
  } finally {
    await guest.dispose();
  }
});

test("own comments amend and pending canonical suggestions enter the shortlist once", async ({
  request,
  playwright,
}) => {
  const { trip, invitation } = await setup(request);
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    await guest.post(`/api/invitations/${invitation.token}`, {
      headers,
      data: { displayName: "Alex" },
    });
    expect(
      (
        await mutate(guest, trip.id, {
          action: "comment",
          placeId: "fictional-cafe-east",
          text: "Coffee first",
        })
      ).status(),
    ).toBe(200);
    const amended = await mutate(guest, trip.id, {
      action: "comment",
      placeId: "fictional-cafe-east",
      text: "Coffee after lunch",
    });
    expect((await amended.json()).collaboration.comments).toEqual([
      expect.objectContaining({
        text: "Coffee after lunch",
        placeId: "fictional-cafe-east",
      }),
    ]);
    const suggested = await mutate(guest, trip.id, {
      action: "suggest",
      placeId: "fictional-cafe-west",
    });
    expect(suggested.status()).toBe(200);
    const suggestion = (await suggested.json()).collaboration.suggestions[0];
    expect(suggestion.state).toBe("pending");
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .savedPlaces,
    ).toHaveLength(1);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await mutate(
            request,
            trip.id,
            { action: "accept", suggestionId: suggestion.id },
            true,
          )
        ).status(),
      ).toBe(200);
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .savedPlaces,
    ).toHaveLength(2);
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .selectedPlaceIds,
    ).toEqual([]);
    const unresolved = await mutate(guest, trip.id, {
      action: "suggest",
      name: "Unknown Shanghai café",
    });
    const unknown = (await unresolved.json()).collaboration.suggestions.at(-1);
    expect(
      (
        await mutate(
          request,
          trip.id,
          { action: "accept", suggestionId: unknown.id },
          true,
        )
      ).status(),
    ).toBe(200);
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .savedPlaces,
    ).toHaveLength(2);
    expect(
      (
        await mutate(
          request,
          trip.id,
          {
            action: "confirm",
            suggestionId: unknown.id,
            placeId: "fictional-cafe-east",
          },
          true,
        )
      ).status(),
    ).toBe(200);
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .savedPlaces,
    ).toHaveLength(2);
  } finally {
    await guest.dispose();
  }
});

test("two browser guests discuss choices and organiser accepts without automatic selection", async ({
  page,
  browser,
}, testInfo) => {
  const { trip, invitation } = await setup(page.request);
  const first = await browser.newContext(),
    second = await browser.newContext();
  try {
    const alex = await first.newPage(),
      another = await second.newPage();
    for (const guest of [alex, another]) {
      await guest.goto(invitation.url);
      await guest.getByLabel("Display name").fill("Alex");
      await guest.getByRole("button", { name: "Join as guest" }).click();
      await expect(
        guest.getByRole("heading", { name: trip.title }),
      ).toBeVisible();
    }
    await alex
      .getByLabel("Your preference for East branch")
      .selectOption("must-go");
    await expect(
      alex
        .getByRole("status")
        .filter({ hasText: "Collaboration change saved" }),
    ).toBeVisible();
    await alex
      .getByLabel("Your comment for East branch")
      .fill("Coffee before lunch");
    await alex
      .getByRole("button", { name: "Save comment for East branch" })
      .click();
    await another
      .getByLabel("Your preference for East branch")
      .selectOption("skip");
    await another
      .getByLabel("Your comment for East branch")
      .fill("Prefer the West branch");
    await another
      .getByRole("button", { name: "Save comment for East branch" })
      .click();
    await alex.getByRole("button", { name: "Refresh collaboration" }).click();
    const discussion = alex.getByRole("region", {
      name: "Discussion for East branch",
    });
    await expect(discussion).toContainText("Must go 1 · Interested 0 · Skip 1");
    await expect(discussion).toContainText("Alex · Guest 2: Skip");
    await expect(discussion).toContainText("Prefer the West branch");
    await alex
      .getByLabel("Your preference for East branch")
      .selectOption("interested");
    await expect(discussion).toContainText("Must go 0 · Interested 1 · Skip 1");
    await alex.getByLabel("Your preference for East branch").selectOption("");
    await expect(discussion).toContainText("Alex · Guest 1: No vote");
    await alex
      .getByLabel("Your comment for East branch")
      .fill("Coffee after lunch");
    await alex
      .getByRole("button", { name: "Save comment for East branch" })
      .click();
    await expect(discussion).toContainText("Coffee after lunch");
    await alex
      .getByLabel("Canonical branch to suggest")
      .selectOption("fictional-cafe-west");
    await alex
      .getByRole("button", { name: "Suggest canonical branch" })
      .click();
    await expect(
      alex.getByRole("region", { name: "Place suggestions" }),
    ).toContainText("pending");
    await page.goto("/trips");
    await page.getByRole("button", { name: "Accept suggestion" }).click();
    await expect(
      page.getByLabel("Select West branch for a day plan"),
    ).toBeVisible();
    await expect(
      page.getByLabel("Select West branch for a day plan"),
    ).not.toBeChecked();
    await page.getByLabel("Select West branch for a day plan").click();
    await expect(
      page.getByLabel("Select West branch for a day plan"),
    ).toBeChecked();
    await expect(
      page.getByRole("status").filter({ hasText: "Trip changes saved" }),
    ).toBeVisible();
    await alex.reload();
    await expect(
      alex.getByLabel("Your preference for East branch"),
    ).toHaveValue("");
    await expect(
      alex.getByRole("region", { name: "Discussion for East branch" }),
    ).toContainText("Coffee after lunch");
    for (const width of [375, 1280]) {
      await alex.setViewportSize({ width, height: 900 });
      expect(
        await alex.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await alex.screenshot({
        path: testInfo.outputPath(`collaboration-${width}.png`),
        fullPage: true,
      });
    }
  } finally {
    await first.close();
    await second.close();
  }
});

test("authoritative actors reject cross-participant changes and revoked retries while retaining history", async ({
  request,
  playwright,
}) => {
  const { trip, invitation } = await setup(request);
  const first = await playwright.request.newContext({ baseURL: origin }),
    second = await playwright.request.newContext({ baseURL: origin }),
    stranger = await playwright.request.newContext({ baseURL: origin });
  try {
    for (const guest of [first, second])
      await guest.post(`/api/invitations/${invitation.token}`, {
        headers,
        data: { displayName: "Alex" },
      });
    const comment = (
      await (
        await mutate(first, trip.id, {
          action: "comment",
          placeId: "fictional-cafe-east",
          text: "My choice",
        })
      ).json()
    ).collaboration.comments[0];
    const suggestion = (
      await (
        await mutate(first, trip.id, {
          action: "suggest",
          name: "Original request",
        })
      ).json()
    ).collaboration.suggestions[0];
    expect(
      (
        await mutate(second, trip.id, {
          action: "comment",
          placeId: comment.placeId,
          commentId: comment.id,
          text: "Forged",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await mutate(second, trip.id, {
          action: "amend",
          suggestionId: suggestion.id,
          name: "Forged",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await mutate(first, trip.id, {
          action: "amend",
          suggestionId: suggestion.id,
          name: "Corrected request",
        })
      ).status(),
    ).toBe(200);
    for (const action of ["accept", "reject", "confirm"])
      expect(
        (
          await mutate(first, trip.id, {
            action,
            suggestionId: suggestion.id,
            ...(action === "confirm" ? { placeId: "fictional-cafe-east" } : {}),
          })
        ).status(),
      ).toBe(403);
    expect(
      (
        await mutate(
          request,
          trip.id,
          { action: "reject", suggestionId: suggestion.id },
          true,
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await mutate(
          request,
          trip.id,
          { action: "accept", suggestionId: suggestion.id },
          true,
        )
      ).status(),
    ).toBe(409);
    const vote = {
      action: "vote",
      placeId: "fictional-cafe-east",
      choice: "must-go",
      operationId: randomUUID(),
    };
    for (const action of ["toString", "__proto__", ["suggest"]])
      expect(
        (
          await mutate(first, trip.id, { action, name: "Malformed action" })
        ).status(),
      ).toBe(400);
    expect(
      (
        await mutate(first, trip.id, { ...vote, actorId: comment.actorId })
      ).status(),
    ).toBe(400);
    expect(
      (await mutate(first, trip.id, { ...vote, role: "organiser" })).status(),
    ).toBe(400);
    expect((await mutate(stranger, trip.id, vote)).status()).toBe(404);
    expect(
      (
        await stranger.get(`/api/guest-trips/${trip.id}/collaboration`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await first.post(`/api/guest-trips/${trip.id}/collaboration`, {
          headers: { Origin: "https://other.invalid" },
          data: vote,
        })
      ).status(),
    ).toBe(403);
    const other = await setup(stranger);
    expect(
      (
        await first.get(`/api/guest-trips/${other.trip.id}/collaboration`)
      ).status(),
    ).toBe(404);
    expect(
      (await stranger.get(`/api/trips/${trip.id}/collaboration`)).status(),
    ).toBe(404);
    expect((await mutate(stranger, trip.id, vote, true)).status()).toBe(404);
    expect((await mutate(first, trip.id, vote)).status()).toBe(200);
    const shared = await (
      await first.get(`/api/guest-trips/${trip.id}/collaboration`)
    ).text();
    for (const privateValue of [
      trip.organiserUserId,
      invitation.token,
      invitation.generation,
      "receipts",
      "organiserUserId",
      "sessionDigest",
      "importId",
      "mentionId",
    ])
      expect(shared).not.toContain(privateValue);
    await request.post(`/api/trips/${trip.id}/invitation`, {
      headers,
      data: { action: "replace" },
    });
    for (const guest of [first, second]) {
      expect(
        (await guest.get(`/api/guest-trips/${trip.id}/collaboration`)).status(),
      ).toBe(404);
      for (const data of [
        vote,
        { action: "comment", placeId: comment.placeId, text: "Revoked" },
        { action: "suggest", name: "Revoked" },
        { action: "amend", suggestionId: suggestion.id, name: "Revoked" },
      ])
        expect((await mutate(guest, trip.id, data)).status()).toBe(404);
    }
    const history = (
      await (await request.get(`/api/trips/${trip.id}/collaboration`)).json()
    ).collaboration;
    expect(history.comments).toEqual([comment]);
    expect(history.votes).toHaveLength(1);
    expect(
      history.participants.every(
        (participant: { accessActive: boolean }) => !participant.accessActive,
      ),
    ).toBe(true);
  } finally {
    await first.dispose();
    await second.dispose();
    await stranger.dispose();
  }
});

test("concurrent contributions and actor-scoped retries count once without replaying older preferences", async ({
  request,
  playwright,
}) => {
  const { trip, invitation } = await setup(request);
  const first = await playwright.request.newContext({ baseURL: origin }),
    second = await playwright.request.newContext({ baseURL: origin });
  try {
    for (const guest of [first, second])
      await guest.post(`/api/invitations/${invitation.token}`, {
        headers,
        data: { displayName: "Alex" },
      });
    const duplicate = {
      action: "suggest",
      name: "One suggestion",
      operationId: randomUUID(),
    };
    const results = await Promise.all([
      mutate(first, trip.id, duplicate),
      mutate(first, trip.id, duplicate),
    ]);
    expect(results.map((response) => response.status())).toEqual([200, 200]);
    expect((await results[1].json()).collaboration.suggestions).toHaveLength(1);
    expect(
      (
        await mutate(first, trip.id, {
          ...duplicate,
          name: "Different payload",
        })
      ).status(),
    ).toBe(409);
    const old = {
      action: "vote",
      placeId: "fictional-cafe-east",
      choice: "must-go",
      operationId: randomUUID(),
    };
    expect((await mutate(first, trip.id, old)).status()).toBe(200);
    const votes = await Promise.all([
      mutate(first, trip.id, {
        ...old,
        choice: "interested",
        operationId: randomUUID(),
      }),
      mutate(second, trip.id, { ...old, choice: "skip" }),
    ]);
    expect(votes.map((response) => response.status())).toEqual([200, 200]);
    expect((await mutate(first, trip.id, old)).status()).toBe(200);
    const current = (
      await (
        await first.get(`/api/guest-trips/${trip.id}/collaboration`)
      ).json()
    ).collaboration;
    expect(
      current.votes.map((vote: { choice: string }) => vote.choice).sort(),
    ).toEqual(["interested", "skip"]);
    const pending = (
      await (
        await mutate(first, trip.id, {
          action: "suggest",
          placeId: "fictional-cafe-west",
        })
      ).json()
    ).collaboration.suggestions.at(-1);
    const decisions = await Promise.all([
      mutate(
        request,
        trip.id,
        { action: "accept", suggestionId: pending.id },
        true,
      ),
      mutate(
        request,
        trip.id,
        { action: "accept", suggestionId: pending.id },
        true,
      ),
    ]);
    expect(decisions.map((response) => response.status())).toEqual([200, 200]);
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip
        .savedPlaces,
    ).toHaveLength(2);
    const comment = {
      action: "comment",
      placeId: "fictional-cafe-east",
      text: "One comment",
      operationId: randomUUID(),
    };
    const comments = await Promise.all([
      mutate(first, trip.id, comment),
      mutate(first, trip.id, comment),
    ]);
    expect(comments.map((response) => response.status())).toEqual([200, 200]);
    expect((await comments[1].json()).collaboration.comments).toHaveLength(1);
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

test("real failed writes and lost responses preserve explicit browser retry without duplicate suggestions", async ({
  page,
  browser,
}) => {
  const { trip, invitation } = await setup(page.request);
  const guestContext = await browser.newContext();
  const config = JSON.parse(
    readFileSync(".data/trip-storage-test.json", "utf8"),
  );
  const lock = new Database(config.databasePath);
  try {
    const guest = await guestContext.newPage();
    await guest.goto(invitation.url);
    await guest.getByLabel("Display name").fill("Write guest");
    await guest.getByRole("button", { name: "Join as guest" }).click();
    await expect(
      guest.getByLabel("Your preference for East branch"),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Refresh collaboration" }),
    ).toBeEnabled();
    lock.exec("BEGIN IMMEDIATE");
    await guest
      .getByLabel("Your preference for East branch")
      .selectOption("must-go");
    await expect(
      guest.getByRole("alert", { name: "Collaboration request failed" }),
    ).toContainText("No new change is confirmed", { timeout: 15_000 });
    await expect(
      guest.getByLabel("Your preference for East branch"),
    ).toHaveValue("");
    expect(
      (
        await (
          await guestContext.request.get(
            `/api/guest-trips/${trip.id}/collaboration`,
          )
        ).json()
      ).collaboration.votes,
    ).toEqual([]);
    lock.exec("ROLLBACK");
    await guest.getByRole("button", { name: "Retry collaboration" }).click();
    await expect(
      guest.getByLabel("Your preference for East branch"),
    ).toHaveValue("must-go");
    await guest.route("**/api/guest-trips/*/collaboration", async (route) => {
      if (route.request().method() === "POST") {
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await guest
      .getByLabel("Unresolved Place name")
      .fill("Lost response request");
    await guest
      .getByRole("button", { name: "Suggest unresolved Place" })
      .click();
    await expect(
      guest.getByRole("alert", { name: "Collaboration request failed" }),
    ).toBeVisible();
    expect(
      (
        await (
          await guestContext.request.get(
            `/api/guest-trips/${trip.id}/collaboration`,
          )
        ).json()
      ).collaboration.suggestions,
    ).toHaveLength(1);
    await guest.unroute("**/api/guest-trips/*/collaboration");
    await guest.getByRole("button", { name: "Retry collaboration" }).click();
    await expect(
      guest
        .getByRole("status")
        .filter({ hasText: "Collaboration change saved" }),
    ).toBeVisible();
    expect(
      (
        await (
          await guestContext.request.get(
            `/api/guest-trips/${trip.id}/collaboration`,
          )
        ).json()
      ).collaboration.suggestions,
    ).toHaveLength(1);
    await page.request.post(`/api/trips/${trip.id}/invitation`, {
      headers,
      data: { action: "disable" },
    });
    await guest
      .getByLabel("Your preference for East branch")
      .selectOption("skip");
    await expect(
      guest.getByRole("alert", { name: "Guest access unavailable" }),
    ).toBeVisible();
    await expect(guest.getByRole("heading", { name: trip.title })).toHaveCount(
      0,
    );
  } finally {
    lock.close();
    await guestContext.close();
  }
});

test("canonical suggestions cannot mix data kinds or revive an old guest generation", async ({
  request,
  playwright,
}) => {
  const { trip, invitation } = await setup(request);
  const guest = await playwright.request.newContext({ baseURL: origin });
  const path = ".data/catalogue-scenario.json",
    before = readFileSync(path);
  try {
    await guest.post(`/api/invitations/${invitation.token}`, {
      headers,
      data: { displayName: "Fixture guest" },
    });
    const fixtureVote = {
      action: "vote",
      placeId: "fictional-cafe-east",
      choice: "must-go",
      operationId: randomUUID(),
    };
    expect((await mutate(guest, trip.id, fixtureVote)).status()).toBe(200);
    writeFileSync(path, readFileSync("data/catalogue/shanghai.json"));
    expect(
      (
        await mutate(guest, trip.id, {
          action: "suggest",
          placeId: "bluebottle-zhangyuan",
        })
      ).status(),
    ).toBe(400);
    await request.post(`/api/trips/${trip.id}`, {
      headers,
      data: { action: "remove", placeId: "fictional-cafe-east" },
    });
    const intent = (
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
          data: { action: "save", intentId: intent.id },
        })
      ).status(),
    ).toBe(200);
    expect((await mutate(guest, trip.id, fixtureVote)).status()).toBe(404);
    expect(
      (await (await request.get(`/api/trips/${trip.id}/collaboration`)).json())
        .collaboration.votes,
    ).toEqual([]);
    const real = (
      await (
        await request.post(`/api/trips/${trip.id}/invitation`, {
          headers,
          data: { action: "replace" },
        })
      ).json()
    ).invitation;
    await guest.post(`/api/invitations/${real.token}`, {
      headers,
      data: { displayName: "Real guest" },
    });
    expect(
      (
        await mutate(guest, trip.id, {
          action: "vote",
          placeId: "bluebottle-zhangyuan",
          choice: "skip",
        })
      ).status(),
    ).toBe(200);
    await request.post(`/api/trips/${trip.id}`, {
      headers,
      data: { action: "remove", placeId: "bluebottle-zhangyuan" },
    });
    writeFileSync(path, before);
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
    expect(
      (await guest.get(`/api/guest-trips/${trip.id}/collaboration`)).status(),
    ).toBe(404);
    expect((await mutate(guest, trip.id, fixtureVote)).status()).toBe(404);
    const restored = (
      await (await request.get(`/api/trips/${trip.id}/collaboration`)).json()
    ).collaboration;
    expect(restored.votes).toEqual([
      expect.objectContaining({
        choice: "must-go",
        placeId: "fictional-cafe-east",
      }),
    ]);
    expect(restored.participants[0].accessActive).toBe(false);
  } finally {
    writeFileSync(path, before);
    await guest.dispose();
  }
});
