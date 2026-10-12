# WhereToVisit

A responsive web app with a small, source-backed Shanghai food/café shortlist. Visitors can browse six independently sourced branches and their attributed recommendations without an account. Prices, hours, ratings, operating status and coordinates remain unknown. Apple Maps links are explicitly address searches; exact map results/pins, reviews and live providers are unverified. Imports, accounts, shared trips, filters, in-app maps and day planning remain unavailable.

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

The build requires no database or auth secret. SQLite connections open lazily at runtime. Apply checked-in SQL and explicitly load the reviewed catalogue publication before serving discovery; startup does not generate migrations or curate/load real data automatically. A missing database, migration or publication returns a truthful unavailable state.

## Validation and maintenance

```sh
npm run typecheck
npm run lint
npm run build
npx --no-install playwright install chromium
npm run test:e2e
npm run test:catalogue
```

The production suite starts the build on loopback 3100 behind NGINX on 8180, migrates an isolated database and loads the committed real batch. Its three scenarios cover navigation, phone/desktop evidence/coverage, keyboard access and anonymous catalogue retrieval. Fixture flags and a development-source path are deliberately supplied in production to verify that they cannot replace the real catalogue; `/development` remains 404.

`test:catalogue` runs three development browser/public HTTP scenarios through the same isolated ports with clearly fictional branch/source data. They verify multiple recommendations, distinct branches, missing values, dated optional claims/classification rules and atomic rejection of malformed, duplicate, wrong-city or private-field batches. The development-only `CATALOGUE_DEVELOPMENT_SOURCE` adapter loads an explicit local source file at query time. Deleting that source file leaves the last valid stored publication available, so a public query can verify that invalid input did not replace it. This adapter never runs in production, and production query operations reject stored fixture publications. No test proves actual provider connectivity or venue operation. Leave 3100/8180 free, keep Docker running and run the suites sequentially. Both use separate ignored databases and generated secrets; they create no accounts and never use the developer database. Screenshots/traces are ignored under `test-results/`.

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

Provider adapters belong on the server. Absent/unqualified integrations return typed unavailable outcomes; client views do not hold credentials or implement permissions. Later specs add richer discovery, maps, import, organiser/guest authority and day-plan operations at those boundaries. Public `/api/catalogue` accepts only a single optional `city`; unsupported filters are rejected rather than silently ignored. Catalogue JSON contains only validated public Place/evidence data, never private Trip state.

The proxy preserves the browser Host and forwarding origin, disables response buffering for Next streaming and forwards development WebSocket upgrade headers. It performs no caching. The launcher discovers Docker’s DNS resolver and restricts upstream lookup to IPv4; it does not hardcode a host gateway. See [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [NGINX proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [NGINX WebSockets](https://nginx.org/en/docs/http/websocket.html) and [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/). TLS, AWS provisioning, hosting costs, backups and public deployment remain later work.
