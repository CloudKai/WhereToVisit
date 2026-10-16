import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizePlaceFeature,
  normalizeSuggestions,
} from "../src/lib/geoapify.ts";

const FEATURE = {
  properties: {
    name: "喫茶 ローズ",
    formatted: "喫茶 ローズ, 1 Teramachi, Kyoto, Japan",
    address_line2: "1 Teramachi, Kyoto, Japan",
    lat: 35.0102,
    lon: 135.7681,
    categories: ["catering", "catering.cafe"],
    opening_hours: "Mo-Su 09:00-18:00",
    contact: { phone: "+81 75-000-0000" },
    catering: { cuisine: "coffee_shop;japanese_regional" },
    wiki_and_media: { wikidata: "Q123" },
    datasource: {
      raw: {
        "name:en": "Rose Kissaten",
        website: "rose.example",
        outdoor_seating: "yes",
        internet_access: "wlan",
        "diet:vegetarian": "yes",
        "description:en": "A tiny coffee house.",
        wikimedia_commons: "File:Rose_front.jpg",
        brand: "",
        "award:michelin": "bib",
        osm_type: "n",
        osm_id: "42",
      },
    },
  },
};

test("normalizePlaceFeature maps Geoapify properties to a RawPlace", () => {
  const place = normalizePlaceFeature(FEATURE);
  assert.ok(place);
  assert.equal(place.name, "Rose Kissaten");
  assert.equal(place.localName, "喫茶 ローズ");
  assert.equal(place.category, "cafe");
  assert.deepEqual(place.cuisines, ["Coffee shop", "Japanese regional"]);
  assert.equal(place.address, "1 Teramachi, Kyoto, Japan");
  assert.equal(place.hours, "Mo-Su 09:00-18:00");
  assert.equal(place.website, "https://rose.example/");
  assert.equal(place.wikidata, "Q123");
  assert.equal(place.photoFile, "Rose front.jpg");
  assert.equal(place.description, "A tiny coffee house.");
  assert.equal(place.descriptionBasis, "community");
  assert.deepEqual(place.facts, [
    "Outdoor seating",
    "Wi-Fi",
    "Vegetarian options",
  ]);
  assert.equal(place.flags.michelin, true);
  assert.equal(place.flags.chain, false);
  assert.equal(place.source.url, "https://www.openstreetmap.org/node/42");
});

test("normalizePlaceFeature rejects unusable features", () => {
  assert.equal(normalizePlaceFeature({}), null);
  assert.equal(
    normalizePlaceFeature({ properties: { lat: 1, lon: 1 } }),
    null,
    "no name",
  );
  assert.equal(
    normalizePlaceFeature({ properties: { name: "X", lat: 200, lon: 1 } }),
    null,
    "bad latitude",
  );
});

test("normalizePlaceFeature never keeps non-http website schemes", () => {
  const place = normalizePlaceFeature({
    properties: {
      name: "X",
      lat: 1,
      lon: 1,
      website: "javascript:alert(1)",
    },
  });
  assert.ok(place);
  assert.equal(place.website, undefined);
});

test("normalizePlaceFeature falls back to geometry and restaurant category", () => {
  const place = normalizePlaceFeature({
    properties: { name: "Ramen Ichi", categories: ["catering.restaurant"] },
    geometry: { coordinates: [135.77, 35.02] },
  });
  assert.ok(place);
  assert.equal(place.category, "food");
  assert.equal(place.lat, 35.02);
  assert.equal(place.lon, 135.77);
});

test("normalizeSuggestions keeps destinations, drops streets and duplicates", () => {
  const suggestions = normalizeSuggestions({
    features: [
      {
        properties: {
          formatted: "Kyoto, Japan",
          name: "Kyoto",
          country: "Japan",
          result_type: "city",
          lat: 35.01,
          lon: 135.76,
        },
      },
      {
        properties: {
          formatted: "Kyoto, Japan",
          name: "Kyoto",
          result_type: "city",
          lat: 35.01,
          lon: 135.76,
        },
      },
      {
        properties: {
          formatted: "Kyoto Street 1",
          result_type: "street",
          lat: 1,
          lon: 1,
        },
      },
      {
        properties: {
          formatted: "Gion, Kyoto, Japan",
          result_type: "suburb",
          lat: 35.0,
          lon: 135.77,
        },
      },
    ],
  });
  assert.equal(suggestions.length, 2);
  assert.deepEqual(
    suggestions.map((s) => [s.name, s.radiusM]),
    [
      ["Kyoto", 6000],
      ["Gion", 2500],
    ],
  );
});

