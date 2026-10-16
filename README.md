# WhereToVisit

Search any destination and see recommended cafés and restaurants, each with the
reason it is worth a visit, where that reason comes from, and the practical
details to check before you go.

**Status:** step 1 of 3 (discovery and recommendation reasons). Map + day plan
is step 2; companion voting is step 3.

## What it does today

- **Worldwide destination search** with autocomplete (Geoapify), plus a set of
  popular starting cities.
- **Recommended places first.** Cafés and restaurants listed by
  [Wikivoyage](https://www.wikivoyage.org/) travel editors appear first, each
  with the editor's own description and a link to the article.
- **More places nearby** from OpenStreetMap, ordered by how complete their data
  is. These have *no* editorial recommendation and are labelled that way.
- **Honest about sources.** Every card says whether its text came from travel
  editors, OpenStreetMap contributors, or is only map data.
- **Optional AI condensing.** If `OPENAI_API_KEY` is set, long notes are
  shortened to one line. The model may only use the source text, output that
  adds a number or name is rejected, lines are tagged "AI-condensed", and the
  full note is one click away. The AI never chooses what is recommended.
- **Visit details:** address, hours (as mapped), phone, website, and links that
  open the place in Google Maps, Apple Maps, Amap or OpenStreetMap.

There is no account, sign-in, saving or private Trip. See
[/about](src/app/about/page.tsx) for the user-facing explanation.

## Known limits

- No free worldwide source of ratings or reviews exists, so none are shown.
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
npm test         # unit tests for parsing, merging, grounding (no network)
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
src/lib/maplinks.ts    keyless deep links to maps apps
src/app/               pages (/, /explore, /about) and /api/suggest
src/components/        search box, place card
tests/                 node:test unit tests
```

## Data sources and licences

- Recommendations: Wikivoyage, CC BY-SA 4.0 (attribution shown on every card).
- Place data: © OpenStreetMap contributors, ODbL, via Geoapify.
- Photos: Wikimedia Commons, linked to each file's page for author and licence.
