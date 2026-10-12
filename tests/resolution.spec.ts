import { readFileSync, writeFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import type { Import } from "../src/shared/contracts";

const origin = "http://127.0.0.1:8180";
async function imported(request: APIRequestContext, title = "Resolution") {
  const response = await request.post("/api/imports", {
    headers: { Origin: origin },
    data: { sourceUrl: `https://en.wikivoyage.org/wiki/Fixture_${title}` },
  });
  expect(response.status()).toBe(202);
  const id = (await response.json()).job.id;
  let job: Import | undefined;
  await expect
    .poll(async () => {
      job = (await (await request.get(`/api/imports/${id}`)).json()).job;
      return job?.status;
    })
    .not.toMatch(/^(queued|processing)$/);
  if (!job) throw new Error("Import did not finish.");
  return job;
}
async function resolve(request: APIRequestContext, job: Import) {
  const response = await request.post(`/api/imports/${job.id}/resolution`, {
    headers: { Origin: origin },
    data: { action: "resolve" },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).job as Import;
}
test("visitor resolves distinct branches and retains no-match evidence before specific confirmation", async ({
  request,
}) => {
  const job = await resolve(request, await imported(request));
  expect(job.mentions[0].placeId).toBeNull();
  expect(
    job.mentions[0].candidates.map((candidate) => candidate.place.address),
  ).toEqual([
    "1 Fictional East Road, Shanghai",
    "2 Fictional West Road, Shanghai",
  ]);
  expect(job.mentions[1].resolution?.outcome).toBe("no-match");
  const selected = job.mentions[0].candidates[1];
  const response = await request.post(`/api/imports/${job.id}/resolution`, {
    headers: { Origin: origin },
    data: {
      action: "confirm",
      mentionId: job.mentions[0].id,
      candidateId: selected.id,
    },
  });
  expect(response.status()).toBe(200);
  const confirmed = (await response.json()).job;
  expect(confirmed.mentions[0]).toMatchObject({
    placeId: "fictional-cafe-west",
    resolutionStatus: "user-confirmed",
    confirmation: { method: "user-selection", independentVerification: false },
  });
  expect(confirmed.mentions[1].placeId).toBeNull();
  expect(confirmed.status).toBe("awaiting-confirmation");
  const refreshed = (await (await request.get(`/api/imports/${job.id}`)).json())
    .job;
  expect(refreshed.mentions[0].confirmation).toEqual(
    confirmed.mentions[0].confirmation,
  );
});

test("browser confirms a reviewed branch, merges separate source evidence and keeps discovery separate", async ({
  page,
}, testInfo) => {
  await page.goto("/import", { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("Supported article URL")
    .fill("https://en.wikivoyage.org/wiki/Fixture_Resolution");
  await page
    .getByRole("button", { name: "Import article", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fictional Scenario Café", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Find candidate branches" }).click();
  await expect(
    page.getByText("2 Fictional West Road, Shanghai", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm West branch", exact: true })
    .click();
  await expect(
    page.getByText("User-confirmed branch", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/No candidate in the bounded canonical shortlist/),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("User-confirmed branch", { exact: true }),
  ).toBeVisible();
  const second = await resolve(
    page.request,
    await imported(page.request, "ResolutionSecond"),
  );
  const confirm = await page.request.post(
    `/api/imports/${second.id}/resolution`,
    {
      headers: { Origin: origin },
      data: {
        action: "confirm",
        mentionId: second.mentions[0].id,
        candidateId: "fictional-cafe-west",
      },
    },
  );
  expect(confirm.status()).toBe(200);
  const list = await (await page.request.get("/api/imports")).json();
  expect(list.resolvedPlaces).toHaveLength(1);
  expect(list.resolvedPlaces[0]).toMatchObject({
    place: {
      id: "fictional-cafe-west",
      classifications: [],
      coordinates: null,
    },
    importedEvidence: [{ importId: second.id }, { importId: list.jobs[1].id }],
  });
  expect(list.resolvedPlaces[0].importedEvidence).toHaveLength(2);
  for (const item of list.resolvedPlaces[0].importedEvidence) {
    expect(item.source.license).toBe("CC BY-SA 4.0");
    expect(item.extraction.quote).toBe("Fictional Scenario Café");
    expect(item.confirmation.independentVerification).toBe(false);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("region", { name: "Confirmed temporary branches" }),
  ).toContainText("2 source mentions");
  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("resolution-375.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("resolution-1280.png"),
    fullPage: true,
  });
});

test("out-of-city confirmation requires explicit acknowledgement without changing Shanghai discovery", async ({
  request,
  playwright,
}) => {
  const job = await resolve(request, await imported(request, "Outside"));
  const mention = job.mentions[0];
  expect(mention.candidates[0]).toMatchObject({
    outsideCity: true,
    place: {
      city: "Hangzhou",
      id: "fictional-outside-cafe",
      coordinates: null,
    },
  });
  const body = {
    action: "confirm",
    mentionId: mention.id,
    candidateId: mention.candidates[0].id,
  };
  const other = await playwright.request.newContext({ baseURL: origin });
  for (const input of [{ action: "resolve" }, body]) {
    expect(
      (
        await other.post(`/api/imports/${job.id}/resolution`, {
          headers: { Origin: origin },
          data: input,
        })
      ).status(),
    ).toBe(404);
  }
  expect(
    (
      await request.post(`/api/imports/${job.id}/resolution`, {
        headers: { Origin: "https://other.example" },
        data: body,
      })
    ).status(),
  ).toBe(403);
  const rejected = await request.post(`/api/imports/${job.id}/resolution`, {
    headers: { Origin: origin },
    data: body,
  });
  expect((await rejected.json()).error.code).toBe(
    "outside-city-acknowledgement-required",
  );
  const confirmed = await request.post(`/api/imports/${job.id}/resolution`, {
    headers: { Origin: origin },
    data: { ...body, acknowledgeOutsideCity: true },
  });
  expect(confirmed.status()).toBe(200);
  expect((await confirmed.json()).job).toMatchObject({
    city: "Shanghai",
    status: "completed",
    mentions: [{ confirmation: { outsideCityAcknowledged: true } }],
  });
  const catalogue = await (
    await request.get("/api/catalogue?city=Shanghai")
  ).json();
  expect(
    catalogue.data.places.map((place: { id: string }) => place.id),
  ).not.toContain("fictional-outside-cafe");
  expect(
    (await (await other.get("/api/imports")).json()).resolvedPlaces,
  ).toEqual([]);
  await request.post(`/api/imports/${job.id}`, {
    headers: { Origin: origin },
    data: { action: "delete" },
  });
  expect(
    (await (await request.get("/api/imports")).json()).resolvedPlaces,
  ).toEqual([]);
  expect(
    (
      await request.post(`/api/imports/${job.id}/resolution`, {
        headers: { Origin: origin },
        data: body,
      })
    ).status(),
  ).toBe(404);
  await other.dispose();
});

test("real canonical branch evidence and address-search references remain qualified only for their actual scope", async ({
  request,
}) => {
  const path = ".data/catalogue-scenario.json";
  const before = readFileSync(path, "utf8");
  try {
    writeFileSync(path, readFileSync("data/catalogue/shanghai.json"));
    const job = await resolve(request, await imported(request, "Canonical"));
    expect(job.mentions[0].candidates).toHaveLength(1);
    expect(job.mentions[0].candidates[0]).toMatchObject({
      id: "bluebottle-zhangyuan",
      place: { address: "上海市静安区茂名北路240号W5-1A号", coordinates: null },
      providerReference: { linkKind: "search", placeId: null },
    });
    expect(job.mentions[0].placeId).toBeNull();
    const local = await resolve(request, await imported(request, "LocalChain"));
    expect(
      local.mentions[0].candidates.map((candidate) => candidate.id),
    ).toEqual(["bluebottle-zhangyuan", "bluebottle-westbund"]);
  } finally {
    writeFileSync(path, before);
  }
});

test("unavailable resolution is explicit and retry retains confirmed identity while resolving other mentions", async ({
  request,
}) => {
  const job = await resolve(request, await imported(request));
  const mention = job.mentions[0];
  const confirmation = await request.post(`/api/imports/${job.id}/resolution`, {
    headers: { Origin: origin },
    data: {
      action: "confirm",
      mentionId: mention.id,
      candidateId: "fictional-cafe-east",
    },
  });
  expect(confirmation.status()).toBe(200);
  const before = (await confirmation.json()).job.mentions[0];
  const path = ".data/catalogue-scenario.json";
  const publication = readFileSync(path, "utf8");
  try {
    writeFileSync(path, "{}");
    const unavailable = await resolve(request, job);
    expect(unavailable.mentions[0]).toEqual(before);
    expect(unavailable.mentions[1]).toMatchObject({
      resolution: { outcome: "provider-unavailable" },
      candidates: [],
      placeId: null,
    });
  } finally {
    writeFileSync(path, publication);
  }
  const retried = await resolve(request, job);
  expect(retried.mentions[0]).toEqual(before);
  expect(retried.mentions[1].resolution?.outcome).toBe("no-match");
  const forged = await request.post(`/api/imports/${job.id}/resolution`, {
    headers: { Origin: origin },
    data: {
      action: "confirm",
      mentionId: job.mentions[1].id,
      candidateId: "fictional-cafe-west",
    },
  });
  expect((await forged.json()).error.code).toBe("candidate-not-found");
  const change = await request.post(`/api/imports/${job.id}/resolution`, {
    headers: { Origin: origin },
    data: {
      action: "confirm",
      mentionId: mention.id,
      candidateId: "fictional-cafe-west",
    },
  });
  expect((await change.json()).error.code).toBe("already-confirmed");
  const same = await request.post(`/api/imports/${job.id}/resolution`, {
    headers: { Origin: origin },
    data: {
      action: "confirm",
      mentionId: mention.id,
      candidateId: "fictional-cafe-east",
    },
  });
  expect((await same.json()).job.mentions[0].confirmation).toEqual(
    before.confirmation,
  );
  const slow = await imported(request, "Slow");
  await request.post(`/api/imports/${slow.id}`, {
    headers: { Origin: origin },
    data: { action: "delete" },
  });
  expect(
    (
      await request.post(`/api/imports/${slow.id}/resolution`, {
        headers: { Origin: origin },
        data: { action: "resolve" },
      })
    ).status(),
  ).toBe(404);
});
