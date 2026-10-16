import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDestination } from "../src/lib/destination.ts";
import { haversineKm } from "../src/lib/geo.ts";
import { WindowCounter } from "../src/lib/http.ts";
import { applyTaglines, isGrounded, selectForPolish } from "../src/lib/llm.ts";
import { mapLinks } from "../src/lib/maplinks.ts";
import {
  cleanWikitext,
  namesMatch,
  safeHttpUrl,
  truncateText,
} from "../src/lib/text.ts";
import type { Place } from "../src/lib/types.ts";

test("cleanWikitext strips markup, refs, templates and entities", () => {
  assert.equal(
    cleanWikitext(
      "''Great'' [[a|food]] &amp; [https://x.example tea]{{t|1}}<ref>n</ref>",
    ),
    "Great food & tea",
  );
  assert.equal(cleanWikitext(undefined), "");
});

test("truncateText prefers sentence boundaries", () => {
  const text =
    "First sentence is here. Second sentence goes on and on without stopping for ages";
  assert.equal(truncateText(text, 40), "First sentence is here.");
  assert.ok(truncateText("word ".repeat(50), 30).endsWith("…"));
});

test("namesMatch handles accents, case and contained names", () => {
  assert.ok(namesMatch("Café Rose", "cafe rose"));
  assert.ok(namesMatch("Rose Kissaten Kyoto", "Rose Kissaten"));
  assert.ok(!namesMatch("Rose", "Rosemary Cafe"));
  assert.ok(!namesMatch("", "x"));
});

test("safeHttpUrl accepts only http(s)", () => {
  assert.equal(safeHttpUrl("example.com/a"), "https://example.com/a");
  assert.equal(safeHttpUrl("javascript:alert(1)"), undefined);
  assert.equal(safeHttpUrl("data:text/html,x"), undefined);
  assert.equal(safeHttpUrl(undefined), undefined);
});

test("haversineKm is accurate for a known distance", () => {
  const km = haversineKm(
    { lat: 48.8566, lon: 2.3522 },
    { lat: 51.5074, lon: -0.1278 },
  );
  assert.ok(Math.abs(km - 343.5) < 3, `got ${km}`);
});

test("parseDestination validates untrusted parameters", () => {
  assert.deepEqual(
    parseDestination({
      name: "Kyoto",
      lat: "35.01",
      lon: "135.76",
      r: "99999",
    }),
    {
      name: "Kyoto",
      country: undefined,
      lat: 35.01,
      lon: 135.76,
      radiusM: 10000,
    },
  );
  assert.equal(parseDestination({ name: "X", lat: "", lon: "1" }), null);
  assert.equal(parseDestination({ name: "X", lat: "91", lon: "1" }), null);
  assert.equal(parseDestination({ name: "X", lat: "abc", lon: "1" }), null);
  assert.equal(parseDestination({ lat: "1", lon: "1" }), null);
  assert.equal(
    parseDestination({ name: "<b>Hi</b>\u0000", lat: "1", lon: "1" })?.name,
    "bHi/b",
  );
  assert.equal(
    parseDestination({ name: "X", lat: "1", lon: "1" })?.radiusM,
    4000,
  );
});

test("map links use the right coordinate order", () => {
  const links = Object.fromEntries(
    mapLinks({ name: "Café Rose", lat: 35.01, lon: 135.76 }).map((l) => [
      l.id,
      l.href,
    ]),
  );
  assert.ok(links.google.includes("query=35.01,135.76"));
  assert.ok(links.apple.includes("ll=35.01,135.76"));
  assert.ok(links.amap.includes("position=135.76,35.01"));
  assert.ok(links.amap.includes("coordinate=wgs84"));
  assert.ok(links.apple.includes("q=Caf%C3%A9%20Rose"));
});

test("WindowCounter enforces a limit per window", () => {
  const counter = new WindowCounter(1000);
  assert.ok(counter.take("a", 2, 0));
  assert.ok(counter.take("a", 2, 10));
  assert.ok(!counter.take("a", 2, 20));
  assert.ok(counter.take("b", 2, 20));
  assert.ok(counter.take("a", 2, 1500), "window reset");
  assert.ok(
    !new WindowCounter(1000).take("fresh", 0, 0),
    "a limit of 0 blocks even the first call",
  );
});

const SOURCE =
  "Known for siphon coffee and thick toast since 1975. Cash only; expect a queue at weekends.";

test("isGrounded accepts faithful lines and rejects invented facts", () => {
  assert.ok(
    isGrounded(
      "Siphon coffee and thick toast since 1975.",
      SOURCE,
      "Café Rose",
    ),
  );
  assert.ok(
    !isGrounded("Siphon coffee, open since 1985.", SOURCE, "Café Rose"),
    "wrong number",
  );
  assert.ok(
    !isGrounded("Siphon coffee near Gion Shrine.", SOURCE, "Café Rose"),
    "invented name",
  );
  assert.ok(
    !isGrounded("See https://x.example for toast.", SOURCE, "Café Rose"),
    "url",
  );
  assert.ok(!isGrounded("", SOURCE, "Café Rose"), "empty");
  assert.ok(!isGrounded("x".repeat(200), SOURCE, "Café Rose"), "too long");
});

function place(id: string, fullText?: string): Place {
  return {
    id,
    name: "Café Rose",
    category: "cafe",
    cuisines: [],
    reason: { basis: "editor", text: "short", fullText, polished: false },
    sources: [],
    tier: "editor",
    score: 1,
  };
}

