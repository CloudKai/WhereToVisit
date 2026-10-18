import assert from "node:assert/strict";
import { test } from "node:test";
import { directionLinks, googleDayLink } from "../src/lib/maplinks.ts";
import { parseDirections, parseMatrix, parseSteps } from "../src/lib/ors.ts";
import {
  addDay,
  addStop,
  allStops,
  clampDwell,
  decodePlan,
  EMPTY_PLAN,
  encodePlan,
  findStop,
  MAX_DAYS,
  MAX_STOPS_PER_DAY,
  MAX_TOTAL_STOPS,
  moveStop,
  moveStopToDay,
  type Plan,
  placeToStop,
  removeDay,
  removeStop,
  reorderDay,
  setDayMode,
  setDayStart,
  setDwell,
  type Stop,
  stopCount,
  tokenFromHash,
} from "../src/lib/plan.ts";
import {
  buildSchedule,
  estimateLeg,
  estimateRoute,
  estimateMatrix,
  formatClock,
  formatDistance,
  formatDuration,
  optimiseOrder,
  parseClock,
} from "../src/lib/routing.ts";
import type { Place } from "../src/lib/types.ts";

function stop(n: number, overrides: Partial<Stop> = {}): Stop {
  const lat = 35 + n / 1000;
  const lon = 135 + n / 1000;
  return {
    id: `${lat.toFixed(5)},${lon.toFixed(5)}`,
    name: `Stop ${n}`,
    lat,
    lon,
    category: "cafe",
    dwell: 45,
    ...overrides,
  };
}

function totalCost(matrix: number[][], order: number[]): number {
  let sum = 0;
  for (let i = 0; i < order.length - 1; i++)
    sum += matrix[order[i]][order[i + 1]];
  return sum;
}

// ---------- optimiseOrder ----------

test("optimiseOrder keeps stop 0 first and visits every stop once", () => {
  const points = [0, 5, 1, 4, 2, 3].map((x) => ({ lat: 0, lon: x * 0.01 }));
  const order = optimiseOrder(estimateMatrix(points, "walk"));
  assert.equal(order[0], 0);
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5],
  );
});

test("optimiseOrder finds the cheapest path on a line", () => {
  // Stops on a line at x = 0, 5, 1, 4, 2, 3 (start at x = 0): the best path is 0,1,2,3,4,5.
  const xs = [0, 5, 1, 4, 2, 3];
  const matrix = xs.map((a) => xs.map((b) => Math.abs(a - b)));
  const order = optimiseOrder(matrix);
  assert.equal(totalCost(matrix, order), 5);
  assert.deepEqual(
    order.map((i) => xs[i]),
    [0, 1, 2, 3, 4, 5],
  );
});

test("optimiseOrder matches brute force on a random asymmetric matrix", () => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const n = 7;
  const matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? 0 : 1 + Math.floor(rand() * 50),
    ),
  );
  const permute = (rest: number[], path: number[]): number => {
    if (rest.length === 0) return totalCost(matrix, path);
    return Math.min(
      ...rest.map((next) =>
        permute(
          rest.filter((r) => r !== next),
          [...path, next],
        ),
      ),
    );
  };
  const best = permute([1, 2, 3, 4, 5, 6], [0]);
  assert.equal(totalCost(matrix, optimiseOrder(matrix)), best);
});

test("optimiseOrder handles tiny and large inputs", () => {
  assert.deepEqual(optimiseOrder([[0]]), [0]);
  assert.deepEqual(
    optimiseOrder([
      [0, 1],
      [1, 0],
    ]),
    [0, 1],
  );
  const n = 14; // beyond the exact solver: nearest-neighbour fallback
  const matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => Math.abs(i - j)),
  );
  const order = optimiseOrder(matrix);
  assert.equal(order.length, n);
  assert.equal(new Set(order).size, n);
  assert.equal(order[0], 0);
});

test("unreachable legs are avoided when a route exists", () => {
  const matrix = [
    [0, 1e9, 10],
    [1e9, 0, 10],
    [10, 10, 0],
  ];
  assert.deepEqual(optimiseOrder(matrix), [0, 2, 1]);
});

// ---------- estimates, schedule, formatting ----------

