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
