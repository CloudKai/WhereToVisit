import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const origin =
  process.env.WHERETOVISIT_SOCIAL_TEST_ORIGIN ?? "http://127.0.0.1:8580";
const headers = { Origin: origin };
const post = "https://www.instagram.com/p/BranchChoice05/";
const captures = process.env.WHERETOVISIT_CAPTURE_PATH;
function storage() {
  const config = process.env.WHERETOVISIT_SOCIAL_TEST_STORAGE_CONFIG;
  if (!config) throw Error("Fresh isolated storage configuration required");
  const { databasePath } = JSON.parse(readFileSync(config, "utf8"));
  if (!/test-social-[a-f0-9]+\.sqlite$/.test(databasePath))
    throw Error("Isolated database required");
  return new Database(databasePath);
}

test("real catalogue choice is explicit, retained, revision protected and bounded", async ({
  request,
  playwright,
}) => {
  const created = await request.post("/api/social-references", {
    headers,
    data: { sourceUrl: post, note: "My original reminder" },
  });
  expect(created.status()).toBe(201);
  const { reference: original } = await created.json();
  expect(original.branchChoice).toBeNull();
  expect(original.choiceRevision).toBe(0);
  const candidates = await request.get("/api/social-references/branches");
  expect(candidates.headers()["cache-control"]).toBe("no-store");
  const { branches } = await candidates.json();
  expect(branches).toHaveLength(6);
  for (const branch of branches) {
    expect(branch.address).toBeTruthy();
    expect(branch.sources.length).toBeGreaterThan(0);
  }
  const url = `/api/social-references/${original.id}`;
  const change = (data: unknown) => request.patch(url, { headers, data });
  for (const branchId of [
    "unknown",
    "fixture-noodle-harbour",
    "outside-shanghai",
    "<script>",
    7,
    {},
    "x".repeat(161),
  ])
    expect((await change({ branchId, expectedRevision: 0 })).status()).toBe(
      400,
    );
  expect(
    (
      await change({
        branchId: branches[0].id,
        expectedRevision: 0,
        displayName: "Spoofed",
      })
    ).status(),
  ).toBe(400);
  expect((await change({ branchId: branches[0].id })).status()).toBe(400);
  expect(
    (
      await request.patch(url, {
        data: { branchId: branches[0].id, expectedRevision: 0 },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.patch(url, {
        headers: { Origin: "https://evil.test" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.patch(url, { headers, data: { junk: "x".repeat(2048) } })
    ).status(),
  ).toBe(413);
  expect(
    (
      await request.patch(url, {
        headers: { ...headers, "Content-Type": "text/plain" },
        data: "{}",
      })
    ).status(),
  ).toBe(400);
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    for (const id of [original.id, "unknown"]) {
      const inaccessible = await other.patch(`/api/social-references/${id}`, {
        headers,
        data: { branchId: branches[0].id, expectedRevision: 0 },
      });
      expect(inaccessible.status()).toBe(404);
      expect((await inaccessible.json()).error.code).toBe("not-found");
    }
  } finally {
    await other.dispose();
  }
  const raced = await Promise.all(
    [branches[0], branches[1]].map((branch) =>
      change({ branchId: branch.id, expectedRevision: 0 }),
    ),
  );
  expect(raced.map((response) => response.status()).sort()).toEqual([200, 409]);
  const after = (await (await request.get(url)).json()).reference;
  expect(after.choiceRevision).toBe(1);
  for (const key of ["sourceUrl", "note", "createdAt", "expiresAt"])
    expect(after[key]).toBe(original[key]);
  expect(
    (await change({ branchId: branches[2].id, expectedRevision: 1 })).status(),
  ).toBe(200);
  expect((await change({ branchId: null, expectedRevision: 1 })).status()).toBe(
    409,
  );
  expect((await change({ branchId: null, expectedRevision: 2 })).status()).toBe(
    200,
  );
  const cleared = (await (await request.get(url)).json()).reference;
  expect(cleared.branchChoice).toBeNull();
  expect(cleared.choiceRevision).toBe(3);
  const db = storage();
  try {
    const session = db
      .prepare("SELECT session_digest FROM social_references WHERE id=?")
      .get(original.id) as { session_digest: string };
    const insert = db.prepare(
      "INSERT INTO social_reference_attempts(session_digest,ip_digest,created_at) VALUES(?,?,?)",
    );
    for (let i = 0; i < 40; i++)
      insert.run(session.session_digest, "test", Date.now());
    expect(
      (
        await change({ branchId: branches[0].id, expectedRevision: 3 })
      ).status(),
    ).toBe(429);
    db.prepare(
      "DELETE FROM social_reference_attempts WHERE session_digest=?",
    ).run(session.session_digest);
  } finally {
    db.close();
  }
  expect((await request.delete(url, { headers })).status()).toBe(200);
  expect(
    (await change({ branchId: branches[0].id, expectedRevision: 3 })).status(),
  ).toBe(404);
});

test("publication removal, fixture, errors and expiry never rematch or revive a choice", async ({
  request,
}) => {
  const original = (
    await (
      await request.post("/api/social-references", {
        headers,
        data: { sourceUrl: post },
      })
    ).json()
  ).reference;
  const { branches } = await (
    await request.get("/api/social-references/branches")
  ).json();
  const url = `/api/social-references/${original.id}`;
  expect(
    (
      await request.patch(url, {
        headers,
        data: { branchId: branches[0].id, expectedRevision: 0 },
      })
    ).status(),
  ).toBe(200);
  const db = storage();
  const row = db
    .prepare("SELECT payload FROM catalogue_publication WHERE city='Shanghai'")
    .get() as { payload: string };
  const publish = (payload: unknown) =>
    db
      .prepare(
        "UPDATE catalogue_publication SET payload=? WHERE city='Shanghai'",
      )
      .run(JSON.stringify(payload));
  try {
    const removed = JSON.parse(row.payload);
    removed.places = removed.places.filter(
      (place: { id: string }) => place.id !== branches[0].id,
    );
    publish(removed);
    const unavailable = (await (await request.get(url)).json()).reference;
    expect(unavailable.branchChoice).toEqual({
      branchId: branches[0].id,
      branch: null,
    });
    expect(unavailable.choiceRevision).toBe(1);
    expect(
      (
        await request.patch(url, {
          headers,
          data: { branchId: branches[0].id, expectedRevision: 1 },
        })
      ).status(),
    ).toBe(503);
    const fixture = JSON.parse(row.payload);
    fixture.kind = "fixture";
    publish(fixture);
    expect(
      (await request.get("/api/social-references/branches")).status(),
    ).toBe(503);
    expect(
      (
        await request.patch(url, {
          headers,
          data: { branchId: branches[1].id, expectedRevision: 1 },
        })
      ).status(),
    ).toBe(503);
    publish({ broken: true });
    expect(
      (await request.get("/api/social-references/branches")).status(),
    ).toBe(503);
    expect(
      (
        await request.patch(url, {
          headers,
          data: { branchId: null, expectedRevision: 1 },
        })
      ).status(),
    ).toBe(200);
    db.prepare(
      "UPDATE catalogue_publication SET payload=? WHERE city='Shanghai'",
    ).run(row.payload);
    expect(
      (
        await request.patch(url, {
          headers,
          data: { branchId: branches[1].id, expectedRevision: 2 },
        })
      ).status(),
    ).toBe(200);
    db.prepare("UPDATE social_references SET expires_at=? WHERE id=?").run(
      Date.now() - 1,
      original.id,
    );
    expect((await request.get(url)).status()).toBe(404);
    expect(
      (
        await request.patch(url, {
          headers,
          data: { branchId: branches[2].id, expectedRevision: 3 },
        })
      ).status(),
    ).toBe(404);
    expect(
      db
        .prepare("SELECT id FROM social_references WHERE id=?")
        .get(original.id),
    ).toBeUndefined();
  } finally {
    db.prepare(
      "UPDATE catalogue_publication SET payload=? WHERE city='Shanghai'",
    ).run(row.payload);
    db.close();
  }
});

test("phone and desktop deliberate review, failure recovery, keyboard choice and clear without provider requests", async ({
  page,
}) => {
  const socialRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /instagram\.com|tiktok\.com|xiaohongshu\.com/.test(
        new URL(request.url()).hostname,
      )
    )
      socialRequests.push(request.url());
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/references");
  await page.getByLabel("Canonical social post URL").fill(post);
  await page
    .getByLabel("Your note (optional, original words only)")
    .fill("Choose the address myself");
  await page.getByRole("button", { name: "Keep social draft" }).click();
  const card = page
    .locator("article")
    .filter({ hasText: "Choose the address myself" });
  await expect(card.getByText("Unresolved — no branch chosen.")).toBeVisible();
  await card.getByRole("button", { name: "Review branch choices" }).click();
  const select = card.getByLabel("Shanghai catalogue branch");
  await expect(select).toHaveValue("");
  await expect(
    card.getByRole("button", { name: "Confirm my branch choice" }),
  ).toBeDisabled();
  await select.focus();
  await select.press("b");
  await select.press("Enter");
  await expect(select).not.toHaveValue("");
  await card.getByText("Review catalogue sources and limits").click();
  await expect(
    card.getByRole("link", { name: "Catalogue source (new tab)" }).first(),
  ).toBeVisible();
  await page.route("**/api/social-references/*", async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Controlled save failure" } }),
      });
    else await route.continue();
  });
  const selection = await select.inputValue();
  await card.getByRole("button", { name: "Confirm my branch choice" }).click();
  await expect(card.getByRole("alert")).toContainText(
    "Controlled save failure",
  );
  await expect(select).toHaveValue(selection);
  await page.unroute("**/api/social-references/*");
  await card.getByRole("button", { name: "Confirm my branch choice" }).click();
  await expect(
    card.getByText("Your branch choice was saved in this browser."),
  ).toBeVisible();
  if (captures)
    await page.screenshot({
      path: join(captures, "choice-phone375.png"),
      fullPage: true,
    });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    card.getByRole("button", { name: "Change or clear branch choice" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await card
    .getByRole("button", { name: "Change or clear branch choice" })
    .click();
  await expect(card.getByLabel("Shanghai catalogue branch")).toHaveValue("");
  if (captures)
    await page.screenshot({
      path: join(captures, "choice-review-desktop1280.png"),
      fullPage: true,
    });
  await card
    .getByRole("button", { name: "Confirm clear branch choice" })
    .click();
  await expect(card.getByText("Unresolved — no branch chosen.")).toBeVisible();
  await card.getByRole("button", { name: "Review branch choices" }).click();
  await card
    .getByRole("button", { name: "Cancel — keep current choice" })
    .click();
  await expect(card.getByText("Unresolved — no branch chosen.")).toBeVisible();
  expect(socialRequests).toEqual([]);
});

test("global write bound and outside-city publication cannot confer branch identity", async ({
  request,
}) => {
  const original = (
    await (
      await request.post("/api/social-references", {
        headers,
        data: { sourceUrl: post },
      })
    ).json()
  ).reference;
  const { branches } = await (
    await request.get("/api/social-references/branches")
  ).json();
  const url = `/api/social-references/${original.id}`;
  const db = storage();
  const row = db
    .prepare("SELECT payload FROM catalogue_publication WHERE city='Shanghai'")
    .get() as { payload: string };
  try {
    const insert = db.prepare(
      "INSERT INTO social_reference_attempts(session_digest,ip_digest,created_at) VALUES(?,?,?)",
    );
    db.transaction(() => {
      for (let i = 0; i < 1000; i++)
        insert.run("global-bound-05", "global-bound-05", Date.now());
    })();
    expect(
      (
        await request.patch(url, {
          headers,
          data: { branchId: branches[0].id, expectedRevision: 0 },
        })
      ).status(),
    ).toBe(429);
    db.prepare(
      "DELETE FROM social_reference_attempts WHERE session_digest='global-bound-05'",
    ).run();
    const outside = JSON.parse(row.payload);
    outside.places[0].city = "Hangzhou";
    db.prepare(
      "UPDATE catalogue_publication SET payload=? WHERE city='Shanghai'",
    ).run(JSON.stringify(outside));
    expect(
      (await request.get("/api/social-references/branches")).status(),
    ).toBe(503);
    expect(
      (
        await request.patch(url, {
          headers,
          data: { branchId: branches[0].id, expectedRevision: 0 },
        })
      ).status(),
    ).toBe(503);
    expect(
      (await (await request.get(url)).json()).reference.branchChoice,
    ).toBeNull();
  } finally {
    db.prepare(
      "DELETE FROM social_reference_attempts WHERE session_digest='global-bound-05'",
    ).run();
    db.prepare(
      "UPDATE catalogue_publication SET payload=? WHERE city='Shanghai'",
    ).run(row.payload);
    db.close();
  }
});
