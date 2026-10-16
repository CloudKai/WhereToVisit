import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATEGORIES,
  CATEGORY_INFO,
  categoriesForFilter,
  categoryFromToken,
  FILTERS,
  matchesFilter,
  parseCategoryFilter,
} from "../src/lib/categories.ts";
import { capPerType, prioritise } from "../src/lib/explore.ts";
import {
  categoryOf,
  isNotable,
  normalizePlaceFeature,
  subtypeLabel,
} from "../src/lib/geoapify.ts";
import {
  addPhotos,
  distinctiveWords,
  parseWikidataImages,
  pickNearbyFile,
  wikidataImageQuery,
} from "../src/lib/images.ts";
import { decodePlan, encodePlan, type Plan } from "../src/lib/plan.ts";
import type { Category, Place } from "../src/lib/types.ts";
import { listingCategory, parseListings } from "../src/lib/wikivoyage.ts";

function place(
  id: string,
  category: Category,
  over: Partial<Place> = {},
): Place {
  return {
    id,
    name: id,
    category,
    cuisines: [],
    reason: { basis: "facts", text: "x", polished: false },
    sources: [],
    tier: "nearby",
    score: 0,
    ...over,
  };
}

// ---------- categories & filters ----------

test("every category has a unique one-letter link code and sane defaults", () => {
  const tokens = CATEGORIES.map((c) => CATEGORY_INFO[c].token);
  assert.equal(new Set(tokens).size, CATEGORIES.length);
  assert.equal(
    CATEGORY_INFO.cafe.token,
    "c",
    "existing shared links must keep working",
  );
  assert.equal(CATEGORY_INFO.food.token, "f");
  for (const c of CATEGORIES) {
    assert.ok(CATEGORY_INFO[c].dwell >= 10 && CATEGORY_INFO[c].dwell <= 300);
    assert.ok(CATEGORY_INFO[c].geoapify.length > 0);
    assert.equal(categoryFromToken(CATEGORY_INFO[c].token), c);
  }
  assert.equal(categoryFromToken("z"), null);
  assert.equal(categoryFromToken(undefined), null);
});

test("filters group categories sensibly", () => {
  assert.ok(matchesFilter("park", "all"));
  assert.ok(matchesFilter("cafe", "eat") && matchesFilter("food", "eat"));
  assert.ok(!matchesFilter("park", "eat"));
  assert.ok(matchesFilter("park", "park") && !matchesFilter("museum", "park"));
  assert.deepEqual(categoriesForFilter("eat"), ["cafe", "food"]);
  assert.equal(categoriesForFilter("all").length, CATEGORIES.length);
  assert.equal(FILTERS[0].id, "all");
  assert.equal(parseCategoryFilter("park"), "park");
  assert.equal(
    parseCategoryFilter("food"),
    "food",
    "old restaurant links still work",
  );
  assert.equal(parseCategoryFilter("nonsense"), "all");
  assert.equal(parseCategoryFilter(["museum", "x"]), "museum");
  assert.equal(parseCategoryFilter(undefined), "all");
});

test("'All' keeps the top few of each type in order", () => {
  const places = [
    place("c1", "cafe"),
    place("p1", "park"),
    place("c2", "cafe"),
    place("c3", "cafe"),
    place("p2", "park"),
  ];
  assert.deepEqual(
    capPerType(places, 2).map((p) => p.id),
    ["c1", "p1", "c2", "p2"],
  );
  const order = prioritise(places).map((p) => p.id);
  assert.deepEqual(
    order,
    ["c1", "p1", "c2", "p2", "c3"],
    "firsts of each type come first",
  );
});

// ---------- Wikivoyage see / do / buy ----------

test("Wikivoyage listings are sorted into our categories", () => {
  const text = `
{{see | name=Senso-ji | lat=35.71 | long=139.79 | content=Tokyo's oldest temple.}}
{{see | name=Ueno Park | lat=35.71 | long=139.77}}
{{see | name=Tokyo National Museum | lat=35.71 | long=139.78}}
{{do | name=Sumida River cruise | lat=35.7 | long=139.8}}
{{buy | name=Ginza Six | lat=35.67 | long=139.76}}
{{eat | name=Ramen Ichi | lat=35.6 | long=139.7}}
{{drink | name=Blue Cafe | lat=35.6 | long=139.7}}
{{drink | name=Rusty Pub | lat=35.6 | long=139.7}}
{{see | name=Hotel Park View | lat=35.7 | long=139.7 | content=Next to the botanical garden and a museum.}}
`;
  const byName = Object.fromEntries(
    parseListings(text, "Tokyo").map((l) => [l.name, listingCategory(l)]),
  );
  assert.deepEqual(byName, {
    "Senso-ji": "attraction",
    "Ueno Park": "park",
    "Tokyo National Museum": "museum",
    "Sumida River cruise": "attraction",
    "Ginza Six": "shopping",
    "Ramen Ichi": "food",
    "Blue Cafe": "cafe",
    "Rusty Pub": null,
    // The name says park, so it is a park; descriptions never decide.
    "Hotel Park View": "park",
  });
});

