# WhereToVisit

A responsive web app with a small, source-backed Shanghai food/café shortlist. Visitors can browse six independently sourced branches and their attributed recommendations without an account. Prices, hours, ratings, operating status and coordinates remain unknown. Apple Maps links are explicitly address searches; exact map results/pins, reviews and live providers are unverified. Narrow licensed Wikivoyage listing imports are available with private operator configuration. Local organiser email/password accounts, durable private Shanghai Trips and invitation-based guest participation are available. Guests join explicitly without an account; organisers retain control. Guests can suggest Places, amend their own comments and vote Must go, Interested or Skip. Organisers review suggestions and choose final stops. Organisers can save one-day inputs and generate a grounded order of selected canonical branches; real travel timing and feasibility remain unresolved. Live provider matching and live in-app maps remain unavailable. Imported evidence can be compared with the bounded canonical shortlist, with explicit branch selection and user-confirmed provenance. Development can exercise an explicitly fictional map/list and area-search workflow.

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

`config:local` creates ignored `.env.local` with a fresh random secret and restrictive file permissions. It refuses to overwrite an existing file. `.env.example` contains placeholders only. Keep the secret private; never paste it into Git or logs. `DATABASE_PATH` controls the durable SQLite file, defaulting to `.data/wheretovisit.sqlite` in the example. Preserve the entire database directory, including WAL/SHM files. At `/trips`, create a local email/password account or sign in, then explicitly review and save a discovered or confirmed imported branch. Private Trip management stays with the organiser; invited guests can read the deliberately shared Trip information and contribute suggestions, comments and preferences. Email verification and password recovery are unavailable; no email is sent.

In a second terminal, start the requested front web server:

```sh
npm run nginx:check
npm run nginx:serve
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). Next runs on loopback port 3000; NGINX publishes only loopback port 8080. The first Docker command may download the pinned official NGINX 1.30.5 image. No global NGINX installation is needed. Stop the foreground proxy with Ctrl+C, or use `npm run nginx:stop` from another terminal. Stop Next with Ctrl+C. Direct Next development is also accessible at [http://127.0.0.1:3000](http://127.0.0.1:3000); set `BETTER_AUTH_URL` to that origin if developing auth without the proxy.

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
npm run test:import-transition
npm run test:day-plan-storage
```

The production suite starts the build on loopback 3100 behind NGINX on 8180, migrates an isolated database and loads the committed real batch. Its scenarios cover saved one-day inputs, grounded owner/guest day ordering, navigation, phone/desktop discovery and coverage, keyboard access, real filters, anonymous catalogue retrieval and real local organiser accounts saving/recovering canonical private Trips, and invitation-based guest sharing/revocation. Fixture flags and a development-source path are deliberately supplied in production to verify that they cannot replace the real catalogue; `/development` remains 404.

`test:catalogue` defines development browser/public HTTP scenarios through the same isolated ports with clearly fictional branch/source data. They verify synchronized map/list selection and reopening native source details when reselecting the same Place, explicit pan/zoom area searches with filters, clipping and outside coverage, missing/incompatible coordinates, delayed/reordered responses, reset supersession, map failure with list preservation, fixture isolation after a real publication and combined filters, explicit distance origins, unknown-data choices, keyboard details, unsupported cities, empty/reset and failed-request/retry recovery, multiple recommendations, distinct branches, missing values, dated optional claims/classification rules and atomic rejection of malformed, duplicate, wrong-city or private-field batches. The development-only `CATALOGUE_DEVELOPMENT_SOURCE` adapter loads an explicit local source file at query time. Deleting that source file leaves the last valid stored publication available, so a public query can verify that invalid input did not replace it. This adapter never runs in production, and production query operations reject stored fixture publications. Invitation scenarios additionally cover explicit join/browser return, distinct duplicate names, revocation/replacement, private-role denials, copy/write failure recovery and retained attribution. No test proves actual provider connectivity or venue operation. Leave 3100/8180 free, keep Docker running and run the suites sequentially. The suites use separate ignored databases and generated secrets; account scenarios create isolated local accounts and never use the developer database. Screenshots/traces are ignored under `test-results/`.

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

