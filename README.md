# WhereToVisit

A responsive web foundation for discovering Shanghai food and cafés, bringing travel inspiration into a trip, and choosing a day out together. Discovery, imports, accounts, shared trips and day planning are still unavailable. No real catalogue, provider data or recommendations ship with this foundation.

## Local startup

Use Node **22.23.2**, npm **10.9.8**, and a running **Docker Desktop** with the `docker` CLI on PATH. The NGINX workflow was validated on macOS arm64 with Docker Desktop 4.55.0 / Engine 29.1.3. It uses Docker Desktop's `host.docker.internal` host connection; another Docker runtime needs separate qualification.

```sh
nvm install
nvm use
npm ci
npm run config:local
npm run db:migrate
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
npm run start
# Second terminal:
npm run nginx:serve
```

The build requires no database or auth secret. SQLite connections open lazily at runtime. Apply checked-in SQL before serving future data operations; startup does not generate or apply migrations automatically.

## Validation and maintenance

```sh
npm run typecheck
npm run lint
npm run build
npx --no-install playwright install chromium
npm run test:e2e
```

The three smoke scenarios start the actual production build on loopback 3100 and NGINX on loopback 8180. Leave those ports free and keep Docker running. They exercise phone/desktop navigation, keyboard access, truthful unavailable discovery and the public catalogue/fixture isolation boundary. The suite intentionally enables the fixture flag in production and verifies that examples remain inaccessible. It creates no accounts and never uses the local database. Screenshots/traces are ignored under `test-results/`. Real providers and deployed reachability require separate qualification.

| Command | Purpose |
| --- | --- |
| `npm run format` | Format source with Biome |
| `npm run auth:schema` | Regenerate Better Auth's connection-free Drizzle schema; review changes |
| `npm run db:generate` | Generate versioned SQL from the schema; review before applying |
| `npm run db:migrate` | Load Next environment files, apply committed migrations, close SQLite |
| `npm run nginx:check` | Test project configuration with actual `nginx -t` |
| `npm run nginx:serve -- --port 8180 --upstream 3100` | Run a separate local proxy instance |
| `npm run nginx:stop -- --port 8180` | Stop that proxy instance |

The pinned Drizzle Kit dependency has a moderate advisory through its older esbuild development-server dependency. This project uses Drizzle Kit for schema generation and does not run that development server. The registry's suggested automatic fix downgrades the qualified toolchain; review a compatible update before introducing an esbuild serving workflow.

## Structure and boundaries

- `src/app/`: landing, Discover, Import and Trips pages; public `/api/catalogue` operation; shared loading/error routes.
- `src/components/`: accessible operation-state presentation.
- `src/shared/contracts.ts`: portable JSON Place/evidence, catalogue, Import, actor, Trip and Day-plan contracts. Missing facts stay null; coordinates carry their datum and origin.
- `src/server/`: authoritative catalogue operation, injectable provider interface, server-only configuration, connection-free auth schema options and lazy SQLite access.
- `drizzle/`: generated, committed auth-only SQL and migration metadata. No trip/place tables or account flows are implemented yet.
- `src/development/`: explicitly fictional UI examples, separate from catalogue operations.
- `nginx/` and `scripts/nginx.mjs`: project-local reverse proxy configuration and pinned container lifecycle.
- `tests/`: agreed browser and bounded public HTTP smoke checks.

Enable `ENABLE_DEVELOPMENT_FIXTURES=1` in `.env.local` and restart `npm run dev` to inspect `/development`. That page says the examples are not real data. Production always rejects it with HTTP 404, even if the flag is set. Catalogue operations never import these examples.

Provider adapters belong on the server. Absent/unqualified integrations return typed unavailable outcomes; client views do not hold credentials or implement permissions. Later specs add real catalogue, import, organiser/guest authority and day-plan operations at those boundaries.

The proxy preserves the browser Host and forwarding origin, disables response buffering for Next streaming and forwards development WebSocket upgrade headers. It performs no caching. The launcher discovers Docker’s DNS resolver and restricts upstream lookup to IPv4; it does not hardcode a host gateway. See [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [NGINX proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [NGINX WebSockets](https://nginx.org/en/docs/http/websocket.html) and [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/). TLS, AWS provisioning, hosting costs, backups and public deployment remain later work.
