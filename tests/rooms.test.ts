import assert from "node:assert/strict";
import { test } from "node:test";
import { encodePlan, type Plan, type Stop } from "../src/lib/plan.ts";
import {
  cleanName,
  computeTallies,
  displayNames,
  isToken,
  rankStops,
} from "../src/lib/room-types.ts";
import {
  allow,
  castVote,
  createRoom,
  deleteRoom,
  getRoom,
  RoomError,
  setClosed,
  updateStops,
} from "../src/lib/rooms.ts";
import {
  getStore,
  MemoryStore,
  parseHashReply,
  storageMode,
  UpstashStore,
} from "../src/lib/store.ts";

function stop(n: number): Stop {
  const lat = 35 + n / 1000;
  const lon = 135 + n / 1000;
  return {
    id: `${lat.toFixed(5)},${lon.toFixed(5)}`,
    name: `Stop ${n}`,
    lat,
    lon,
    category: "cafe",
    dwell: 45,
  };
}

const PLAN: Plan = { destination: "Kyoto", stops: [stop(1), stop(2), stop(3)] };
const TOKEN = encodePlan(PLAN);
const ALICE = "alice-participant-id-0001";
const BOB = "bob-participant-id-000002";

async function expectError(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(
      error instanceof RoomError,
      `expected RoomError, got ${String(error)}`,
    );
    assert.equal(error.status, status);
    return true;
  });
}

// ---------- pure helpers ----------

test("cleanName trims, strips markup characters and enforces length", () => {
  assert.equal(cleanName("  Sam   Lee "), "Sam Lee");
  assert.equal(cleanName("<b>Sam</b>"), "bSam/b");
  assert.equal(cleanName(""), null);
  assert.equal(cleanName("x".repeat(41)), null);
  assert.equal(cleanName("あ".repeat(40)), "あ".repeat(40));
  assert.equal(cleanName(42), null);
});

test("isToken accepts url-safe ids only", () => {
  assert.ok(isToken("abcDEF123_-abcDEF123_-"));
  assert.ok(!isToken("short"));
  assert.ok(!isToken("has space in it 123456"));
  assert.ok(!isToken("../../etc/passwd/../x"));
  assert.ok(!isToken(undefined));
});

test("duplicate display names are numbered by join order", () => {
  const names = displayNames([
    { key: "b", name: "Sam", joined: 2 },
    { key: "a", name: "sam", joined: 1 },
    { key: "c", name: "Ana", joined: 3 },
    { key: "d", name: "SAM", joined: 4 },
  ]);
  assert.equal(names.get("a"), "sam");
  assert.equal(names.get("b"), "Sam (2)");
  assert.equal(names.get("d"), "SAM (3)");
  assert.equal(names.get("c"), "Ana");
});

test("tallies score 2/1/-1 and ignore votes for removed stops", () => {
  const stops = [stop(1), stop(2)];
  const people = [
    { key: "p1", name: "Ana", joined: 1 },
    { key: "p2", name: "Ben", joined: 2 },
  ];
  const { tallies, participants } = computeTallies(stops, people, {
    [`p1|${stops[0].id}`]: "must",
    [`p2|${stops[0].id}`]: "interested",
    [`p2|${stops[1].id}`]: "skip",
    [`p1|gone`]: "must",
  });
  assert.equal(tallies[stops[0].id].score, 3);
  assert.deepEqual(tallies[stops[0].id].must, ["Ana"]);
  assert.equal(tallies[stops[1].id].score, -1);
  assert.deepEqual(participants[1].votes, {
    [stops[0].id]: "interested",
    [stops[1].id]: "skip",
  });
  assert.deepEqual(
    rankStops([stops[1], stops[0]], tallies).map((s) => s.name),
    ["Stop 1", "Stop 2"],
  );
});

// ---------- rooms ----------

test("a room can be created, voted in and read back", async () => {
  const store = new MemoryStore();
  const { id, ownerKey } = await createRoom(store, TOKEN);
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  assert.ok(ownerKey.length >= 30);

  const [a, b, c] = PLAN.stops;
  await castVote(store, id, {
    participantId: ALICE,
    name: "Alice",
    stopId: a.id,
    vote: "must",
  });
  await castVote(store, id, {
    participantId: ALICE,
    name: "Alice",
    stopId: b.id,
    vote: "skip",
  });
  await castVote(store, id, {
    participantId: BOB,
    name: "Bob",
    stopId: a.id,
    vote: "interested",
  });
  await castVote(store, id, {
    participantId: BOB,
    name: "Bob",
    stopId: c.id,
    vote: "must",
  });

  const view = await getRoom(store, id, { participantId: ALICE });
  assert.equal(view.destination, "Kyoto");
  assert.equal(view.stops.length, 3);
  assert.equal(view.participants.length, 2);
  assert.equal(view.tallies[a.id].score, 3);
  assert.equal(view.tallies[b.id].score, -1);
  assert.deepEqual(view.tallies[c.id].must, ["Bob"]);
  assert.equal(view.you?.name, "Alice");
  assert.deepEqual(view.you?.votes, { [a.id]: "must", [b.id]: "skip" });
  assert.equal(view.isOwner, false);
  assert.equal((await getRoom(store, id, { ownerKey })).isOwner, true);
  assert.equal(
    (await getRoom(store, id, { ownerKey: "wrong".repeat(5) })).isOwner,
    false,
  );
});