test("estimateLeg is plausible for walking", () => {
  const leg = estimateLeg(
    { lat: 35, lon: 135 },
    { lat: 35, lon: 135.01 },
    "walk",
  );
  assert.ok(
    leg.distanceM > 900 && leg.distanceM < 1600,
    `distance ${leg.distanceM}`,
  );
  assert.ok(
    leg.durationS > 600 && leg.durationS < 1500,
    `duration ${leg.durationS}`,
  );
  const drive = estimateLeg(
    { lat: 35, lon: 135 },
    { lat: 35, lon: 135.01 },
    "drive",
  );
  assert.ok(drive.durationS < leg.durationS);
});

test("buildSchedule chains dwell time and travel time", () => {
  const items = buildSchedule(600, [45, 60, 30], [900, 1800]);
  assert.deepEqual(items, [
    { arriveMin: 600, departMin: 645 },
    { arriveMin: 660, departMin: 720 },
    { arriveMin: 750, departMin: 780 },
  ]);
});

test("clock helpers parse and format", () => {
  assert.equal(parseClock("09:30"), 570);
  assert.equal(parseClock("9:05"), 545);
  assert.equal(parseClock("24:00"), null);
  assert.equal(parseClock("abc"), null);
  assert.equal(formatClock(570), "09:30");
  assert.equal(formatClock(1500), "01:00 (+1d)");
});

test("duration and distance formatting", () => {
  assert.equal(formatDuration(30), "1 min");
  assert.equal(formatDuration(2700), "45 min");
  assert.equal(formatDuration(3600), "1 h");
  assert.equal(formatDuration(5400), "1 h 30 min");
  assert.equal(formatDistance(420), "420 m");
  assert.equal(formatDistance(2340), "2.3 km");
});

// ---------- plan state ----------

function planOf(...days: Stop[][]): Plan {
  return {
    days: days.map((stops) => ({ start: 600, mode: "walk" as const, stops })),
  };
}

test("addStop targets a day, ignores duplicates across days, respects limits", () => {
  let plan: Plan = planOf([], []);
  plan = addStop(plan, stop(1), "Kyoto", 1);
  assert.equal(plan.destination, "Kyoto");
  assert.deepEqual(
    plan.days.map((d) => d.stops.length),
    [0, 1],
  );
  assert.equal(addStop(plan, stop(1), undefined, 0), plan, "already in day 2");
  for (let i = 2; i <= MAX_STOPS_PER_DAY + 3; i++)
    plan = addStop(plan, stop(i), undefined, 1);
  assert.equal(plan.days[1].stops.length, MAX_STOPS_PER_DAY);
  assert.equal(
    addStop(plan, stop(99), undefined, 5).days[1].stops.length,
    MAX_STOPS_PER_DAY,
    "bad day index clamps to last (full) day",
  );
});

test("the whole trip is capped", () => {
  let plan: Plan = planOf(...Array.from({ length: 4 }, () => [] as Stop[]));
  for (let i = 1; i <= MAX_TOTAL_STOPS + 10; i++) {
    plan = addStop(plan, stop(i), undefined, Math.floor((i - 1) / 10) % 4);
  }
  assert.equal(stopCount(plan), MAX_TOTAL_STOPS);
});

test("move, remove, reorder and dwell edits work within a day", () => {
  let plan = planOf([stop(1), stop(2), stop(3)]);
  plan = moveStop(plan, stop(3).id, -1);
  assert.deepEqual(
    plan.days[0].stops.map((s) => s.name),
    ["Stop 1", "Stop 3", "Stop 2"],
  );
  assert.equal(moveStop(plan, stop(1).id, -1), plan, "cannot move first up");
  plan = reorderDay(plan, 0, [2, 1, 0]);
  assert.deepEqual(
    plan.days[0].stops.map((s) => s.name),
    ["Stop 2", "Stop 3", "Stop 1"],
  );
  assert.equal(reorderDay(plan, 0, [0, 1]), plan, "partial order is rejected");
  assert.equal(reorderDay(plan, 0, [0, 0, 1]), plan, "repeats are rejected");
  assert.equal(reorderDay(plan, 3, [0]), plan, "unknown day is rejected");
  plan = setDwell(plan, stop(2).id, 5000);
  assert.equal(plan.days[0].stops[0].dwell, 300);
  assert.equal(clampDwell(Number.NaN), 10);
  plan = removeStop(plan, stop(2).id);
  assert.equal(stopCount(plan), 2);
  const emptied = removeStop(planOf([stop(1)]), stop(1).id);
  assert.equal(stopCount(emptied), 0);
  assert.equal(emptied.days.length, 1, "the day itself remains");
});

