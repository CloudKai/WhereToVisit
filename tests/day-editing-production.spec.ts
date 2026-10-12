import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:8180" };
async function prepare(request: APIRequestContext) {
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Editor",
          email: `edit-${randomUUID()}@example.invalid`,
          password: "Editing-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await request.post("/api/trips", {
        headers,
        data: { title: "Edited real day", city: "Shanghai" },
      })
    ).json()
  ).trip;
  for (const placeId of ["bluebottle-zhangyuan", "roastery-shanghai"]) {
    const intent = (
      await (
        await request.post("/api/trip-save-intents", {
          headers,
          data: { placeId },
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
          data: { action: "select", placeId, selected: true },
        })
      ).status(),
    ).toBe(200);
  }
  const draft = (
    await (await request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  const saved = (
    await (
      await request.post(`/api/trips/${trip.id}/day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 0,
          selectionRevision: draft.selectionRevision,
          visitDate: "2026-12-31",
        },
      })
    ).json()
  ).dayPlan;
  expect(
    (
      await request.post(`/api/trips/${trip.id}/generated-day-plan`, {
        headers,
        data: {
          operationId: randomUUID(),
          expectedRevision: 0,
          requestRevision: saved.draft.revision,
          selectionRevision: saved.selectionRevision,
        },
      })
    ).status(),
  ).toBe(200);
  return trip;
}
test("organiser edits a real day, reloads and reviews the retained canonical branch", async ({
  page,
  browser,
}, testInfo) => {
  const trip = await prepare(page.request);
  await page.goto("/trips");
  const result = page.getByRole("region", {
    name: "Generated day plan",
    exact: true,
  });
  const stops = result
    .getByRole("list", { name: "Day stops" })
    .getByRole("listitem");
  await stops.nth(1).getByRole("button", { name: "Move earlier" }).click();
  await expect(result).toContainText("Revision 2");
  await stops.nth(0).getByLabel("Desired arrival (Shanghai)").fill("08:30");
  await stops.nth(0).getByRole("button", { name: "Save desired time" }).click();
  await expect(result).toContainText("User-desired arrival 08:30");
  await stops
    .nth(1)
    .getByRole("button", { name: "Remove from this day" })
    .click();
  await expect(result).toContainText("Removed from this day by the organiser");
  await page.reload();
  await expect(result).toContainText("User-desired arrival 08:30");
  await expect(result).toContainText("Timing unresolved");
  const current = (
    await (await page.request.get(`/api/trips/${trip.id}`)).json()
  ).trip;
  expect(current.selectedPlaceIds).toEqual([
    "bluebottle-zhangyuan",
    "roastery-shanghai",
  ]);
  expect(
    current.savedPlaces.map((s: { placeId: string }) => s.placeId),
  ).toEqual(["bluebottle-zhangyuan", "roastery-shanghai"]);
  await stops
    .nth(0)
    .getByRole("button", { name: "Review branch details" })
    .click();
  const details = result.getByRole("region", {
    name: "Day stop branch details",
  });
  await expect(details).toContainText("Shanghai Roastery");
  const addressLink = await details
    .getByRole("link", { name: "Search address on Apple Maps" })
    .getAttribute("href");
  expect(new URL(addressLink as string).searchParams.get("q")).toBe(
    "星巴克臻选上海烘焙工坊 上海市静安区南京西路789号N110及201",
  );
  await expect(details).toContainText(
    "Exact map and navigation remain unavailable",
  );
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replace edited day plan", exact: true }),
  ).toBeVisible();
  await expect(result).toContainText("User-desired arrival 08:30");
  await page.getByRole("button", { name: "Keep edited day plan" }).click();
  await expect(result).toContainText("User-desired arrival 08:30");
  const discovery = await page.context().newPage();
  try {
    await discovery.goto("/discover?placeId=roastery-shanghai");
    const branch = discovery.getByRole("article", {
      name: "Starbucks Reserve Shanghai Roastery, Shanghai Roastery",
      exact: true,
    });
    await expect(branch).toHaveAttribute("data-selected", "true");
    await expect(branch.locator("details")).toHaveAttribute("open", "");
    await expect(
      discovery.getByRole("region", { name: "Discovery map" }),
    ).toContainText("Map unavailable");
  } finally {
    await discovery.close();
  }
  const invitation = (
    await (
      await page.request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await browser.newContext();
  try {
    expect(
      (
        await guest.request.post(
          `http://127.0.0.1:8180/api/invitations/${invitation.token}`,
          { headers, data: { displayName: "Reader" } },
        )
      ).status(),
    ).toBe(201);
    const guestPage = await guest.newPage();
    await guestPage.goto(`http://127.0.0.1:8180/shared-trips/${trip.id}`);
    await expect(
      guestPage.getByRole("region", {
        name: "Generated day plan",
        exact: true,
      }),
    ).toContainText("User-desired arrival 08:30");
    await expect(
      guestPage.getByRole("button", { name: "Move earlier" }),
    ).toHaveCount(0);
    expect(
      (
        await guest.request.patch(
          `http://127.0.0.1:8180/api/trips/${trip.id}/generated-day-plan`,
          {
            headers,
            data: { operationId: randomUUID(), expectedRevision: 4, stops: [] },
          },
        )
      ).status(),
    ).toBe(401);
  } finally {
    await guest.close();
  }
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`day-editing-${width}.png`),
      fullPage: true,
    });
  }
});

