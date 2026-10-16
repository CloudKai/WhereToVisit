import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addPost,
  listPosts,
  MAX_FIELDS_PER_CELL,
  postId,
  REPORTS_TO_HIDE,
  reportPost,
  reporterKey,
} from "../src/lib/community.ts";
import { RoomError } from "../src/lib/rooms.ts";
import {
  cellOf,
  cellsFor,
  countByPlatform,
  hashtagFor,
  MAX_POSTS_PER_PLACE,
  parsePlaceKey,
  parseSocialUrl,
  placeKey,
  socialSearchLinks,
} from "../src/lib/social.ts";
import { MemoryStore } from "../src/lib/store.ts";

// ---------- link checking ----------

test("real post links on the three platforms are accepted and cleaned", () => {
  const ok = (input: string) => parseSocialUrl(input);
  assert.deepEqual(
    ok(
      "https://www.tiktok.com/@some.user_1/video/7234567890123456789?is_from_webapp=1&sender_device=pc#x",
    ),
    {
      platform: "tiktok",
      url: "https://www.tiktok.com/@some.user_1/video/7234567890123456789",
    },
  );
  assert.deepEqual(ok("tiktok.com/@a/video/12345678/"), {
    platform: "tiktok",
    url: "https://www.tiktok.com/@a/video/12345678",
  });
  assert.deepEqual(ok("https://vm.tiktok.com/ZMabc123x/"), {
    platform: "tiktok",
    url: "https://vm.tiktok.com/ZMabc123x/",
  });
  assert.deepEqual(ok("https://www.instagram.com/reel/C1a2B3c4D5e/?igsh=abc"), {
    platform: "instagram",
    url: "https://www.instagram.com/reel/C1a2B3c4D5e/",
  });
  assert.deepEqual(ok("https://instagram.com/p/Cabcde12345"), {
    platform: "instagram",
    url: "https://www.instagram.com/p/Cabcde12345/",
  });
  assert.deepEqual(ok("https://www.instagram.com/someone/reel/C1a2B3c4D5e/"), {
    platform: "instagram",
    url: "https://www.instagram.com/reel/C1a2B3c4D5e/",
  });
  assert.deepEqual(
    ok(
      "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f60718293a4b?xsec_token=zzz",
    ),
    {
      platform: "xiaohongshu",
      url: "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f60718293a4b",
    },
  );
  assert.deepEqual(
    ok("https://www.xiaohongshu.com/discovery/item/64a1b2c3d4e5f60718293a4b"),
    {
      platform: "xiaohongshu",
      url: "https://www.xiaohongshu.com/explore/64a1b2c3d4e5f60718293a4b",
    },
  );
  assert.deepEqual(ok("http://xhslink.com/a/AbCd1234"), {
    platform: "xiaohongshu",
    url: "https://xhslink.com/a/AbCd1234",
  });
});

test("anything that is not a single post on those sites is rejected", () => {
  const bad = [
    "",
    "   ",
    42,
    null,
    undefined,
    "https://evil.example/@a/video/123456",
    "https://www.tiktok.com.evil.example/@a/video/123456",
    "https://evil.example/www.tiktok.com/@a/video/123456",
    "https://www.tiktok.com@evil.example/@a/video/123456",
    "https://user:pass@www.tiktok.com/@a/video/123456",
    "https://www.tiktok.com:8443/@a/video/123456",
    "https://www.tiktok.com/@a", // profile
    "https://www.tiktok.com/search?q=cafe", // search page
    "https://www.tiktok.com/@a/video/12", // id too short
    "https://www.tiktok.com/@a/video/12345%2F..", // encoded
    "https://www.instagram.com/explore/tags/cafe/", // hashtag page
    "https://www.instagram.com/someone/", // profile
    "https://www.instagram.com/stories/x/123456/", // story
    "https://www.xiaohongshu.com/explore/short",
    "https://www.xiaohongshu.com/user/profile/64a1b2c3d4e5f60718293a4b",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "ftp://www.tiktok.com/@a/video/123456",
    `https://www.tiktok.com/@a/video/${"1".repeat(400)}`,
  ];
  for (const input of bad) {
    assert.equal(
      parseSocialUrl(input),
      null,
      `should reject: ${String(input).slice(0, 60)}`,
    );
  }
});

// ---------- place identity ----------

