import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exploreHref,
  parseBounds,
  parseDestination,
} from "../src/lib/destination.ts";
import { withinBounds } from "../src/lib/explore.ts";
import {
  areaProblem,
  boundsCenter,
  boundsSizeKm,
  circleCovering,
  inBounds,
  isValidBounds,
} from "../src/lib/geo.ts";
import type { Bounds } from "../src/lib/types.ts";
import { fetchWikivoyagePlaces } from "../src/lib/wikivoyage.ts";

// About 4.4 km tall and 4.7 km wide, in central Shanghai.
const JINGAN: Bounds = {
  south: 31.21,
  west: 121.43,
  north: 31.25,
  east: 121.48,
};

test("rectangle maths: centre, size, containment", () => {
  const c = boundsCenter(JINGAN);
  assert.ok(Math.abs(c.lat - 31.23) < 1e-9 && Math.abs(c.lon - 121.455) < 1e-9);
  const { widthKm, heightKm } = boundsSizeKm(JINGAN);
  assert.ok(widthKm > 4 && widthKm < 5.5, `width ${widthKm}`);
  assert.ok(heightKm > 4 && heightKm < 5, `height ${heightKm}`);
  assert.ok(inBounds({ lat: 31.23, lon: 121.45 }, JINGAN));
  assert.ok(!inBounds({ lat: 31.3, lon: 121.45 }, JINGAN));
  assert.ok(!inBounds({ lat: 31.23, lon: 121.6 }, JINGAN));
  const circle = circleCovering(JINGAN);
  assert.ok(
    circle.radiusM > 3000 && circle.radiusM < 4000,
    `radius ${circle.radiusM}`,
  );
});

test("only sensible rectangles can be searched", () => {
  assert.equal(areaProblem(JINGAN), null);
  assert.equal(
    areaProblem({ south: 30, west: 120, north: 32, east: 122 }),
    "too-large",
  );
  assert.equal(
    areaProblem({ south: 31.23, west: 121.45, north: 31.2301, east: 121.4501 }),
    "too-small",
  );
  assert.ok(isValidBounds(JINGAN));
  assert.ok(!isValidBounds({ ...JINGAN, south: 31.3 }), "south above north");
  assert.ok(!isValidBounds({ ...JINGAN, west: 122 }), "west east of east");
  assert.ok(!isValidBounds({ south: -91, west: 0, north: 0, east: 1 }));
  assert.ok(!isValidBounds({ south: Number.NaN, west: 0, north: 1, east: 1 }));
});

test("bbox URL parameters are validated", () => {
  assert.deepEqual(parseBounds("31.21,121.43,31.25,121.48"), JINGAN);
  assert.equal(parseBounds(undefined), null);
  assert.equal(parseBounds(""), null);
  assert.equal(parseBounds("1,2,3"), null);
  assert.equal(parseBounds("a,b,c,d"), null);
  assert.equal(parseBounds("31.25,121.43,31.21,121.48"), null, "reversed");
  assert.equal(parseBounds("30,120,32,122"), null, "too large");
  assert.equal(parseBounds("31.21,121.43,31.25,121.48,9"), null, "extra field");
  assert.equal(parseBounds("31.21,,31.25,121.48"), null, "blank field");
});

test("a searched map area becomes the destination and round-trips through the URL", () => {
  const d = parseDestination({
    name: "Shanghai",
    country: "China",
    bbox: "31.21,121.43,31.25,121.48",
    lat: "0",
    lon: "0",
  });
  assert.ok(d?.bounds);
  assert.deepEqual(d.bounds, JINGAN);
  assert.ok(
    Math.abs(d.lat - 31.23) < 1e-6,
    "centre comes from the rectangle, not lat/lon",
  );
  assert.ok(d.radiusM > 3000);

  const href = exploreHref(d, "park");
  const url = new URL(href, "http://x");
  assert.equal(
    url.searchParams.get("bbox"),
    "31.21000,121.43000,31.25000,121.48000",
  );
  assert.equal(url.searchParams.get("type"), "park");
  const again = parseDestination(Object.fromEntries(url.searchParams));
  assert.deepEqual(again?.bounds, JINGAN);
});

test("a bad bbox falls back to the ordinary city search", () => {
  const d = parseDestination({
    name: "Shanghai",
    lat: "31.23",
    lon: "121.47",
    bbox: "oops",
  });
  assert.ok(d);
  assert.equal(d.bounds, undefined);
  assert.equal(d.lat, 31.23);
  // And a bbox alone, without lat/lon, is enough when it is valid.
  assert.ok(
    parseDestination({ name: "X", bbox: "31.21,121.43,31.25,121.48" })?.bounds,
  );
  assert.equal(parseDestination({ name: "X", bbox: "nope" }), null);
});

test("withinBounds drops places outside, or without a position", () => {
  const places = [
    { id: "in", lat: 31.23, lon: 121.45 },
    { id: "out", lat: 31.4, lon: 121.45 },
    { id: "nowhere" },
  ];
  assert.deepEqual(
    withinBounds(places, JINGAN).map((p) => p.id),
    ["in"],
  );
  assert.equal(
    withinBounds(places, undefined).length,
    3,
    "no rectangle, no filtering",
  );
});

// ---------- Wikivoyage listings are limited to the rectangle ----------

test("Wikivoyage listings outside the searched area are dropped", async () => {
  const original = globalThis.fetch;
  const wikitext = `
{{eat | name=Inside Noodles | lat=31.23 | long=121.45 | content=Hand-pulled noodles.}}
{{eat | name=Far Dumplings | lat=31.40 | long=121.60 | content=Across the river.}}
{{eat | name=Unlocated Diner | content=No coordinates.}}
{{see | name=Inside Temple | lat=31.24 | long=121.46}}
`;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const body = url.includes("list=geosearch")
      ? {
          query: {
            geosearch: [{ title: "Shanghai/Jing'an", ns: 0, dist: 100 }],
          },
        }
      : {
          query: {
            pages: [
              {
                title: "Shanghai/Jing'an",
                revisions: [{ slots: { main: { content: wikitext } } }],
              },
            ],
          },
        };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const area = await fetchWikivoyagePlaces({
      name: "Shanghai",
      ...circleCovering(JINGAN),
      bounds: JINGAN,
    });
    assert.deepEqual(area.map((p) => p.name).sort(), [
      "Inside Noodles",
      "Inside Temple",
    ]);

    // Without a rectangle the unlocated place stays, and nearby ones are kept.
    const city = await fetchWikivoyagePlaces({
      name: "Shanghai",
      lat: 31.23,
      lon: 121.45,
      radiusM: 6000,
    });
    assert.ok(city.some((p) => p.name === "Unlocated Diner"));
    assert.ok(city.some((p) => p.name === "Inside Noodles"));
    assert.ok(
      !city.some((p) => p.name === "Far Dumplings"),
      "about 20 km away",
    );
  } finally {
    globalThis.fetch = original;
  }
});
