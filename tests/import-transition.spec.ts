import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_PATH: `./.data/test-import-transition-${randomBytes(8).toString("hex")}.sqlite`,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    WIKIMEDIA_OPERATOR_CONTACT: "",
    IMPORTS_ENABLED: "1",
    ENABLE_DEVELOPMENT_IMPORT_FIXTURE: "1",
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
    for (const title of ["Multiple", "Unavailable", "Slow", "Queued"]) {
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
    expect((await (await request.get("/api/imports")).json()).jobs).toEqual([]);
    for (const job of originals) {
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
    for (const original of originals) {
      const restored = (
        await (await request.get(`/api/imports/${original.id}`)).json()
      ).job;
      expect(restored).toEqual(original.before);
    }
  } finally {
    await stop(next);
    await stop(nginx);
  }
});