test("place keys round-trip and are validated", () => {
  const key = placeKey({ name: "Café Rose", lat: 35.01234, lon: 135.76543 });
  assert.equal(key, "cafe-rose@35.0123,135.7654");
  assert.deepEqual(parsePlaceKey(key), { lat: 35.0123, lon: 135.7654 });
  assert.deepEqual(
    parsePlaceKey(placeKey({ name: "星巴克", lat: -33.8, lon: 151.2 })),
    { lat: -33.8, lon: 151.2 },
  );
  for (const bad of [
    "",
    "nope",
    "a@1,2",
    "a@99.0000,10.0000",
    "a@10.0000,190.0000",
    "x".repeat(200),
    5,
    null,
    "a b@1.0000,2.0000",
    "a|b@1.0000,2.0000",
  ]) {
    assert.equal(parsePlaceKey(bad), null, String(bad));
  }
});

test("cells group nearby places, including negative coordinates", () => {
  assert.equal(cellOf(35.01, 135.76), "350_1357");
  assert.equal(cellOf(35.09, 135.79), "350_1357", "same ~11 km square");
  assert.equal(cellOf(-33.86, -70.65), "-339_-707");
  assert.deepEqual(
    cellsFor([
      { lat: 35.01, lon: 135.76 },
      { lat: 35.02, lon: 135.77 },
      { lat: 36.5, lon: 135.7 },
      {},
    ]),
    ["350_1357", "365_1357"],
  );
});

// ---------- looking a place up (plain links) ----------

test("search links open each app's own search and make no claims", () => {
  const links = Object.fromEntries(
    socialSearchLinks({ name: "Café Rose" }, "Kyoto").map((l) => [
      l.platform,
      l.href,
    ]),
  );
  assert.equal(
    links.tiktok,
    "https://www.tiktok.com/search?q=Caf%C3%A9%20Rose%20Kyoto",
  );
  assert.equal(
    links.instagram,
    "https://www.instagram.com/explore/tags/caf%C3%A9rose/",
  );
  assert.equal(
    links.xiaohongshu,
    "https://www.xiaohongshu.com/search_result?keyword=Caf%C3%A9%20Rose%20Kyoto",
  );

  const chinese = socialSearchLinks(
    { name: "Roastery", localName: "烘焙工坊" },
    "Shanghai",
  );
  assert.ok(
    chinese
      .find((l) => l.platform === "xiaohongshu")
      ?.href.endsWith(encodeURIComponent("烘焙工坊")),
  );
  // A name too short to make a hashtag leaves Instagram out rather than guessing.
  assert.ok(
    !socialSearchLinks({ name: "Ox" }, "Kyoto").some(
      (l) => l.platform === "instagram",
    ),
  );
  assert.equal(hashtagFor("Ueno Park!"), "uenopark");
});

test("post counts per platform come out most-first", () => {
  assert.deepEqual(
    countByPlatform([
      { platform: "instagram" },
      { platform: "tiktok" },
      { platform: "tiktok" },
    ]),
    [
      { platform: "tiktok", count: 2 },
      { platform: "instagram", count: 1 },
    ],
  );
  assert.deepEqual(countByPlatform([]), []);
});

// ---------- storing, limiting and reporting ----------

const PLACE = placeKey({ name: "Cafe Rose", lat: 35.0123, lon: 135.7654 });
const tiktok = (n: number) => `https://www.tiktok.com/@u/video/${1000000 + n}`;

async function expectError(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof RoomError, String(e));
    assert.equal(e.status, status);
    return true;
  });
}

test("a shared link shows up for its place, once, with the right platform", async () => {
  const store = new MemoryStore();
  let posts = await addPost(store, { placeKey: PLACE, url: tiktok(1) }, 100);
  assert.deepEqual(
    posts.map((p) => [p.platform, p.url]),
    [["tiktok", tiktok(1)]],
  );
  posts = await addPost(
    store,
    { placeKey: PLACE, url: `${tiktok(1)}?utm=x` },
    200,
  );
  assert.equal(posts.length, 1, "the same link twice counts once");
  posts = await addPost(
    store,
    { placeKey: PLACE, url: "https://www.instagram.com/reel/Cabcde12345/" },
    300,
  );
  assert.deepEqual(
    posts.map((p) => p.platform),
    ["instagram", "tiktok"],
    "newest first",
  );

  const other = placeKey({ name: "Other", lat: 35.0999, lon: 135.7999 });
  await addPost(store, { placeKey: other, url: tiktok(2) });
  const listed = await listPosts(store, [cellOf(35.0123, 135.7654)]);
  assert.equal(listed[PLACE].length, 2);
  assert.equal(listed[other].length, 1, "places in one cell are kept apart");
});