test("cities mapped as a state (Tokyo, Shanghai) are searchable and rank sensibly", () => {
  const suggestions = normalizeSuggestions({
    features: [
      {
        properties: {
          formatted: "Japan",
          name: "Japan",
          result_type: "country",
          lat: 36,
          lon: 138,
        },
      },
      {
        properties: {
          formatted: "Tokyo, Japan",
          name: "Tokyo",
          country: "Japan",
          result_type: "state",
          lat: 35.68,
          lon: 139.76,
        },
      },
      {
        properties: {
          formatted: "Tokyo Station, Chiyoda, Japan",
          name: "Chiyoda",
          result_type: "district",
          lat: 35.68,
          lon: 139.76,
        },
      },
      {
        properties: {
          formatted: "Tokyo, Ohio, United States",
          name: "Tokyo",
          result_type: "city",
          lat: 40,
          lon: -83,
        },
      },
    ],
  });
  // Countries are still excluded; a city beats a district beats a state.
  assert.deepEqual(
    suggestions.map((s) => [s.label, s.radiusM]),
    [
      ["Tokyo, Ohio, United States", 6000],
      ["Tokyo Station, Chiyoda, Japan", 2500],
      ["Tokyo, Japan", 8000],
    ],
  );
});

// ---------- backup geocoder & failure reasons ----------

test("backup geocoder keeps cities and districts, drops countries and shops", async () => {
  const { normalizeNominatim } = await import("../src/lib/nominatim.ts");
  const result = normalizeNominatim([
    {
      lat: "35",
      lon: "103",
      name: "China",
      display_name: "China",
      addresstype: "country",
    },
    {
      lat: "31.2304",
      lon: "121.4737",
      name: "Shanghai",
      display_name: "Shanghai, China",
      addresstype: "state",
      address: { country: "China" },
    },
    {
      lat: "31.2",
      lon: "121.4",
      name: "Jing'an",
      display_name: "Jing'an, Shanghai, China",
      addresstype: "city_district",
    },
    {
      lat: "40.7",
      lon: "-74",
      name: "Shanghai Cafe",
      display_name: "Shanghai Cafe, New York",
      addresstype: "amenity",
    },
    {
      lat: "abc",
      lon: "1",
      name: "Bad",
      display_name: "Bad",
      addresstype: "city",
    },
    {
      lat: "95",
      lon: "1",
      name: "Far",
      display_name: "Far",
      addresstype: "city",
    },
  ]);
  assert.deepEqual(
    result.map((r) => [r.name, r.radiusM, r.country]),
    [
      ["Jing'an", 2500, undefined],
      ["Shanghai", 8000, "China"],
    ],
  );
  assert.deepEqual(normalizeNominatim(null), []);
  assert.deepEqual(normalizeNominatim({}), []);
});

test("upstream failures are classified for a helpful message", async () => {
  const { failureReason, UpstreamError } = await import("../src/lib/http.ts");
  assert.equal(
    failureReason(new UpstreamError("Geoapify", "HTTP 401", 401)),
    "key-rejected",
  );
  assert.equal(
    failureReason(new UpstreamError("Geoapify", "HTTP 403", 403)),
    "key-rejected",
  );
  assert.equal(
    failureReason(new UpstreamError("Geoapify", "HTTP 429", 429)),
    "quota",
  );
  assert.equal(
    failureReason(new UpstreamError("Geoapify", "HTTP 500", 500)),
    "unavailable",
  );
  assert.equal(
    failureReason(new UpstreamError("Geoapify", "timeout")),
    "unavailable",
  );
  assert.equal(failureReason(new Error("boom")), "unavailable");
});