- `src/app/`: discovery/import/private Trip and guest invitation/shared Trip pages; public catalogue, browser-owned imports/save continuations, organiser-owned Trip/invitation and guest-scoped shared-read/collaboration HTTP operations; shared loading/error routes.
- `src/components/`: accessible operation-state and sourced-catalogue presentation.
- `src/shared/contracts.ts`: portable JSON Place/evidence, catalogue, Import, actor, Trip and Day-plan contracts. Missing facts stay null; coordinates carry their datum and origin.
- `src/server/`: authoritative catalogue/import/Trip/invitation/guest/collaboration operations, strict publication validation/load, server-only configuration, organiser authentication and lazy SQLite access.
- `drizzle/`: committed auth, catalogue, import, private Trip/save-intent and invitation/guest-session/collaboration SQL migrations and generated metadata.
- `data/catalogue/`: reviewed real publication, source citations, evidence limits and reproducible-load notes. Array order is the stable curated default; coverage is a six-branch initial batch.
- `src/development/`: explicitly fictional UI examples, separate from catalogue operations.
- `nginx/` and `scripts/nginx.mjs`: project-local reverse proxy configuration and pinned container lifecycle.
- `tests/`: agreed browser and bounded public HTTP smoke checks.

Enable `ENABLE_DEVELOPMENT_FIXTURES=1` in `.env.local` and restart `npm run dev` to inspect `/development`. That page says the examples are not real data. Production always rejects it with HTTP 404, even if the flag is set. Catalogue operations never import these UI examples. The separate development catalogue scenario uses its own explicitly configured fictional source file and isolated database.

Provider adapters belong on the server. Absent/unqualified integrations return typed unavailable outcomes; client views do not hold credentials or implement permissions. Organiser ownership and invitation-derived guest authority are enforced at the HTTP boundary. Live maps/provider matching and real timed routing remain gated; grounded one-day ordering is available. Public `/api/catalogue` accepts optional `city`, `category`, `budget`, `neighbourhood`, `recommendationType` and explicit distance parameters. Unknown or duplicate parameters return 400. Unsupported cities return a coverage message. Shared parsing/matching in `src/shared/discovery-query.ts` keeps future map consumers consistent. Catalogue JSON contains only validated public Place/evidence data, never private Trip state.