// ---------- Geoapify categories ----------

test("Geoapify categories map to ours, using the requested group as a hint", () => {
  assert.equal(categoryOf(["catering.cafe"]), "cafe");
  assert.equal(categoryOf(["tourism.sights.castle"]), "attraction");
  assert.equal(categoryOf(["leisure.park.garden"]), "park");
  assert.equal(categoryOf(["entertainment.museum"]), "museum");
  assert.equal(categoryOf(["commercial.shopping_mall"]), "shopping");
  assert.equal(
    categoryOf(["tourism.attraction", "entertainment.museum"], "museum"),
    "museum",
  );
  assert.equal(categoryOf([], "park"), "park");
  assert.equal(categoryOf([]), "food");
  assert.equal(
    subtypeLabel(["tourism.sights.place_of_worship"], "attraction"),
    "Place of worship",
  );
  assert.equal(subtypeLabel(["tourism.sights"], "attraction"), undefined);
});

test("non-food places show their kind in place of cuisines", () => {
  const raw = normalizePlaceFeature(
    {
      properties: {
        name: "Himeji Castle",
        lat: 34.84,
        lon: 134.69,
        categories: ["tourism", "tourism.sights", "tourism.sights.castle"],
        wiki_and_media: { wikidata: "Q184408" },
      },
    },
    "attraction",
  );
  assert.ok(raw);
  assert.equal(raw.category, "attraction");
  assert.deepEqual(raw.cuisines, ["Castle"]);
  assert.equal(raw.wikidata, "Q184408");
});

test("map clutter is filtered by notability", () => {
  const bare = normalizePlaceFeature({
    properties: {
      name: "Bench Statue",
      lat: 1,
      lon: 1,
      categories: ["tourism.attraction"],
    },
  });
  const known = normalizePlaceFeature({
    properties: {
      name: "Old Tower",
      lat: 1,
      lon: 1,
      categories: ["tourism.sights.tower"],
      website: "https://tower.example",
    },
  });
  assert.ok(bare && known);
  assert.equal(isNotable(bare), false);
  assert.equal(isNotable(known), true);
});

// ---------- shareable links keep working with new categories ----------

test("all categories survive a link round trip, and old links still open", () => {
  const stops = CATEGORIES.map((category, i) => ({
    id: `${(10 + i).toFixed(5)},${(20 + i).toFixed(5)}`,
    name: `Place ${category}`,
    lat: 10 + i,
    lon: 20 + i,
    category,
    dwell: CATEGORY_INFO[category].dwell,
  }));
  const plan: Plan = { days: [{ start: 600, mode: "walk", stops }] };
  assert.deepEqual(decodePlan(encodePlan(plan)), plan);

  const legacy = Buffer.from(
    JSON.stringify({
      v: 2,
      y: [
        [
          600,
          "w",
          [
            ["A", 1, 1, "c", 30],
            ["B", 2, 2, "f", 60],
          ],
        ],
      ],
    }),
  ).toString("base64url");
  assert.deepEqual(
    decodePlan(legacy)?.days[0].stops.map((s) => s.category),
    ["cafe", "food"],
  );

  const bad = Buffer.from(
    JSON.stringify({ v: 2, y: [[600, "w", [["A", 1, 1, "q", 30]]]] }),
  ).toString("base64url");
  assert.equal(decodePlan(bad), null, "unknown category code is rejected");
});

// ---------- photos ----------

test("Wikidata image results are parsed defensively", () => {
  assert.equal(
    wikidataImageQuery(["Q1", "Q22", "not-a-qid"]),
    "SELECT ?item ?img WHERE { VALUES ?item { wd:Q1 wd:Q22 } ?item wdt:P18 ?img }",
  );
  const map = parseWikidataImages({
    results: {
      bindings: [
        {
          item: { value: "http://www.wikidata.org/entity/Q1" },
          img: {
            value:
              "http://commons.wikimedia.org/wiki/Special:FilePath/Senso-ji%20Temple.jpg",
          },
        },
        {
          item: { value: "http://www.wikidata.org/entity/Q1" },
          img: {
            value:
              "http://commons.wikimedia.org/wiki/Special:FilePath/Second.jpg",
          },
        },
        {
          item: { value: "http://www.wikidata.org/entity/Q2" },
          img: {
            value:
              "http://commons.wikimedia.org/wiki/Special:FilePath/Plan.svg",
          },
        },
        { item: { value: "nonsense" }, img: { value: "x" } },
      ],
    },
  });
  assert.deepEqual([...map], [["Q1", "Senso-ji Temple.jpg"]]);
  assert.equal(parseWikidataImages(null).size, 0);
  assert.equal(parseWikidataImages({ results: {} }).size, 0);
});