test("stops can move between days", () => {
  let plan = planOf([stop(1), stop(2)], [stop(3)]);
  plan = moveStopToDay(plan, stop(1).id, 1);
  assert.deepEqual(
    plan.days.map((d) => d.stops.map((s) => s.name)),
    [["Stop 2"], ["Stop 3", "Stop 1"]],
  );
  assert.deepEqual(findStop(plan, stop(1).id), { day: 1, index: 1 });
  assert.equal(moveStopToDay(plan, stop(1).id, 1), plan, "same day");
  assert.equal(moveStopToDay(plan, stop(1).id, 7), plan, "unknown day");
  assert.equal(moveStopToDay(plan, "nope", 0), plan);
  const full = planOf(
    [stop(1)],
    Array.from({ length: MAX_STOPS_PER_DAY }, (_, i) => stop(i + 10)),
  );
  assert.equal(moveStopToDay(full, stop(1).id, 1), full, "target day full");
});

test("days can be added, configured and removed", () => {
  let plan: Plan = EMPTY_PLAN;
  plan = setDayStart(plan, 0, 9 * 60 + 30);
  plan = setDayMode(plan, 0, "bike");
  plan = addDay(plan);
  assert.equal(plan.days.length, 2);
  assert.deepEqual(
    [plan.days[1].start, plan.days[1].mode],
    [570, "bike"],
    "new day copies the last day's settings",
  );
  assert.equal(setDayStart(plan, 0, 99999).days[0].start, 1439);
  assert.equal(setDayStart(plan, 9, 60), plan);
  for (let i = 0; i < 20; i++) plan = addDay(plan);
  assert.equal(plan.days.length, MAX_DAYS);

  let trip = planOf([stop(1)], [stop(2)], [stop(3)]);
  trip = removeDay(trip, 1);
  assert.deepEqual(
    allStops(trip).map((s) => s.name),
    ["Stop 1", "Stop 3"],
  );
  const single = removeDay(planOf([stop(1)]), 0);
  assert.equal(single.days.length, 1);
  assert.equal(stopCount(single), 0);
  assert.equal(removeDay(trip, 9), trip);
});

test("placeToStop needs a valid map position", () => {
  const base: Place = {
    id: "p",
    name: "Café Rose",
    category: "cafe",
    cuisines: [],
    reason: { basis: "facts", text: "x", polished: false },
    sources: [],
    tier: "nearby",
    score: 0,
  };
  assert.equal(placeToStop(base), null);
  const s = placeToStop({
    ...base,
    lat: 35.01,
    lon: 135.76,
    hours: "Mo-Su 09:00-18:00",
  });
  assert.ok(s);
  assert.equal(s.dwell, 45);
  assert.equal(s.hours, "Mo-Su 09:00-18:00");
  assert.equal(placeToStop({ ...base, lat: 99, lon: 0 }), null);
});

// ---------- shareable link ----------

test("trips round-trip through the URL token, including non-Latin text", () => {
  const plan: Plan = {
    destination: "京都",
    days: [
      {
        start: 540,
        mode: "bike",
        stops: [
          stop(1, {
            name: "喫茶 ローズ",
            address: "1 Teramachi",
            hours: "Mo-Su 09:00-18:00",
          }),
          stop(2, { category: "food", dwell: 90 }),
        ],
      },
      { start: 660, mode: "drive", stops: [stop(3)] },
      { start: 600, mode: "walk", stops: [] },
    ],
  };
  const token = encodePlan(plan);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePlan(token), plan);
});

test("old single-day links still open as one day", () => {
  const legacy = Buffer.from(
    JSON.stringify({
      v: 1,
      d: "Kyoto",
      s: [
        ["A", 35.01, 135.76, "c", 40],
        ["B", 35.02, 135.77, "f", 70],
      ],
    }),
  ).toString("base64url");
  const plan = decodePlan(legacy);
  assert.ok(plan);
  assert.equal(plan.days.length, 1);
  assert.deepEqual(
    plan.days[0].stops.map((s) => s.name),
    ["A", "B"],
  );
  assert.equal(plan.days[0].mode, "walk");
  assert.equal(plan.destination, "Kyoto");
});

