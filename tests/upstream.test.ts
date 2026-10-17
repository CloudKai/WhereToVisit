import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchOsmPlaces,
  fetchPlacesForCategory,
  placesRequestUrl,
} from "../src/lib/geoapify.ts";
import {
  getJson,
  isRetryable,
  readErrorDetail,
  redactSecrets,
  UpstreamError,
} from "../src/lib/http.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const SHANGHAI = {
  name: "Shanghai",
  lat: 31.2304,
  lon: 121.4737,
  radiusM: 5000,
};

type Reply = {
  status?: number;
  body?: unknown;
  delayMs?: number;
  throws?: string;
};

/** Replaces fetch with a scripted sequence of replies and records every call. */
function scripted(replies: (Reply | ((url: string) => Reply))[]) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  let inFlight = 0;
  let peak = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    const reply = typeof next === "function" ? next(url) : next;
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      if (reply.throws) throw new Error(reply.throws);
      const body =
        typeof reply.body === "string"
          ? reply.body
          : JSON.stringify(reply.body ?? {});
      return new Response(body, { status: reply.status ?? 200 });
    } finally {
      inFlight--;
    }
  }) as typeof fetch;
  return {
    calls,
    peak: () => peak,
    restore: () => (globalThis.fetch = original),
  };
}

// ---------- the explanation is kept, and never contains a key ----------

test("a failed request keeps the service's own explanation", async () => {
  const net = scripted([
    {
      status: 400,
      body: {
        statusCode: 400,
        error: "Bad Request",
        message: "Invalid filter: radius too large",
      },
    },
  ]);
  try {
    await assert.rejects(
      getJson("Geoapify", "https://x.example/p"),
      (e: unknown) => {
        assert.ok(e instanceof UpstreamError);
        assert.equal(e.status, 400);
        assert.equal(e.detail, "Invalid filter: radius too large");
        assert.match(e.message, /HTTP 400 — Invalid filter: radius too large/);
        return true;
      },
    );
  } finally {
    net.restore();
  }
});

test("keys and tokens are removed from anything logged or shown", async () => {
  assert.equal(
    redactSecrets("bad request at /v2/places?limit=5&apiKey=SECRET123&x=1"),
    "bad request at /v2/places?limit=5&apiKey=***&x=1",
  );
  assert.equal(
    redactSecrets("Authorization: Bearer abc.def-ghi_123"),
    "Authorization: Bearer ***",
  );
  assert.equal(redactSecrets(`key ${KEY} leaked`), "key *** leaked");
  assert.equal(redactSecrets("sk-proj-abcdefghijkl1234"), "***");
  assert.equal(redactSecrets("nothing secret here"), "nothing secret here");

  const detail = await readErrorDetail(
    new Response(JSON.stringify({ message: `bad apiKey=${KEY}&q=1` }), {
      status: 401,
    }),
  );
  assert.ok(detail && !detail.includes(KEY));
  assert.equal(
    await readErrorDetail(new Response("", { status: 500 })),
    undefined,
  );
  assert.equal(
    (await readErrorDetail(new Response("x".repeat(1000), { status: 500 })))
      ?.length,
    240,
  );
  assert.equal(
    await readErrorDetail(
      new Response("<html>Bad gateway</html>", { status: 502 }),
    ),
    "<html>Bad gateway</html>",
  );
});

test("a connection error message never carries the key either", async () => {
  const net = scripted([
    { throws: `connect failed for https://api.example/x?apiKey=${KEY}` },
  ]);
  try {
    await assert.rejects(
      getJson("Geoapify", "https://x.example/p"),
      (e: unknown) => {
        assert.ok(e instanceof UpstreamError);
        assert.ok(!e.message.includes(KEY));
        return true;
      },
    );
  } finally {
    net.restore();
  }
});

// ---------- retrying only when it can help ----------