test("a nearby Commons photo is accepted only when it plausibly shows the place", () => {
  assert.deepEqual(distinctiveWords("The Old Ueno Park"), ["ueno"]);
  const hits = (list: { title: string; dist: number }[]) => ({
    query: { geosearch: list },
  });
  // The file name contains the place's name: a real match.
  assert.deepEqual(
    pickNearbyFile(
      hits([
        { title: "File:Street.jpg", dist: 30 },
        { title: "File:Himeji Castle 2019.jpg", dist: 40 },
      ]),
      "Himeji Castle",
    ),
    { file: "Himeji Castle 2019.jpg", kind: "place" },
  );
  // No name match: only a photo within a few metres, labelled nearby.
  assert.deepEqual(
    pickNearbyFile(
      hits([{ title: "File:IMG_1234.jpg", dist: 8 }]),
      "Quiet Garden Cafe",
    ),
    { file: "IMG 1234.jpg", kind: "nearby" },
  );
  assert.equal(
    pickNearbyFile(
      hits([{ title: "File:IMG_1234.jpg", dist: 40 }]),
      "Quiet Garden Cafe",
    ),
    null,
  );
  // Diagrams and non-images are ignored.
  assert.equal(
    pickNearbyFile(
      hits([
        { title: "File:Castle map.jpg", dist: 3 },
        { title: "File:Castle.svg", dist: 3 },
      ]),
      "Castle",
    ),
    null,
  );
  assert.equal(pickNearbyFile(null, "x"), null);
});

test("addPhotos uses Wikidata first, looks nearby only for sights, and tolerates failures", async () => {
  const places = [
    place("a", "attraction", { wikidata: "Q1", lat: 1, lon: 1 }),
    place("b", "park", { lat: 2, lon: 2 }),
    place("c", "cafe", { lat: 3, lon: 3 }),
    place("d", "museum", { lat: 4, lon: 4 }),
    place("e", "park", {
      photo: { url: "u", pageUrl: "p", credit: "c" },
      lat: 5,
      lon: 5,
    }),
  ];
  const asked: string[] = [];
  const result = await addPhotos(places, "me", {
    wikidata: async () => new Map([["Q1", "Temple.jpg"]]),
    nearby: async (lat, _lon, name) => {
      asked.push(name);
      if (name === "d") throw new Error("slow");
      return lat === 2 ? { file: "Park.jpg", kind: "nearby" as const } : null;
    },
  });
  const byId = Object.fromEntries(result.map((p) => [p.id, p.photo]));
  assert.equal(byId.a?.kind, "place");
  assert.match(byId.a?.url ?? "", /Temple\.jpg/);
  assert.equal(byId.b?.kind, "nearby");
  assert.equal(byId.c, undefined, "cafés are not looked up nearby");
  assert.equal(byId.d, undefined, "a failed lookup just means no photo");
  assert.equal(byId.e?.credit, "c", "existing photos are untouched");
  assert.deepEqual(
    asked.sort(),
    ["b", "d"],
    "a (has Wikidata image), c (café) and e (has photo) are skipped",
  );

  const none = await addPhotos(places, "me", {
    wikidata: async () => {
      throw new Error("down");
    },
    nearby: async () => null,
  });
  assert.equal(none.find((p) => p.id === "a")?.photo, undefined);
});

// ---------- client-side filtering helpers ----------

test("filtering is a pure function of the places already loaded", async () => {
  const { applyFilter, countFor, HEADLINE_PER_TYPE } =
    await import("../src/lib/listing.ts");
  const picks = [
    ...Array.from({ length: 8 }, (_, i) =>
      place(`park${i}`, "park", { tier: "editor" }),
    ),
    place("cafe1", "cafe", { tier: "editor" }),
    place("food1", "food", { tier: "editor" }),
  ];
  const nearby = [place("museum1", "museum"), place("park9", "park")];
  assert.equal(
    applyFilter(picks, "park").length,
    8,
    "a chosen type shows everything",
  );
  assert.equal(
    applyFilter(picks, "all").filter((p) => p.category === "park").length,
    HEADLINE_PER_TYPE,
  );
  assert.deepEqual(
    applyFilter(picks, "eat").map((p) => p.id),
    ["cafe1", "food1"],
  );
  assert.equal(
    countFor({ editorPicks: picks, nearby }, "park"),
    9,
    "counts include both lists",
  );
  assert.equal(countFor({ editorPicks: picks, nearby }, "eat"), 2);
  assert.equal(
    countFor({ editorPicks: picks, nearby }, "all"),
    12,
    "the All count is not capped",
  );
});

test("explore keeps exporting the helpers other code imports", async () => {
  const mod = await import("../src/lib/explore.ts");
  assert.equal(typeof mod.capPerType, "function");
  assert.equal(mod.HEADLINE_PER_TYPE, 5);
});
