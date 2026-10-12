import { expect, test } from "@playwright/test";

test("anonymous visitor imports distinct evidence-bearing names and recovers the temporary draft", async ({
  page,
}) => {
  await page.goto("/import", { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("Supported article URL")
    .fill("https://en.wikivoyage.org/wiki/Fixture_Multiple");
  await page
    .getByRole("button", { name: "Import article", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Café 🥟 One", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Tea Two", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Unresolved mention", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: "CC BY-SA 4.0", exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Café 🥟 One", exact: true }),
  ).toBeVisible();
});

const origin = "http://127.0.0.1:8180";
async function submit(
  request: import("@playwright/test").APIRequestContext,
  title: string,
) {
  const response = await request.post("/api/imports", {
    headers: { Origin: origin },
    data: { sourceUrl: `https://en.wikivoyage.org/wiki/${title}` },
  });
  expect(response.status()).toBe(202);
  return (await response.json()).job;
}
async function terminal(
  request: import("@playwright/test").APIRequestContext,
  id: string,
) {
  let result: import("../src/shared/contracts").Import | undefined;
  await expect
    .poll(async () => {
      const response = await request.get(`/api/imports/${id}`);
      expect(response.status()).toBe(200);
      result = (await response.json()).job;
      return result?.status;
    })
    .not.toMatch(/^(queued|processing)$/);
  return result as import("../src/shared/contracts").Import;
}
test("public import rejects an invalid source revision instead of saving unattested names", async ({
  request,
}) => {
  const job = await terminal(
    request,
    (await submit(request, "Fixture_WrongRevision")).id,
  );
  expect(job).toMatchObject({
    status: "failed",
    reason: { code: "response-invalid" },
    mentions: [],
    evidence: null,
  });
});

test("visitor sees honest empty, unavailable, private and unsupported prose outcomes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/import", { waitUntil: "domcontentloaded" });
  for (const [title, reason] of [
    ["Empty", "no-place"],
    ["Unavailable", "source-unavailable"],
    ["Private", "private-or-auth-required"],
    ["Prose", "format-unsupported"],
  ]) {
    await page
      .getByLabel("Supported article URL")
      .fill(`https://en.wikivoyage.org/wiki/Fixture_${title}`);
    await page
      .getByRole("button", { name: "Import article", exact: true })
      .click();
    const result = page.getByRole("article").first();
    await expect(result).toContainText(reason);
    await expect(
      result.getByText("Unresolved mention", { exact: true }),
    ).toHaveCount(0);
  }
  await page.screenshot({
    path: testInfo.outputPath("import-outcomes-375.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("unresolved evidence stays exact, partial and idempotent without creating places", async ({
  request,
}) => {
  const created = await submit(request, "Fixture_Multiple");
  const job = await terminal(request, created.id);
  expect(job).toMatchObject({
    status: "awaiting-confirmation",
    dataKind: "fixture",
    sourceReplayAvailable: false,
  });
  expect(job.evidence?.attribution).toContain("fictional source");
  expect(
    job.mentions.map((mention) => [
      mention.originalText,
      mention.extraction.codePointStart,
      mention.extraction.codePointEnd,
    ]),
  ).toEqual([
    ["Café 🥟 One", 24, 34],
    ["Tea Two", 70, 77],
  ]);
  for (const mention of job.mentions)
    expect(mention).toMatchObject({
      placeId: null,
      candidates: [],
      resolutionStatus: "unresolved",
      branchHint: null,
      addressHint: null,
      cityHint: { origin: "selected-city" },
    });
  const repeated = await submit(request, "Fixture_Multiple");
  expect(repeated.id).toBe(job.id);
  expect(
    repeated.mentions.map((mention: { id: string }) => mention.id),
  ).toEqual(job.mentions.map((mention) => mention.id));
  const partial = await terminal(
    request,
    (await submit(request, "Fixture_Nested")).id,
  );
  expect(partial).toMatchObject({
    partial: true,
    status: "awaiting-confirmation",
  });
  expect(partial.mentions.map((mention) => mention.originalText)).toEqual([
    "Plain Name",
  ]);
});

test("source redirects and unsafe URL spelling are rejected at the authoritative import boundary", async ({
  playwright,
}) => {
  const cases = [
    "http://127.0.0.1/wiki/Test",
    "https://[::ffff:127.0.0.1]/wiki/Test",
    "https://user:secret@en.wikivoyage.org/wiki/Test",
    "https://en.wikivoyage.org.:443/wiki/Test",
    "https://en.wikivoyage.org:444/wiki/Test",
    "https://en.wikivoyage.org/wiki/%252e%252e/Test",
    "https://en.wikivoyage.org/wiki/../Test",
    "https://en.wikivoyage.org/wiki/Special:Search?search=Test",
  ];
  for (let index = 0; index < cases.length; index += 4) {
    const client = await playwright.request.newContext({ baseURL: origin });
    for (const sourceUrl of cases.slice(index, index + 4)) {
      const response = await client.post("/api/imports", {
        headers: { Origin: origin },
        data: { sourceUrl },
      });
      expect(response.status()).toBe(202);
      expect((await response.json()).job).toMatchObject({
        status: "failed",
        reason: { code: "unsafe-url" },
        mentions: [],
      });
    }
    await client.dispose();
  }
  const client = await playwright.request.newContext({ baseURL: origin });
  const redirect = await terminal(
    client,
    (await submit(client, "Fixture_Redirect")).id,
  );
  expect(redirect).toMatchObject({
    status: "failed",
    reason: { code: "unsafe-url" },
    mentions: [],
  });
  expect(redirect.reason?.message).toContain(
    "no redirect destination was fetched",
  );
  const originRejected = await client.post("/api/imports", {
    headers: { Origin: "https://other.example" },
    data: { sourceUrl: "https://en.wikivoyage.org/wiki/Fixture_Multiple" },
  });
  expect(originRejected.status()).toBe(403);
  await client.dispose();
});

test("another anonymous session cannot read, retry, cancel or delete a draft", async ({
  request,
  playwright,
}) => {
  const job = await terminal(
    request,
    (await submit(request, "Fixture_Multiple")).id,
  );
  const other = await playwright.request.newContext({ baseURL: origin });
  expect((await other.get(`/api/imports/${job.id}`)).status()).toBe(404);
  for (const action of ["retry", "cancel", "delete"])
    expect(
      (
        await other.post(`/api/imports/${job.id}`, {
          headers: { Origin: origin },
          data: { action },
        })
      ).status(),
    ).toBe(404);
  expect((await (await other.get("/api/imports")).json()).jobs).toEqual([]);
  expect(
    (await (await request.get(`/api/imports/${job.id}`)).json()).job.mentions,
  ).toHaveLength(2);
  await other.dispose();
});

test("visitor can explicitly retry the same job and cancel then erase a slow import", async ({
  page,
}, testInfo) => {
  await page.goto("/import", { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("Supported article URL")
    .fill("https://en.wikivoyage.org/wiki/Fixture_Retry");
  await page
    .getByRole("button", { name: "Import article", exact: true })
    .click();
  await expect(page.getByRole("article").first()).toContainText(
    "network-unavailable",
  );
  await page.getByRole("button", { name: "Retry import", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Café 🥟 One", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").first()).toContainText(
    "Attempt 2 of 3",
  );
  await expect(page.getByRole("article").first()).toContainText(
    "Whole-source replay is unavailable",
  );
  await page.screenshot({
    path: testInfo.outputPath("import-evidence-1280.png"),
    fullPage: true,
  });
  await page
    .getByLabel("Supported article URL")
    .fill("https://en.wikivoyage.org/wiki/Fixture_Slow");
  await page
    .getByRole("button", { name: "Import article", exact: true })
    .click();
  await expect(
    page.getByRole("article").first().getByRole("status"),
  ).toContainText(/Queued|Processing/);
  await page
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  const slow = page.getByRole("article").first();
  await expect(slow).toContainText("cancelled");
  await page.waitForTimeout(3200);
  await expect(
    slow.getByText("Unresolved mention", { exact: true }),
  ).toHaveCount(0);
  await slow
    .getByRole("button", { name: "Delete temporary import", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("bounded input and session submission caps are authoritative", async ({
  request,
}) => {
  const oversized = await request.post("/api/imports", {
    headers: { Origin: origin },
    data: { sourceUrl: "x".repeat(5000) },
  });
  expect(oversized.status()).toBe(400);
  expect((await oversized.json()).error.code).toBe("input-too-large");
  for (let index = 0; index < 5; index++) {
    const response = await request.post("/api/imports", {
      headers: { Origin: origin },
      data: { sourceUrl: `https://unsupported.example/wiki/${index}` },
    });
    expect(response.status()).toBe(202);
    expect((await response.json()).job.status).toBe("unsupported");
  }
  const sixth = await request.post("/api/imports", {
    headers: { Origin: origin },
    data: { sourceUrl: "https://en.wikivoyage.org/wiki/Fixture_Multiple" },
  });
  expect(sixth.status()).toBe(429);
  expect((await sixth.json()).error.code).toBe("rate-limited");
});

test("rejected URLs retain neither credentials nor private query text and still deduplicate", async ({
  request,
}) => {
  const sourceUrl =
    "https://user:private-password@en.wikivoyage.org/wiki/Test?token=private-token";
  const first = await request.post("/api/imports", {
    headers: { Origin: origin },
    data: { sourceUrl },
  });
  expect(first.status()).toBe(202);
  const job = (await first.json()).job;
  const retrieved = await request.get(`/api/imports/${job.id}`);
  expect(JSON.stringify(await retrieved.json())).not.toMatch(
    /private-password|private-token|user:/,
  );
  const repeated = await request.post("/api/imports", {
    headers: { Origin: origin },
    data: { sourceUrl },
  });
  expect((await repeated.json()).job.id).toBe(job.id);
});