test("decodePlan rejects hostile or malformed tokens", () => {
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const day = (stops: unknown) => [600, "w", stops];
  assert.equal(decodePlan(""), null);
  assert.equal(decodePlan("not base64 !!"), null);
  assert.equal(decodePlan(enc({ v: 3, y: [] })), null);
  assert.equal(decodePlan(enc({ v: 2, y: "x" })), null);
  assert.equal(
    decodePlan(enc({ v: 2, y: [day("x")] })),
    null,
    "stops must be a list",
  );
  assert.equal(
    decodePlan(enc({ v: 2, y: [day([["A", 99, 0, "c", 30]])] })),
    null,
    "lat range",
  );
  assert.equal(
    decodePlan(enc({ v: 2, y: [day([["A", 1, 1, "z", 30]])] })),
    null,
    "category",
  );
  assert.equal(
    decodePlan(enc({ v: 2, y: [day([["", 1, 1, "c", 30]])] })),
    null,
    "name",
  );
  assert.equal(decodePlan("A".repeat(30000)), null, "too long");

  const many = Array.from({ length: 50 }, (_, i) => [
    `S${i}`,
    1 + i / 100,
    1,
    "c",
    30,
  ]);
  assert.equal(
    decodePlan(enc({ v: 2, y: [day(many)] }))?.days[0].stops.length,
    MAX_STOPS_PER_DAY,
  );
  const manyDays = Array.from({ length: 30 }, (_, i) =>
    day([[`S${i}`, 1 + i / 100, 1, "c", 30]]),
  );
  assert.equal(decodePlan(enc({ v: 2, y: manyDays }))?.days.length, MAX_DAYS);

  const dup = [["A", 1, 1, "c", 30]];
  const deduped = decodePlan(enc({ v: 2, y: [day(dup), day(dup)] }));
  assert.equal(
    stopCount(deduped as Plan),
    1,
    "same place cannot be on two days",
  );

  const dirty = decodePlan(
    enc({
      v: 2,
      d: "<b>x</b>\u0000",
      y: [[99999, "q", [["A\u0007B", 1, 1, "c", 9999]]]],
    }),
  );
  assert.equal(dirty?.days[0].stops[0].name, "A B");
  assert.equal(dirty?.days[0].stops[0].dwell, 300);
  assert.equal(dirty?.days[0].start, 1439, "start clamped");
  assert.equal(dirty?.days[0].mode, "walk", "unknown mode falls back");
  assert.equal(
    decodePlan(enc({ v: 2, y: [] }))?.days.length,
    1,
    "always at least one day",
  );
});

test("tokenFromHash only accepts the expected shape", () => {
  assert.equal(tokenFromHash("#p=abc_-123"), "abc_-123");
  assert.equal(tokenFromHash("#p=abc<script>"), null);
  assert.equal(tokenFromHash("#x=1"), null);
  assert.equal(tokenFromHash(""), null);
});

// ---------- ORS parsing & fallbacks ----------

test("parseDirections reads legs and geometry", () => {
  const result = parseDirections(
    {
      features: [
        {
          geometry: {
            coordinates: [
              [135, 35],
              [135.01, 35.01],
              [135.02, 35.02],
            ],
          },
          properties: {
            segments: [
              { duration: 600.4, distance: 800.2 },
              { duration: 300, distance: 400 },
            ],
          },
        },
      ],
    },
    3,
  );
  assert.deepEqual(result.legs, [
    { durationS: 600, distanceM: 800 },
    { durationS: 300, distanceM: 400 },
  ]);
  assert.equal(result.geometry.length, 3);
});

test("parseDirections rejects mismatched or incomplete responses", () => {
  assert.throws(() => parseDirections({}, 3));
  assert.throws(() =>
    parseDirections(
      {
        features: [
          {
            geometry: {
              coordinates: [
                [1, 1],
                [2, 2],
              ],
            },
            properties: { segments: [{ duration: 1, distance: 1 }] },
          },
        ],
      },
      3,
    ),
  );
  assert.throws(() =>
    parseDirections(
      {
        features: [
          {
            geometry: {
              coordinates: [
                [1, 1],
                [2, 2],
              ],
            },
            properties: { segments: [{ duration: 1 }] },
          },
        ],
      },
      2,
    ),
  );
});

test("parseMatrix validates shape and treats null as unreachable", () => {
  assert.deepEqual(
    parseMatrix(
      {
        durations: [
          [0, 5],
          [null, 0],
        ],
      },
      2,
    ),
    [
      [0, 5],
      [1e9, 0],
    ],
  );
  assert.throws(() => parseMatrix({}, 2));
  assert.throws(() => parseMatrix({ durations: [[0, 1]] }, 2));
  assert.throws(() => parseMatrix({ durations: [[0], [0, 1]] }, 2));
});