The proxy preserves the browser Host and forwarding origin, disables response buffering for Next streaming and forwards development WebSocket upgrade headers. It performs no caching. The launcher discovers Docker’s DNS resolver and restricts upstream lookup to IPv4; it does not hardcode a host gateway. See [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [NGINX proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [NGINX WebSockets](https://nginx.org/en/docs/http/websocket.html) and [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/). TLS, AWS provisioning, hosting costs, backups and public deployment remain later work.

## Discovery filters

Visitors can apply all filters together and reset to Shanghai. Curated source order is preserved. Category is `food` or `cafe`; neighbourhood matches a source-described area exactly. Recommendation type is `trending`, `local-favourite`, `highly-reviewed` or `unclassified`, using only evidenced classifications. The real catalogue is currently unclassified.

Budget is `low` (CNY 0–50), `mid` (over 50–150), `high` (over 150) or `unknown` (no price evidence). Amounts are source-reported prices, without assuming a per-person meal total. Known bands exclude absent prices and other currencies. The real catalogue has no price evidence.

Distance accepts `latitude`, `longitude`, `system` (`WGS-84` or `GCJ-02`) and `radiusMetres` (greater than zero, at most 100000), all together. It measures straight-line separation from that user-entered point, not travel distance or time. Only coordinates with the same qualified datum match; no conversion or device location is requested. `distance=unknown` selects missing coordinates and cannot be combined with an origin. The real catalogue has no coordinates, so a radius yields no results. Area search accepts `north`, `south`, `east`, `west` and `areaSystem` together. Bounds must be finite, valid latitude/longitude ranges with north greater than south and east greater than west; antimeridian areas are not supported. The bounded workflow envelope is WGS-84 south 30.7, north 31.6, west 120.9, east 122.0. This is not an administrative Shanghai boundary or exhaustive venue coverage. Queries intersect this envelope and every existing filter, retaining curated order. Valid GCJ-02 area requests return `coordinate-system-unsupported`; no conversion is performed. Results include requested bounds, actual searched intersection (or null), searched/clipped/outside-coverage outcome and missing/incompatible-coordinate count. The real catalogue has six unlocated branches, so area results are empty with an explicit explanation, not evidence of an empty neighbourhood.

Discover keeps one Place selection for list and map details, pending viewport separate from the last completed request, and older responses cannot replace newer filters/areas. Pan/zoom does not refresh results until Search this area. List, map and both-view controls work on phones; keyboard controls and the list avoid precision pin tapping. During refresh old cards/pins are hidden. Map failure preserves available list/details. Saving a branch requires explicit organiser review at `/trips`; discovery never directly changes saved Trip membership.

To exercise the fictional coordinate diagram, start development with `ENABLE_DEVELOPMENT_MAP_FIXTURE=1` and an explicitly configured fixture catalogue through `CATALOGUE_DEVELOPMENT_SOURCE` using isolated storage. The map requires both development mode and a current fixture publication; production ignores the flag, and real publications show Map unavailable. This diagram has no street tiles, provider connection or verified venue coordinates. Conditional Amap eligibility, permission/license/data rights, private credentials and live branch alignment remain gates; no Google substitute is introduced.

Each place opens its attributed source details with a keyboard-operable disclosure. External address searches retain branch context and are labelled searches. Full reviews and exact navigation remain unqualified. Loading and failed requests hide previous results; retry preserves the applied filters and reset removes them.

## Bounded article imports

`/import` accepts public English Wikivoyage article URLs with explicit plain Eat/Drink listing names. It returns unresolved Mentions with original wording, exact Unicode code-point spans, source revision/hash, attribution, contributor history and CC BY-SA4.0 links. It labels partial extraction when prose/unsupported structures or the20-name bound remain unanalysed. Empty supported Eat/Drink sections can finish no-place; prose-only or malformed structures are unsupported. It establishes no branch, current operation, rating, coordinates, Place, map pin or Trip. Social/video/general-blog, pasted text, uploads and model analysis remain unavailable.

Apply migrations, then privately set `IMPORTS_ENABLED=1` and `WIKIMEDIA_OPERATOR_CONTACT` to a real public operator email or HTTPS contact URL in `.env.local`; restart the local server. The contact goes to Wikimedia in the descriptive User-Agent. Do not invent it or commit it. With the switch off, imports explain integration-disabled. Without a valid contact, live access explains credentials-missing. No app credential, paid service, AI/model call or provider key is needed for this licensed subset.

Jobs persist in SQLite behind a32-byte random anonymous HttpOnly/SameSite=Lax session cookie (digest only on the server); on HTTPS production origins the cookie is Secure. Plain HTTP loopback is qualified only for local preview, not public deployment. Sessions expire absolutely after30days; job expiry cannot exceed its session. Temporary imports do not automatically create or attach an account-owned Trip. An explicit authenticated save separately retains confirmed provenance. Retry uses the same job identity, at most3explicit attempts and only retryable reasons; cancel prevents late result writes; delete removes the draft. Session ownership and matching Origin are checked for every mutation. Private/denied, unavailable/unknown cause, unsupported, invalid-response, rate/backoff, failed-extraction and no-place outcomes are distinct.

Authoritative defaults: one URL of at most2048characters and a4096-byte/5-second request body,50,000source code points,20mentions with280-code-point quotes,100queued/1,000retained jobs (at most20per session, all visible/deletable),10,000sessions, one processing job globally and at mostone active plus twoqueued per session. Limits are5accepted attempts/minute and20/day per session,40/minute and200/day per shared proxy IP,60/minute and1,000/day globally. Only one serial Wikimedia request stream runs; there is no automatic network retry. Processing has a45-second deadline and queued jobs expire after120seconds. On process restart, stale work becomes explicitly retryable rather than silently restarting a source request.

Every live fetch uses a constructed Action parse API endpoint on the exact HTTPS host. Article namespaces, credentials, nondefault ports, queries, rawIP/trailingdot hosts and ambiguous encodings are rejected. All DNS answers must classify public with maintained `ipaddr.js`; the connection uses frozen addresses, TLS hostname/SNI/certificate verification and actual peer checking. Direct HTTPS ignores environment proxies. Redirects are disabled; no subresources/media are fetched. DNS/TLS/body share a15-second deadline with5-second connection budget; both transfer and decoded body are bounded1MiB. Status, content type/compression, UTF-8, JSON/body errors and requested title/revision are checked. Provider Retry-After/maxlag backoff persists. These local controls are separate from a production network firewall; no public hosting/AWS egress policy has been provisioned or qualified.

Normalized full source text is used only in memory and deleted immediately after exact quote/hash/span validation. This tightens the earlier proposed24-hour upper bound. Only bounded original-text evidence remains; `sourceReplayAvailable=false` explicitly means a hash cannot reconstruct the source. Expired anonymous records are purged on the next application operation; stopped local storage is not an always-running retention service. A later public deployment must qualify storage cleanup/backups/egress separately.

`ENABLE_DEVELOPMENT_IMPORT_FIXTURE=1` affects only development and explicit `Fixture_*` article inputs. Authored responses pass the same external response/JSON validation and extraction; fixture provenance is visibly labelled and never attributed to real Wikivoyage contributors. Production ignores the flag. Development tests exercise anonymous isolation, safe URLs/redirect denial, exact evidence/idempotency, partial/empty/unsupported/private/unavailable results, invalid revision, retry/cancel/delete and rates through actualNGINX. Production additionally proves fixture injection cannot become an invented import result. These scenarios establish app behavior; the separately recorded single real-source runtime probe establishes licensed article retrieval only, not current venues or general article understanding.

Rejected unsafe/unsupported input retains only a redacted label and HMAC deduplication key, so credentials and private queries are not stored. Valid article fragments are discarded before persistence.

`test:import-transition` starts its own isolated Next3100/NGINX8180 processes and preserves one test database and anonymous cookie while switching from development to production. It verifies that completed, failed and queued fictional imports stay inaccessible to production reads, retries/cancellation/deletion, duplicate submission and worker processing. Fixture provenance is persisted from queue admission; stored fixture jobs are excluded unless explicit development fixture mode remains enabled. No real source fetch occurs. Run sequentially with other suites.


### Temporary branch resolution

`POST /api/imports/<id>/resolution` accepts `{ "action": "resolve" }` to retrieve zero/one/many candidates from the currently published canonical shortlist. NFKC, whitespace and case normalization compare display/local names; bounded chain prefixes retrieve separate branches. These names are clues only: every selection requires explicit user confirmation. An address, independently sourced identity evidence and a purpose-qualified provider reference must accompany a candidate. A qualified address-search reference remains a search, with no provider POI ID or coordinates implied. No broader live provider query, auto-verification, manual-name input or new Place publication occurs.

Confirmation accepts `{ "action": "confirm", "mentionId": "...", "candidateId": "..." }` for a specific returned branch. An outside-city candidate requires `acknowledgeOutsideCity: true` and never changes Shanghai discovery. Confirmations persist with their time and `independentVerification: false`, separately from canonical venue evidence/classifications. Resolve retries preserve confirmed identities. No-match means no eligible candidate in this bounded shortlist, not absence from the city. Unavailable data remains explicit and can be retried.

`GET /api/imports` includes `resolvedPlaces`: the initiating session's temporary confirmed Place snapshots merged by canonical identity, with each original source bundle, exact Mention extraction and user-confirmation provenance retained separately. Deletion or expiry removes that draft's evidence from the aggregate. This aggregate remains temporary; an explicit reviewed save copies applicable evidence into the organiser’s durable private Trip. Exact map inspection remains gated. Every resolution mutation enforces session ownership and application Origin. Real drafts reject fixture catalogue data; development fixture drafts and their candidates/confirmations remain excluded from production, including same-storage transitions.


Private Trip saves retain canonical branch evidence separately from imported source attribution, exact wording/revision/hash/span/license and user-selection provenance. Draft deletion/expiry does not delete saved evidence. The Shanghai city policy rejects out-of-city saves. Saved membership and future day-plan selection are separate; removal never deletes catalogue records. A pending save lasts15minutes and binds to the initiating browser and first authenticated organiser who reviews it; no Trip is saved automatically by authentication. Reviewed imported sources cannot be reassigned by switching accounts in that browser. A fresh import remains saveable: aggregation retains only provenance eligible for the reviewing account and protects the explicitly requested source, including pending saves prepared before sign-in. The dashboard waits for durable responses and offers retry after failures.

Fictional saved Trips and pending saves require development mode plus `ENABLE_DEVELOPMENT_TRIP_FIXTURE=1`; production ignores that flag and rejects their stored reads/mutations. Real and fictional membership cannot be mixed in one Trip. The storage transition suite verifies restored fixture Trip/evidence documents as well as imports after a development→production→development process change. Local auth rate limits use the library's memory storage; public release still requires qualified durable/distributed abuse controls, HTTPS, recovery and backup/restore operations.

## Invitations and guest access

At `/trips`, a signed-in organiser can create an invitation for the selected Trip, copy its link, disable it or replace it. The link is unpredictable and scoped to that Trip. Anyone holding it can forward it and explicitly join with a nonempty display name, without registration. Names are unverified; a separate opaque participant identity and visible Guest number distinguish duplicate names.

Joining shows the shared shortlist, selected Places, licensed source evidence and participant labels. Returning in the same browser resumes the same active participant without duplication, for up to30days from joining. Losing browser storage or an expired session can require rejoining through a current link. Guests cannot manage invitations, access private organiser account data or change final selections. Suggestions, own comment amendments, preferences, organiser one-day inputs and read-only generated day plans are available; real timing remains unresolved.

Disable/replace success is announced only after storage confirms it. These actions block old-link joins and end guest access derived from that invitation generation on subsequent requests, while retaining historical attribution and the organiser’s saved Trip. Changing a Trip between real and fixture data also permanently disables its previous invitation. Copy failures offer manual copying; failed requests offer explicit retry without claiming success.

Fixture invitations, participants and shared reads require development mode plus `ENABLE_DEVELOPMENT_TRIP_FIXTURE=1`. Production excludes them even when flags are supplied and preserves retained development data. Invitation and guest credentials stay server-controlled; the guest cookie is HttpOnly/SameSite=Lax with an absolute server expiry and Secure on HTTPS production origins. Plain HTTP loopback is qualified only for local preview. Public HTTPS, abuse controls, retention operations and deployment remain separate qualification.

## Group decisions

At a shared Trip, guests and the organiser can suggest a canonical branch or a bounded unresolved Place name, record Must go / Interested / Skip, clear to No vote, and add or amend their own Place-scoped comment. Names are unverified; Guest numbers distinguish duplicate names. Summaries count actual preferences without weights or automatic selection. Must go does not guarantee a planning stop; solo organiser selection works without votes.

Suggestions begin pending. Only the organiser accepts/rejects them. Accepted resolved canonical identities enter the shortlist once, keeping branches distinct; accepted unresolved requests remain unschedulable until the organiser explicitly chooses a canonical branch and address. A participant can amend only their own pending suggestion; a name amendment makes it unresolved again. Comments are one amendable text per actor/Place (1–1000 Unicode characters); unresolved names are1–120. These are bounded engineering defaults.

Every collaboration read/write checks current owner or generation-scoped guest authority and data-kind visibility. SQLite commits serialize updates; a participant’s latest committed vote/comment replaces their prior value. Each mutation requires an actor-scoped operationId: retrying the same payload returns current state without replaying it, and reusing that ID for another payload returns409. Known successful retries are checked before canonical catalogue lookups, so an outage or withdrawn branch cannot block them. Failed requests offer explicit retry with the captured operation, including a lost response after successful persistence. Limits per Trip/data kind are200suggestions (50peractor),2000comments and10000successful operation receipts; reaching them returns429 without changing existing data. Receipt/contribution state is retained with attribution and excluded with stored fixtures in production.

## Plan my day inputs

At `/trips`, the organiser selects confirmed saved branches and a Shanghai visit date, then explicitly saves a one-day draft. A solo organiser needs no votes. Start area/hotel, budget, dietary needs and pace can all be unset; walking/public transit is the default, with taxi/car as the alternative. Saved preferences are deliberately visible to invited guests. Dietary text records a preference and supplies no venue or allergy-safety verification.

The draft persists across reloads with the selected Shanghai calendar date unchanged by device timezone. Votes, shortlist and selected stops remain separate. Unresolved accepted suggestions need explicit canonical branch/address confirmation before selection. Changed selections or a data-kind transition make an earlier draft require review and a fresh save. Stale writes offer Reload day request; failed network/storage writes offer captured explicit retry and display the confirmed values after persistence. Guests and other owners cannot change inputs or final selections. Saving inputs alone does not generate a plan; the separate generation operation below proposes an order with unresolved real timings. Live qualification remains gated.

`npm run test:day-plan-storage` exercises retained fictional drafts/receipts through isolated development→production→opt-out-development→opt-in-development processes. It preserves stored fixtures, checks public denial/outcomes and uses no real provider/source calls. Run sequentially with the other NGINX8180/Next3100 suites.

## Grounded one-day generation

After selecting confirmed Shanghai shortlist branches, save the one-day request and choose Generate day plan. The current real catalogue has unknown opening hours and unqualified routes, so generated plans persist selected-place order with unresolved timing, mode-specific unavailable legs and explicit warnings. All selected Places remain accounted for; preferences do not establish affordability or allergy safety. Request/selection changes mark the old result for review. Guests see the saved result under current invitation authority and cannot generate it.

Owner GET/POST `/api/trips/<id>/generated-day-plan` uses current request/selection/plan revisions and retained operation receipts. Known identical retry returns the current result without replay; mismatched reuse or stale fresh generation returns409. A failed generation preserves saved inputs and the prior result. Future editing must participate in the same plan revision check before regeneration.

Development-only authored provider responses require a fixture Trip, `ENABLE_DEVELOPMENT_TRIP_FIXTURE=1`, `ENABLE_DEVELOPMENT_DAY_PLAN_FIXTURE=1` and `DAY_PLAN_DEVELOPMENT_SOURCE` pointing to a bounded local JSON response. They exercise dated mode-specific routes, hours, closed stops, assumed day capacity, unavailable legs and failure recovery. Production ignores this source even with flags. Fixture schedules label the 09:00–18:00 window and 30/45/60 minute dwell assumptions explicitly and retain structured hours/provenance separately. These scenarios qualify application behavior only; no real provider rights, coordinates, live routes or venue hours are established.
