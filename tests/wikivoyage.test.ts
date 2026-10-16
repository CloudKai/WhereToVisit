import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractTemplates,
  listingCategory,
  listingToRaw,
  parseListings,
  splitParams,
} from "../src/lib/wikivoyage.ts";

const SAMPLE = `
== Eat ==
{{eat
| name=Café [[Kyoto|Rose]] | alt=薔薇珈琲 | url=https://rose.example/ | email=
| address=1 Teramachi | lat=35.0101 | long=135.7680 | directions=near the arcade
| phone=+81 75-000-0000 | tollfree= | hours=9:00-18:00 | price=¥800-1200
| wikidata=Q123 | image=File:Rose_cafe.jpg
| content=Known for its ''siphon coffee'' and thick toast.<ref>Some ref</ref> A [[w:Kyoto|local]] favourite.{{nowrap|x}}
}}
* {{listing | type=eat | name=Ramen Ichi | lat=35.02 | long=135.77 | content=Rich pork broth.}}
{{drink | name=The Rusty Pub | lat=35.0 | long=135.7 | content=Cheap beer and live music.}}
{{drink | name=Tea House Matcha | lat=35.0 | long=135.7 | content=Traditional tea ceremony.}}
{{see | name=Temple | lat=35.0 | long=135.7}}
{{eat | name= | content=nameless}}
{{eat | name=Bad Coords | lat=999 | long=135.7 | url=javascript:alert(1)}}
`;

test("extractTemplates finds balanced top-level templates only", () => {
  const bodies = extractTemplates("a {{x|{{y|1}}}} b {{z}} {{unclosed");
  assert.deepEqual(bodies, ["x|{{y|1}}", "z"]);
});

test("splitParams ignores pipes inside links and nested templates", () => {
  assert.deepEqual(splitParams("eat|name=[[A|B]]|c={{t|1|2}}|d=4"), [
    "eat",
    "name=[[A|B]]",
    "c={{t|1|2}}",
    "d=4",
  ]);
});

test("parseListings reads eat/drink listings and cleans wikitext", () => {
  const listings = parseListings(SAMPLE, "Kyoto/Central");
  const names = listings.map((l) => l.name);
  assert.deepEqual(names, [
    "Café Rose",
    "Ramen Ichi",
    "The Rusty Pub",
    "Tea House Matcha",
    "Bad Coords",
  ]);
  const cafe = listings[0];
  assert.equal(cafe.type, "eat");
  assert.equal(cafe.alt, "薔薇珈琲");
  assert.equal(cafe.lat, 35.0101);
  assert.equal(cafe.lon, 135.768);
  assert.equal(cafe.image, "Rose cafe.jpg");
  assert.equal(cafe.wikidata, "Q123");
  assert.equal(cafe.price, "¥800-1200");
  assert.equal(
    cafe.description,
    "Known for its siphon coffee and thick toast. A local favourite.",
  );
});

test("parseListings rejects unsafe URLs and out-of-range coordinates", () => {
  const bad = parseListings(SAMPLE, "x").find((l) => l.name === "Bad Coords");
  assert.ok(bad);
  assert.equal(bad.lat, undefined);
  assert.equal(bad.url, undefined);
});

test("drink listings are kept only when they look like cafés", () => {
  const listings = parseListings(SAMPLE, "Kyoto");
  const byName = Object.fromEntries(listings.map((l) => [l.name, l]));
  assert.equal(listingCategory(byName["The Rusty Pub"]), null);
  assert.equal(listingCategory(byName["Tea House Matcha"]), "cafe");
  assert.equal(listingCategory(byName["Ramen Ichi"]), "food");
  assert.equal(listingCategory(byName["Café Rose"]), "cafe");
});

test("listingToRaw builds a sourced editor record", () => {
  const raw = listingToRaw(parseListings(SAMPLE, "Kyoto/Central")[0]);
  assert.ok(raw);
  assert.equal(raw.origin, "wikivoyage");
  assert.equal(raw.descriptionBasis, "editor");
  assert.equal(raw.source.url, "https://en.wikivoyage.org/wiki/Kyoto/Central");
  assert.equal(raw.source.license, "CC BY-SA 4.0");
  assert.equal(raw.localName, "薔薇珈琲");
});