test("estimateRoute reorders when asked and always explains itself", () => {
  const points = [0, 5, 1].map((x) => ({ lat: 35, lon: 135 + x * 0.01 }));
  const kept = estimateRoute(points, "walk", false, "note");
  assert.deepEqual(kept.order, [0, 1, 2]);
  assert.equal(kept.source, "estimate");
  assert.equal(kept.legs.length, 2);
  assert.equal(kept.note, "note");
  const best = estimateRoute(points, "walk", true);
  assert.deepEqual(best.order, [0, 2, 1]);
  assert.equal(best.geometry.length, 3);
});

// ---------- directions links ----------

test("directionLinks encode coordinates and travel mode", () => {
  const links = Object.fromEntries(
    directionLinks(
      { name: "A", lat: 35.01, lon: 135.76 },
      { name: "Café B", lat: 35.02, lon: 135.77 },
      "walk",
    ).map((l) => [l.id, l.href]),
  );
  assert.ok(links.google.includes("origin=35.01,135.76"));
  assert.ok(links.google.includes("destination=35.02,135.77"));
  assert.ok(links.google.includes("travelmode=walking"));
  assert.ok(links["google-transit"].includes("travelmode=transit"));
  assert.ok(links.apple.includes("saddr=35.01,135.76"));
  assert.ok(links.amap.includes("from=135.76,35.01,A"));
  assert.ok(links.amap.includes("to=135.77,35.02,Caf%C3%A9%20B"));
  assert.ok(links.amap.includes("mode=walk"));
});

test("parseSteps keeps clean, bounded written directions", () => {
  const steps = parseSteps([
    { instruction: "Head  north on\nMain St", distance: 120.4 },
    { instruction: "   ", distance: 5 },
    { instruction: 42 as unknown as string, distance: 5 },
    { instruction: "Arrive", distance: "x" as unknown as number },
    { instruction: "x".repeat(500), distance: 1 },
  ]);
  assert.deepEqual(steps.slice(0, 2), [
    { text: "Head north on Main St", distanceM: 120 },
    { text: "Arrive", distanceM: 0 },
  ]);
  assert.equal(steps.length, 3);
  assert.equal(steps[2].text.length, 200);
  assert.deepEqual(parseSteps(undefined), []);
  assert.equal(
    parseSteps(
      Array.from({ length: 200 }, () => ({ instruction: "Go", distance: 1 })),
    ).length,
    60,
  );
});

test("parseDirections returns steps per leg and tolerates their absence", () => {
  const result = parseDirections(
    {
      features: [
        {
          geometry: {
            coordinates: [
              [135, 35],
              [135.01, 35.01],
            ],
          },
          properties: {
            segments: [
              {
                duration: 60,
                distance: 80,
                steps: [{ instruction: "Go", distance: 80 }],
              },
            ],
          },
        },
      ],
    },
    2,
  );
  assert.deepEqual(result.steps, [[{ text: "Go", distanceM: 80 }]]);
  const bare = parseDirections(
    {
      features: [
        {
          geometry: {
            coordinates: [
              [1, 1],
              [2, 2],
            ],
          },
          properties: { segments: [{ duration: 1, distance: 1 }] },
        },
      ],
    },
    2,
  );
  assert.deepEqual(bare.steps, [[]]);
});

test("googleDayLink builds one multi-stop link within Google's limits", () => {
  const stops = [1, 2, 3, 4].map((n) => ({
    lat: 35 + n / 100,
    lon: 135 + n / 100,
  }));
  const url = new URL(googleDayLink(stops, "bike") as string);
  assert.equal(url.searchParams.get("origin"), "35.01,135.01");
  assert.equal(url.searchParams.get("destination"), "35.04,135.04");
  assert.equal(url.searchParams.get("waypoints"), "35.02,135.02|35.03,135.03");
  assert.equal(url.searchParams.get("travelmode"), "bicycling");
  assert.equal(googleDayLink(stops.slice(0, 1), "walk"), null);
  assert.equal(
    googleDayLink(
      Array.from({ length: 12 }, () => stops[0]),
      "walk",
    ),
    null,
  );
  const two = new URL(googleDayLink(stops.slice(0, 2), "walk") as string);
  assert.equal(two.searchParams.get("waypoints"), null);
});

test("planRoute without a key still returns a complete, labelled estimate", async () => {
  const { planRoute } = await import("../src/lib/ors.ts");
  const points = [0, 5, 1, 4].map((x) => ({ lat: 35, lon: 135 + x * 0.01 }));
  const result = await planRoute(points, "walk", true, {
    orsKey: undefined,
    orsBaseUrl: "https://example.invalid",
    orsDailyCap: 10,
  });
  assert.equal(result.source, "estimate");
  assert.match(result.note ?? "", /no routing key/i);
  assert.equal(result.order[0], 0);
  assert.equal(new Set(result.order).size, 4);
  assert.equal(result.legs.length, 3);
});