test("stale owner editing reloads the current day and regeneration requires replacement", async ({
  page,
  browser,
}) => {
  const trip = await prepare(page.request);
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  const before = (await (await page.request.get(url)).json()).generatedDayPlan;
  const owner = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  try {
    const stale = await owner.newPage();
    await stale.goto("http://127.0.0.1:8180/trips");
    const result = stale.getByRole("region", {
      name: "Generated day plan",
      exact: true,
    });
    await expect(result).toContainText("Revision 1");
    const patch = {
      operationId: randomUUID(),
      expectedRevision: 1,
      stops: [
        { placeId: "roastery-shanghai", desiredArrivalMinute: null },
        { placeId: "bluebottle-zhangyuan", desiredArrivalMinute: 600 },
      ],
    };
    expect(
      (await page.request.patch(url, { headers, data: patch })).status(),
    ).toBe(200);
    await result
      .getByRole("list", { name: "Day stops" })
      .getByRole("listitem")
      .nth(1)
      .getByRole("button", { name: "Move earlier" })
      .click();
    await expect(
      stale.getByRole("alert", { name: "Day plan request failed" }),
    ).toContainText("changed");
    await expect(result).toContainText("Revision 1");
    await stale
      .getByRole("button", { name: "Reload day request", exact: true })
      .click();
    await expect(result).toContainText("Revision 2");
    await expect(result).toContainText("User-desired arrival 10:00");
    const current = (await (await page.request.get(url)).json())
      .generatedDayPlan;
    for (const data of [
      { ...patch, operationId: randomUUID(), expectedRevision: 1 },
    ])
      expect((await page.request.patch(url, { headers, data })).status()).toBe(
        409,
      );
    const generation = {
      operationId: randomUUID(),
      expectedRevision: 2,
      requestRevision: before.plan.requestRevision,
      selectionRevision: before.plan.selectionRevision,
    };
    expect(
      (await page.request.post(url, { headers, data: generation })).status(),
    ).toBe(409);
    expect(
      (
        await page.request.post(url, {
          headers,
          data: {
            ...generation,
            operationId: randomUUID(),
            expectedRevision: 1,
            replaceEdited: true,
          },
        })
      ).status(),
    ).toBe(409);
    for (const stops of [
      [{ placeId: "unknown-place", desiredArrivalMinute: null }],
      [
        { placeId: "roastery-shanghai", desiredArrivalMinute: null },
        { placeId: "roastery-shanghai", desiredArrivalMinute: null },
      ],
      [{ placeId: "roastery-shanghai", desiredArrivalMinute: -1 }],
      [{ placeId: "roastery-shanghai", desiredArrivalMinute: 1440 }],
      [{ placeId: "roastery-shanghai", desiredArrivalMinute: 1.5 }],
      [{ placeId: "roastery-shanghai", desiredArrivalMinute: "10:00" }],
      [
        {
          placeId: "roastery-shanghai",
          desiredArrivalMinute: null,
          provider: "forged",
        },
      ],
    ])
      expect(
        (
          await page.request.patch(url, {
            headers,
            data: { operationId: randomUUID(), expectedRevision: 2, stops },
          })
        ).status(),
      ).toBe(400);
    expect(
      (await (await page.request.get(url)).json()).generatedDayPlan,
    ).toEqual(current);
    expect(
      (await page.request.patch(url, { headers, data: patch })).status(),
    ).toBe(200);
    expect(
      (await (await page.request.get(url)).json()).generatedDayPlan,
    ).toEqual(current);
    expect(
      (
        await page.request.patch(url, {
          headers,
          data: { ...patch, stops: [] },
        })
      ).status(),
    ).toBe(409);
    await stale
      .getByRole("button", { name: "Generate day plan", exact: true })
      .click();
    await expect(
      stale.getByRole("alert", { name: "Replace manual edits" }),
    ).toContainText("replace the edited order");
    await stale
      .getByRole("button", { name: "Replace edited day plan", exact: true })
      .click();
    await expect(result).toContainText("Revision 3");
    await expect(result).not.toContainText("User-desired arrival 10:00");
    const regenerated = (await (await page.request.get(url)).json())
      .generatedDayPlan.plan;
    expect(regenerated.manuallyEdited).toBe(false);
    expect(
      regenerated.stops.map((stop: { placeId: string }) => stop.placeId),
    ).toEqual(["bluebottle-zhangyuan", "roastery-shanghai"]);
  } finally {
    await owner.close();
  }
});

test("bounded ordered-edit JSON permits larger bodies and rejects oversized input without losing state", async ({
  page,
}) => {
  const trip = await prepare(page.request);
  const url = `/api/trips/${trip.id}/generated-day-plan`;
  const input = {
    operationId: randomUUID(),
    expectedRevision: 1,
    stops: [
      { placeId: "roastery-shanghai", desiredArrivalMinute: 660 },
      { placeId: "bluebottle-zhangyuan", desiredArrivalMinute: null },
    ],
  };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  expect(
    (
      await page.request.patch(url, {
        headers: jsonHeaders,
        data: " ".repeat(7000) + JSON.stringify(input),
      })
    ).status(),
  ).toBe(200);
  const current = (await (await page.request.get(url)).json()).generatedDayPlan;
  const oversized = await page.request.patch(url, {
    headers: jsonHeaders,
    data:
      " ".repeat(65537) +
      JSON.stringify({
        ...input,
        operationId: randomUUID(),
        expectedRevision: 2,
      }),
  });
  expect(oversized.status()).toBe(400);
  expect((await oversized.json()).error.code).toBe("input-too-large");
  expect((await (await page.request.get(url)).json()).generatedDayPlan).toEqual(
    current,
  );
});
