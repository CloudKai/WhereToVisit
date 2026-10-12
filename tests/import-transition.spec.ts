import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
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
    for (const title of ["Resolution", "Unavailable", "Slow", "Queued"]) {
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
    const savedTrip = (
      await (
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "save", intentId: pending.id },
        })
      ).json()
    ).trip;
    expect(savedTrip.dataKind).toBe("fixture");
    expect(savedTrip.savedPlaces[0].importedEvidence).toHaveLength(1);
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
    expect((await request.get(`/api/trips/${trip.id}`)).status()).toBe(404);
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
  }
});