// ---------- planRoute against a mocked OpenRouteService ----------

type Recorded = { url: string; auth: string | null; body: any };

function mockOrs(
  respond: (url: string, body: any) => { status?: number; json?: unknown },
): { calls: Recorded[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Recorded[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "null"));
    calls.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
      body,
    });
    const reply = respond(url, body);
    return new Response(JSON.stringify(reply.json ?? {}), {
      status: reply.status ?? 200,
    });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const ORS = {
  orsKey: "test-key",
  orsBaseUrl: "https://ors.example/openrouteservice",
  orsDailyCap: 100,
};

test("planRoute optimises with the matrix, then returns road legs, geometry and steps", async () => {
  const { planRoute } = await import("../src/lib/ors.ts");
  // Stops on a line at x = 0, 5, 1: best order is 0, 2, 1.
  const points = [0, 5, 1].map((x) => ({ lat: 10, lon: 20 + x * 0.001 }));
  const xs = [0, 5, 1];
  const { calls, restore } = mockOrs((url, body) => {
    if (url.includes("/v2/matrix/")) {
      return {
        json: { durations: xs.map((a) => xs.map((b) => Math.abs(a - b) * 60)) },
      };
    }
    const n = body.coordinates.length;
    return {
      json: {
        features: [
          {
            geometry: { coordinates: body.coordinates },
            properties: {
              segments: Array.from({ length: n - 1 }, () => ({
                duration: 300,
                distance: 400,
                steps: [{ instruction: "Head east", distance: 400 }],
              })),
            },
          },
        ],
      },
    };
  });
  try {
    const result = await planRoute(points, "bike", true, ORS);
    assert.equal(result.source, "openrouteservice");
    assert.deepEqual(result.order, [0, 2, 1]);
    assert.equal(result.legs.length, 2);
    assert.deepEqual(result.steps?.[0], [
      { text: "Head east", distanceM: 400 },
    ]);

    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].url,
      "https://ors.example/openrouteservice/v2/matrix/cycling-regular",
    );
    assert.equal(calls[0].auth, "test-key");
    assert.deepEqual(calls[0].body.locations[1], [20.005, 10]);
    assert.equal(
      calls[1].url,
      "https://ors.example/openrouteservice/v2/directions/cycling-regular/geojson",
    );
    assert.equal(calls[1].body.instructions, true);
    // Directions are requested in the optimised order, as [lon, lat].
    assert.deepEqual(
      calls[1].body.coordinates.map((c: number[]) => c[0]),
      [20, 20.001, 20.005],
    );
  } finally {
    restore();
  }
});

test("planRoute falls back to labelled estimates when the service fails", async () => {
  const { planRoute } = await import("../src/lib/ors.ts");
  const points = [0, 1, 2].map((x) => ({ lat: 11, lon: 21 + x * 0.001 }));
  const { restore } = mockOrs(() => ({ status: 500 }));
  try {
    const result = await planRoute(points, "drive", false, ORS);
    assert.equal(result.source, "estimate");
    assert.match(result.note ?? "", /could not find or return a route/i);
    assert.equal(result.legs.length, 2);
    assert.deepEqual(result.order, [0, 1, 2]);
  } finally {
    restore();
  }
});

test("planRoute rejects a malformed service reply instead of trusting it", async () => {
  const { planRoute } = await import("../src/lib/ors.ts");
  const points = [0, 1].map((x) => ({ lat: 12, lon: 22 + x * 0.001 }));
  const { restore } = mockOrs(() => ({
    json: { features: [{ properties: { segments: [] } }] },
  }));
  try {
    const result = await planRoute(points, "walk", false, ORS);
    assert.equal(result.source, "estimate");
  } finally {
    restore();
  }
});

test("planRoute stops calling the service once the daily allowance is used", async () => {
  const { planRoute } = await import("../src/lib/ors.ts");
  const { calls, restore } = mockOrs(() => ({ status: 500 }));
  try {
    const capped = { ...ORS, orsDailyCap: 0 };
    const points = [0, 1].map((x) => ({ lat: 13, lon: 23 + x * 0.001 }));
    const result = await planRoute(points, "walk", false, capped);
    assert.equal(calls.length, 0);
    assert.match(result.note ?? "", /allowance/i);
  } finally {
    restore();
  }
});
