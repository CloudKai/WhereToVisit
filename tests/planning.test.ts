import assert from "node:assert/strict";
import { test } from "node:test";
import { directionLinks } from "../src/lib/maplinks.ts";
import { parseDirections, parseMatrix } from "../src/lib/ors.ts";
import {
  addStop,
  clampDwell,
  decodePlan,
  encodePlan,
  MAX_STOPS,
  moveStop,
  type Plan,
  placeToStop,
  removeStop,
  reorder,
  setDwell,
  type Stop,
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

test("addStop ignores duplicates and respects the limit", () => {
  let plan: Plan = { stops: [] };
  plan = addStop(plan, stop(1), "Kyoto");
  plan = addStop(plan, stop(1));
  assert.equal(plan.stops.length, 1);
  assert.equal(plan.destination, "Kyoto");
  for (let i = 2; i <= MAX_STOPS + 3; i++) plan = addStop(plan, stop(i));
  assert.equal(plan.stops.length, MAX_STOPS);
});

test("move, remove, reorder and dwell edits", () => {
  let plan: Plan = { stops: [stop(1), stop(2), stop(3)] };
  plan = moveStop(plan, stop(3).id, -1);
  assert.deepEqual(
    plan.stops.map((s) => s.name),
    ["Stop 1", "Stop 3", "Stop 2"],
  );
  assert.equal(moveStop(plan, stop(1).id, -1), plan, "cannot move first up");
  plan = reorder(plan, [2, 1, 0]);
  assert.deepEqual(
    plan.stops.map((s) => s.name),
    ["Stop 2", "Stop 3", "Stop 1"],
  );
  assert.equal(reorder(plan, [0, 1]), plan, "partial order is rejected");
  plan = setDwell(plan, stop(2).id, 5000);
  assert.equal(plan.stops[0].dwell, 300);
  assert.equal(clampDwell(Number.NaN), 10);
  plan = removeStop(plan, stop(2).id);
  assert.equal(plan.stops.length, 2);
  assert.deepEqual(removeStop({ stops: [stop(1)] }, stop(1).id).stops, []);
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

test("plans round-trip through the URL token, including non-Latin text", () => {
  const plan: Plan = {
    destination: "京都",
    stops: [
      stop(1, {
        name: "喫茶 ローズ",
        address: "1 Teramachi",
        hours: "Mo-Su 09:00-18:00",
      }),
      stop(2, { category: "food", dwell: 90 }),
    ],
  };
  const token = encodePlan(plan);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePlan(token), plan);
});

test("decodePlan rejects hostile or malformed tokens", () => {
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  assert.equal(decodePlan(""), null);
  assert.equal(decodePlan("not base64 !!"), null);
  assert.equal(decodePlan(enc({ v: 2, s: [] })), null);
  assert.equal(decodePlan(enc({ v: 1, s: "x" })), null);
  assert.equal(
    decodePlan(enc({ v: 1, s: [["A", 99, 0, "c", 30]] })),
    null,
    "lat range",
  );
  assert.equal(
    decodePlan(enc({ v: 1, s: [["A", 1, 1, "z", 30]] })),
    null,
    "category",
  );
  assert.equal(
    decodePlan(enc({ v: 1, s: [["", 1, 1, "c", 30]] })),
    null,
    "name",
  );
  assert.equal(decodePlan("A".repeat(20000)), null, "too long");
  const many = Array.from({ length: 50 }, (_, i) => [
    `S${i}`,
    1 + i / 100,
    1,
    "c",
    30,
  ]);
  assert.equal(decodePlan(enc({ v: 1, s: many }))?.stops.length, MAX_STOPS);
  const dirty = decodePlan(
    enc({ v: 1, d: "<b>x</b>\u0000", s: [["A\u0007B", 1, 1, "c", 9999]] }),
  );
  assert.equal(dirty?.stops[0].name, "A B");
  assert.equal(dirty?.stops[0].dwell, 300);
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
