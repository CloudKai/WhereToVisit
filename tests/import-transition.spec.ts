import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { catalogueFixture } from "./catalogue-fixture";

const origin = "http://127.0.0.1:8180";
function launch(args: string[], env: NodeJS.ProcessEnv) {
  return spawn("npm", args, {
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function stop(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || !child.pid) return;
  const ended = once(child, "exit");
  // Only the process group created by this test is stopped. Main3000/8080 is untouched.
  process.kill(-child.pid, "SIGTERM");
  await ended;
}
test("stored fictional imports cannot be read or mutated after development storage becomes production", async ({
  request,
  playwright,
}) => {
  mkdirSync(".data", { recursive: true });
  const source = `./.data/transition-catalogue-${randomBytes(8).toString("hex")}.json`;
  writeFileSync(source, JSON.stringify(catalogueFixture()));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    CATALOGUE_DEVELOPMENT_SOURCE: source,
    DATABASE_PATH: `./.data/test-import-transition-${randomBytes(8).toString("hex")}.sqlite`,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    WIKIMEDIA_OPERATOR_CONTACT: "",
    IMPORTS_ENABLED: "1",
    ENABLE_DEVELOPMENT_IMPORT_FIXTURE: "1",
    ENABLE_DEVELOPMENT_TRIP_FIXTURE: "1",
  };
  execFileSync("npm", ["run", "db:migrate"], { env, stdio: "pipe" });
  const guest = await playwright.request.newContext({ baseURL: origin });
  let next: ChildProcess | null = null,
    nginx: ChildProcess | null = null;
  try {
    next = launch(["run", "dev", "--", "--port", "3100"], env);
    // Consume output so subprocess pipes cannot block during the lifecycle test.
    next.stdout?.resume();
    next.stderr?.resume();
    nginx = launch(
      ["run", "nginx:serve", "--", "--port", "8180", "--upstream", "3100"],
      env,
    );
    nginx.stdout?.resume();
    nginx.stderr?.resume();
    await expect
      .poll(
        async () => {
          try {
            return (await request.get("/", { timeout: 1000 })).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30_000 },
      )
      .toBe(200);
    const originals = [];
    for (const title of ["Resolution", "Unavailable"]) {
      const sourceUrl = `https://en.wikivoyage.org/wiki/Fixture_${title}`;
      const response = await request.post("/api/imports", {
        headers: { Origin: origin },
        data: { sourceUrl },
      });
      expect(response.status()).toBe(202);
      const job = (await response.json()).job;
      expect(job.dataKind).toBe("fixture");
      if (title !== "Slow" && title !== "Queued")
        await expect
          .poll(
            async () =>
              (await (await request.get(`/api/imports/${job.id}`)).json()).job
                .status,
          )
          .not.toMatch(/^(queued|processing)$/);
      if (title === "Resolution") {
        const resolved = await request.post(
          `/api/imports/${job.id}/resolution`,
          { headers: { Origin: origin }, data: { action: "resolve" } },
        );
        expect(resolved.status()).toBe(200);
        const mention = (await resolved.json()).job.mentions[0];
        const confirmed = await request.post(
          `/api/imports/${job.id}/resolution`,
          {
            headers: { Origin: origin },
            data: {
              action: "confirm",
              mentionId: mention.id,
              candidateId: "fictional-cafe-east",
            },
          },
        );
        expect(confirmed.status()).toBe(200);
        expect(
          (await (await request.get("/api/imports")).json()).resolvedPlaces,
        ).toHaveLength(1);
      }
      const before = (
        await (await request.get(`/api/imports/${job.id}`)).json()
      ).job;
      originals.push({ id: job.id, sourceUrl, before });
    }
    const headers = { Origin: origin };
    expect(
      (
        await request.post("/api/auth/sign-up/email", {
          headers,
          data: {
            name: "Transition organiser",
            email: `transition-${randomBytes(8).toString("hex")}@example.invalid`,
            password: "Transition-password-123",
          },
        })
      ).status(),
    ).toBe(200);
    const pending = (
      await (
        await request.post("/api/trip-save-intents", {
          headers,
          data: { placeId: "fictional-cafe-east", importId: originals[0].id },
        })
      ).json()
    ).intent;
    const trip = (
      await (
        await request.post("/api/trips", {
          headers,
          data: { title: "Fixture Trip", city: "Shanghai" },
        })
      ).json()
    ).trip;
    const initialInvitation = (
      await (
        await request.post(`/api/trips/${trip.id}/invitation`, {
          headers,
          data: { action: "create" },
        })
      ).json()
    ).invitation;
    expect(
      (
        await guest.post(`/api/invitations/${initialInvitation.token}`, {
          headers,
          data: { displayName: "Real empty guest" },
        })
      ).status(),
    ).toBe(201);
    let savedTrip = (
      await (
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "save", intentId: pending.id },
        })
      ).json()
    ).trip;
    expect(savedTrip.dataKind).toBe("fixture");
    expect(
      (await guest.get(`/api/invitations/${initialInvitation.token}`)).status(),
    ).toBe(404);
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
    const hiddenOldInvitation = await (
      await request.get(`/api/trips/${trip.id}/invitation`)
    ).json();
    expect(hiddenOldInvitation).toEqual({ invitation: null, participants: [] });
    const fixtureInvitation = (
      await (
        await request.post(`/api/trips/${trip.id}/invitation`, {
          headers,
          data: { action: "create" },
        })
      ).json()
    ).invitation;
    expect(
      (
        await guest.post(`/api/invitations/${fixtureInvitation.token}`, {
          headers,
          data: { displayName: "Fixture guest" },
        })
      ).status(),
    ).toBe(201);
    const collaborationPath = `/api/guest-trips/${trip.id}/collaboration`;
    const ownerCollaborationPath = `/api/trips/${trip.id}/collaboration`;
    const voteInput = {
      action: "vote",
      placeId: "fictional-cafe-east",
      choice: "must-go",
      operationId: randomUUID(),
    };
    for (const data of [
      voteInput,
      {
        action: "comment",
        placeId: "fictional-cafe-east",
        text: "Retained fixture comment",
        operationId: randomUUID(),
      },
      {
        action: "suggest",
        placeId: "fictional-cafe-west",
        operationId: randomUUID(),
      },
    ])
      expect(
        (await guest.post(collaborationPath, { headers, data })).status(),
      ).toBe(200);
    const suggestion = (await (await guest.get(collaborationPath)).json())
      .collaboration.suggestions[0];
    expect(
      (
        await request.post(ownerCollaborationPath, {
          headers,
          data: {
            action: "accept",
            suggestionId: suggestion.id,
            operationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(200);
    savedTrip = (await (await request.get(`/api/trips/${trip.id}`)).json())
      .trip;
    const retainedCollaboration = (
      await (await guest.get(collaborationPath)).json()
    ).collaboration;
    expect(retainedCollaboration.votes[0].choice).toBe("must-go");
    expect(savedTrip.savedPlaces).toHaveLength(2);
    const sharedFixture = (
      await (await guest.get(`/api/guest-trips/${trip.id}`)).json()
    ).shared;
    expect(sharedFixture.trip.dataKind).toBe("fixture");
    expect(sharedFixture.participants).toHaveLength(1);
    expect(sharedFixture.participants[0].displayName).toBe("Fixture guest");
    expect(
      sharedFixture.trip.savedPlaces[0].importedEvidence[0],
    ).not.toHaveProperty("importId");
    const retainedInvitation = await (
      await request.get(`/api/trips/${trip.id}/invitation`)
    ).json();
    expect(savedTrip.savedPlaces[0].importedEvidence).toHaveLength(1);
    // Admit pending workers immediately before stopping development: invitation setup
    // must not allow the Slow fixture to finish between its snapshot and the switch.
    for (const title of ["Slow", "Queued"]) {
      const sourceUrl = `https://en.wikivoyage.org/wiki/Fixture_${title}`;
      const response = await request.post("/api/imports", {
        headers,
        data: { sourceUrl },
      });
      expect(response.status()).toBe(202);
      const job = (await response.json()).job;
      const before = (
        await (await request.get(`/api/imports/${job.id}`)).json()
      ).job;
      originals.push({ id: job.id, sourceUrl, before });
    }
    await stop(next);
    next = null;
    next = launch(["run", "start", "--", "--port", "3100"], {
      ...env,
      NODE_ENV: "production",
    });
    next.stdout?.resume();
    next.stderr?.resume();
    await expect
      .poll(
        async () => {
          try {
            return (await request.get("/", { timeout: 1000 })).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30_000 },
      )
      .toBe(200);
    for (const [client, path] of [
      [guest, collaborationPath],
      [request, ownerCollaborationPath],
    ] as const) {
      expect((await client.get(path)).status()).toBe(404);
      for (const data of [
        voteInput,
        {
          action: "comment",
          placeId: "fictional-cafe-east",
          text: "Must not mutate",
          operationId: randomUUID(),
        },
        {
          action: "suggest",
          name: "Must not create",
          operationId: randomUUID(),
        },
        {
          action: "amend",
          suggestionId: suggestion.id,
          name: "Must not amend",
          operationId: randomUUID(),
        },
        {
          action: "accept",
          suggestionId: suggestion.id,
          operationId: randomUUID(),
        },
        {
          action: "reject",
          suggestionId: suggestion.id,
          operationId: randomUUID(),
        },
        {
          action: "confirm",
          suggestionId: suggestion.id,
          placeId: "fictional-cafe-east",
          operationId: randomUUID(),
        },
      ])
        expect((await client.post(path, { headers, data })).status()).toBe(404);
    }
    expect((await request.get(`/api/trips/${trip.id}`)).status()).toBe(404);
    expect(
      (await request.get(`/api/trips/${trip.id}/invitation`)).status(),
    ).toBe(404);
    for (const action of ["create", "disable", "replace"])
      expect(
        (
          await request.post(`/api/trips/${trip.id}/invitation`, {
            headers,
            data: { action },
          })
        ).status(),
      ).toBe(404);
    expect(
      (await guest.get(`/api/invitations/${fixtureInvitation.token}`)).status(),
    ).toBe(404);
    expect(
      (
        await guest.post(`/api/invitations/${fixtureInvitation.token}`, {
          headers,
          data: { displayName: "Must not join" },
        })
      ).status(),
    ).toBe(404);
    expect((await guest.get(`/api/guest-trips/${trip.id}`)).status()).toBe(404);
    expect((await (await request.get("/api/trips")).json()).trips).toEqual([]);
    expect(
      (await request.get(`/api/trip-save-intents/${pending.id}`)).status(),
    ).toBe(404);
    for (const data of [
      { action: "save", intentId: pending.id },
      { action: "remove", placeId: "fictional-cafe-east" },
      { action: "select", placeId: "fictional-cafe-east", selected: true },
      { action: "update", title: "Changed", city: "Shanghai" },
    ])
      expect(
        (
          await request.post(`/api/trips/${trip.id}`, { headers, data })
        ).status(),
      ).toBe(404);
    expect(
      (
        await request.post("/api/trip-save-intents", {
          headers,
          data: { placeId: "fictional-cafe-east", importId: originals[0].id },
        })
      ).status(),
    ).toBe(404);
    expect((await (await request.get("/api/imports")).json()).jobs).toEqual([]);
    expect(
      (await (await request.get("/api/imports")).json()).resolvedPlaces,
    ).toEqual([]);
    for (const job of originals) {
      for (const data of [
        { action: "resolve" },
        {
          action: "confirm",
          mentionId: job.before.mentions[0]?.id ?? "unknown",
          candidateId: "fictional-cafe-east",
        },
      ])
        expect(
          (
            await request.post(`/api/imports/${job.id}/resolution`, {
              headers: { Origin: origin },
              data,
            })
          ).status(),
        ).toBe(404);
      expect((await request.get(`/api/imports/${job.id}`)).status()).toBe(404);
      for (const action of ["retry", "cancel", "delete"])
        expect(
          (
            await request.post(`/api/imports/${job.id}`, {
              headers: { Origin: origin },
              data: { action },
            })
          ).status(),
        ).toBe(404);
    }
    const duplicate = await request.post("/api/imports", {
      headers: { Origin: origin },
      data: { sourceUrl: originals[0].sourceUrl },
    });
    expect(duplicate.status()).toBe(202);
    const replacement = (await duplicate.json()).job;
    expect(replacement.id).not.toBe(originals[0].id);
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/imports/${replacement.id}`)).json())
            .job.status,
      )
      .toBe("unsupported");
    expect(
      (await (await request.get(`/api/imports/${replacement.id}`)).json()).job,
    ).toMatchObject({
      dataKind: "real",
      reason: { code: "credentials-missing" },
      mentions: [],
      evidence: null,
    });
    await stop(next);
    next = null;
    next = launch(["run", "dev", "--", "--port", "3100"], env);
    next.stdout?.resume();
    next.stderr?.resume();
    await expect
      .poll(
        async () => {
          try {
            return (await request.get("/", { timeout: 1000 })).status();
          } catch {
            return 0;
          }
        },
        { timeout: 30_000 },
      )
      .toBe(200);
    expect(
      (await (await request.get(`/api/trips/${trip.id}`)).json()).trip,
    ).toEqual(savedTrip);
    expect(
      (await (await request.get(`/api/trip-save-intents/${pending.id}`)).json())
        .intent,
    ).toEqual(pending);
    expect(
      await (await request.get(`/api/trips/${trip.id}/invitation`)).json(),
    ).toEqual(retainedInvitation);
    expect(
      (await (await guest.get(`/api/guest-trips/${trip.id}`)).json()).shared,
    ).toEqual(sharedFixture);
    expect(
      (await (await guest.get(collaborationPath)).json()).collaboration,
    ).toEqual(retainedCollaboration);
    expect(
      (await (await request.get(ownerCollaborationPath)).json()).collaboration,
    ).toEqual({ ...retainedCollaboration, actorId: "organiser" });
    const resumedFixture = await guest.post(
      `/api/invitations/${fixtureInvitation.token}`,
      { headers, data: { displayName: "Must resume" } },
    );
    expect(resumedFixture.status()).toBe(200);
    expect((await resumedFixture.json()).shared).toEqual(sharedFixture);
    expect(
      await (await request.get(`/api/trips/${trip.id}/invitation`)).json(),
    ).toEqual(retainedInvitation);
    for (const original of originals) {
      const restored = (
        await (await request.get(`/api/imports/${original.id}`)).json()
      ).job;
      expect(restored).toEqual(original.before);
    }
    expect(
      (await (await request.get("/api/imports")).json()).resolvedPlaces,
    ).toHaveLength(1);
  } finally {
    await stop(next);
    await stop(nginx);
    await guest.dispose();
  }
});
