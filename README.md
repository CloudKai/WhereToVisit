# WhereToVisit

Search any city and see recommended restaurants, cafés, malls and shopping,
attractions, museums and parks. Every place shows why it is worth a visit and
where that reason comes from. Then build a multi-day trip with a map and a route
for each day, and let friends vote on it. No accounts.

> **Status:** everything below is built and unit-tested (142 tests), but the
> project has not yet been built or run against the real packages and live
> services. Expect to fix small things on first run (see "First run").

## What you can do

### Discover

- **Search anywhere.** Worldwide autocomplete (Geoapify), popular starting cities,
  and a backup city search if live suggestions fail.
- **Recommended places first.** Editor picks come from
  [Wikivoyage](https://www.wikivoyage.org/) (Eat, Drink, See, Do, Buy listings),
  each with the editor's description and a link to the article. Other places come
  from OpenStreetMap and are labelled as _not_ a recommendation.
- **Filters for every kind of place** with counts: All · Food & drink · Cafés ·
  Restaurants · Malls & shopping · Attractions · Museums & culture · Parks &
  nature. Filtering is instant (everything is loaded once).
- **10–15 places to eat, not 2.** "All" shows 14 places to eat (6 cafés, 8
  restaurants) plus the best of each other type; a chosen type shows its top 15
  with "Show more". A city with too few places to eat is searched again out to
  10 km, and says so.
- **Search this area.** Move the map and press the button to rebuild the list
  for exactly what is on screen (up to about 20 km across). The area is in the
  page link, so it can be bookmarked and shared.
- **Photos where a trustworthy free one exists** (Wikidata or Wikivoyage image,
  or a Commons photo geotagged at a landmark, labelled "Photo taken nearby" when
  it is not clearly that place). Shops and cafés mostly show an icon instead.
- **Visit details:** address, hours (as mapped), phone, website, links to Google
  Maps, Apple Maps, Amap and OpenStreetMap.
- **Optional AI condensing** of long notes (OpenAI). It may only use the source
  text; any line adding a number or name is rejected; condensed lines are
  tagged "AI-condensed". The AI never decides what is recommended.

### Plan

- **Multi-day trips (`/plan`).** Up to 10 days, 12 stops per day, 40 in total.
  Each day has its own map, start time, travel mode (walk / bike / drive), stay
  times and an itinerary with arrival times. Move stops between days, reorder, or
  press "Shortest route" for the quickest order of a day.
- **Routing for each day.** Road-based time and distance, the route on the map,
  and written step-by-step directions (OpenRouteService). Without a key, or if
  the service is down, labelled straight-line estimates are used.
- **Navigation hand-off.** Each leg links to live directions in Google Maps,
  Apple Maps or Amap (including public transit); a whole day opens as one
  Google Maps route (up to 11 stops).
- **Shareable, not stored.** The trip lives in your browser tab and in the page
  link (`/plan#p=…`). Nothing about it is saved on a server.
- **From links (`/links`).** Add saved TikTok / Instagram / Xiaohongshu posts.
  Each link is kept as the _source_; you paste the caption (or type place names).
  The AI picks place names out of that text (a name is dropped unless it is
  really written there), Geoapify finds where each is, and they appear on a map.
  You confirm each match, then add places to your trip.

### Share

- **Vote with friends.** "Create voting link" on the trip page. Companions enter
  a name (no sign-up) and vote Must go / Interested / Skip on each stop across
  all days, see live totals and who voted what, and the group ranking
  (2 × Must go + 1 × Interested − 1 × Skip). The organiser (private link) can
  update stops, close voting or delete the room. Rooms expire after 30 days.
- **Social posts, honestly.** Each place has a panel with buttons that open
  TikTok, Instagram and Xiaohongshu's own search, and links **visitors have
  shared** ("Seen on TikTok ×2"). There is no automatic "trending" data: none of
  the three offers a free, permitted source for it. Shared links must be a single
  real post on those sites, carry no free text, are rate limited, capped, can be
  reported (three different visitors hide one) and expire after 90 days.

## Limits you should know about

- **No ratings or reviews.** No free worldwide source exists. Places without an
  editor recommendation are ordered by how complete their data is, not quality.
- **Social platforms are not read.** Instagram's terms limit its embed data to
  displaying the post, and Xiaohongshu has no API. TikTok captions are read
  automatically only if you set `TIKTOK_OEMBED=1`, which is off by default:
  review TikTok's terms for that endpoint first. Text you paste is sent to OpenAI.
- Opening hours are shown as mapped and are **not** checked against a schedule.
- Travel times exclude traffic, waiting and public transit.
- Voting and shared-post links are unguessable but not private; names are not
  verified.
- A new destination costs six Geoapify requests (one per type) plus Wikivoyage,
  Wikidata and Commons lookups. Searches are cached for 12 hours (shared store)
  so repeat visits are free, but a free key limits how many new destinations you
  can search per day.
- Sights and parks from map data are listed only if they show some sign of being
  known (an encyclopedia entry, website or description), to avoid clutter.

## Run it

Requires Node 22.12+.

```sh
cp .env.example .env.local   # then add at least GEOAPIFY_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

| Variable                                                 | Needed?                                                   | What it does                                                  |
| -------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| `GEOAPIFY_API_KEY`                                       | **Yes**                                                   | Place search, autocomplete, finding places by name            |
| `ORS_API_KEY`                                            | No                                                        | Road-based travel times and "Shortest route" (else estimates) |
| `OPENAI_API_KEY`                                         | No                                                        | Condensing notes; finding place names in captions             |
| `OPENAI_MODEL`, `LLM_DAILY_CAP`                          | No                                                        | Model name and a daily call cap                               |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` (or `KV_REST_API_*`) | For voting, shared links and shared caching in production | Shared storage                                                |
| `COMMUNITY_POSTS`                                        | No                                                        | `0` switches off visitor-shared post links                    |
| `TIKTOK_OEMBED`                                          | No                                                        | `1` reads TikTok captions automatically (off by default)      |
| `WIKIMEDIA_CONTACT`                                      | No                                                        | Contact in the user-agent sent to Wikimedia                   |

Keys are read on the server only and never sent to the browser.

### First run

1. `npm install`, then `npm test` (no network needed).
2. In development open [`/api/status`](http://localhost:3000/api/status). It tests
   every service the app uses, including each of the six place types, and says
   which one fails and why (for example "key was rejected"). It never shows keys
   and is disabled in production.
3. Things not yet verified against the real packages: the `maplibre-gl` version
   range in `package.json`, the OpenRouteService URL paths, the exact Geoapify and
   OpenAI response fields, and the `./file.ts` import style under the bundler.
4. `npm run typecheck`, `npm run lint`, `npm run build`.

## Deploy (Vercel or AWS)

Everything except voting, shared links and shared caching works on any Node host
with no database. Those use a free [Upstash Redis](https://upstash.com) database
over plain HTTP, so it works the same on Vercel, AWS (Amplify, ECS, Lambda, EC2)
or anywhere else.

1. Create the database (on Vercel: Storage → Upstash Redis adds the variables).
2. Set the Redis variables plus your API keys on the host.
3. Without Redis in production, voting and shared links switch themselves off
   with a clear message instead of silently losing data.

## Structure

```text
src/app/                 pages: /, /explore, /plan, /links, /r/[id], /about
src/app/api/             suggest, route, extract, rooms, social, status
src/components/          search box, results, place card, map, trip, voting, links
src/lib/categories.ts    the six place types, filters, type guessing
src/lib/wikivoyage.ts    Wikivoyage listing parser + fetch
src/lib/geoapify.ts      Geoapify places, autocomplete, geocoding
src/lib/merge.ts         dedupe, match, score, build the "why go" reason
src/lib/explore.ts       one destination end to end, caching, widening
src/lib/listing.ts       what the results page shows for each filter
src/lib/images.ts        photos: Wikidata image, nearby Commons photo
src/lib/llm.ts           optional condensing + grounding check
src/lib/plan.ts          multi-day trip state and shareable-link encoding
src/lib/routing.ts       exact route ordering, estimates, schedule maths
src/lib/ors.ts           OpenRouteService + graceful fallback
src/lib/rooms.ts         voting rooms          src/lib/room-types.ts  vote maths
src/lib/social.ts        post-link checking, place keys, platform search links
src/lib/community.ts     shared post links: store, limits, reports
src/lib/extract.ts       "From links": names from text, grounding, locating
src/lib/store.ts         storage interface: Upstash Redis (REST) and in-memory
tests/                   node:test unit tests (run with `npm test`)
```

## Data sources and licences

- Recommendations: Wikivoyage, CC BY-SA 4.0 (attribution on every card).
- Place data: © OpenStreetMap contributors, ODbL, via Geoapify.
- Map tiles: OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors.
- Routing: OpenRouteService (HeiGIT), OpenStreetMap data.
- Photos: Wikimedia Commons; each links to its file page for author and licence.