test("only shortened editor texts go to the model; invalid output is ignored", () => {
  const places = [place("a", SOURCE), place("b"), place("c", SOURCE)];
  const inputs = selectForPolish(places);
  assert.deepEqual(
    inputs.map((i) => i.id),
    ["a", "c"],
  );
  const out = applyTaglines(
    places,
    new Map([
      ["a", "Siphon coffee and thick toast since 1975."],
      ["c", "Famous for matcha lattes since 1999."],
    ]),
    new Map(inputs.map((i) => [i.id, i])),
  );
  assert.equal(out[0].reason.polished, true);
  assert.equal(out[0].reason.text, "Siphon coffee and thick toast since 1975.");
  assert.equal(out[2].reason.polished, false, "ungrounded line rejected");
  assert.equal(out[2].reason.text, "short");
});

test("nearestArea highlights the closest search-area option", async () => {
  const { AREA_OPTIONS, nearestArea } =
    await import("../src/lib/destination.ts");
  assert.equal(AREA_OPTIONS.length, 3);
  assert.equal(nearestArea(2000).radiusM, 2500);
  assert.equal(nearestArea(6000).radiusM, 6000);
  assert.equal(
    nearestArea(8000).radiusM,
    6000,
    "8 km is nearer to 6 km than 10 km",
  );
  assert.equal(nearestArea(9500).radiusM, 10000);
});

test("the header tab only trusts same-site results links", async () => {
  const { isResultsHref, parseLastSearch } =
    await import("../src/lib/last-search.ts");
  const { exploreHref } = await import("../src/lib/destination.ts");

  // Links the app itself builds always pass, including unicode names and map areas.
  for (const href of [
    exploreHref({
      name: "Shanghai",
      country: "China",
      lat: 31.23,
      lon: 121.47,
      radiusM: 6000,
    }),
    exploreHref(
      { name: "上海", lat: 31.23, lon: 121.47, radiusM: 6000 },
      "park",
    ),
    exploreHref(
      {
        name: "São Paulo",
        lat: -23.5,
        lon: -46.6,
        radiusM: 6000,
        bounds: { south: -23.6, west: -46.7, north: -23.5, east: -46.6 },
      },
      "eat",
    ),
  ]) {
    assert.ok(isResultsHref(href), href);
  }
  for (const bad of [
    "https://evil.example/explore?x=1",
    "//evil.example/explore?x=1",
    "/explore?x=<script>",
    "/plan?x=1",
    "javascript:alert(1)",
    "/explore?" + "a".repeat(700),
    "/explore?x=1\n",
    42,
    null,
  ]) {
    assert.equal(isResultsHref(bad), false, String(bad).slice(0, 40));
  }

  const ok = JSON.stringify({
    name: "Shanghai",
    href: "/explore?name=Shanghai&lat=31.23&lon=121.47&r=6000",
  });
  assert.deepEqual(parseLastSearch(ok), {
    name: "Shanghai",
    href: "/explore?name=Shanghai&lat=31.23&lon=121.47&r=6000",
  });
  assert.equal(parseLastSearch(null), null);
  assert.equal(parseLastSearch("{oops"), null);
  assert.equal(
    parseLastSearch(JSON.stringify({ name: "", href: "/explore?x=1" })),
    null,
  );
  assert.equal(
    parseLastSearch(
      JSON.stringify({ name: "x".repeat(81), href: "/explore?x=1" }),
    ),
    null,
  );
  assert.equal(
    parseLastSearch(
      JSON.stringify({ name: "X", href: "https://evil.example" }),
    ),
    null,
  );
});

test("pictures are shrunk to fit, never enlarged", async () => {
  const { fitSize } = await import("../src/lib/media.ts");
  assert.deepEqual(fitSize(2000, 1000, 1024), { width: 1024, height: 512 });
  assert.deepEqual(fitSize(1000, 3000, 1024), { width: 341, height: 1024 });
  assert.deepEqual(
    fitSize(500, 400, 1024),
    { width: 500, height: 400 },
    "small pictures stay as they are",
  );
  assert.deepEqual(fitSize(0, 10, 1024), { width: 1, height: 1 });
  assert.deepEqual(fitSize(Number.NaN, 10, 1024), { width: 1, height: 1 });
  assert.deepEqual(fitSize(5000, 1, 1024), { width: 1024, height: 1 });
});

test("video pictures are spread evenly and avoid the very start and end", async () => {
  const { evenTimes } = await import("../src/lib/media.ts");
  const times = evenTimes(30, 6);
  assert.equal(times.length, 6);
  assert.ok(times[0] > 0 && times[0] <= 0.4, "not the very first moment");
  assert.ok(
    times.at(-1) !== undefined && (times.at(-1) as number) < 30,
    "not the very last moment",
  );
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
  );
  const gaps = times
    .slice(1)
    .map((t, i) => Math.round((t - times[i]) * 100) / 100);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.05, "evenly spaced");
  assert.deepEqual(evenTimes(10, 1), [5]);
  assert.deepEqual(evenTimes(0, 6), [0]);
  assert.deepEqual(evenTimes(Number.NaN, 6), [0]);
  assert.deepEqual(evenTimes(10, 0), [0]);
  const short = evenTimes(1, 4);
  assert.ok(
    short.every((t) => t >= 0 && t <= 1),
    "a 1-second clip stays inside the clip",
  );
});
