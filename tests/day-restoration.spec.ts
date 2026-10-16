import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import type { DayPlan } from "../src/shared/contracts";
import { prepareRestoreTrip, restoreInput } from "./restoration-setup";

const headers = { Origin: "http://127.0.0.1:8180" };
const source = ".data/day-planning-scenario.json";
function evidence() {
  return {
    kind: "fixture",
    visitDate: "2026-12-31",
    requestedMode: "walking-transit",
    provider: "Fictional scenario provider",
    apiVersion: "scenario-v1",
    retrievedAt: "2026-10-13T00:00:00Z",
    coordinateProvenance: "Fictional endpoint coordinates",
    hours: [
      {
        placeId: "fictional-cafe-east",
        closed: false,
        opensMinute: 540,
        closesMinute: 1080,
        evidence: "Fictional east dated hours",
      },
      {
        placeId: "fictional-cafe-west",
        closed: false,
        opensMinute: 540,
        closesMinute: 1080,
        evidence: "Fictional west dated hours",
      },
    ],
    legs: [
      {
        fromPlaceId: "fictional-cafe-east",
        toPlaceId: "fictional-cafe-west",
        outcome: "available",
        actualSubmode: "transit",
        resultKind: "route",
        durationSeconds: 900,
        distanceMetres: 1500,
      },
    ],
  };
}

function legacyFixture(
  tripId: string,
  change: (document: { plan: DayPlan }) => void,
) {
  // Old-version/exclusion fixture construction only in this isolated task database.
  const { databasePath } = JSON.parse(
    readFileSync(".data/trip-storage-test.json", "utf8"),
  );
  if (
    !process.cwd().endsWith("/.data/ticket16-runtime") ||
    !databasePath.includes("ticket16-development.sqlite")
  )
    throw new Error("Isolated fixture storage required");
  const db = new Database(databasePath);
  const id = `${tripId}:fixture`;
  const document = JSON.parse(
    (
      db
        .prepare("SELECT document FROM generated_day_plans WHERE id=?")
        .get(id) as { document: string }
    ).document,
  );
  change(document);
  db.prepare("UPDATE generated_day_plans SET document=? WHERE id=?").run(
    JSON.stringify(document),
    id,
  );
  db.close();
}

