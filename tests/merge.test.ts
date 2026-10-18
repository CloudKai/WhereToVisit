import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReason,
  dedupe,
  mergePlaces,
  scoreOsm,
} from "../src/lib/merge.ts";
import type { Destination, RawPlace } from "../src/lib/types.ts";

const KYOTO: Destination = {
  name: "Kyoto",
  lat: 35.0116,
  lon: 135.7681,
  radiusM: 4000,
};

function raw(overrides: Partial<RawPlace>): RawPlace {
  return {
    origin: "openstreetmap",
    name: "Place",
    category: "cafe",
    cuisines: [],
    facts: [],
    flags: {},
    source: {
      kind: "openstreetmap",
      label: "OpenStreetMap contributors",
      url: "https://www.openstreetmap.org/copyright",
      license: "ODbL",
    },
    ...overrides,
  };
}

const listing = raw({
  origin: "wikivoyage",
  name: "Café Rose",
  lat: 35.0101,
  lon: 135.768,
  description:
    "Known for siphon coffee and thick toast. A local favourite for decades.",
  descriptionBasis: "editor",
  source: {
    kind: "wikivoyage",
    label: "Wikivoyage: Kyoto",
    url: "https://en.wikivoyage.org/wiki/Kyoto",
    license: "CC BY-SA 4.0",
  },
});

test("an editor listing absorbs the matching OSM place", () => {
  const osm = raw({
    name: "Cafe Rose",
    lat: 35.0103,
    lon: 135.7682,
    hours: "Mo-Su 09:00-18:00",
    website: "https://rose.example/",
    wikidata: "Q1",
  });
  const other = raw({ name: "Other Cafe", lat: 35.02, lon: 135.77 });
  const { editorPicks, nearby } = mergePlaces(KYOTO, [listing], [osm, other]);
  assert.equal(editorPicks.length, 1);
  assert.equal(nearby.length, 1);
  const pick = editorPicks[0];
  assert.equal(pick.tier, "editor");
  assert.equal(pick.hours, "Mo-Su 09:00-18:00");
  assert.equal(pick.website, "https://rose.example/");
  assert.equal(pick.lat, 35.0103, "OSM mapped position wins");
  assert.equal(pick.reason.basis, "editor");
  assert.deepEqual(
    pick.sources.map((s) => s.kind),
    ["wikivoyage", "openstreetmap"],
  );
  assert.equal(nearby[0].name, "Other Cafe");
});

test("same name far away is NOT treated as the same venue", () => {
  const farAway = raw({ name: "Café Rose", lat: 35.1, lon: 135.9 });
  const { editorPicks, nearby } = mergePlaces(KYOTO, [listing], [farAway]);
  assert.equal(editorPicks[0].hours, undefined);
  assert.equal(nearby.length, 1);
});

test("places without a description are never presented as recommendations", () => {
  const reason = buildReason(
    raw({ name: "Plain", cuisines: ["Coffee shop"], facts: ["Wi-Fi"] }),
    "Kyoto",
  );
  assert.equal(reason.basis, "facts");
  assert.equal(reason.text, "Café serving coffee shop near Kyoto. Wi-Fi.");
});

test("long descriptions are shortened but the original is kept", () => {
  const long = `${"Great coffee and toast. ".repeat(20)}`.trim();
  const reason = buildReason(
    raw({ description: long, descriptionBasis: "editor" }),
    "Kyoto",
  );
  assert.ok(reason.text.length <= 170);
  assert.equal(reason.fullText, long);
  assert.equal(reason.polished, false);
});

test("nearby places rank by data richness, chains lower", () => {
  const rich = raw({
    name: "Rich",
    website: "https://r.example/",
    hours: "24/7",
    wikidata: "Q9",
  });
  const chain = raw({ name: "Chain", flags: { chain: true } });
  assert.ok(scoreOsm(rich) > scoreOsm(chain));
  const { nearby } = mergePlaces(KYOTO, [], [chain, rich]);
  assert.deepEqual(
    nearby.map((p) => p.name),
    ["Rich", "Chain"],
  );
});

test("dedupe removes repeats within range but keeps distant namesakes", () => {
  const a = raw({ name: "Blue Cup", lat: 35.0, lon: 135.0 });
  const b = raw({ name: "Blue Cup", lat: 35.00001, lon: 135.00001 });
  const c = raw({ name: "Blue Cup", lat: 35.1, lon: 135.1 });
  assert.equal(dedupe([a, b, c], 0.05).length, 2);
});

test("place ids stay unique when names repeat", () => {
  const { nearby } = mergePlaces(
    KYOTO,
    [],
    [
      raw({ name: "Twin", lat: 35.0, lon: 135.0 }),
      raw({ name: "Twin", lat: 35.1, lon: 135.1 }),
    ],
  );
  assert.equal(new Set(nearby.map((p) => p.id)).size, 2);
});