test("bad input is refused with a clear status", async () => {
  const store = new MemoryStore();
  await expectError(
    addPost(store, { placeKey: PLACE, url: "https://evil.example/x" }),
    400,
  );
  await expectError(
    addPost(store, { placeKey: "nonsense", url: tiktok(1) }),
    400,
  );
  await expectError(addPost(store, { placeKey: PLACE, url: undefined }), 400);
});

test("a place cannot be flooded with links", async () => {
  const store = new MemoryStore();
  for (let i = 0; i < MAX_POSTS_PER_PLACE; i++) {
    await addPost(store, { placeKey: PLACE, url: tiktok(i) });
  }
  await expectError(addPost(store, { placeKey: PLACE, url: tiktok(999) }), 409);
  assert.equal(
    (await listPosts(store, [cellOf(35.0123, 135.7654)]))[PLACE].length,
    MAX_POSTS_PER_PLACE,
  );
});

test("an area cannot be flooded with links either", async () => {
  const store = new MemoryStore();
  const cell = "wtv:social:cell:350_1357";
  for (let i = 0; i < MAX_FIELDS_PER_CELL; i++) {
    await store.hset(
      cell,
      `filler${i}@1.0000,1.0000|${String(i).padStart(16, "0")}`,
      JSON.stringify({ p: "tiktok", u: tiktok(i), t: 1 }),
      3600,
    );
  }
  await expectError(addPost(store, { placeKey: PLACE, url: tiktok(1) }), 409);
});

test("enough different reporters hide a post for good", async () => {
  const store = new MemoryStore();
  const [post] = await addPost(store, { placeKey: PLACE, url: tiktok(1) });
  const report = (client: string) =>
    reportPost(store, {
      placeKey: PLACE,
      postId: post.id,
      reporter: reporterKey(client),
    });

  assert.deepEqual(await report("a"), { hidden: false });
  assert.deepEqual(
    await report("a"),
    { hidden: false },
    "the same person reporting twice counts once",
  );
  assert.deepEqual(await report("b"), { hidden: false });
  assert.equal(
    (await listPosts(store, [cellOf(35.0123, 135.7654)]))[PLACE]?.length,
    1,
  );
  assert.equal(REPORTS_TO_HIDE, 3);
  assert.deepEqual(await report("c"), { hidden: true });
  assert.equal(
    (await listPosts(store, [cellOf(35.0123, 135.7654)]))[PLACE]?.length ?? 0,
    0,
  );

  await expectError(addPost(store, { placeKey: PLACE, url: tiktok(1) }), 409);
  await addPost(store, { placeKey: PLACE, url: tiktok(2) }); // other links still fine
});

test("reports about things that do not exist are refused", async () => {
  const store = new MemoryStore();
  await expectError(
    reportPost(store, {
      placeKey: PLACE,
      postId: postId("https://x"),
      reporter: "r",
    }),
    404,
  );
  await expectError(
    reportPost(store, { placeKey: PLACE, postId: "../etc", reporter: "r" }),
    400,
  );
  await expectError(
    reportPost(store, { placeKey: "bad", postId: postId("x"), reporter: "r" }),
    400,
  );
});

test("posts expire with the rest of the area", async () => {
  let now = 0;
  const store = new MemoryStore(() => now);
  await addPost(store, { placeKey: PLACE, url: tiktok(1) });
  now += 89 * 24 * 3600 * 1000;
  assert.equal(
    (await listPosts(store, [cellOf(35.0123, 135.7654)]))[PLACE]?.length,
    1,
  );
  now += 2 * 24 * 3600 * 1000;
  assert.equal(
    Object.keys(await listPosts(store, [cellOf(35.0123, 135.7654)])).length,
    0,
  );
});

test("listing ignores malformed cells and damaged entries", async () => {
  const store = new MemoryStore();
  await store.hset("wtv:social:cell:350_1357", "garbage", "{oops", 60);
  await store.hset(
    "wtv:social:cell:350_1357",
    `${PLACE}|0123456789abcdef`,
    JSON.stringify({ p: "myspace", u: "x", t: 1 }),
    60,
  );
  assert.deepEqual(
    await listPosts(store, ["../../etc", "350_1357", 5, null]),
    {},
  );
});
