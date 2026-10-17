import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config } from "../src/lib/config.ts";
import {
  addEvidence,
  evidenceLabel,
  findInSpeech,
  formatTime,
  mergeByLocation,
  rateMention,
  sameName,
} from "../src/lib/evidence.ts";
import type { Candidate, Evidence } from "../src/lib/extract-types.ts";
import { MAX_VIDEO_SECONDS } from "../src/lib/extract-types.ts";
import {
  cleanSpeech,
  cleanVisionHits,
  extractPlaces,
} from "../src/lib/extract.ts";
import type { Deps } from "../src/lib/extract.ts";
import { encodeWav, loudness, usedSeconds } from "../src/lib/media.ts";
import { RoomError } from "../src/lib/rooms.ts";
import { checkWav, cleanSegments, transcribe } from "../src/lib/transcribe.ts";

const BASE: Config = {
  geoapifyKey: "g",
  orsBaseUrl: "https://x",
  orsDailyCap: 1,
  openaiModel: "m",
  openaiTranscribeModel: "t",
  llmDailyCap: 10,
  communityPosts: true,
  tiktokOembed: false,
  openaiKey: "k",
};
const IG = "https://www.instagram.com/reel/Cabcde12345/";
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function cand(
  label: string,
  lat = 31.2,
  lon = 121.4,
  over: Partial<Candidate> = {},
): Candidate {
  return {
    label,
    address: label,
    lat,
    lon,
    kind: "amenity",
    confidence: 0.95,
    approximate: false,
    category: "cafe",
    ...over,
  };
}

function deps(over: Partial<Deps> = {}): Deps {
  return {
    caption: async () => "",
    names: async () => new Map(),
    vision: async () => [],
    geocode: async (name) => [cand(name)],
    ...over,
  };
}

// ---------- names, times, quotes ----------

test("names are matched across spellings, but short or unrelated names are not", () => {
  assert.ok(sameName("Coda's Roastery", "codas roastery"));
  assert.ok(sameName("Yu Garden", "Yu Garden Bazaar"));
  assert.ok(
    !sameName("Tea House", "Tea House of the Golden Dragon Palace"),
    "too little of the longer name",
  );
  assert.ok(sameName("豫园", "豫园商城"));
  assert.ok(
    !sameName("Cafe", "Cafe Nero Cafe"),
    "four letters is not enough on its own",
  );
  assert.ok(!sameName("Blue Bottle", "Blue Door"));
  assert.ok(!sameName("a", "a"));
});

test("times are shown as minutes and seconds", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(75), "1:15");
  assert.equal(formatTime(9.6), "0:10");
  assert.equal(formatTime(-3), "0:00");
});

test("a spoken name is traced to the phrase and the second it was said", () => {
  const segments = [
    { start: 1, text: "Welcome back" },
    { start: 12.4, text: "today we are at Blue Bottle Coffee in Jing’an" },
  ];
  assert.deepEqual(findInSpeech("blue bottle coffee", segments), {
    at: 12.4,
    quote: "today we are at Blue Bottle Coffee in Jing’an",
  });
  assert.equal(findInSpeech("Din Tai Fung", segments), null);
});

test("evidence is described in plain words and never duplicated", () => {
  assert.equal(
    evidenceLabel({ source: "caption" }),
    "Written in the caption you gave",
  );
  assert.equal(
    evidenceLabel({ source: "images", at: 20 }),
    "Seen on screen at 0:20",
  );
  assert.equal(
    evidenceLabel({ source: "images", frame: 3 }),
    "Seen in picture 3",
  );
  assert.equal(
    evidenceLabel({ source: "speech", at: 12, quote: "at Coda" }),
    "Said at 0:12: “at Coda”",
  );
  const once = addEvidence([], { source: "speech", at: 1 });
  assert.equal(addEvidence(once, { source: "speech", at: 1 }).length, 1);
  assert.equal(addEvidence(once, { source: "speech", at: 2 }).length, 2);
});

// ---------- the confirmed rule ----------

const SPEECH: Evidence = { source: "speech", at: 3 };
const SCREEN: Evidence = { source: "images", at: 5 };

