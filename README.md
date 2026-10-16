# WhereToVisit

Search any destination and see recommended restaurants, cafés, malls and
shopping, attractions, museums and parks, each with the reason it is worth a visit, where that reason comes from, and the practical
details to check before you go.

**Status:** all three planned steps are built: discovery with recommendation
reasons, the map and multi-day routing, and companion voting.

## What it does today

- **Worldwide destination search** with autocomplete (Geoapify), plus a set of
  popular starting cities.
- **Recommended places first.** Cafés and restaurants listed by
  [Wikivoyage](https://www.wikivoyage.org/) travel editors appear first, each
  with the editor's own description and a link to the article.
- **More places nearby** from OpenStreetMap, ordered by how complete their data
  is. These have _no_ editorial recommendation and are labelled that way.
- **Honest about sources.** Every card says whether its text came from travel
  editors, OpenStreetMap contributors, or is only map data.
- **Optional AI condensing.** If `OPENAI_API_KEY` is set, long notes are
  shortened to one line. The model may only use the source text, output that
  adds a number or name is rejected, lines are tagged "AI-condensed", and the
  full note is one click away. The AI never chooses what is recommended.
- **Filters for every kind of place.** All · Food & drink · Cafés · Restaurants ·
  Malls & shopping · Attractions · Museums & culture · Parks & nature, each with a
  count. "All" shows the best of each type (14 places to eat: 6 cafés and 8 restaurants); choose a type to see the top 15, then "Show more" for the rest. Editor
  picks come from Wikivoyage's Eat, Drink, See, Do and Buy listings.
- **Never empty-handed.** If a city search finds fewer than 10 places to eat, it
  automatically searches again out to 10 km and tells you it did. A map area you
  chose yourself is never widened.
- **Instant filters.** All places for a search are delivered once, so choosing a
  type filters the list and map in the browser with no new request.
- **Search this area.** Move or zoom the map, then press "Search this area" (like
  Google Maps) to rebuild the list for exactly what is on screen — editor picks
  first, then the best-documented nearby places, with the same type filters. Areas
  up to about 20 km across can be searched; wider views ask you to zoom in. The
  searched rectangle is in the page link, so it can be bookmarked and shared.
- **Photos where a trustworthy free one exists.** A place's own Wikidata /
  Wikivoyage image, or (for sights, parks, museums and malls) a Wikimedia Commons
  photo geotagged at the spot, labelled "Photo taken nearby" when it isn't clearly
  that place. Shops and cafés mostly have no free photo and show an icon.
- **Visit details:** address, hours (as mapped), phone, website, and links that
  open the place in Google Maps, Apple Maps, Amap or OpenStreetMap.

- **Map.** Every results page shows the places on an interactive map
  (MapLibre + free OpenFreeMap tiles, no key). Clicking a pin jumps to its card.
- **Multi-day trips (`/plan`).** Tap "Add to my trip" on places, then organise
  them into days (up to 10 days, 12 stops per day, 40 in total). Each day has
  its own map, start time, travel mode (walk / bike / drive), stay times and
  itinerary with arrival times and travel time between stops. Move a stop to
  another day, reorder within a day, or let "Shortest route" find the quickest
  order for the day (it keeps your first stop; exact for up to 12 stops).
- **Routing for each day.** Roads-based times, distance and the route drawn on
  that day's map, with written step-by-step directions for each leg when the
  routing service provides them.
- **Navigation hand-off.** Each leg has links that open live turn-by-turn
  directions in Google Maps, Apple Maps or Amap (including a public-transit
  link), and each day can open as one multi-stop route in Google Maps (up to 11
  stops).
- **Shareable, not stored.** The whole trip lives in your browser tab and in the
  page link (`/plan#p=…`). Nothing is saved on a server. Links made by earlier
  single-day versions still open.

- **Vote with friends.** On the trip page, "Create voting link" gives a link for
  companions. They enter a display name (no sign-up) and vote Must go /
  Interested / Skip on each stop, see live totals and who voted what, and the
  group ranking (2 × Must go + 1 × Interested − 1 × Skip). The organiser can
  update the stops, close voting or delete the room, using a private organiser
  link kept in their browser. Rooms expire after 30 days of inactivity.

There is no account, sign-in, saving or private Trip. See
[/about](src/app/about/page.tsx) for the user-facing explanation.

## Known limits

- No free worldwide source of ratings or reviews exists, so none are shown.
- Travel times come from OpenRouteService when `ORS_API_KEY` is set and the
  service answers; otherwise they are straight-line estimates and say so.
  They exclude traffic, waiting and public transit (use the Directions links).
- Voting links are unguessable but not private: anyone holding one can vote and
  see names, and display names are not verified. The organiser can close or
  delete the room.
- Opening hours are shown as mapped but are **not** checked against the
  schedule.
- Where Wikivoyage has no listing for an area, only the "nearby" list appears.
- Hours/addresses are community-mapped and can be wrong or missing.
- Photos appear only where Wikivoyage or OpenStreetMap link a Wikimedia Commons
  image; other cards use a coloured placeholder.
- A new destination makes one Geoapify request per type (six), plus Wikivoyage,
  Wikidata and Commons lookups for photos. Results are cached for 24 hours, so
  repeat visits are free, but a free key allows only a limited number of new
  destinations per day.
- Sights and parks from map data are only listed when they show some sign of
  being known (an encyclopedia entry, website or description), to avoid clutter.
- Free API tiers are rate limited. Results are cached (24 h for upstream data,
  6 h per destination in memory), and the app degrades instead of failing when
  one source is down.

## Deploying (Vercel or AWS)

Everything except voting works on any Node host with no database. Voting needs
shared storage, because votes from several phones must land in one place. The app
uses a free [Upstash Redis](https://upstash.com) database over plain HTTP, so it
works the same on Vercel, AWS (Amplify, ECS, Lambda, EC2) or anywhere else.

1. Create the database (on Vercel: Storage → Upstash Redis, which adds the
   variables for you).
2. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or Vercel's
   `KV_REST_API_URL` / `KV_REST_API_TOKEN`) plus your API keys on the host.
3. Without these in production, voting is disabled with a clear message rather
   than silently losing votes. Check the Upstash free-tier limits for your use.

Rate limits, expiry and the search-result cache live in Redis, so they hold
across serverless instances. Finished searches are stored for 12 hours, so the
second visitor to a destination costs no API calls at all. Without Redis the same
cache is kept per server process.
Other in-memory caches (AI condensing) are per instance.

## Run it

Requires Node 22.12+.

```sh
cp .env.example .env.local   # then add at least GEOAPIFY_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

Keys are read on the server only and never sent to the browser.

**Something not working?** In development, open
[`/api/status`](http://localhost:3000/api/status). It tests each service
(Geoapify, Wikivoyage, OpenRouteService, OpenAI, voting storage) and says which
one is failing and why, for example "key was rejected". It never shows your keys
and is disabled in production.

If live suggestions fail, pressing Enter in the search box falls back to
OpenStreetMap's free geocoder (one search per Enter, never while typing, as its
usage policy requires), so any city can still be found.

```sh
npm test         # unit tests for parsing, merging, routing, plan links (no network)
npm run typecheck
npm run lint
npm run build
```

## Structure

```text
src/lib/wikivoyage.ts  Wikivoyage listing parser + fetch
src/lib/geoapify.ts    Geoapify places + autocomplete, normalisation
src/lib/merge.ts       dedupe, match, score, build the "why go" reason
src/lib/llm.ts         optional condensing + grounding check
src/lib/explore.ts     orchestrates the above for one destination
src/lib/destination.ts validated URL parameters, popular destinations
src/lib/maplinks.ts    keyless deep links to maps apps (places and directions)
src/lib/routing.ts     route ordering (exact solver), estimates, schedule maths
src/lib/ors.ts         OpenRouteService matrix/directions + graceful fallback
src/lib/plan.ts        day-plan state and shareable-link encoding
src/lib/rooms.ts       voting rooms: create, vote, owner actions, rate limits
src/lib/room-types.ts  vote types, tallies, name rules (shared with the browser)
src/lib/store.ts       storage interface: Upstash Redis (REST) and in-memory
src/app/               pages (/, /explore, /plan, /r/[id], /about) and API routes
src/components/        search box, place card, map, day-plan screen
tests/                 node:test unit tests
```

## Data sources and licences

- Recommendations: Wikivoyage, CC BY-SA 4.0 (attribution shown on every card).
- Place data: © OpenStreetMap contributors, ODbL, via Geoapify.
- Map tiles: OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors.
- Routing: OpenRouteService (HeiGIT), OpenStreetMap data.
- Photos: Wikimedia Commons, linked to each file's page for author and licence.
