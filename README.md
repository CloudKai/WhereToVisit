# WhereToVisit

A responsive web app with a small, source-backed Shanghai food/café shortlist. Visitors can browse six independently sourced branches and their attributed recommendations without an account. Prices, hours, ratings, operating status and coordinates remain unknown. Apple Maps links are explicitly address searches; exact map results/pins, reviews and live providers are unverified. Imports, accounts, shared trips, live in-app maps and day planning remain unavailable. Development can exercise an explicitly fictional map/list and area-search workflow.

## Local startup

Use Node **22.23.2**, npm **10.9.8**, and a running **Docker Desktop** with the `docker` CLI on PATH. The NGINX workflow was validated on macOS arm64 with Docker Desktop 4.55.0 / Engine 29.1.3. It uses Docker Desktop's `host.docker.internal` host connection; another Docker runtime needs separate qualification.

```sh
nvm install
nvm use
npm ci
npm run config:local
npm run db:migrate
npm run catalogue:load
npm run dev
```

`config:local` creates ignored `.env.local` with a fresh random secret and restrictive file permissions. It refuses to overwrite an existing file. `.env.example` contains placeholders only. Keep the secret private; never paste it into Git or logs. `DATABASE_PATH` controls the durable SQLite file, defaulting to `.data/wheretovisit.sqlite` in the example. Preserve the entire database directory, including WAL/SHM files. Auth routes and sign-in are not implemented yet.

In a second terminal, start the requested front web server:

```sh
npm run nginx:check
npm run nginx:serve
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). Next runs on loopback port 3000; NGINX publishes only loopback port 8080. The first Docker command may download the pinned official NGINX 1.30.5 image. No global NGINX installation is needed. Stop the foreground proxy with Ctrl+C, or use `npm run nginx:stop` from another terminal. Stop Next with Ctrl+C. Direct Next development is also accessible at [http://127.0.0.1:3000](http://127.0.0.1:3000); set `BETTER_AUTH_URL` to that origin if developing future auth without the proxy.

For a local production run:

```sh
npm run build
npm run db:migrate
npm run catalogue:load
npm run start
# Second terminal:
npm run nginx:serve
```

The build requires no database or auth secret. SQLite connections open lazily at runtime. Apply checked-in SQL and explicitly load the reviewed catalogue publication before serving discovery; startup does not generate migrations or curate/load real data automatically. A missing database, migration or publication returns a truthful unavailable state. If catalogue storage is not ready, the operator should verify `DATABASE_PATH`, apply the local migrations and load the reviewed publication; visitors receive a simple unavailable message.

## Validation and maintenance

```sh
npm run typecheck
npm run lint
npm run build
npx --no-install playwright install chromium
npm run test:e2e
npm run test:catalogue
```

The production suite starts the build on loopback 3100 behind NGINX on 8180, migrates an isolated database and loads the committed real batch. Its three scenarios cover navigation, phone/desktop discovery and coverage, keyboard access, real filters and anonymous catalogue retrieval. Fixture flags and a development-source path are deliberately supplied in production to verify that they cannot replace the real catalogue; `/development` remains 404.

`test:catalogue` runs twelve development browser/public HTTP scenarios through the same isolated ports with clearly fictional branch/source data. They verify synchronized map/list selection and reopening native source details when reselecting the same Place, explicit pan/zoom area searches with filters, clipping and outside coverage, missing/incompatible coordinates, delayed/reordered responses, reset supersession, map failure with list preservation, fixture isolation after a real publication and combined filters, explicit distance origins, unknown-data choices, keyboard details, unsupported cities, empty/reset and failed-request/retry recovery, multiple recommendations, distinct branches, missing values, dated optional claims/classification rules and atomic rejection of malformed, duplicate, wrong-city or private-field batches. The development-only `CATALOGUE_DEVELOPMENT_SOURCE` adapter loads an explicit local source file at query time. Deleting that source file leaves the last valid stored publication available, so a public query can verify that invalid input did not replace it. This adapter never runs in production, and production query operations reject stored fixture publications. No test proves actual provider connectivity or venue operation. Leave 3100/8180 free, keep Docker running and run the suites sequentially. Both use separate ignored databases and generated secrets; they create no accounts and never use the developer database. Screenshots/traces are ignored under `test-results/`.

| Command | Purpose |
| --- | --- |
| `npm run format` | Format source with Biome |
| `npm run auth:schema` | Regenerate Better Auth's connection-free Drizzle schema; review changes |
| `npm run db:generate` | Generate versioned SQL from the schema; review before applying |
| `npm run db:migrate` | Load Next environment files, apply committed migrations, close SQLite |
| `npm run catalogue:load` | Validate and atomically load `data/catalogue/shanghai.json`; optional reviewed source-file argument |
| `npm run test:catalogue` | Run isolated fictional public catalogue scenarios in development |
| `npm run nginx:check` | Test project configuration with actual `nginx -t` |
| `npm run nginx:serve -- --port 8180 --upstream 3100` | Run a separate local proxy instance |
| `npm run nginx:stop -- --port 8180` | Stop that proxy instance |

The pinned Drizzle Kit dependency has a moderate advisory through its older esbuild development-server dependency. This project uses Drizzle Kit for schema generation and does not run that development server. The registry's suggested automatic fix downgrades the qualified toolchain; review a compatible update before introducing an esbuild serving workflow.

## Structure and boundaries

- `src/app/`: landing, Discover, Import and Trips pages; public `/api/catalogue` operation; shared loading/error routes.
- `src/components/`: accessible operation-state and sourced-catalogue presentation.
- `src/shared/contracts.ts`: portable JSON Place/evidence, catalogue, Import, actor, Trip and Day-plan contracts. Missing facts stay null; coordinates carry their datum and origin.
- `src/server/`: authoritative catalogue query, strict publication validation/load, server-only configuration, connection-free auth schema options and lazy SQLite access.
- `drizzle/`: generated, committed auth and atomic catalogue-publication SQL/migration metadata. No trip tables or account flows exist.
- `data/catalogue/`: reviewed real publication, source citations, evidence limits and reproducible-load notes. Array order is the stable curated default; coverage is a six-branch initial batch.
- `src/development/`: explicitly fictional UI examples, separate from catalogue operations.
- `nginx/` and `scripts/nginx.mjs`: project-local reverse proxy configuration and pinned container lifecycle.
- `tests/`: agreed browser and bounded public HTTP smoke checks.

Enable `ENABLE_DEVELOPMENT_FIXTURES=1` in `.env.local` and restart `npm run dev` to inspect `/development`. That page says the examples are not real data. Production always rejects it with HTTP 404, even if the flag is set. Catalogue operations never import these UI examples. The separate development catalogue scenario uses its own explicitly configured fictional source file and isolated database.

Provider adapters belong on the server. Absent/unqualified integrations return typed unavailable outcomes; client views do not hold credentials or implement permissions. Later specs qualify live maps and add import, organiser/guest authority and day-plan operations at those boundaries. Public `/api/catalogue` accepts optional `city`, `category`, `budget`, `neighbourhood`, `recommendationType` and explicit distance parameters. Unknown or duplicate parameters return 400. Unsupported cities return a coverage message. Shared parsing/matching in `src/shared/discovery-query.ts` keeps future map consumers consistent. Catalogue JSON contains only validated public Place/evidence data, never private Trip state.

The proxy preserves the browser Host and forwarding origin, disables response buffering for Next streaming and forwards development WebSocket upgrade headers. It performs no caching. The launcher discovers Docker’s DNS resolver and restricts upstream lookup to IPv4; it does not hardcode a host gateway. See [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [NGINX proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [NGINX WebSockets](https://nginx.org/en/docs/http/websocket.html) and [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/). TLS, AWS provisioning, hosting costs, backups and public deployment remain later work.

## Discovery filters

Visitors can apply all filters together and reset to Shanghai. Curated source order is preserved. Category is `food` or `cafe`; neighbourhood matches a source-described area exactly. Recommendation type is `trending`, `local-favourite`, `highly-reviewed` or `unclassified`, using only evidenced classifications. The real catalogue is currently unclassified.

Budget is `low` (CNY 0–50), `mid` (over 50–150), `high` (over 150) or `unknown` (no price evidence). Amounts are source-reported prices, without assuming a per-person meal total. Known bands exclude absent prices and other currencies. The real catalogue has no price evidence.

Distance accepts `latitude`, `longitude`, `system` (`WGS-84` or `GCJ-02`) and `radiusMetres` (greater than zero, at most 100000), all together. It measures straight-line separation from that user-entered point, not travel distance or time. Only coordinates with the same qualified datum match; no conversion or device location is requested. `distance=unknown` selects missing coordinates and cannot be combined with an origin. The real catalogue has no coordinates, so a radius yields no results. Area search accepts `north`, `south`, `east`, `west` and `areaSystem` together. Bounds must be finite, valid latitude/longitude ranges with north greater than south and east greater than west; antimeridian areas are not supported. The bounded workflow envelope is WGS-84 south 30.7, north 31.6, west 120.9, east 122.0. This is not an administrative Shanghai boundary or exhaustive venue coverage. Queries intersect this envelope and every existing filter, retaining curated order. Valid GCJ-02 area requests return `coordinate-system-unsupported`; no conversion is performed. Results include requested bounds, actual searched intersection (or null), searched/clipped/outside-coverage outcome and missing/incompatible-coordinate count. The real catalogue has six unlocated branches, so area results are empty with an explicit explanation, not evidence of an empty neighbourhood.

Discover keeps one Place selection for list and map details, pending viewport separate from the last completed request, and older responses cannot replace newer filters/areas. Pan/zoom does not refresh results until Search this area. List, map and both-view controls work on phones; keyboard controls and the list avoid precision pin tapping. During refresh old cards/pins are hidden. Map failure preserves available list/details. No saved-trip persistence or save success exists.

To exercise the fictional coordinate diagram, start development with `ENABLE_DEVELOPMENT_MAP_FIXTURE=1` and an explicitly configured fixture catalogue through `CATALOGUE_DEVELOPMENT_SOURCE` using isolated storage. The map requires both development mode and a current fixture publication; production ignores the flag, and real publications show Map unavailable. This diagram has no street tiles, provider connection or verified venue coordinates. Conditional Amap eligibility, permission/license/data rights, private credentials and live branch alignment remain gates; no Google substitute is introduced.

Each place opens its attributed source details with a keyboard-operable disclosure. External address searches retain branch context and are labelled searches. Full reviews and exact navigation remain unqualified. Loading and failed requests hide previous results; retry preserves the applied filters and reset removes them.
