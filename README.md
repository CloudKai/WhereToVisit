# WhereToVisit

Search any destination and see recommended cafés and restaurants, each with the
reason it is worth a visit, where that reason comes from, and the practical
details to check before you go.

**Status:** steps 1 and 2 of 3 are built (discovery with recommendation reasons,
then the map and day plan). Companion voting is step 3.

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
- **Day plan (`/plan`).** Tap "Add to my day" on up to 12 places. See them
  numbered on the map, reorder them, set how long you will stay at each, pick
  walk / bike / drive and a start time, and get an itinerary with arrival times
  and travel time between stops. "Shortest route" keeps your first stop and finds
  the quickest order for the rest (exact for up to 12 stops).
- **Navigation hand-off.** Each leg has links that open turn-by-turn directions
  in Google Maps, Apple Maps or Amap (including a public-transit link).
- **Shareable, not stored.** The plan lives in your browser tab and in the page
  link (`/plan#p=…`). Nothing is saved on a server.

There is no account, sign-in, saving or private Trip. See
[/about](src/app/about/page.tsx) for the user-facing explanation.

## Known limits

- No free worldwide source of ratings or reviews exists, so none are shown.
- Travel times come from OpenRouteService when `ORS_API_KEY` is set and the
  service answers; otherwise they are straight-line estimates and say so.
  They exclude traffic, waiting and public transit (use the Directions links).
- Opening hours are shown as mapped but are **not** checked against the
  schedule.
- Where Wikivoyage has no listing for an area, only the "nearby" list appears.
- Hours/addresses are community-mapped and can be wrong or missing.
- Photos appear only where Wikivoyage or OpenStreetMap link a Wikimedia Commons
  image; other cards use a coloured placeholder.
- Free API tiers are rate limited. Results are cached (24 h for upstream data,
  6 h per destination in memory), and the app degrades instead of failing when
  one source is down.

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
src/app/               pages (/, /explore, /plan, /about), /api/suggest, /api/route
src/components/        search box, place card, map, day-plan screen
tests/                 node:test unit tests
```

## Data sources and licences

- Recommendations: Wikivoyage, CC BY-SA 4.0 (attribution shown on every card).
- Place data: © OpenStreetMap contributors, ODbL, via Geoapify.
- Map tiles: OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors.
- Routing: OpenRouteService (HeiGIT), OpenStreetMap data.
- Photos: Wikimedia Commons, linked to each file's page for author and licence.
