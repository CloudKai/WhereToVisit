import assert from "node:assert/strict";
import { test } from "node:test";
import { explore } from "../src/lib/explore.ts";
import { foodCount, MIN_FOOD_PLACES } from "../src/lib/listing.ts";
import { MemoryStore } from "../src/lib/store.ts";

type Hit = { url: string; radius?: number };

/** Geoapify returns `perRadius` cafés per request; everything else is empty. */
function mockWorld(perRadius: (radiusM: number) => number) {
  const original = globalThis.fetch;
  const hits: Hit[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("api.geoapify.com/v2/places")) {
      const radius = Number(
        /circle:[-\d.]+,[-\d.]+,(\d+)/.exec(decodeURIComponent(url))?.[1],
      );
      hits.push({ url, radius });
      const wantsCafes = decodeURIComponent(url).includes("catering.cafe");
      const n = wantsCafes ? perRadius(radius) : 0;
      return Response.json({
        features: Array.from({ length: n }, (_, i) => ({
          properties: {
            name: `Cafe ${radius}-${i}`,
            lat: 10 + i / 10000,
            lon: 20 + i / 10000,
            categories: ["catering.cafe"],
          },
        })),
      });
    }
    if (url.includes("wikivoyage"))
      return Response.json({ query: { geosearch: [] } });
    return Response.json({}); // photos etc.
  }) as typeof fetch;
  return { hits, restore: () => (globalThis.fetch = original) };
}

function isolate() {
  const g = globalThis as { __wtvStore?: unknown };
  const previous = g.__wtvStore;
  g.__wtvStore = new MemoryStore();
  process.env.GEOAPIFY_API_KEY = "test-key";
  return () => {
    g.__wtvStore = previous;
    delete process.env.GEOAPIFY_API_KEY;
  };
}

test("a city with few places to eat is searched again, wider, and says so", async () => {
  const cleanup = isolate();
  const { hits, restore } = mockWorld((radius) => (radius >= 10000 ? 14 : 3));
  try {
    const result = await explore({
      name: "Sparseville",
      lat: 10,
      lon: 20,
      radiusM: 4000,
    });
    const radii = [...new Set(hits.map((h) => h.radius))];
    assert.deepEqual(
      radii.sort((a, b) => (a ?? 0) - (b ?? 0)),
      [4000, 10000],
    );
    assert.ok(
      foodCount([...result.editorPicks, ...result.nearby]) >= MIN_FOOD_PLACES,
    );
    assert.ok(
      result.notes.some((n) => /widened to 10 km/.test(n)),
      result.notes.join(" | "),
    );
    assert.ok(result.notes.some((n) => /4 km/.test(n)));
  } finally {
    restore();
    cleanup();
  }
});

test("a city with enough places is not searched twice", async () => {
  const cleanup = isolate();
  const { hits, restore } = mockWorld(() => 25);
  try {
    const result = await explore({
      name: "Richtown",
      lat: 11,
      lon: 21,
      radiusM: 4000,
    });
    assert.deepEqual([...new Set(hits.map((h) => h.radius))], [4000]);
    assert.ok(!result.notes.some((n) => /widened/.test(n)));
  } finally {
    restore();
    cleanup();
  }
});

test("widening that finds nothing more keeps the original results", async () => {
  const cleanup = isolate();
  const { restore } = mockWorld(() => 3);
  try {
    const result = await explore({
      name: "Emptyville",
      lat: 12,
      lon: 22,
      radiusM: 4000,
    });
    assert.ok(!result.notes.some((n) => /widened/.test(n)));
    assert.ok(
      result.nearby.length > 0 && result.nearby[0].name.startsWith("Cafe 4000"),
    );
  } finally {
    restore();
    cleanup();
  }
});

test("a searched map area is never widened beyond what the person chose", async () => {
  const cleanup = isolate();
  const { hits, restore } = mockWorld(() => 2);
  try {
    const bounds = { south: 10, west: 20, north: 10.03, east: 20.03 };
    await explore({
      name: "Box",
      lat: 10.015,
      lon: 20.015,
      radiusM: 2500,
      bounds,
    });
    assert.equal(new Set(hits.map((h) => h.radius)).size, 1);
  } finally {
    restore();
    cleanup();
  }
});