test("a voter's own id is never exposed in the room view", async () => {
  const store = new MemoryStore();
  const { id } = await createRoom(store, TOKEN);
  await castVote(store, id, {
    participantId: ALICE,
    name: "Alice",
    stopId: PLAN.stops[0].id,
    vote: "must",
  });
  const json = JSON.stringify(await getRoom(store, id));
  assert.ok(!json.includes(ALICE));
});

test("changing or clearing a vote replaces it", async () => {
  const store = new MemoryStore();
  const { id } = await createRoom(store, TOKEN);
  const a = PLAN.stops[0];
  const vote = (v: "must" | "skip" | null) =>
    castVote(store, id, {
      participantId: ALICE,
      name: "Alice",
      stopId: a.id,
      vote: v,
    });
  await vote("must");
  await vote("skip");
  assert.equal((await getRoom(store, id)).tallies[a.id].score, -1);
  await vote(null);
  const view = await getRoom(store, id, { participantId: ALICE });
  assert.equal(view.tallies[a.id].score, 0);
  assert.deepEqual(view.you?.votes, {});
});

test("renaming keeps the same voter instead of adding another", async () => {
  const store = new MemoryStore();
  const { id } = await createRoom(store, TOKEN);
  const a = PLAN.stops[0];
  await castVote(store, id, {
    participantId: ALICE,
    name: "Al",
    stopId: a.id,
    vote: "must",
  });
  await castVote(store, id, {
    participantId: ALICE,
    name: "Alice",
    stopId: a.id,
    vote: "must",
  });
  const view = await getRoom(store, id);
  assert.equal(view.participants.length, 1);
  assert.equal(view.participants[0].name, "Alice");
});

test("votes are validated", async () => {
  const store = new MemoryStore();
  const { id } = await createRoom(store, TOKEN);
  const a = PLAN.stops[0];
  const base = {
    participantId: ALICE,
    name: "Alice",
    stopId: a.id,
    vote: "must",
  };
  await expectError(castVote(store, id, { ...base, vote: "love" }), 400);
  await expectError(castVote(store, id, { ...base, stopId: "0,0" }), 400);
  await expectError(castVote(store, id, { ...base, stopId: 5 }), 400);
  await expectError(castVote(store, id, { ...base, name: "  " }), 400);
  await expectError(castVote(store, id, { ...base, participantId: "x" }), 400);
  await expectError(castVote(store, "nonexistent-room-id-0000", base), 404);
  await expectError(castVote(store, "../etc", base), 404);
});

test("the number of voters is capped", async () => {
  const store = new MemoryStore();
  const { id } = await createRoom(store, TOKEN);
  const a = PLAN.stops[0];
  for (let i = 0; i < 30; i++) {
    await castVote(store, id, {
      participantId: `participant-number-${String(i).padStart(4, "0")}`,
      name: `P${i}`,
      stopId: a.id,
      vote: "must",
    });
  }
  await expectError(
    castVote(store, id, {
      participantId: "one-voter-too-many-0001",
      name: "Late",
      stopId: a.id,
      vote: "must",
    }),
    409,
  );
  // Existing voters can still change their vote.
  await castVote(store, id, {
    participantId: "participant-number-0000",
    name: "P0",
    stopId: a.id,
    vote: "skip",
  });
});

test("owner-only actions reject everyone else", async () => {
  const store = new MemoryStore();
  const { id, ownerKey } = await createRoom(store, TOKEN);
  await expectError(setClosed(store, id, undefined, true), 403);
  await expectError(setClosed(store, id, "guess".repeat(6), true), 403);
  await expectError(updateStops(store, id, undefined, TOKEN), 403);
  await expectError(deleteRoom(store, id, ALICE), 403);

  await setClosed(store, id, ownerKey, true);
  await expectError(
    castVote(store, id, {
      participantId: ALICE,
      name: "Alice",
      stopId: PLAN.stops[0].id,
      vote: "must",
    }),
    409,
  );
  await setClosed(store, id, ownerKey, false);
  await castVote(store, id, {
    participantId: ALICE,
    name: "Alice",
    stopId: PLAN.stops[0].id,
    vote: "must",
  });

  await deleteRoom(store, id, ownerKey);
  await expectError(getRoom(store, id), 404);
});

