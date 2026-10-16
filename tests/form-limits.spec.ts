import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
const placeId = "bluebottle-zhangyuan";
test.setTimeout(120_000);
async function setup(request: APIRequestContext) {
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Form organiser",
          email: `forms-${randomUUID()}@example.invalid`,
          password: "Forms-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const trip = (
    await (
      await request.post("/api/trips", {
        headers,
        data: { title: "Form boundaries", city: "Shanghai" },
      })
    ).json()
  ).trip;
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
  const invitation = (
    await (
      await request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  return { trip, invitation };
}
async function change(
  request: APIRequestContext,
  tripId: string,
  data: Record<string, unknown>,
  owner = false,
) {
  return request.post(
    `/api/${owner ? "trips" : "guest-trips"}/${tripId}/collaboration`,
    {
      headers,
      data: { operationId: randomUUID(), ...data },
    },
  );
}

test("public Unicode boundaries, comment newline policy and authority remain authoritative", async ({
  request,
  playwright,
}) => {
  const { trip, invitation } = await setup(request);
  const guest = await playwright.request.newContext({ baseURL: origin });
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    for (const text of [
      "a".repeat(81),
      "😀".repeat(81),
      "   ",
      "Guest\nname",
      "Guest\tname",
      "Guest\u200ename",
    ]) {
      const response = await guest.post(
        `/api/invitations/${invitation.token}`,
        { headers, data: { displayName: text } },
      );
      expect(response.status()).toBe(400);
      expect((await response.json()).error.message).toContain("Display name");
    }
    expect(
      (
        await guest.post(`/api/invitations/${invitation.token}`, {
          headers,
          data: { displayName: `  ${"😀".repeat(80)}  ` },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await other.post(`/api/invitations/${invitation.token}`, {
          headers,
          data: { displayName: "Other guest" },
        })
      ).status(),
    ).toBe(201);
    for (const unit of ["a", "😀"]) {
      const nameGuest = await playwright.request.newContext({
        baseURL: origin,
      });
      try {
        const joined = await nameGuest.post(
          `/api/invitations/${invitation.token}`,
          { headers, data: { displayName: ` ${unit.repeat(80)} ` } },
        );
        expect(joined.status()).toBe(201);
        expect((await joined.json()).shared.participant.displayName).toBe(
          unit.repeat(80),
        );
      } finally {
        await nameGuest.dispose();
      }
      for (const [action, field, limit, label] of [
        ["comment", "text", 1000, "Comment"],
        ["suggest", "name", 120, "Place name"],
      ] as const) {
        const data = { action, ...(action === "comment" ? { placeId } : {}) };
        const accepted = await change(guest, trip.id, {
          ...data,
          [field]: ` ${unit.repeat(limit)} `,
        });
        expect(accepted.status()).toBe(200);
        const rejected = await change(guest, trip.id, {
          ...data,
          [field]: unit.repeat(limit + 1),
        });
        expect(rejected.status()).toBe(400);
        expect((await rejected.json()).error.message).toContain(label);
      }
    }
    const escapedComment = JSON.stringify({
      operationId: randomUUID(),
      action: "comment",
      placeId,
      text: "😀".repeat(1000),
    }).replace(/😀/g, "\\ud83d\\ude00");
    expect(Buffer.byteLength(escapedComment)).toBeGreaterThan(4096);
    expect(
      (
        await guest.post(`/api/guest-trips/${trip.id}/collaboration`, {
          headers: { ...headers, "Content-Type": "application/json" },
          data: escapedComment,
        })
      ).status(),
    ).toBe(200);
    const oversized = await guest.post(
      `/api/guest-trips/${trip.id}/collaboration`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: " ".repeat(16385),
      },
    );
    expect(oversized.status()).toBe(400);
    expect((await oversized.json()).error.code).toBe("input-too-large");
    for (const text of [
      "First\nSecond",
      "First\r\nSecond",
      ` ${"😀".repeat(998)}\r\nx `,
    ]) {
      const response = await change(guest, trip.id, {
        action: "comment",
        placeId,
        text,
      });
      expect(response.status()).toBe(200);
      expect((await response.json()).collaboration.comments[0].text).toBe(
        text.replace(/\r\n/g, "\n").trim(),
      );
    }
    for (const text of [
      "x\tbad",
      "x\rbad",
      "x\u0000bad",
      "x\u200ebad",
      " \n\r\n ",
    ]) {
      expect(
        (
          await change(guest, trip.id, { action: "comment", placeId, text })
        ).status(),
      ).toBe(400);
    }
    for (const name of ["x\nbad", "x\r\nbad", "x\tbad", "x\u200ebad", "   "]) {
      expect(
        (await change(guest, trip.id, { action: "suggest", name })).status(),
      ).toBe(400);
    }
    const before = (
      await (
        await guest.get(`/api/guest-trips/${trip.id}/collaboration`)
      ).json()
    ).collaboration;
    const own = before.comments[0];
    expect(
      (
        await change(other, trip.id, {
          action: "comment",
          placeId,
          commentId: own.id,
          text: "Other actor",
        })
      ).status(),
    ).toBe(403);
    const suggestion = before.suggestions[0];
    expect(
      (
        await change(other, trip.id, {
          action: "amend",
          suggestionId: suggestion.id,
          name: "Other actor",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await change(guest, trip.id, {
          action: "amend",
          suggestionId: suggestion.id,
          name: "😀".repeat(120),
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await change(guest, trip.id, {
          action: "amend",
          suggestionId: suggestion.id,
          name: "😀".repeat(121),
        })
      ).status(),
    ).toBe(400);
    const old = {
      action: "comment",
      placeId,
      text: "Older\r\ncomment",
      operationId: randomUUID(),
    };
    expect((await change(guest, trip.id, old)).status()).toBe(200);
    expect(
      (
        await change(guest, trip.id, {
          action: "comment",
          placeId,
          text: "Latest\ncomment",
        })
      ).status(),
    ).toBe(200);
    const retry = await change(guest, trip.id, old);
    expect(retry.status()).toBe(200);
    expect((await retry.json()).collaboration.comments[0].text).toBe(
      "Latest\ncomment",
    );
    expect(
      (await change(guest, trip.id, { ...old, text: "Changed" })).status(),
    ).toBe(409);
    await request.post(`/api/trips/${trip.id}/invitation`, {
      headers,
      data: { action: "disable" },
    });
    expect((await change(guest, trip.id, old)).status()).toBe(404);
    expect(
      (
        await change(
          request,
          trip.id,
          { action: "comment", placeId, text: "Owner\ncomment" },
          true,
        )
      ).status(),
    ).toBe(200);
  } finally {
    await guest.dispose();
    await other.dispose();
  }
});

test("day preferences accept trimmed code points, reject each named field and preserve draft", async ({
  request,
  playwright,
}) => {
  const { trip, invitation } = await setup(request);
  const endpoint = `/api/trips/${trip.id}/day-plan`;
  async function save(fields: Record<string, unknown>) {
    const state = (await (await request.get(endpoint)).json()).dayPlan;
    return request.post(endpoint, {
      headers,
      data: {
        operationId: randomUUID(),
        expectedRevision: state.draft?.revision ?? 0,
        selectionRevision: state.selectionRevision,
        visitDate: "2026-12-31",
        ...fields,
      },
    });
  }
  for (const unit of ["a", "😀"]) {
    for (const [field, limit, label] of [
      ["startArea", 200, "Start area or hotel"],
      ["budget", 120, "Budget"],
      ["dietaryNeeds", 500, "Dietary needs"],
    ] as const) {
      const accepted = await save({ [field]: `  ${unit.repeat(limit)}  ` });
      expect(accepted.status()).toBe(200);
      const before = (await accepted.json()).dayPlan;
      expect(before.draft.request[field]).toBe(unit.repeat(limit));
      for (const value of [
        unit.repeat(limit + 1),
        "x\nline",
        "x\r\nline",
        "x\tbad",
        "x\u200ebad",
      ]) {
        const rejected = await save({ [field]: value });
        expect(rejected.status()).toBe(400);
        expect((await rejected.json()).error.message).toContain(label);
        expect((await (await request.get(endpoint)).json()).dayPlan).toEqual(
          before,
        );
      }
    }
  }
  const escapedState = (await (await request.get(endpoint)).json()).dayPlan;
  const escapedPreferences = JSON.stringify({
    operationId: randomUUID(),
    expectedRevision: escapedState.draft.revision,
    selectionRevision: escapedState.selectionRevision,
    visitDate: "2026-12-31",
    startArea: "😀".repeat(200),
    budget: "😀".repeat(120),
    dietaryNeeds: "😀".repeat(500),
  }).replace(/😀/g, "\\ud83d\\ude00");
  expect(Buffer.byteLength(escapedPreferences)).toBeGreaterThan(4096);
  expect(
    (
      await request.post(endpoint, {
        headers: { ...headers, "Content-Type": "application/json" },
        data: escapedPreferences,
      })
    ).status(),
  ).toBe(200);
  const oversized = await request.post(endpoint, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: " ".repeat(16385),
  });
  expect(oversized.status()).toBe(400);
  expect((await oversized.json()).error.code).toBe("input-too-large");
  for (const value of [undefined, null, "", "   "]) {
    const response = await save({
      startArea: value,
      budget: value,
      dietaryNeeds: value,
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).dayPlan.draft.request).toMatchObject({
      startArea: null,
      budget: null,
      dietaryNeeds: null,
    });
  }
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    await guest.post(`/api/invitations/${invitation.token}`, {
      headers,
      data: { displayName: "Guest" },
    });
    expect((await guest.post(endpoint, { headers, data: {} })).status()).toBe(
      401,
    );
  } finally {
    await guest.dispose();
  }
});

test("visible fields retain rejected ASCII, supplementary and control input and save valid boundaries", async ({
  page,
  browser,
}, testInfo) => {
  const { trip, invitation } = await setup(page.request);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(invitation.url);
    const name = guest.getByLabel("Display name", { exact: true });
    for (const value of [
      "a".repeat(81),
      "😀".repeat(81),
      "   ",
      "x\u200ebad",
    ]) {
      await name.fill(value);
      await expect(name).toHaveValue(value);
      await expect(
        guest.getByRole("alert").filter({ hasText: "Display name:" }),
      ).toContainText("Display name:");
      await guest.getByRole("button", { name: "Join as guest" }).click();
      await expect(name).toHaveValue(value);
    }
    await name.fill(`  ${"😀".repeat(80)}  `);
    await guest.getByRole("button", { name: "Join as guest" }).click();
    await expect(
      guest.getByLabel("Your comment for Zhangyuan", { exact: true }),
    ).toBeVisible();
    const comment = guest.getByLabel("Your comment for Zhangyuan", {
      exact: true,
    });
    const suggestion = guest.getByLabel("Unresolved Place name", {
      exact: true,
    });
    for (const [field, limit, label, button] of [
      [comment, 1000, "Comment:", "Save comment for Zhangyuan"],
      [suggestion, 120, "Place name:", "Suggest unresolved Place"],
    ] as const) {
      for (const value of [
        "a".repeat(limit + 1),
        "😀".repeat(limit + 1),
        "   ",
        "x\u200ebad",
      ]) {
        await field.fill(value);
        await expect(field).toHaveValue(value);
        await expect(
          guest.getByRole("alert").filter({ hasText: label }),
        ).toBeVisible();
        await guest.getByRole("button", { name: button, exact: true }).click();
        await expect(field).toHaveValue(value);
      }
      for (const unit of ["a", "😀"]) {
        await field.fill(`  ${unit.repeat(limit)}  `);
        await guest.getByRole("button", { name: button, exact: true }).click();
        await expect(
          guest
            .getByRole("status")
            .filter({ hasText: "Collaboration change saved" }),
        ).toBeVisible();
      }
    }
    await comment.fill("First\nSecond");
    await guest
      .getByRole("button", { name: "Save comment for Zhangyuan" })
      .click();
    await expect(
      guest
        .getByRole("status")
        .filter({ hasText: "Collaboration change saved" }),
    ).toBeVisible();
    await guest.route("**/api/guest-trips/*/collaboration", async (route) => {
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON();
        await route.continue({
          postData: JSON.stringify({ ...input, text: "Server\tcontrol" }),
        });
      } else await route.continue();
    });
    await comment.fill("Keep my rejected submission");
    await guest
      .getByRole("button", { name: "Save comment for Zhangyuan" })
      .click();
    await expect(
      guest.getByRole("alert", { name: "Collaboration request failed" }),
    ).toContainText("Comment:");
    await expect(comment).toHaveValue("Keep my rejected submission");
    expect(
      (
        await (
          await context.request.get(`/api/guest-trips/${trip.id}/collaboration`)
        ).json()
      ).collaboration.comments[0].text,
    ).toBe("First\nSecond");
    await guest.unroute("**/api/guest-trips/*/collaboration");
    await guest
      .getByRole("button", { name: "Save comment for Zhangyuan" })
      .click();
    await expect(
      guest
        .getByRole("status")
        .filter({ hasText: "Collaboration change saved" }),
    ).toBeVisible();
    await guest.screenshot({
      path: testInfo.outputPath("comment-limits.png"),
      fullPage: true,
    });
    const ownSuggestion = guest
      .getByLabel("Amend your suggestion", { exact: true })
      .first();
    await ownSuggestion.fill("😀".repeat(121));
    await guest
      .getByRole("button", { name: "Save suggestion amendment" })
      .first()
      .click();
    await expect(ownSuggestion).toHaveValue("😀".repeat(121));
    await ownSuggestion.fill("😀".repeat(120));
    await guest
      .getByRole("button", { name: "Save suggestion amendment" })
      .first()
      .click();
    await expect(
      guest
        .getByRole("status")
        .filter({ hasText: "Collaboration change saved" }),
    ).toBeVisible();
    await page.goto("/trips?view=day");
    const day = page.getByRole("region", { name: "Plan my day" });
    await day.getByLabel("Visit date (Shanghai)").fill("2026-12-31");
    for (const [label, limit, error] of [
      ["Start area or hotel (optional)", 200, "Start area or hotel:"],
      ["Budget (optional)", 120, "Budget:"],
      ["Dietary needs (optional)", 500, "Dietary needs:"],
    ] as const) {
      const field = day.getByLabel(label, { exact: true });
      for (const value of [
        "a".repeat(limit + 1),
        "😀".repeat(limit + 1),
        "x\u200ebad",
      ]) {
        await field.fill(value);
        await expect(day.getByRole("alert")).toContainText(error);
        await day.getByRole("button", { name: "Save one-day draft" }).click();
        await expect(field).toHaveValue(value);
      }
      for (const unit of ["a", "😀"]) {
        await field.fill(`  ${unit.repeat(limit)}  `);
        await day.getByRole("button", { name: "Save one-day draft" }).click();
        await expect(day).toContainText("One-day draft saved");
        await expect(field).toHaveValue(unit.repeat(limit));
      }
      await field.fill("   ");
      await day.getByRole("button", { name: "Save one-day draft" }).click();
      await expect(field).toHaveValue("");
    }
    await page.screenshot({
      path: testInfo.outputPath("day-field-limits.png"),
      fullPage: true,
    });
    expect(
      (await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json())
        .dayPlan.draft.request,
    ).toMatchObject({ startArea: null, budget: null, dietaryNeeds: null });
  } finally {
    await context.close();
  }
});
