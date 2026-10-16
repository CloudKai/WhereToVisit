import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import type { CatalogueBatch, Trip } from "../src/shared/contracts";
import { catalogueFixture } from "./catalogue-fixture";
import { prepareRestoreTrip } from "./restoration-setup";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
const fictional = process.env.VISIT_FACT_TEST_KIND === "fixture";
function writePlanningFixture(ids: string[]) {
  storage();
  writeFileSync(
    ".data/day-planning-scenario.json",
    JSON.stringify({
      kind: "fixture",
      visitDate: "2026-12-31",
      requestedMode: "walking-transit",
      provider: "Fictional scenario provider",
      apiVersion: "scenario-v1",
      retrievedAt: "2026-10-12T00:00:00Z",
      coordinateProvenance: "Fictional endpoints; no real provider",
      hours: ids.map((placeId) => ({
        placeId,
        closed: false,
        opensMinute: 540,
        closesMinute: 1080,
        evidence: "Fictional dated hours",
      })),
      legs: ids.slice(1).map((toPlaceId, index) => ({
        fromPlaceId: ids[index],
        toPlaceId,
        outcome: "available",
        actualSubmode: "transit",
        resultKind: "route",
        durationSeconds: 900,
        distanceMetres: 1000,
      })),
    }),
  );
}

