import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const origin =
  process.env.WHERETOVISIT_SOCIAL_TEST_ORIGIN ?? "http://127.0.0.1:8180";
const headers = { Origin: origin };
const post = "https://www.instagram.com/p/Test_01/";
const captures = process.env.WHERETOVISIT_CAPTURE_PATH;
function storage() {
  const path = process.env.WHERETOVISIT_SOCIAL_TEST_STORAGE_CONFIG;
  if (!path)
    throw new Error(
      "Use a dedicated isolated social-reference runtime/configuration.",
    );
  const configuration = JSON.parse(readFileSync(path, "utf8"));
  if (
    !configuration.databasePath.includes("discovery-01-isolated") &&
    !/test-social-[a-f0-9]+\.sqlite$/.test(configuration.databasePath)
  )
    throw new Error("Isolated storage required.");
  return new Database(configuration.databasePath);
}
test("canonical URL safety, normalization, bounded text and request contracts", async ({
  request,
}) => {
  for (const sourceUrl of [
    "https://www.xiaohongshu.com/explore/653b2a61000000001f005bd4",
    "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    post,
    "https://www.instagram.com/reel/AbC-12_/",
  ]) {
    const response = await request.post("/api/social-references", {
      headers,
      data: {
        sourceUrl: `${sourceUrl}?tracking=do-not-store#secret`,
        note: "🥟".repeat(500),
      },
    });
    expect(response.status()).toBe(201);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const { reference, normalized } = await response.json();
    expect(normalized).toBe(true);
    expect(reference.sourceUrl).toBe(sourceUrl);
    expect(reference.note).toBe("🥟".repeat(500));
    expect(
      Date.parse(reference.expiresAt) - Date.parse(reference.createdAt),
    ).toBe(86400_000);
    expect(
      (
        await request.delete(`/api/social-references/${reference.id}`, {
          headers,
        })
      ).status(),
    ).toBe(200);
  }
  for (const sourceUrl of [
    "javascript:alert(1)",
    "data:text/html,test",
    "<a href='https://www.instagram.com/p/test/'>x</a>",
    "http://www.instagram.com/p/test/",
    "https://instagram.com/p/test/",
    "https://www.instagram.com.evil.test/p/test/",
    "https://www.instagram.com:443/p/test/",
    "https://u:p@www.instagram.com/p/test/",
    "https://www.instagram.com/p/%41/",
    "https://www.instagram.com/p/x/../test/",
    "https://www.instagram.com/p/test\\a/",
    "https://www.instagram.com/p/test/\n",
    " https://www.instagram.com/p/test/",
    "https://www.instagram.com/p/test/?x=\u200b",
    "https://www.instagram.com/explore/",
    "https://www.instagram.com/someone/",
    "https://www.instagram.com/stories/someone/1/",
    "https://www.instagram.com/p/test/extra",
    "https://l.instagram.com/test",
    "https://vm.tiktok.com/test/",
    "https://www.tiktok.com/@user",
    "https://www.tiktok.com/@user/photo/123",
    "https://xhslink.com/test",
    "https://www.xiaohongshu.com/search_result?keyword=test",
    "https://www.xiaohongshu.com/explore/not-an-id",
    "https://www.xiaohongshu.com/discovery/item/653b2a61000000001f005bd4",
  ])
    expect(
      (
        await request.post("/api/social-references", {
          headers,
          data: { sourceUrl },
        })
      ).status(),
      sourceUrl,
    ).toBe(400);
  for (const note of [
    "🥟".repeat(501),
    "a\tb",
    "a\rb",
    "a\u0000b",
    "a\u200bb",
    { copied: true },
  ]) {
    const response = await request.post("/api/social-references", {
      headers,
      data: { sourceUrl: post, note },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.message).toContain("Your note");
  }
  const multiline = await request.post("/api/social-references", {
    headers,
    data: { sourceUrl: post, note: " My own\r\nreminder\n🥟 " },
  });
  expect((await multiline.json()).reference.note).toBe("My own\nreminder\n🥟");
  expect(
    (
      await request.post("/api/social-references", {
        data: { sourceUrl: post },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/social-references", {
        headers: { Origin: "https://other.invalid" },
        data: { sourceUrl: post },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/social-references", {
        headers,
        data: { sourceUrl: post, placeId: "anything" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/social-references", {
        headers: { ...headers, "Content-Type": "text/plain" },
        data: "test",
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/social-references", {
        headers: { ...headers, "Content-Type": "application/json" },
        data: "{",
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/social-references", {
        headers,
        data: { sourceUrl: post, note: "a".repeat(9000) },
      })
    ).status(),
  ).toBe(413);
});

test("browser ownership survives same-browser account changes without granting Trip or other-browser authority", async ({
  request,
  playwright,
}) => {
  const create = await request.post("/api/social-references", {
    headers,
    data: { sourceUrl: post, note: "My original reminder" },
  });
  let { reference } = await create.json();
  reference = (
    await (
      await request.patch(`/api/social-references/${reference.id}`, {
        headers,
        data: { branchId: "bluebottle-zhangyuan", expectedRevision: 0 },
      })
    ).json()
  ).reference;
  expect(reference.branchChoice.branchId).toBe("bluebottle-zhangyuan");
  const before = await (
    await request.get(`/api/social-references/${reference.id}`)
  ).json();
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    expect(
      (await (await other.get("/api/social-references")).json()).references,
    ).toEqual([]);
    expect(
      (await other.get(`/api/social-references/${reference.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await other.delete(`/api/social-references/${reference.id}`, {
          headers,
        })
      ).status(),
    ).toBe(404);
    expect(
      (await other.get("/api/social-references/nonexistent")).status(),
    ).toBe(404);
    expect(
      (
        await other.patch(`/api/social-references/${reference.id}`, {
          headers,
          data: { note: "changed" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await request.delete(`/api/social-references/${reference.id}`)).status(),
    ).toBe(403);
    for (let account = 0; account < 2; account++) {
      const signup = await request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          email: `social-${randomBytes(8).toString("hex")}@example.invalid`,
          password: "Social-test-password-123",
          name: "Social organiser",
        },
      });
      expect(signup.status()).toBe(200);
      expect(
        (await (await request.get("/api/social-references")).json()).references,
      ).toEqual([reference]);
      const tripResponse = await request.post("/api/trips", {
        headers,
        data: { title: "No automatic social transfer", city: "Shanghai" },
      });
      expect(tripResponse.status()).toBe(201);
      const trip = (await tripResponse.json()).trip;
      expect(trip.savedPlaces).toEqual([]);
      const intent = await request.post("/api/trip-save-intents", {
        headers,
        data: {
          placeId: "bluebottle-zhangyuan",
          importId: reference.id,
        },
      });
      expect(intent.ok()).toBe(false);
      expect(
        (
          await request.post("/api/auth/sign-out", { headers, data: {} })
        ).status(),
      ).toBe(200);
    }
    expect(
      await (
        await request.get(`/api/social-references/${reference.id}`)
      ).json(),
    ).toEqual(before);
    expect(
      (
        await request.delete(`/api/social-references/${reference.id}`, {
          headers,
        })
      ).status(),
    ).toBe(200);
    expect(
      (await request.get(`/api/social-references/${reference.id}`)).status(),
    ).toBe(404);
    const db = storage();
    try {
      expect(
        db
          .prepare("SELECT id FROM social_references WHERE id=?")
          .get(reference.id),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  } finally {
    await other.dispose();
  }
});

test("twenty live drafts, absolute expiry, session expiry and bounded cleanup exclude expired records on every path", async ({
  request,
}) => {
  const ids: string[] = [];
  for (let n = 0; n < 20; n++) {
    const response = await request.post("/api/social-references", {
      headers,
      data: { sourceUrl: post, note: `Original note ${n}` },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).reference.id);
  }
  const rejected = await request.post("/api/social-references", {
    headers,
    data: { sourceUrl: post },
  });
  expect(rejected.status()).toBe(409);
  expect((await rejected.json()).error.code).toBe("draft-limit");
  const before = await (
    await request.get(`/api/social-references/${ids[0]}`)
  ).json();
  await request.get("/api/social-references");
  expect(
    await (await request.get(`/api/social-references/${ids[0]}`)).json(),
  ).toEqual(before);
  let db = storage();
  try {
    db.prepare("UPDATE social_references SET expires_at=? WHERE id=?").run(
      Date.now() - 1,
      ids[0],
    );
  } finally {
    db.close();
  }
  expect((await request.get(`/api/social-references/${ids[0]}`)).status()).toBe(
    404,
  );
  expect(
    (
      await request.delete(`/api/social-references/${ids[0]}`, { headers })
    ).status(),
  ).toBe(404);
  expect(
    (await (await request.get("/api/social-references")).json()).references,
  ).toHaveLength(19);
  expect(
    (
      await request.post("/api/social-references", {
        headers,
        data: { sourceUrl: post },
      })
    ).status(),
  ).toBe(201);
  db = storage();
  try {
    const row = db
      .prepare("SELECT session_digest FROM social_references WHERE id=?")
      .get(ids[1]) as { session_digest: string };
    db.prepare("UPDATE import_sessions SET expires_at=? WHERE digest=?").run(
      Date.now() - 1,
      row.session_digest,
    );
  } finally {
    db.close();
  }
  expect((await request.get(`/api/social-references/${ids[1]}`)).status()).toBe(
    404,
  );
  expect(
    (await (await request.get("/api/social-references")).json()).references,
  ).toEqual([]);
  db = storage();
  try {
    expect(
      db.prepare("SELECT id FROM social_references WHERE id=?").get(ids[1]),
    ).toBeUndefined();
  } finally {
    db.close();
  }
});

test("mobile and keyboard create, return, original text rendering, expiry and recoverable failures without social network requests", async ({
  page,
}) => {
  const outbound: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) outbound.push(request.url());
  });
  let failList = true,
    failSave = false,
    failDelete = false;
  await page.route("**/api/social-references**", async (route) => {
    const method = route.request().method();
    if (
      (method === "GET" && failList) ||
      (method === "POST" && failSave) ||
      (method === "DELETE" && failDelete)
    )
      return route.fulfill({
        status: 503,
        json: { error: { message: "Social drafts temporarily unavailable." } },
      });
    return route.continue();
  });
  await page.goto("/import");
  await page
    .getByRole("link", { name: "Keep a private temporary social link" })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Social drafts temporarily unavailable" }),
  ).toContainText("temporarily unavailable");
  failList = false;
  await page.getByRole("button", { name: "Refresh social drafts" }).click();
  await expect(
    page.getByText("No social drafts in this browser.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(/Anyone using this browser can see/),
  ).toBeVisible();
  await page
    .getByLabel("Canonical social post URL")
    .fill(`${post}?token=discard-this#private`);
  await expect(
    page.getByText(`Will save: ${post}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText(/Xiaohongshu may require the original sharing context/)
      .first(),
  ).toBeVisible();
  await page
    .getByLabel("Your note (optional, original words only)")
    .fill("🥟".repeat(501));
  expect(
    await page
      .getByLabel("Your note (optional, original words only)")
      .evaluate((node: HTMLTextAreaElement) => node.checkValidity()),
  ).toBe(false);
  await page
    .getByLabel("Your note (optional, original words only)")
    .fill("My own reminder\n<script>alert('text only')</script>");
  failSave = true;
  await page.getByRole("button", { name: "Keep social draft" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Social drafts temporarily unavailable" }),
  ).toContainText("temporarily unavailable");
  failSave = false;
  await page.getByRole("button", { name: "Keep social draft" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Instagram reference" }),
  ).toBeVisible();
  await expect(
    page.getByText("<script>alert('text only')</script>", { exact: false }),
  ).toBeVisible();
  const link = page.getByRole("link", {
    name: "Open source on Instagram (new tab)",
  });
  await expect(link).toHaveAttribute("href", post);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (captures)
      await page.screenshot({
        path: join(captures, `social-${width}.png`),
        fullPage: true,
      });
  }
  await page.goto("/discover");
  await page.goto("/references");
  await expect(
    page.getByRole("heading", { name: "Instagram reference" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Instagram reference" }),
  ).toBeVisible();
  expect(outbound).toEqual([]);
  failDelete = true;
  await page.getByRole("button", { name: "Delete Instagram draft" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Social drafts temporarily unavailable" }),
  ).toContainText("temporarily unavailable");
  await expect(
    page.getByRole("heading", { name: "Instagram reference" }),
  ).toBeVisible();
  failDelete = false;
  await page.getByRole("button", { name: "Delete Instagram draft" }).click();
  await expect(page.getByRole("status")).toContainText(
    "deleted, including your note",
  );
  await expect(
    page.getByText("No social drafts in this browser.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add a link", exact: true }).click();
  await page.getByLabel("Canonical social post URL").fill(post);
  await page.getByRole("button", { name: "Keep social draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Instagram reference" }),
  ).toBeVisible();
  const list = await (await page.request.get("/api/social-references")).json();
  const db = storage();
  try {
    db.prepare("UPDATE social_references SET expires_at=? WHERE id=?").run(
      Date.now() + 1800,
      list.references[0].id,
    );
  } finally {
    db.close();
  }
  await page.getByRole("button", { name: "Refresh social drafts" }).click();
  await expect(
    page.getByRole("heading", { name: "Instagram reference" }),
  ).toHaveCount(0, { timeout: 6000 });
  await expect(page.getByRole("status")).toContainText(/expired/);
  expect(outbound).toEqual([]);
});

test("bounded physical cleanup excludes every expired row while retained licensed imports and Trip data stay unchanged", async ({
  request,
}) => {
  const made = await request.post("/api/social-references", {
    headers,
    data: { sourceUrl: post },
  });
  const { reference } = await made.json();
  const catalogue = await (await request.get("/api/catalogue")).json();
  const db = storage();
  let importId = "";
  let originalDocument = "";
  let tripRows: unknown;
  try {
    const { session_digest: session } = db
      .prepare("SELECT session_digest FROM social_references WHERE id=?")
      .get(reference.id) as { session_digest: string };
    const now = Date.now();
    db.prepare("DELETE FROM social_references WHERE expires_at<=?").run(now);
    const insert = db.prepare(
      "INSERT INTO social_references(id,session_digest,platform,source_url,note,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
    );
    db.transaction(() => {
      for (let n = 0; n < 225; n++)
        insert.run(
          `expired-${reference.id}-${n}`,
          session,
          "Instagram",
          post,
          "Expired original note",
          now - 86400_001,
          now - 1,
        );
    })();
    const licensedPath = join(
      process.cwd(),
      "tests/fixtures/retained-licensed-import.json",
    );
    if (licensedPath) {
      const job = JSON.parse(readFileSync(licensedPath, "utf8"));
      importId = `retained-${reference.id}`;
      job.id = importId;
      job.dataKind = "real";
      job.expiresAt = new Date(now + 86400_000).toISOString();
      job.sourceReplayAvailable = false;
      originalDocument = JSON.stringify(job);
      db.prepare(
        "INSERT INTO import_jobs(id,session_digest,source_key,status,created_at,updated_at,expires_at,document) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        importId,
        session,
        "historic-licensed-probe",
        job.status,
        now,
        now,
        now + 86400_000,
        originalDocument,
      );
    }
    tripRows = db.prepare("SELECT * FROM trips ORDER BY id").all();
  } finally {
    db.close();
  }
  const list = await (await request.get("/api/social-references")).json();
  expect(list.references).toEqual([reference]);
  const inspect = storage();
  try {
    expect(
      (
        inspect
          .prepare(
            "SELECT COUNT(*) AS count FROM social_references WHERE id LIKE ?",
          )
          .get(`expired-${reference.id}-%`) as { count: number }
      ).count,
    ).toBe(125);
  } finally {
    inspect.close();
  }
  expect(
    (
      await request.get(`/api/social-references/expired-${reference.id}-224`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.delete(
        `/api/social-references/expired-${reference.id}-224`,
        { headers },
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.delete(`/api/social-references/${reference.id}`, {
        headers,
      })
    ).status(),
  ).toBe(200);
  const after = storage();
  try {
    expect(after.prepare("SELECT * FROM trips ORDER BY id").all()).toEqual(
      tripRows,
    );
    expect(
      (
        after
          .prepare(
            "SELECT COUNT(*) AS count FROM social_references WHERE id LIKE ?",
          )
          .get(`expired-${reference.id}-%`) as { count: number }
      ).count,
    ).toBe(0);
    if (importId)
      expect(
        (
          after
            .prepare("SELECT document FROM import_jobs WHERE id=?")
            .get(importId) as { document: string }
        ).document,
      ).toBe(originalDocument);
  } finally {
    after.close();
  }
  if (importId) {
    const retained = (
      await (await request.get(`/api/imports/${importId}`)).json()
    ).job;
    expect(retained.evidence).toEqual(JSON.parse(originalDocument).evidence);
    expect(retained.mentions).toEqual(JSON.parse(originalDocument).mentions);
  }
  expect(await (await request.get("/api/catalogue")).json()).toEqual(catalogue);
});

test("guest participation grants no reference authority and social expiry leaves saved Places and guest votes intact", async ({
  request,
  playwright,
}) => {
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Reference organiser",
          email: `reference-guest-${randomBytes(8).toString("hex")}@example.invalid`,
          password: "Reference-guest-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await request.post("/api/trips", {
        headers,
        data: {
          title: "Separate guest and browser authority",
          city: "Shanghai",
        },
      })
    ).json()
  ).trip;
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
  const invitation = (
    await (
      await request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    expect(
      (
        await guest.post(`/api/invitations/${invitation.token}`, {
          headers,
          data: { displayName: "Companion" },
        })
      ).status(),
    ).toBe(201);
    const path = `/api/guest-trips/${trip.id}/collaboration`;
    expect(
      (
        await guest.post(path, {
          headers,
          data: {
            action: "vote",
            placeId: "bluebottle-zhangyuan",
            choice: "must-go",
            operationId: crypto.randomUUID(),
          },
        })
      ).status(),
    ).toBe(200);
    const shared = await (
      await guest.get(`/api/guest-trips/${trip.id}`)
    ).json();
    const votes = await (await guest.get(path)).json();
    const ownerReference = (
      await (
        await request.post("/api/social-references", {
          headers,
          data: { sourceUrl: post, note: "My original organiser reminder" },
        })
      ).json()
    ).reference;
    expect(
      (
        await request.patch(`/api/social-references/${ownerReference.id}`, {
          headers,
          data: { branchId: "bluebottle-zhangyuan", expectedRevision: 0 },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await guest.patch(`/api/social-references/${ownerReference.id}`, {
          headers,
          data: { branchId: "bluebottle-zhangyuan", expectedRevision: 1 },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await (await guest.get("/api/social-references")).json()).references,
    ).toEqual([]);
    expect(
      (await guest.get(`/api/social-references/${ownerReference.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await guest.delete(`/api/social-references/${ownerReference.id}`, {
          headers,
        })
      ).status(),
    ).toBe(404);
    const guestReference = (
      await (
        await guest.post("/api/social-references", {
          headers,
          data: { sourceUrl: post, note: "My original guest reminder" },
        })
      ).json()
    ).reference;
    expect(
      (
        await request.get(`/api/social-references/${guestReference.id}`)
      ).status(),
    ).toBe(404);
    const db = storage();
    try {
      db.prepare("UPDATE social_references SET expires_at=? WHERE id=?").run(
        Date.now() - 1,
        ownerReference.id,
      );
      const row = db
        .prepare("SELECT session_digest FROM social_references WHERE id=?")
        .get(guestReference.id) as { session_digest: string };
      db.prepare("UPDATE import_sessions SET expires_at=? WHERE digest=?").run(
        Date.now() - 1,
        row.session_digest,
      );
    } finally {
      db.close();
    }
    expect(
      (
        await request.get(`/api/social-references/${ownerReference.id}`)
      ).status(),
    ).toBe(404);
    expect(
      (await guest.get(`/api/social-references/${guestReference.id}`)).status(),
    ).toBe(404);
    expect(
      await (await guest.get(`/api/guest-trips/${trip.id}`)).json(),
    ).toEqual(shared);
    expect(await (await guest.get(path)).json()).toEqual(votes);
    const retained = (await (await request.get(`/api/trips/${trip.id}`)).json())
      .trip;
    expect(retained.savedPlaces).toHaveLength(1);
    expect(retained.savedPlaces[0].placeId).toBe("bluebottle-zhangyuan");
  } finally {
    await guest.dispose();
  }
});
