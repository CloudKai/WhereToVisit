import assert from "node:assert/strict";
import { test } from "node:test";
import { explore } from "../src/lib/explore.ts";
import { MemoryStore } from "../src/lib/store.ts";

// The shared cache is the "database" that lets every visitor reuse a search.
test("a finished search is served from the shared store without touching the network", async () => {
  const env = process.env;
  const globalStore = globalThis as { __wtvStore?: unknown };
  const store = new MemoryStore();
  const previous = globalStore.__wtvStore;
  globalStore.__wtvStore = store;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network must not be used");
  }) as typeof fetch;
  env.GEOAPIFY_API_KEY = "test-key";
  try {
    const destination = {
      name: "Cacheville",
      lat: 10.1,
      lon: 20.2,
      radiusM: 4000,
    };
    await store.set(
      "wtv:explore:v1:10.100,20.200,4000,",
      JSON.stringify({
        editorPicks: [
          {
            id: "e-a",
            name: "A",
            category: "park",
            cuisines: [],
            reason: { basis: "editor", text: "t", polished: false },
            sources: [],
            tier: "editor",
            score: 1,
          },
        ],
        nearby: [],
        notes: [],
        aiUsed: false,
      }),
      60,
    );
    const result = await explore(destination);
    assert.equal(result.editorPicks[0].name, "A");
    assert.deepEqual(
      result.destination,
      destination,
      "the caller's destination is used, not a stored copy",
    );
    assert.equal(calls, 0);

    // Damaged cache entries are ignored rather than breaking the search.
    const other = { name: "Elsewhere", lat: 11.1, lon: 21.2, radiusM: 4000 };
    await store.set("wtv:explore:v1:11.100,21.200,4000,", "{not json", 60);
    await assert.rejects(
      explore(other),
      /./,
      "falls through to the (blocked) network instead of crashing on bad cache",
    );
    assert.ok(calls > 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalStore.__wtvStore = previous;
    delete env.GEOAPIFY_API_KEY;
  }
});
