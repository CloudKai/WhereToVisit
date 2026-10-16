# WhereToVisit

Search any destination and see recommended cafés and restaurants, each with the
reason it is worth a visit, where that reason comes from, and the practical
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

Rate limits and expiry live in Redis, so they hold across serverless instances.
Other in-memory caches (search results, AI condensing) are per instance.

## Run it

Requires Node 22.12+.

```sh
cp .env.example .env.local   # then add at least GEOAPIFY_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

Keys are read on the server only and never sent to the browser.

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