test("two different ways plus one clear map match is confirmed", () => {
  const r = rateMention([SPEECH, SCREEN], [cand("Coda")]);
  assert.equal(r.verdict, "confirmed");
  assert.deepEqual(r.reasons, []);
});

test("found one way only is never confirmed, and says which way", () => {
  for (const [e, word] of [
    [SPEECH, /only heard/],
    [SCREEN, /only seen/],
    [{ source: "caption" } as Evidence, /only in the caption/],
  ] as const) {
    const r = rateMention([e], [cand("Coda")]);
    assert.equal(r.verdict, "check");
    assert.match(r.reasons[0], word);
  }
  // Three mentions in the same way is still one way.
  assert.equal(
    rateMention([SPEECH, { source: "speech", at: 9 }], [cand("Coda")]).verdict,
    "check",
  );
});

test("a weak, approximate, missing or ambiguous map match is never confirmed", () => {
  const two = [SPEECH, SCREEN];
  assert.match(rateMention(two, []).reasons[0], /wasn’t found on the map/);
  assert.match(
    rateMention(two, [cand("Pudong", 31, 121, { approximate: true })])
      .reasons[0],
    /area or street/,
  );
  assert.match(
    rateMention(two, [cand("Coda", 31.2, 121.4, { confidence: 0.6 })])
      .reasons[0],
    /uncertain/,
  );
  const rival = rateMention(two, [
    cand("Coda", 31.2, 121.4),
    cand("Coda", 31.3, 121.5, { confidence: 0.9 }),
  ]);
  assert.equal(rival.verdict, "check");
  assert.match(rival.reasons.join(" "), /Several different places/);
  // The same venue listed twice a few metres apart is not ambiguity.
  assert.equal(
    rateMention(two, [cand("Coda", 31.2, 121.4), cand("Coda", 31.2001, 121.4)])
      .verdict,
    "confirmed",
  );
  // A clearly worse second match is not ambiguity either.
  assert.equal(
    rateMention(two, [
      cand("Coda", 31.2, 121.4),
      cand("Codex", 31.3, 121.5, { confidence: 0.5 }),
    ]).verdict,
    "confirmed",
  );
});

test("two spellings that land on one spot are merged but left for the person to check", () => {
  const a = {
    name: "Coda",
    entry: 0,
    evidence: [SPEECH],
    candidates: [cand("Coda Roastery")],
  };
  const b = {
    name: "科达烘焙",
    entry: 0,
    evidence: [SCREEN],
    candidates: [cand("Coda Roastery", 31.20005, 121.4)],
  };
  const merged = mergeByLocation([a, b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].evidence.length, 2);
  const r = rateMention(
    merged[0].evidence,
    merged[0].candidates,
    (merged[0] as { alsoWrittenAs?: string[] }).alsoWrittenAs,
  );
  assert.equal(r.verdict, "check");
  assert.match(r.reasons[0], /Also written as “科达烘焙”/);
});

test("places are not merged when they are different shops, other posts or found the same way", () => {
  const base = {
    name: "A",
    entry: 0,
    evidence: [SPEECH],
    candidates: [cand("A")],
  };
  const apart = {
    ...base,
    name: "B",
    evidence: [SCREEN],
    candidates: [cand("B", 31.2003, 121.4)], // ~33 m
  };
  assert.equal(mergeByLocation([base, apart]).length, 2, "over 30 m apart");
  const otherPost = { ...base, name: "B", entry: 1, evidence: [SCREEN] };
  assert.equal(mergeByLocation([base, otherPost]).length, 2);
  const sameWay = { ...base, name: "B" };
  assert.equal(mergeByLocation([base, sameWay]).length, 2, "both spoken");
  const area = {
    ...base,
    name: "B",
    evidence: [SCREEN],
    candidates: [cand("B", 31.2, 121.4, { approximate: true })],
  };
  assert.equal(mergeByLocation([base, area]).length, 2);
});

// ---------- the whole pipeline with speech ----------

const SEGMENTS = [
  { start: 2, text: "Okay so this is Blue Bottle Coffee" },
  { start: 30, text: "and then we walked to Yu Garden" },
];