test("rate limits, server errors and dropped connections are retried once", async () => {
  assert.ok(isRetryable(new UpstreamError("s", "x", 429)));
  assert.ok(isRetryable(new UpstreamError("s", "x", 503)));
  assert.ok(isRetryable(new UpstreamError("s", "timed out")));
  assert.ok(!isRetryable(new UpstreamError("s", "x", 400)));
  assert.ok(!isRetryable(new UpstreamError("s", "x", 401)));
  assert.ok(!isRetryable(new Error("other")));

  const net = scripted([
    { status: 429, body: { message: "slow down" } },
    { body: { ok: true } },
  ]);
  try {
    const data = await getJson<{ ok: boolean }>("S", "https://x.example/p", {
      retries: 1,
      retryDelayMs: 1,
    });
    assert.deepEqual(data, { ok: true });
    assert.equal(net.calls.length, 2);
  } finally {
    net.restore();
  }
});

test("a request that is simply wrong is not retried, and retries stop", async () => {
  const wrong = scripted([{ status: 400, body: { message: "no" } }]);
  try {
    await assert.rejects(
      getJson("S", "https://x.example/p", { retries: 3, retryDelayMs: 1 }),
    );
    assert.equal(wrong.calls.length, 1, "a 400 will not get better");
  } finally {
    wrong.restore();
  }
  const down = scripted([{ status: 503 }]);
  try {
    await assert.rejects(
      getJson("S", "https://x.example/p", { retries: 2, retryDelayMs: 1 }),
    );
    assert.equal(
      down.calls.length,
      3,
      "one try plus two retries, then it gives up",
    );
  } finally {
    down.restore();
  }
});

// ---------- exactly what a search asks Geoapify for ----------

test("the place request has the expected shape and no language setting", () => {
  const url = new URL(placesRequestUrl(SHANGHAI, KEY, "cafe"));
  assert.equal(url.origin + url.pathname, "https://api.geoapify.com/v2/places");
  assert.equal(url.searchParams.get("categories"), "catering.cafe");
  assert.equal(url.searchParams.get("filter"), "circle:121.4737,31.2304,5000");
  assert.equal(url.searchParams.get("bias"), "proximity:121.4737,31.2304");
  assert.equal(url.searchParams.get("limit"), "80");
  assert.equal(url.searchParams.get("apiKey"), KEY);
  assert.equal(
    url.searchParams.has("lang"),
    false,
    "an unconfirmed setting is not sent",
  );
  const shopping = new URL(placesRequestUrl(SHANGHAI, KEY, "shopping"));
  assert.equal(
    shopping.searchParams.get("categories"),
    "commercial.shopping_mall,commercial.department_store,commercial.marketplace",
  );
});

const FEATURE = (name: string) => ({
  properties: { name, lat: 31.2, lon: 121.4, categories: ["catering.cafe"] },
});

test("a place request that is rate limited once still succeeds", async () => {
  const net = scripted([
    { status: 429 },
    { body: { features: [FEATURE("Cafe A")] } },
  ]);
  try {
    const places = await fetchPlacesForCategory(SHANGHAI, KEY, "cafe");
    assert.deepEqual(
      places.map((p) => p.name),
      ["Cafe A"],
    );
    assert.equal(net.calls.length, 2);
  } finally {
    net.restore();
  }
});

test("a search never has more than three place requests in flight", async () => {
  const net = scripted([{ delayMs: 15, body: { features: [] } }]);
  try {
    await fetchOsmPlaces(SHANGHAI, KEY);
    assert.equal(net.calls.length, 6, "one request per type");
    assert.ok(net.peak() <= 3, `peak was ${net.peak()}`);
    assert.ok(net.peak() >= 2, "but they do run side by side");
  } finally {
    net.restore();
  }
});

test("when every type fails the error explains why; when some fail the rest are kept", async () => {
  const allFail = scripted([
    { status: 400, body: { message: "Invalid filter" } },
  ]);
  try {
    await assert.rejects(fetchOsmPlaces(SHANGHAI, KEY), (e: unknown) => {
      assert.ok(e instanceof UpstreamError);
      assert.equal(e.detail, "Invalid filter");
      return true;
    });
  } finally {
    allFail.restore();
  }

  const some = scripted([
    (url) =>
      url.includes("leisure.park")
        ? { status: 400, body: { message: "no" } }
        : { body: { features: [FEATURE("Cafe A")] } },
  ]);
  try {
    const places = await fetchOsmPlaces(SHANGHAI, KEY);
    assert.ok(places.length > 0, "the working types still return places");
  } finally {
    some.restore();
  }
});