test("known closure capacity route and ambiguous legacy exclusions require newer complete assessment", async ({
  page,
}) => {
  for (const cause of [
    "closure",
    "capacity-conflict",
    "route-conflict",
    "legacy",
  ]) {
    const initial = evidence();
    if (cause === "closure") initial.hours[1].closed = true;
    if (cause === "capacity-conflict" || cause === "route-conflict")
      initial.legs[0].durationSeconds = 40000;
    writeFileSync(source, JSON.stringify(initial));
    const trip = await prepareRestoreTrip(page.request, true);
    const url = `/api/trips/${trip.id}/generated-day-plan`;
    const read = async () =>
      (await (await page.request.get(url)).json()).generatedDayPlan;
    if (cause === "legacy") {
      expect(
        (
          await page.request.patch(url, {
            headers,
            data: {
              operationId: randomUUID(),
              expectedRevision: 1,
              stops: [
                { placeId: "fictional-cafe-east", desiredArrivalMinute: null },
              ],
            },
          })
        ).status(),
      ).toBe(200);
      legacyFixture(trip.id, (document) => {
        delete document.plan.unscheduledPlaces[0].cause;
        delete document.plan.unscheduledPlaces[0].restore;
        document.plan.unscheduledPlaces[0].reason =
          "Removed from this day by the organiser";
      });
    } else if (cause === "route-conflict")
      legacyFixture(trip.id, (document) => {
        document.plan.unscheduledPlaces[0].cause = "route-conflict";
        document.plan.unscheduledPlaces[0].reason =
          "Prior fictional journey conflict";
      });
    const before = await read();
    expect(before.plan.stops).toHaveLength(1);
    const input = restoreInput(before.plan, "fictional-cafe-west");
    // Generic edit cannot insert an excluded stop.
    expect(
      (
        await page.request.patch(url, {
          headers,
          data: {
            operationId: randomUUID(),
            expectedRevision: before.plan.revision,
            stops: [
              { placeId: "fictional-cafe-east", desiredArrivalMinute: null },
              { placeId: "fictional-cafe-west", desiredArrivalMinute: null },
            ],
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post(`${url}/restore`, { headers, data: input })
      ).status(),
    ).toBe(409);
    expect(await read()).toEqual(before);
    const next = evidence();
    // Merely changing old evidence is insufficient; its retrieval remains old.
    writeFileSync(source, JSON.stringify(next));
    expect(
      (
        await page.request.post(`${url}/restore`, { headers, data: input })
      ).status(),
    ).toBe(409);
    next.retrievedAt = new Date(Date.now() + 1000).toISOString();
    next.legs = []; // Fresh but incomplete route evidence cannot restore an exclusion.
    writeFileSync(source, JSON.stringify(next));
    expect(
      (
        await page.request.post(`${url}/restore`, { headers, data: input })
      ).status(),
    ).toBe(409);
    expect(await read()).toEqual(before);
    const fresh = evidence();
    fresh.retrievedAt = new Date(Date.now() + 1000).toISOString();
    writeFileSync(source, JSON.stringify(fresh));
    expect(
      (
        await page.request.post(`${url}/restore`, { headers, data: input })
      ).status(),
    ).toBe(200);
    const restored = await read();
    expect(restored.plan.stops).toHaveLength(2);
    expect(restored.plan.unscheduledPlaces).toEqual([]);
    expect(restored.plan.warnings.join(" ")).toContain(
      "Fictional provider evidence",
    );
    expect(
      (
        await page.request.post(`${url}/restore`, { headers, data: input })
      ).status(),
    ).toBe(200);
    expect(await read()).toEqual(restored);
  }
});

test("lost Restore response retains retry and successful receipt cannot replay after selection and data-kind cycles", async ({
  page,
}) => {
  writeFileSync(source, JSON.stringify(evidence()));
  const trip = await prepareRestoreTrip(page.request, true);
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  expect(
    (
      await page.request.patch(url, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 1,
          stops: [
            { placeId: "fictional-cafe-east", desiredArrivalMinute: null },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/trips?view=day");
  const day = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  await expect(day).toContainText("Revision 2");
  let captured: ReturnType<typeof restoreInput> | undefined;
  await page.route(`**${url}/restore`, async (route) => {
    if (!captured) {
      captured = route.request().postDataJSON();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await day.getByRole("button", { name: "Restore to this day" }).click();
  await expect(
    page.getByRole("alert", { name: "Day plan request failed" }),
  ).toContainText("No new change is confirmed saved");
  expect(
    (await (await page.request.get(url)).json()).generatedDayPlan.plan.revision,
  ).toBe(3);
  await page
    .getByRole("button", { name: "Retry day request", exact: true })
    .click();
  await expect(day).toContainText("Revision 3");
  expect(
    (
      await page.request.patch(url, {
        headers,
        data: { operationId: randomUUID(), expectedRevision: 3, stops: [] },
      })
    ).status(),
  ).toBe(200);
  const prior = (await (await page.request.get(url)).json()).generatedDayPlan;
  for (const placeId of ["fictional-cafe-east", "fictional-cafe-west"])
    expect(
      (
        await page.request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "remove", placeId },
        })
      ).status(),
    ).toBe(200);
  const cataloguePath = ".data/catalogue-scenario.json";
  const original = readFileSync(cataloguePath);
  writeFileSync(cataloguePath, readFileSync("data/catalogue/shanghai.json"));
  const save = async (placeId: string) => {
    const intent = (
      await (
        await page.request.post("/api/trip-save-intents", {
          headers,
          data: { placeId },
        })
      ).json()
    ).intent;
    expect(
      (
        await page.request.post(`/api/trips/${trip.id}`, {
          headers,
          data: { action: "save", intentId: intent.id },
        })
      ).status(),
    ).toBe(200);
  };
  await save("bluebottle-zhangyuan");
  expect(
    (
      await page.request.post(`${url}/restore`, { headers, data: captured })
    ).status(),
  ).toBe(409);
  expect(
    (await (await page.request.get(url)).json()).generatedDayPlan.plan,
  ).toBeNull();
  expect(
    (
      await page.request.post(`/api/trips/${trip.id}`, {
        headers,
        data: { action: "remove", placeId: "bluebottle-zhangyuan" },
      })
    ).status(),
  ).toBe(200);
  writeFileSync(cataloguePath, original);
  await save("fictional-cafe-west");
  expect(
    (
      await page.request.post(`${url}/restore`, { headers, data: captured })
    ).status(),
  ).toBe(200);
  const current = (await (await page.request.get(url)).json()).generatedDayPlan;
  expect(current.needsReview).toBe(true);
  expect(current.plan.stops).toEqual([]);
  expect(current.plan.revision).toBe(prior.plan.revision);
});

test("manual removal retains a known unavailable journey requirement until fresh evidence passes", async ({
  request,
}) => {
  const initial = evidence();
  initial.legs = [];
  writeFileSync(source, JSON.stringify(initial));
  const trip = await prepareRestoreTrip(request, true);
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  expect(
    (
      await request.patch(url, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 1,
          stops: [
            { placeId: "fictional-cafe-east", desiredArrivalMinute: null },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  const before = (await (await request.get(url)).json()).generatedDayPlan;
  expect(before.plan.unscheduledPlaces[0].cause).toBe("manual-removal");
  expect(before.plan.unscheduledPlaces[0].restoreEligibility).toBe(
    "fresh-evidence-required",
  );
  const input = restoreInput(before.plan, "fictional-cafe-west");
  writeFileSync(source, JSON.stringify(evidence()));
  expect(
    (await request.post(`${url}/restore`, { headers, data: input })).status(),
  ).toBe(409);
  expect((await (await request.get(url)).json()).generatedDayPlan).toEqual(
    before,
  );
  const fresh = evidence();
  fresh.retrievedAt = new Date(Date.now() + 1000).toISOString();
  writeFileSync(source, JSON.stringify(fresh));
  expect(
    (await request.post(`${url}/restore`, { headers, data: input })).status(),
  ).toBe(200);
  expect(
    (await (await request.get(url)).json()).generatedDayPlan.plan.stops,
  ).toHaveLength(2);
});