test("a place heard AND seen is confirmed with both pieces of evidence", async () => {
  const result = await extractPlaces(
    {
      entries: [
        {
          url: IG,
          images: [PIXEL, PIXEL],
          imageTimes: [4, 28],
          speech: SEGMENTS,
        },
      ],
    },
    BASE,
    deps({
      names: async (texts) =>
        new Map(
          texts.map((t) => [t.index, ["Blue Bottle Coffee", "Yu Garden"]]),
        ),
      vision: async () => [{ name: "Blue Bottle Coffee", frame: 1 }],
    }),
  );
  const blue = result.mentions.find((m) => m.name === "Blue Bottle Coffee");
  const yu = result.mentions.find((m) => m.name === "Yu Garden");
  assert.ok(blue && yu);
  assert.equal(blue.verdict, "confirmed");
  assert.deepEqual(blue.evidence.map((e) => [e.source, e.at]).sort(), [
    ["images", 4],
    ["speech", 2],
  ]);
  assert.equal(yu.verdict, "check", "heard only");
  assert.match(yu.reasons[0], /only heard/);
  assert.match(result.entries[0].message, /2 places found, 1 confirmed/);
});

test("speech names must really be in the transcript", async () => {
  const result = await extractPlaces(
    { entries: [{ url: IG, speech: SEGMENTS }] },
    BASE,
    deps({
      names: async (texts) =>
        new Map(texts.map((t) => [t.index, ["Eiffel Tower", "Yu Garden"]])),
    }),
  );
  assert.deepEqual(
    result.mentions.map((m) => m.name),
    ["Yu Garden"],
    "a name nobody said is dropped",
  );
});

test("the same place in the caption and the audio is counted once", async () => {
  const result = await extractPlaces(
    {
      entries: [{ url: IG, text: "Yu Garden day", speech: SEGMENTS }],
    },
    BASE,
    deps({
      names: async (texts) =>
        new Map(texts.map((t) => [t.index, ["Yu Garden"]])),
    }),
  );
  assert.equal(result.mentions.length, 1);
  assert.deepEqual(result.mentions[0].evidence.map((e) => e.source).sort(), [
    "caption",
    "speech",
  ]);
  assert.equal(result.mentions[0].verdict, "confirmed");
});

test("audio is not used without an AI key, and the person is told", async () => {
  let called = 0;
  const result = await extractPlaces(
    { entries: [{ url: IG, speech: SEGMENTS }] },
    { ...BASE, openaiKey: undefined },
    deps({
      names: async () => {
        called++;
        return new Map();
      },
    }),
  );
  assert.equal(called, 0);
  assert.equal(result.mentions.length, 0);
  assert.ok(result.notes.some((n) => /audio needs an OpenAI key/.test(n)));
});

test("audio never counts without a valid post link", async () => {
  const result = await extractPlaces(
    { entries: [{ url: "", speech: SEGMENTS }] },
    BASE,
    deps(),
  );
  assert.equal(result.entries[0].status, "bad-link");
});

test("speech and picture times in a request are cleaned and bounded", () => {
  const long = Array.from({ length: 400 }, (_, i) => ({
    start: i % 100,
    text: `line number ${i}`,
  }));
  const cleaned = cleanSpeech([
    ...long,
    { start: -1, text: "before the start" },
    { start: MAX_VIDEO_SECONDS + 60, text: "after the end" },
    { start: 5, text: 42 },
    { start: "5", text: "string start" },
    null,
  ]);
  assert.ok(cleaned.length <= 150);
  assert.ok(cleaned.every((s) => s.start >= 0 && s.start <= 125));
  assert.ok(cleaned.reduce((n, s) => n + s.text.length, 0) <= 5000);
  assert.deepEqual(cleanSpeech("nope"), []);
  assert.deepEqual(cleanSpeech([{ start: 1, text: "<b>hi</b> there" }]), [
    { start: 1, text: "bhi/b there" },
  ]);
});