function storage() {
  if (!process.cwd().endsWith("/.data/ticket20-runtime"))
    throw Error(
      "Ticket20 isolated source copy required before any storage access.",
    );
  const path = JSON.parse(
    readFileSync(".data/trip-storage-test.json", "utf8"),
  ).databasePath;
  if (!resolve(path).startsWith(`${process.cwd()}/.data/ticket20-`))
    throw Error("Isolated storage required.");
  return path as string;
}
function publish(batch: CatalogueBatch, rejects = false) {
  const path = storage();
  writeFileSync(".data/visit-facts-batch.json", JSON.stringify(batch));
  const run = () =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {loadCatalogueFile} from './src/server/catalogue-publication.ts'; loadCatalogueFile('.data/visit-facts-batch.json', ${fictional});`,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_PATH: path },
        stdio: "pipe",
      },
    );
  if (rejects) expect(run).toThrow();
  else run();
}
function mutateStored(id: string, change: (trip: Trip) => void) {
  const db = new Database(storage());
  try {
    const row = db.prepare("SELECT document FROM trips WHERE id=?").get(id) as {
      document: string;
    };
    const trip = JSON.parse(row.document) as Trip;
    change(trip);
    db.prepare("UPDATE trips SET document=? WHERE id=?").run(
      JSON.stringify(trip),
      id,
    );
  } finally {
    db.close();
  }
}

test("reviewed source publication preserves legacy snapshots and current owner guest authority", async ({
  page,
  browser,
}, info) => {
  test.skip(fictional, "Production real evidence boundary");
  const batch = JSON.parse(
    readFileSync("data/catalogue/shanghai.json", "utf8"),
  ) as CatalogueBatch;
  publish(batch);
  const trip = await prepareRestoreTrip(page.request);
  const api = `/api/trips/${trip.id}`;
  const read = async () =>
    (await (await page.request.get(api)).json()).trip as Trip;
  const original = await read();
  mutateStored(trip.id, (stored) => {
    for (const member of stored.savedPlaces) delete member.visitFacts;
  });
  const legacy = await read();
  expect(legacy.savedPlaces.map((member) => member.place)).toEqual(
    original.savedPlaces.map((member) => member.place),
  );
  expect(legacy.savedPlaces[0].visitFacts?.fields.address.checkedAt).toBe(
    "2026-10-12",
  );
  expect(legacy.savedPlaces[0].visitFacts?.fields.operation.value).toBeNull();
  expect(legacy.savedPlaces[0].visitFacts?.fields.hours.checkedAt).toBeNull();
  const planUrl = `${api}/generated-day-plan`;
  expect(
    (await (await page.request.get(planUrl)).json()).generatedDayPlan
      .needsReview,
  ).toBe(false);
  publish(batch);
  const refreshed = await read();
  expect(
    refreshed.savedPlaces.map((member) => ({
      place: member.place,
      importedEvidence: member.importedEvidence,
      evidenceIds: member.evidenceIds,
    })),
  ).toEqual(
    original.savedPlaces.map((member) => ({
      place: member.place,
      importedEvidence: member.importedEvidence,
      evidenceIds: member.evidenceIds,
    })),
  );
  expect(refreshed.selectedPlaceIds).toEqual(original.selectedPlaceIds);
  expect(
    (await (await page.request.get(planUrl)).json()).generatedDayPlan
      .needsReview,
  ).toBe(false);
  const invalid = structuredClone(batch);
  invalid.places[0].hours = {
    description: "Unsupported invented value",
    sourceEvidenceId: "missing",
  };
  publish(invalid, true);
  expect(await read()).toEqual(refreshed);
  expect(
    (await page.request.get("/api/catalogue?city=Shanghai")).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: "fictional-cafe-east" },
      })
    ).status(),
  ).toBe(404);
  const invitation = (
    await (
      await page.request.post(`${api}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await browser.newContext({ baseURL: origin });
  expect(
    (
      await guest.request.post(`/api/invitations/${invitation.token}`, {
        headers,
        data: { displayName: "Fact reader" },
      })
    ).status(),
  ).toBe(201);
  const shared = (
    await (await guest.request.get(`/api/guest-trips/${trip.id}`)).json()
  ).shared;
  expect(shared.trip.savedPlaces[0].visitFacts).toEqual(
    refreshed.savedPlaces[0].visitFacts,
  );
  expect(shared.trip.organiserUserId).toBeUndefined();
  expect(
    (
      await guest.request.post(api, {
        headers,
        data: { action: "update", title: "Unauthorized", city: "Shanghai" },
      })
    ).status(),
  ).toBe(401);
  await page.goto("/trips?view=places", { timeout: 20000 });
  await expect(
    page.getByRole("region", { name: "Current visit facts" }).first(),
  ).toContainText("2026-10-12");
  await expect(
    page.getByRole("region", { name: "Current visit facts" }).first(),
  ).toContainText("Operating status: Unknown");
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("real-unknown-facts-320.png"),
    fullPage: true,
  });
  expect(
    (
      await page.request.post(`${api}/invitation`, {
        headers,
        data: { action: "disable" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await guest.request.get(`/api/guest-trips/${trip.id}`)).status(),
  ).toBe(404);
  await guest.close();
});

test("fictional manual checks distinguish metadata material conflict failure and address identity review", async ({
  page,
}, info) => {
  test.skip(!fictional, "Explicit development fixture mechanics only");
  const batch = catalogueFixture() as CatalogueBatch;
  publish(batch);
  writePlanningFixture(["fictional-cafe-east", "fictional-cafe-west"]);
  const trip = await prepareRestoreTrip(page.request, true);
  const api = `/api/trips/${trip.id}`;
  const planUrl = `${api}/generated-day-plan`;
  const read = async () =>
    (await (await page.request.get(api)).json()).trip as Trip;
  const plan = async () =>
    (await (await page.request.get(planUrl)).json()).generatedDayPlan;
  mutateStored(trip.id, (stored) => {
    stored.savedPlaces[0].importedEvidence.push({
      importId: "fictional-temporary-import",
      mentionId: "fictional-mention",
      source: {
        id: "fictional-original-source",
        sourceUrl: "https://example.invalid/original",
        canonicalUrl: "https://example.invalid/original",
        revision: "fixture-v1",
        revisionUrl: null,
        historyUrl: null,
        capturedAt: "2026-10-12",
        attribution: "Fictional provenance test author",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
        changes: "Fictional quotation fixture; no live source retrieval",
        normalizedSourceHash: "a".repeat(64),
        normalizationVersion: "verbatim-decoded-api-wikitext-v1",
        limits: "Fictional retention mechanics only",
      },
      extraction: {
        method: "fictional-test",
        version: "fixture-v1",
        canonicalUrl: "https://example.invalid/original",
        revision: "fixture-v1",
        normalizedSourceHash: "a".repeat(64),
        normalizationVersion: "verbatim-decoded-api-wikitext-v1",
        quote: "Fictional Scenario Café",
        codePointStart: 0,
        codePointEnd: 21,
      },
      confirmation: {
        candidateId: "fictional-cafe-east",
        confirmedAt: "2026-10-12",
        method: "user-selection",
        independentVerification: false,
        outsideCityAcknowledged: false,
      },
    });
  });
  const original = await read();
  const firstPlan = (await plan()).plan;
  const edit = {
    operationId: randomUUID(),
    expectedRevision: firstPlan.revision,
    stops: firstPlan.stops.map((stop: { placeId: string }, index: number) => ({
      placeId: stop.placeId,
      desiredArrivalMinute: index === 0 ? 615 : null,
    })),
  };
  expect(
    (await page.request.patch(planUrl, { headers, data: edit })).status(),
  ).toBe(200);
  const initialPlan = (await plan()).plan;
  expect(initialPlan.stops[0].desiredArrivalMinute).toBe(615);
  expect(
    (
      await page.request.post(`${api}/collaboration`, {
        headers,
        data: {
          action: "vote",
          operationId: randomUUID(),
          placeId: "fictional-cafe-east",
          choice: "must-go",
        },
      })
    ).status(),
  ).toBe(200);
  const votes = (await (await page.request.get(`${api}/collaboration`)).json())
    .collaboration.votes;
  batch.places[0].evidence[0].capturedAt = "2026-10-13";
  publish(batch);
  expect((await plan()).needsReview).toBe(false);
  expect(
    (await read()).savedPlaces[0].visitFacts?.fields.address.contentVersion,
  ).toBe(0);
  expect((await read()).savedPlaces[0].visitFacts?.fields.address.version).toBe(
    1,
  );
  const place = batch.places[0];
  place.evidence[0].establishedFacts.push("hours", "operation");
  place.hours = {
    description: "Fictional daily 09:00–18:00",
    sourceEvidenceId: place.evidence[0].id,
  };
  place.operationStatus = "current";
  place.visitFactChecks = {
    address: {
      outcome: "checked",
      checkedAt: "2026-10-13",
      evidenceIds: [place.evidence[0].id],
      explanation: "Fictional unchanged branch check",
    },
    hours: {
      outcome: "checked",
      checkedAt: "2026-10-13",
      evidenceIds: [place.evidence[0].id],
      explanation: "Fictional regular hours; not selected-date assurance",
    },
    operation: {
      outcome: "checked",
      checkedAt: "2026-10-13",
      evidenceIds: [place.evidence[0].id],
      explanation: "Fictional operation observation",
    },
  };
  publish(batch);
  expect((await plan()).needsReview).toBe(true);
  expect((await plan()).plan).toEqual(initialPlan);
  expect(
    (
      await page.request.patch(planUrl, {
        headers,
        data: { ...edit, operationId: randomUUID() },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await page.request.patch(planUrl, { headers, data: edit })).status(),
  ).toBe(200);
  expect((await plan()).plan.stops[0].desiredArrivalMinute).toBe(615);
  for (const outcome of ["failed", "unknown", "conflict"] as const) {
    place.visitFactChecks.hours.outcome = outcome;
    place.visitFactChecks.hours.explanation = `Fictional ${outcome} check`;
    publish(batch);
    const field = (await read()).savedPlaces[0].visitFacts?.fields.hours;
    expect(field?.value).toBeNull();
    expect(field?.lastChecked?.value).toBe("Fictional daily 09:00–18:00");
    expect(
      (await read()).savedPlaces[0].visitFacts?.fields.operation.value,
    ).toBe("current");
  }
  place.visitFactChecks.hours.outcome = "checked";
  publish(batch);
  expect((await plan()).needsReview).toBe(true);
  place.visitFactChecks.address.outcome = "conflict";
  publish(batch);
  expect((await read()).savedPlaces[0].visitFacts?.identityReviewRequired).toBe(
    true,
  );
  place.visitFactChecks.address.outcome = "checked";
  place.address = "999 Fictional Relocation Road, Shanghai";
  publish(batch);
  let current = await read();
  expect(current.savedPlaces[0].visitFacts?.identityReviewRequired).toBe(true);
  expect(current.savedPlaces[0].place.address).toBe(
    original.savedPlaces[0].place.address,
  );
  const generate = async () =>
    page.request.post(planUrl, {
      headers,
      data: {
        operationId: randomUUID(),
        expectedRevision: (await plan()).plan.revision,
        requestRevision: initialPlan.requestRevision,
        selectionRevision: initialPlan.selectionRevision,
        replaceEdited: true,
      },
    });
  expect((await generate()).status()).toBe(409);
  await page.goto("/trips?view=day", { timeout: 20000 });
  await expect(
    page.getByRole("region", { name: "Generated day plan", exact: true }),
  ).toContainText("Address or branch identity needs review");
  await expect(
    page.getByRole("region", { name: "Generated day plan", exact: true }),
  ).toContainText("practical facts changed");
  const firstStop = page
    .getByRole("list", { name: "Day stops" })
    .getByRole("listitem")
    .first();
  await expect(
    firstStop.getByRole("button", { name: "Copy local name and address" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("fictional-address-review-320.png"),
    fullPage: true,
  });
  place.visitFactChecks.address.outcome = "failed";
  publish(batch);
  expect((await read()).savedPlaces[0].visitFacts?.identityReviewRequired).toBe(
    true,
  );
  place.visitFactChecks.address.outcome = "checked";
  place.address = original.savedPlaces[0].place.address as string;
  publish(batch);
  expect((await read()).savedPlaces[0].visitFacts?.identityReviewRequired).toBe(
    false,
  );
  expect((await plan()).needsReview).toBe(true);
  place.operationStatus = "closed";
  publish(batch);
  expect((await generate()).status()).toBe(200);
  expect((await plan()).plan.unscheduledPlaces).toContainEqual(
    expect.objectContaining({ placeId: place.id, cause: "closure" }),
  );
  expect((await plan()).plan.stops).not.toContainEqual(
    expect.objectContaining({ placeId: place.id }),
  );
  current = await read();
  expect(current.savedPlaces.map((member) => member.place)).toEqual(
    original.savedPlaces.map((member) => member.place),
  );
  expect(current.savedPlaces[0].importedEvidence).toEqual(
    original.savedPlaces[0].importedEvidence,
  );
  expect(current.selectedPlaceIds).toEqual(original.selectedPlaceIds);
  expect(current.selectionRevision).toEqual(original.selectionRevision);
  expect(
    (await (await page.request.get(`${api}/collaboration`)).json())
      .collaboration.votes,
  ).toEqual(votes);
  const unavailable = {
    ...batch,
    status: "unavailable",
    places: [],
    unavailableReason: {
      code: "fixture-unavailable",
      message: "Fictional check unavailable",
    },
  } as CatalogueBatch;
  publish(unavailable);
  expect(
    (await read()).savedPlaces[0].visitFacts?.fields.operation.value,
  ).toBeNull();
  expect(
    (await read()).savedPlaces[0].visitFacts?.fields.operation.lastChecked
      ?.value,
  ).toBe("closed");
  expect((await plan()).needsReview).toBe(true);
});

test("fictional middle closure reassesses three-stop adjacency without retaining obsolete route timings", async ({
  page,
}, info) => {
  test.skip(
    !fictional,
    "Explicit development fixture only; no real route evidence",
  );
  const batch = catalogueFixture() as CatalogueBatch;
  const third = structuredClone(batch.places[1]);
  third.id = "fictional-cafe-north";
  third.branch = "North branch";
  third.address = "3 Fictional North Road, Shanghai";
  third.evidence[0].id = "fictional-north-source";
  batch.places.push(third);
  publish(batch);
  writePlanningFixture(["fictional-cafe-east", "fictional-cafe-west"]);
  const trip = await prepareRestoreTrip(page.request, true);
  const api = `/api/trips/${trip.id}`;
  const url = `${api}/generated-day-plan`;
  const intent = (
    await (
      await page.request.post("/api/trip-save-intents", {
        headers,
        data: { placeId: third.id },
      })
    ).json()
  ).intent;
  expect(
    (
      await page.request.post(api, {
        headers,
        data: { action: "save", intentId: intent.id },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(api, {
        headers,
        data: { action: "select", placeId: third.id, selected: true },
      })
    ).status(),
  ).toBe(200);
  const draft = (await (await page.request.get(`${api}/day-plan`)).json())
    .dayPlan;
  const saved = (
    await (
      await page.request.post(`${api}/day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: draft.draft.revision,
          selectionRevision: draft.selectionRevision,
          visitDate: "2026-12-31",
        },
      })
    ).json()
  ).dayPlan;
  const ids = ["fictional-cafe-east", "fictional-cafe-west", third.id];
  writePlanningFixture(ids);
  const generate = async (expectedRevision: number) =>
    page.request.post(url, {
      headers,
      data: {
        operationId: randomUUID(),
        expectedRevision,
        requestRevision: saved.draft.revision,
        selectionRevision: saved.selectionRevision,
      },
    });
  const before = (await (await generate(1)).json()).generatedDayPlan.plan;
  expect(before.stops).toHaveLength(3);
  expect(
    before.stops.every(
      (stop: { arrivalMinute: number | null }) => stop.arrivalMinute !== null,
    ),
  ).toBe(true);
  const middle = batch.places[1];
  middle.operationStatus = "closed";
  middle.evidence[0].establishedFacts.push("operation");
  middle.visitFactChecks = {
    address: {
      outcome: "checked",
      checkedAt: "2026-10-12",
      evidenceIds: [middle.evidence[0].id],
      explanation: "Fictional branch identity",
    },
    hours: {
      outcome: "unknown",
      checkedAt: null,
      evidenceIds: [],
      explanation: "No catalogue hours",
    },
    operation: {
      outcome: "checked",
      checkedAt: "2026-10-14",
      evidenceIds: [middle.evidence[0].id],
      explanation: "Fictional closure test",
    },
  };
  publish(batch);
  expect(
    (await (await page.request.get(url)).json()).generatedDayPlan.needsReview,
  ).toBe(true);
  const response = await generate(before.revision);
  expect(response.status()).toBe(200);
  const after = (await response.json()).generatedDayPlan.plan;
  expect(after.stops.map((stop: { placeId: string }) => stop.placeId)).toEqual([
    ids[0],
    ids[2],
  ]);
  expect(
    after.stops.every(
      (stop: {
        arrivalMinute: number | null;
        departureMinute: number | null;
      }) => stop.arrivalMinute === null && stop.departureMinute === null,
    ),
  ).toBe(true);
  expect(after.travelLegs).toHaveLength(1);
  expect(after.travelLegs[0]).toMatchObject({
    fromPlaceId: ids[0],
    toPlaceId: ids[2],
    outcome: "no-route",
    durationSeconds: null,
  });
  expect(
    after.operatingHours.some(
      (hours: { placeId: string }) => hours.placeId === ids[1],
    ),
  ).toBe(false);
  expect(after.unscheduledPlaces).toContainEqual(
    expect.objectContaining({ placeId: ids[1], cause: "closure" }),
  );
  const retained = (await (await page.request.get(api)).json()).trip;
  expect(retained.selectedPlaceIds).toEqual(ids);
  expect(retained.savedPlaces).toHaveLength(3);
  await page.goto("/trips?view=day", { timeout: 20000 });
  const day = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await expect(day).toContainText(
    "precise timing and one-day feasibility remain unresolved",
  );
  await expect(
    day.getByRole("list", { name: "Day stops" }).getByRole("listitem"),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("fictional-middle-closure-320.png"),
    fullPage: true,
  });
});
