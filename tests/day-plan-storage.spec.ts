import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { catalogueFixture } from "./catalogue-fixture";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
async function stop(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || !child.pid) return;
  const ended = once(child, "exit");
  process.kill(-child.pid, "SIGTERM");
  await ended;
}
test("retained fixture day drafts and receipts stay inaccessible in production and opt-out development", async ({
  request,
  playwright,
}, testInfo) => {
  mkdirSync(".data", { recursive: true });
  const source = `./.data/day-transition-${randomUUID()}.json`;
  writeFileSync(source, JSON.stringify(catalogueFixture()));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    CATALOGUE_DEVELOPMENT_SOURCE: source,
    DATABASE_PATH: `./.data/day-transition-${randomUUID()}.sqlite`,
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
  function launch(args: string[], configuration: NodeJS.ProcessEnv = env) {
    const child = spawn("npm", args, {
      env: configuration,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = testInfo.outputPath("runtime.log");
    child.stdout?.on("data", (chunk) => appendFileSync(output, chunk));
    child.stderr?.on("data", (chunk) => appendFileSync(output, chunk));
    return child;
  }
  async function ready() {
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
  }
  try {
    next = launch(["run", "dev", "--", "--port", "3100"]);
    nginx = launch([
      "run",
      "nginx:serve",
      "--",
      "--port",
      "8180",
      "--upstream",
      "3100",
    ]);
    await ready();
    expect(
      (
        await request.post("/api/auth/sign-up/email", {
          headers,
          data: {
            name: "Organiser",
            email: `storage-day-${randomUUID()}@example.invalid`,
            password: "Day-plan-password-123",
          },
        })
      ).status(),
    ).toBe(200);
    const trip = (
      await (
        await request.post("/api/trips", {
          headers,
          data: { title: "Fixture draft retention", city: "Shanghai" },
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
    const state = (
      await (await request.get(`/api/trips/${trip.id}/day-plan`)).json()
    ).dayPlan;
    const payload = {
      operationId: randomUUID(),
      expectedRevision: 0,
      selectionRevision: state.selectionRevision,
      visitDate: "2026-12-01",
      mode: "taxi-car",
      dietaryNeeds: "Fictional preference",
    };
    expect(
      (
        await request.post(`/api/trips/${trip.id}/day-plan`, {
          headers,
          data: payload,
        })
      ).status(),
    ).toBe(200);
    const before = (
      await (await request.get(`/api/trips/${trip.id}/day-plan`)).json()
    ).dayPlan;
    const invitation = (
      await (
        await request.post(`/api/trips/${trip.id}/invitation`, {
          headers,
          data: { action: "create" },
        })
      ).json()
    ).invitation;
    expect(
      (
        await guest.post(`/api/invitations/${invitation.token}`, {
          headers,
          data: { displayName: "Fixture guest" },
        })
      ).status(),
    ).toBe(201);
    const sharedBefore = (
      await (await guest.get(`/api/guest-trips/${trip.id}`)).json()
    ).shared;
    expect(sharedBefore.trip.dayPlan).toEqual(before);
    await stop(next);
    next = null;
    const configurations: NodeJS.ProcessEnv[] = [
      { ...env, NODE_ENV: "production" },
      { ...env, ENABLE_DEVELOPMENT_TRIP_FIXTURE: "0" },
    ];
    for (const configuration of configurations) {
      next = launch(
        [
          "run",
          configuration.NODE_ENV === "production" ? "start" : "dev",
          "--",
          "--port",
          "3100",
        ],
        configuration,
      );
      await ready();
      for (const response of [
        await request.get(`/api/trips/${trip.id}/day-plan`),
        await request.post(`/api/trips/${trip.id}/day-plan`, {
          headers,
          data: payload,
        }),
        await request.post(`/api/trips/${trip.id}/day-plan`, {
          headers,
          data: {
            ...payload,
            operationId: randomUUID(),
            mode: "walking-transit",
          },
        }),
        await request.post(`/api/trips/${trip.id}`, {
          headers,
          data: {
            action: "select",
            placeId: "fictional-cafe-east",
            selected: false,
          },
        }),
        await guest.get(`/api/guest-trips/${trip.id}`),
      ]) {
        expect(response.status()).toBe(404);
        expect(await response.text()).not.toContain("Fictional preference");
      }
      expect(
        (await guest.get(`/api/invitations/${invitation.token}`)).status(),
      ).toBe(404);
      await stop(next);
      next = null;
    }
    next = launch(["run", "dev", "--", "--port", "3100"]);
    await ready();
    expect(
      (await (await request.get(`/api/trips/${trip.id}/day-plan`)).json())
        .dayPlan,
    ).toEqual(before);
    expect(
      (
        await request.post(`/api/trips/${trip.id}/day-plan`, {
          headers,
          data: payload,
        })
      ).status(),
    ).toBe(200);
    expect(
      (await (await request.get(`/api/trips/${trip.id}/day-plan`)).json())
        .dayPlan,
    ).toEqual(before);
    expect(
      (await (await guest.get(`/api/guest-trips/${trip.id}`)).json()).shared,
    ).toEqual(sharedBefore);
  } finally {
    await stop(next);
    await stop(nginx);
    await guest.dispose();
  }
});