test("updating stops prunes votes for removed places", async () => {
  const store = new MemoryStore();
  const { id, ownerKey } = await createRoom(store, TOKEN);
  const [a, b] = PLAN.stops;
  await castVote(store, id, {
    participantId: ALICE,
    name: "Alice",
    stopId: a.id,
    vote: "must",
  });
  await castVote(store, id, {
    participantId: ALICE,
    name: "Alice",
    stopId: b.id,
    vote: "must",
  });

  await updateStops(
    store,
    id,
    ownerKey,
    encodePlan({ destination: "Kyoto", stops: [a, stop(9)] }),
  );
  const view = await getRoom(store, id, { participantId: ALICE });
  assert.deepEqual(
    view.stops.map((s) => s.name),
    ["Stop 1", "Stop 9"],
  );
  assert.deepEqual(view.you?.votes, { [a.id]: "must" });

  await updateStops(store, id, ownerKey, TOKEN);
  assert.deepEqual(
    (await getRoom(store, id, { participantId: ALICE })).you?.votes,
    { [a.id]: "must" },
  );
});

test("empty or invalid plans cannot become rooms", async () => {
  const store = new MemoryStore();
  await expectError(createRoom(store, encodePlan({ stops: [] })), 400);
  await expectError(createRoom(store, "garbage"), 400);
  await expectError(createRoom(store, undefined), 400);
});

test("rooms expire after their lifetime", async () => {
  let now = 0;
  const store = new MemoryStore(() => now);
  const { id } = await createRoom(store, TOKEN);
  now += 29 * 24 * 3600 * 1000;
  await getRoom(store, id);
  now += 2 * 24 * 3600 * 1000;
  await expectError(getRoom(store, id), 404);
});

test("rate limiting counts per client within the window", async () => {
  const store = new MemoryStore();
  assert.ok(await allow(store, "vote", "1.2.3.4", 2, 60));
  assert.ok(await allow(store, "vote", "1.2.3.4", 2, 60));
  assert.ok(!(await allow(store, "vote", "1.2.3.4", 2, 60)));
  assert.ok(await allow(store, "vote", "5.6.7.8", 2, 60));
});

// ---------- storage adapters ----------

test("storageMode refuses in-memory storage in production", () => {
  assert.equal(
    storageMode({ redisUrl: "https://x", redisToken: "t" }, "production"),
    "redis",
  );
  assert.equal(storageMode({}, "production"), "none");
  assert.equal(storageMode({}, "development"), "memory");
  assert.equal(getStore({}, "production"), null);
});

test("parseHashReply handles flat arrays and objects", () => {
  assert.deepEqual(parseHashReply(["a", "1", "b", "2"]), { a: "1", b: "2" });
  assert.deepEqual(parseHashReply({ a: 1 }), { a: "1" });
  assert.deepEqual(parseHashReply(null), {});
  assert.deepEqual(parseHashReply([]), {});
});

test("UpstashStore sends authenticated Redis commands over REST", async () => {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({
      url,
      auth: new Headers(init.headers).get("authorization"),
      body,
    });
    if (url.endsWith("/pipeline")) {
      return Response.json(body.map(() => ({ result: 1 })));
    }
    const name = body[0];
    if (name === "HGETALL") return Response.json({ result: ["f", "v"] });
    if (name === "SET" && body.includes("NX"))
      return Response.json({ result: null });
    return Response.json({ result: "OK" });
  }) as unknown as typeof fetch;

  const store = new UpstashStore("https://example.upstash.io/", "secret", fake);
  await store.set("k", "v", 60);
  assert.deepEqual(calls[0].body, ["SET", "k", "v", "EX", 60]);
  assert.equal(calls[0].url, "https://example.upstash.io");
  assert.equal(calls[0].auth, "Bearer secret");

  assert.equal(await store.setIfAbsent("k", "v", 60), false);
  assert.deepEqual(calls[1].body, ["SET", "k", "v", "EX", 60, "NX"]);

  await store.hset("h", "f", "v", 30);
  assert.equal(calls[2].url, "https://example.upstash.io/pipeline");
  assert.deepEqual(calls[2].body, [
    ["HSET", "h", "f", "v"],
    ["EXPIRE", "h", 30],
  ]);

  assert.deepEqual(await store.hgetall("h"), { f: "v" });
  assert.equal(await store.incr("c", 60), 1);
  assert.deepEqual(calls.at(-1)?.body, ["EXPIRE", "c", 60]);
});

test("UpstashStore turns failures into StorageError", async () => {
  const failing = (async () =>
    new Response("no", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(
    new UpstashStore("https://x", "t", failing).get("k"),
    /storage HTTP 500/,
  );
  const errorReply = (async () =>
    Response.json({ error: "ERR boom" })) as unknown as typeof fetch;
  await assert.rejects(
    new UpstashStore("https://x", "t", errorReply).get("k"),
    /ERR boom/,
  );
});