test("picture hits keep their frame numbers and at most three per name", () => {
  const hits = cleanVisionHits([
    { name: "Yu Garden", frame: 1 },
    { name: "yu garden", frame: 2 },
    { name: "Yu Garden", frame: 2 },
    { name: "Yu Garden", frame: 3 },
    { name: "Yu Garden", frame: 4 },
    { name: "x", frame: 1 },
  ]);
  assert.deepEqual(
    hits.map((h) => [h.name, h.frame]),
    [
      ["Yu Garden", 1],
      ["Yu Garden", 2],
      ["Yu Garden", 3],
    ],
  );
});

// ---------- the sound file and the speech model ----------

test("a WAV file is written and checked the same way", () => {
  const rate = 16000;
  const wav = encodeWav(new Float32Array(rate * 2).fill(0.1), rate);
  assert.equal(wav.length, 44 + rate * 2 * 2);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.ok(Math.abs(checkWav(wav).seconds - 2) < 0.01);
});

test("a sound file that is not the expected kind is refused", () => {
  const ok = encodeWav(new Float32Array(16000).fill(0.1));
  assert.throws(() => checkWav(new Uint8Array(10)), RoomError);
  assert.throws(
    () => checkWav(new TextEncoder().encode("x".repeat(100))),
    RoomError,
  );
  const stereo = ok.slice();
  new DataView(stereo.buffer).setUint16(22, 2, true);
  assert.throws(() => checkWav(stereo), RoomError);
  const tooLong = encodeWav(new Float32Array(16000 * 130));
  assert.throws(() => checkWav(tooLong), RoomError);
  assert.throws(
    () => checkWav(encodeWav(new Float32Array(100))),
    RoomError,
    "too short",
  );
  assert.throws(() => checkWav(new Uint8Array(4_100_000)), RoomError);
});

test("loudness tells speech from silence", () => {
  assert.equal(loudness(new Float32Array(100)), 0);
  assert.ok(loudness(new Float32Array(100).fill(0.5)) > 0.4);
  assert.equal(loudness(new Float32Array(0)), 0);
});

test("only the first two minutes of a recording are used", () => {
  assert.deepEqual(usedSeconds(30), { seconds: 30, truncated: false });
  assert.deepEqual(usedSeconds(300), { seconds: 120, truncated: true });
  assert.deepEqual(usedSeconds(Number.NaN), { seconds: 0, truncated: false });
});

test("phrases the speech model is unsure about are dropped", () => {
  const segments = cleanSegments([
    {
      start: 1,
      text: " Blue Bottle Coffee ",
      no_speech_prob: 0.01,
      avg_logprob: -0.2,
    },
    {
      start: 4,
      text: "Thanks for watching!",
      no_speech_prob: 0.9,
      avg_logprob: -0.3,
    },
    { start: 6, text: "mumble", no_speech_prob: 0.1, avg_logprob: -2.5 },
    { start: -2, text: "before" },
    { start: 9, text: "x" },
    { start: 10, text: 42 },
  ]);
  assert.deepEqual(segments, [{ start: 1, text: "Blue Bottle Coffee" }]);
  assert.deepEqual(cleanSegments("nope"), []);
});

test("transcription sends the sound with the key and returns clean phrases", async () => {
  let seenUrl = "";
  let seenAuth = "";
  let seenForm: FormData | undefined;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seenUrl = url;
    seenAuth = (init.headers as Record<string, string>).authorization;
    seenForm = init.body as FormData;
    return new Response(
      JSON.stringify({ segments: [{ start: 2, text: "Yu Garden" }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const wav = encodeWav(new Float32Array(16000).fill(0.1));
  const out = await transcribe(wav, BASE, fakeFetch);
  assert.deepEqual(out, [{ start: 2, text: "Yu Garden" }]);
  assert.equal(seenUrl, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(seenAuth, "Bearer k");
  assert.equal(seenForm?.get("model"), "t");
  assert.equal(seenForm?.get("response_format"), "verbose_json");
  await assert.rejects(
    transcribe(wav, { ...BASE, openaiKey: undefined }, fakeFetch),
    /no key/,
  );
  const failing = (async () =>
    new Response("no", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(transcribe(wav, BASE, failing), /HTTP 500/);
});
