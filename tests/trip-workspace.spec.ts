import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

const origin = "http://127.0.0.1:8180";
const headers = { Origin: origin };
const capture = process.env.WHERETOVISIT_CAPTURE_PATH;
async function create(request: APIRequestContext, title = "Solo Shanghai day") {
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        headers,
        data: {
          name: "Organiser",
          email: `workspace-${randomUUID()}@example.invalid`,
          password: "Workspace-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const response = await request.post("/api/trips", {
    headers,
    data: { title, city: "Shanghai" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).trip;
}
async function save(request: APIRequestContext, tripId: string) {
  const response = await request.post("/api/trip-save-intents", {
    headers,
    data: { placeId: "bluebottle-zhangyuan" },
  });
  expect(response.status()).toBe(201);
  expect(
    (
      await request.post(`/api/trips/${tripId}`, {
        headers,
        data: { action: "save", intentId: (await response.json()).intent.id },
      })
    ).status(),
  ).toBe(200);
}
async function view(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Trip views" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Trip views" })
      .getByRole("link", { name, exact: true }),
  ).toHaveAttribute("aria-current", "page");
}
async function shot(page: Page, name: string) {
  if (!capture) return;
  mkdirSync(capture, { recursive: true });
  await page.screenshot({
    path: resolve(capture, `${name}.png`),
    fullPage: true,
  });
}
async function selectAndPlan(page: Page) {
  await page.getByLabel("Select Zhangyuan for a day plan").click();
  await expect(
    page.getByLabel("Select Zhangyuan for a day plan"),
  ).toBeChecked();
  await view(page, "Day");
  await page.getByLabel("Visit date (Shanghai)").fill("2026-12-31");
  await page
    .getByRole("button", { name: "Save one-day draft", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Plan my day", exact: true }),
  ).toContainText("One-day draft saved");
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Generated day plan", exact: true }),
  ).toBeVisible();
}
test("solo Save, day choice and included stops are distinct without an invitation", async ({
  page,
}) => {
  const trip = await create(page.request);
  await page.goto(`/trips?tripId=${trip.id}&placeId=bluebottle-zhangyuan`);
  const review = page.getByRole("region", { name: "Pending save" });
  await expect(review).toContainText(
    "Destination: Solo Shanghai day · Shanghai",
  );
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
      .savedPlaces,
  ).toEqual([]);
  await review.getByRole("button", { name: "Save reviewed branch" }).click();
  await expect(review).not.toBeVisible();
  const workspace = page.getByRole("region", {
    name: "Trip workspace",
    exact: true,
  });
  await expect(workspace).toContainText(
    "1 saved in shortlist · 0 chosen for day · 0 included stops",
  );
  await selectAndPlan(page);
  await expect(workspace).toContainText(
    "1 saved in shortlist · 1 chosen for day · 1 included stops",
  );
  await expect(workspace).toContainText("Saved visit 2026-12-31 (Shanghai)");
  await expect(
    page.getByRole("region", { name: "Generated day plan" }),
  ).toContainText("Timing unresolved");
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}/invitation`)).json())
      .invitation,
  ).toBeNull();
  expect(
    (
      await (
        await page.request.get(`/api/trips/${trip.id}/collaboration`)
      ).json()
    ).collaboration.votes,
  ).toEqual([]);
  await shot(page, "solo-day-1280");
  await page.setViewportSize({ width: 375, height: 812 });
  await shot(page, "solo-day-375");
  await page.setViewportSize({ width: 1280, height: 900 });
  await view(page, "Manage");
  await expect(
    page.getByRole("button", { name: "Create invitation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await shot(page, "solo-manage-1280");
  await view(page, "Places");
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).toContainText("Included in saved day");
  await expect(
    page.getByRole("button", { name: "Create invitation", exact: true }),
  ).not.toBeVisible();
});
test("view history, branch detail and inactive panes preserve all edited fields without submitting", async ({
  page,
}) => {
  const trip = await create(page.request);
  await save(page.request, trip.id);
  await page.goto(`/trips?tripId=${trip.id}`);
  await selectAndPlan(page);
  let writes = 0;
  page.on("request", (request) => {
    if (
      ["POST", "PATCH"].includes(request.method()) &&
      request.url().includes("/api/")
    )
      writes++;
  });
  await page
    .getByLabel("Start area or hotel (optional)")
    .fill("未保存的酒店区域");
  await page.getByLabel("Desired arrival (Shanghai)").fill("10:30");
  await page
    .getByRole("button", { name: "Review branch details", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Day stop branch details" }),
  ).toBeVisible();
  await view(page, "Group");
  await page
    .getByLabel("Your comment for Zhangyuan", {
      exact: true,
    })
    .fill("保留第一行\nKeep the second line");
  await view(page, "Manage");
  await page
    .getByLabel("Trip title", { exact: true })
    .fill("Unsubmitted title");
  await page.goBack();
  await expect(
    page.getByRole("region", { name: "Group decisions" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Your comment for Zhangyuan", {
      exact: true,
    }),
  ).toHaveValue("保留第一行\nKeep the second line");
  await page.goBack();
  await expect(
    page.getByRole("region", { name: "Day stop branch details" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close branch details", exact: true })
    .click();
  await expect(page.getByLabel("Start area or hotel (optional)")).toHaveValue(
    "未保存的酒店区域",
  );
  await expect(page.getByLabel("Desired arrival (Shanghai)")).toHaveValue(
    "10:30",
  );
  await page.goForward();
  await page.goForward();
  await expect(page.getByLabel("Trip title", { exact: true })).toHaveValue(
    "Unsubmitted title",
  );
  await view(page, "Places");
  await expect(
    page.getByLabel("Trip title", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByLabel("Start area or hotel (optional)"),
  ).not.toBeVisible();
  await expect(
    page.getByLabel("Your comment for Zhangyuan", {
      exact: true,
    }),
  ).not.toBeVisible();
  const hidden = await page
    .locator(".trip-workspace-pane[hidden]")
    .evaluateAll((panes) =>
      panes.every(
        (pane) =>
          getComputedStyle(pane).display === "none" &&
          pane.hasAttribute("inert"),
      ),
    );
  expect(hidden).toBe(true);
  expect(writes).toBe(0);
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip.title,
  ).toBe("Solo Shanghai day");
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json())
      .dayPlan.draft.request.startArea,
  ).toBeNull();
  expect(
    (
      await (
        await page.request.get(`/api/trips/${trip.id}/collaboration`)
      ).json()
    ).collaboration.comments,
  ).toEqual([]);
});
test("a lost day-save response retains the operation across view changes and retries without replay", async ({
  page,
}) => {
  const trip = await create(page.request);
  await save(page.request, trip.id);
  await page.goto(`/trips?tripId=${trip.id}`);
  // Wait for the mounted Day read before changing selection, then wait for its refreshed controls.
  await expect(
    page
      .getByRole("region", { name: "Plan my day", includeHidden: true })
      .getByRole("button", {
        name: "Save one-day draft",
        exact: true,
        includeHidden: true,
      }),
  ).toBeEnabled();
  await page.getByLabel("Select Zhangyuan for a day plan").click();
  await expect(
    page.getByLabel("Select Zhangyuan for a day plan"),
  ).toBeChecked();
  await view(page, "Day");
  await expect(page.getByRole("region", { name: "Plan my day" })).toContainText(
    "1 confirmed Places selected",
  );
  await expect(
    page.getByRole("button", { name: "Save one-day draft", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Visit date (Shanghai)").fill("2026-12-30");
  const identities: string[] = [];
  let first = true;
  await page.route(`**/api/trips/${trip.id}/day-plan`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    identities.push(route.request().postDataJSON().operationId);
    if (first) {
      first = false;
      await route.fetch();
      return route.abort();
    }
    return route.continue();
  });
  await page
    .getByRole("button", { name: "Save one-day draft", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Day plan request failed" }),
  ).toBeVisible();
  const before = (
    await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  await view(page, "Places");
  await view(page, "Group");
  await page.goBack();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Retry day request" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry day request" }).click();
  await expect(page.getByRole("region", { name: "Plan my day" })).toContainText(
    "One-day draft saved",
  );
  expect(identities).toHaveLength(2);
  expect(identities[1]).toBe(identities[0]);
  const after = (
    await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  expect(after.draft.revision).toBe(before.draft.revision);
});
test("changing selection keeps an interrupted save identity and exposes stale review before receipt acknowledgement", async ({
  page,
}) => {
  const trip = await create(page.request);
  await save(page.request, trip.id);
  await page.goto(`/trips?tripId=${trip.id}`);
  await page.getByLabel("Select Zhangyuan for a day plan").click();
  await expect(
    page.getByLabel("Select Zhangyuan for a day plan"),
  ).toBeChecked();
  await view(page, "Day");
  await page.getByLabel("Visit date (Shanghai)").fill("2026-12-29");
  const identities: string[] = [];
  let loseResponse = true;
  await page.route(`**/api/trips/${trip.id}/day-plan`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    identities.push(route.request().postDataJSON().operationId);
    if (loseResponse) {
      loseResponse = false;
      await route.fetch();
      return route.abort();
    }
    return route.continue();
  });
  await page
    .getByRole("button", { name: "Save one-day draft", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry day request" }),
  ).toBeVisible();
  const committed = (
    await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  await view(page, "Places");
  await page.getByLabel("Select Zhangyuan for a day plan").click();
  await expect(
    page.getByLabel("Select Zhangyuan for a day plan"),
  ).not.toBeChecked();
  await view(page, "Day");
  await expect(
    page.getByRole("button", { name: "Retry day request" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Plan my day" })).toContainText(
    "Chosen Places changed since this draft",
  );
  await page.getByRole("button", { name: "Retry day request" }).click();
  await expect(page.getByRole("region", { name: "Plan my day" })).toContainText(
    "previous save was confirmed, but chosen Places now need review",
  );
  expect(identities).toHaveLength(2);
  expect(identities[1]).toBe(identities[0]);
  const current = (
    await (await page.request.get(`/api/trips/${trip.id}/day-plan`)).json()
  ).dayPlan;
  expect(current.draft.revision).toBe(committed.draft.revision);
  expect(current.needsReview).toBe(true);
  expect(
    (await (await page.request.get(`/api/trips/${trip.id}`)).json()).trip
      .selectedPlaceIds,
  ).toEqual([]);
});
test("Trip switching and leaving via Back explicitly protect workspace drafts", async ({
  page,
}) => {
  const first = await create(page.request, "First Trip");
  await save(page.request, first.id);
  const second = (
    await (
      await page.request.post("/api/trips", {
        headers,
        data: { title: "Second Trip", city: "Shanghai" },
      })
    ).json()
  ).trip;
  await page.goto("/discover");
  await page.goto(`/trips?tripId=${first.id}&view=group`);
  const comment = page.getByLabel("Your comment for Zhangyuan", {
    exact: true,
  });
  await comment.fill("Do not lose this");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(comment).toHaveValue("Do not lose this");
  await page.getByText("Choose or create a Trip", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("Your Trip", { exact: true }).selectOption(second.id);
  await expect(page.getByLabel("Your Trip", { exact: true })).toHaveValue(
    first.id,
  );
  await expect(comment).toHaveValue("Do not lose this");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Your Trip", { exact: true }).selectOption(second.id);
  await expect(
    page.getByRole("region", { name: "Trip workspace" }),
  ).toContainText("Second Trip");
  await expect(
    page.getByRole("region", { name: "Saved shortlist" }),
  ).toContainText("No saved Places yet");
  await view(page, "Group");
  await expect(
    page.getByLabel("Your comment for Zhangyuan", {
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (
      await (
        await page.request.get(`/api/trips/${first.id}/collaboration`)
      ).json()
    ).collaboration.comments,
  ).toEqual([]);
});
test("guests start on Group, keep drafts and share Day context without organiser authority", async ({
  page,
  browser,
}) => {
  const trip = await create(page.request, "Companions in Shanghai");
  await save(page.request, trip.id);
  await page.goto(`/trips?tripId=${trip.id}`);
  await selectAndPlan(page);
  await page
    .getByLabel("Start area or hotel (optional)")
    .fill("Shared hotel area");
  await page.getByLabel("Budget (optional)").fill("CNY 300");
  await page.getByLabel("Dietary needs (optional)").fill("Vegetarian");
  await page
    .getByRole("button", { name: "Save one-day draft", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Plan my day" })).toContainText(
    "One-day draft saved",
  );
  const invitation = (
    await (
      await page.request.post(`/api/trips/${trip.id}/invitation`, {
        headers,
        data: { action: "create" },
      })
    ).json()
  ).invitation;
  const guest = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto(invitation.url);
    await guestPage.getByLabel("Display name").fill("同伴 Companion");
    await guestPage
      .getByRole("button", { name: "Join as guest", exact: true })
      .click();
    await expect(
      guestPage.getByRole("region", { name: "Group decisions" }),
    ).toBeVisible();
    await expect(
      guestPage
        .getByRole("navigation", { name: "Trip views" })
        .getByRole("link", { name: "Group", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await guestPage
      .getByLabel("Your comment for Zhangyuan", {
        exact: true,
      })
      .fill("Guest draft survives");
    await view(guestPage, "Day");
    await expect(
      guestPage.getByRole("region", { name: "Shared day-plan context" }),
    ).toContainText("Shared hotel area");
    await expect(
      guestPage.getByRole("region", { name: "Shared day-plan context" }),
    ).toContainText("CNY 300");
    await expect(
      guestPage.getByRole("region", { name: "Shared day-plan context" }),
    ).toContainText("Vegetarian");
    await expect(
      guestPage.getByRole("button", { name: "Save one-day draft" }),
    ).toHaveCount(0);
    await expect(
      guestPage.getByRole("button", { name: "Generate day plan" }),
    ).toHaveCount(0);
    await expect(
      guestPage
        .getByRole("navigation", { name: "Trip views" })
        .getByRole("link", { name: "Manage", exact: true }),
    ).toHaveCount(0);
    await view(guestPage, "Places");
    await expect(guestPage.getByRole("checkbox")).toHaveCount(0);
    await shot(guestPage, "guest-places-375");
    await view(guestPage, "Group");
    await expect(
      guestPage.getByLabel("Your comment for Zhangyuan", {
        exact: true,
      }),
    ).toHaveValue("Guest draft survives");
    await guestPage
      .getByRole("button", {
        name: "Save comment for Zhangyuan",
        exact: true,
      })
      .click();
    await expect(
      guestPage.getByRole("region", { name: "Group decisions" }),
    ).toContainText("Collaboration change saved");
    await shot(guestPage, "guest-group-375");
    const returned = await guest.newPage();
    await returned.goto(`/shared-trips/${trip.id}?view=manage`);
    await expect(
      returned.getByRole("region", { name: "Group decisions" }),
    ).toBeVisible();
    await expect(returned).toHaveURL(/view=group/);
    await expect(
      returned.getByRole("button", { name: "Create invitation" }),
    ).toHaveCount(0);
    await returned.close();
    const contribution = {
      action: "vote",
      placeId: "bluebottle-zhangyuan",
      choice: "must-go",
      operationId: randomUUID(),
    };
    expect(
      (
        await guest.request.post(`/api/guest-trips/${trip.id}/collaboration`, {
          headers,
          data: contribution,
        })
      ).status(),
    ).toBe(200);
    for (const [path, data] of [
      [
        `/api/trips/${trip.id}`,
        { action: "select", placeId: "bluebottle-zhangyuan", selected: false },
      ],
      [`/api/trips/${trip.id}/invitation`, { action: "replace" }],
      [`/api/trips/${trip.id}/day-plan`, { visitDate: "2026-12-30" }],
    ] as const)
      expect((await guest.request.post(path, { headers, data })).status()).toBe(
        401,
      );
    expect(
      (
        await page.request.post(`/api/trips/${trip.id}/invitation`, {
          headers,
          data: { action: "replace" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await guest.request.post(`/api/guest-trips/${trip.id}/collaboration`, {
          headers,
          data: contribution,
        })
      ).status(),
    ).toBe(404);
    await guestPage
      .getByRole("button", { name: "Refresh collaboration", exact: true })
      .click();
    await expect(
      guestPage.getByRole("alert", { name: "Guest access unavailable" }),
    ).toBeVisible();
    await expect(
      guestPage.getByRole("region", { name: "Trip workspace", exact: true }),
    ).toHaveCount(0);
  } finally {
    await guest.close();
  }
});
test("confirmed saves clear only their form and fully saved work leaves without a discard prompt", async ({
  page,
}) => {
  const trip = await create(page.request);
  await save(page.request, trip.id);
  await page.goto("/discover");
  await page.goto(`/trips?tripId=${trip.id}`);
  await selectAndPlan(page);
  await page
    .getByLabel("Start area or hotel (optional)")
    .fill("Keep until confirmed");
  await page.getByLabel("Desired arrival (Shanghai)").fill("10:30");
  await view(page, "Group");
  await page
    .getByLabel("Your comment for Zhangyuan", { exact: true })
    .fill("Group draft");
  await view(page, "Manage");
  await page.getByLabel("Trip title", { exact: true }).fill("Saved title");
  await page.getByRole("button", { name: "Update title", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Saved title", exact: true }),
  ).toBeVisible();
  const update = page.locator(".workspace-update");
  await expect(update).toContainText("Unsaved fields in Day, Group");
  await view(page, "Group");
  await expect(
    page.getByLabel("Your comment for Zhangyuan", { exact: true }),
  ).toHaveValue("Group draft");
  await page
    .getByRole("button", { name: "Save comment for Zhangyuan", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Group decisions" }),
  ).toContainText("Collaboration change saved");
  await expect(update).toContainText("Unsaved fields in Day.");
  await view(page, "Day");
  await expect(page.getByLabel("Start area or hotel (optional)")).toHaveValue(
    "Keep until confirmed",
  );
  await expect(page.getByLabel("Desired arrival (Shanghai)")).toHaveValue(
    "10:30",
  );
  // Saving a day input does not discard the independently edited stop time.
  await page
    .getByRole("button", { name: "Save one-day draft", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Plan my day" })).toContainText(
    "One-day draft saved",
  );
  await expect(update).toContainText("Unsaved fields in Day.");
  // The changed request needs deliberate regeneration before saved plan editing.
  await page
    .getByRole("button", { name: "Generate day plan", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Plan my day" })).toContainText(
    "Day plan confirmed saved",
  );
  await expect(page.getByLabel("Desired arrival (Shanghai)")).toHaveValue("");
  const retained = page.getByRole("region", {
    name: "Retained unsaved arrivals",
  });
  await expect(retained).toContainText("Unsaved desired arrival 10:30");
  await expect(update).toContainText("Unsaved fields in Day.");
  await retained
    .getByRole("button", { name: "Discard earlier arrival draft" })
    .click();
  // Explicitly re-enter the arrangement for the current plan; regeneration did not apply it.
  await page.getByLabel("Desired arrival (Shanghai)").fill("10:30");
  await page
    .getByRole("button", { name: "Save desired time", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Plan my day" })).toContainText(
    "Day plan edits confirmed saved",
  );
  await expect(update).not.toContainText("Unsaved fields");
  await expect(update).not.toContainText("interrupted");
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await view(page, "Places");
  await page
    .getByRole("link", { name: "Add Places from Discover", exact: false })
    .click();
  await expect(page).toHaveURL(/\/discover$/);
  expect(dialogs).toBe(0);
});
test("Trip views reflow, keep long names legible and expose keyboard focus and touch targets", async ({
  page,
}) => {
  const title = "上海美食与咖啡之旅的很长中文名字 ".repeat(4).trim();
  const trip = await create(page.request, title);
  await save(page.request, trip.id);
  await page.goto(`/trips?tripId=${trip.id}`);
  for (const [width, height] of [
    [320, 812],
    [375, 812],
    [1280, 900],
    [640, 450],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of ["Places", "Group", "Day", "Manage"]) {
      await view(page, name);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const navigation = page.getByRole("navigation", { name: "Trip views" });
      const boxes = await navigation.getByRole("link").evaluateAll((links) =>
        links.map((link) => ({
          width: link.getBoundingClientRect().width,
          height: link.getBoundingClientRect().height,
        })),
      );
      expect(boxes.every((box) => box.width >= 44 && box.height >= 44)).toBe(
        true,
      );
      await shot(page, `workspace-${name.toLowerCase()}-${width}`);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  const places = page
    .getByRole("navigation", { name: "Trip views" })
    .getByRole("link", { name: "Places", exact: true });
  await places.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Places", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !document.activeElement?.closest("[hidden]")),
  ).toBe(true);
  await places.focus();
  expect(
    await places.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  for (let count = 0; count < 12; count++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !document.activeElement?.closest("[hidden]")),
    ).toBe(true);
  }
  await shot(page, "workspace-keyboard-focus-375");
});
