---
ticket: gated-upload-auth
stage: research
mode: standard          # single workflow form — no other modes (ADR-011)
status: complete        # not_started | in_progress | blocked | complete
owner: ai_agent
updated: 2026-07-29
links:
  clickup:
  github:
---

# Research — gated-upload-auth

> Read-only phase. **No implementation is allowed in this command.**

## Goal

Replace the single shared `API_KEY` as the upload authority with a two-stage,
per-user ticket flow on new `/gated/*` routes, and harden the existing upload and
delivery paths (folder validation, server-generated keys, byte-sniffed types, safe
content disposition, debug-page removal) — without breaking the current consumers.

Source of the request: `2026-07-29-media-upload-authorization-design.md` (D1–D30).
Gateway contract it depends on: `GO-ME-API-CONTRACT.md`. Both live in this repo.

## Relevant directories

- `src/api/` — the four route groups registered by `buildApp()`
  (`upload.js`, `transform.js`, `stats.js`, `files.js`). The two new route files
  (`ticket.js`, `gatedUpload.js`) belong here, and three of the four existing
  files change.
- `src/services/` — the new `ticketService.js` lands here next to
  `cacheService.js`, `lockService.js`, `videoQueue.js`, `videoJobs.js`,
  `videoPreprocessor.js`, `storyVideoService.js`. Four of these are protected
  paths; two (`videoQueue.js`, `videoJobs.js`) carry the D24 attribution.
- `src/middleware/` — `auth.js` (the global `preHandler` allowlist; **protected**)
  and `metrics.js`.
- `src/storage/` — `s3Client.js` (**protected**). `putObject` and `uploadStream`
  both need the optional `metadata` argument for D22.
- `src/processors/` — `videoProcessor.js` (`probeMedia`, `extractSnapshot`) and
  `imageProcessor.js`. Every video helper takes a **buffer**, which is what forces
  D29 to move poster work to the worker once the upload streams.
- `src/utils/` — `mediaProbe.js` (`isWebPlayable`), `paramParser.js`
  (**protected**), `hashGenerator.js` (**protected**).
- `src/scripts/` — `fetch-and-upload.js` is marked for deletion (D8/§5); the other
  scripts (`migrate-cloudinary.js`, `preprocess-videos.js`) are untouched.
- Repository root — `test.html`, `compare.html`, `stats.html` are deleted by D8.
  They are **not** only source files: the `Dockerfile` copies all three by name.
- `_specs/gated-upload-auth/` — this ticket's own artifacts.

## Relevant config files

- `.claude/project-config.yaml` — defines `protected_paths`. **Seven** files this
  ticket is likely to touch are on that list and must therefore be named in
  `plan.md > Files to change` (GU-2 / IM-5):
  `src/middleware/auth.js`, `src/app.js`, `src/storage/s3Client.js`,
  `src/config/env.js`, `src/services/lockService.js`, `Dockerfile`,
  `docker-compose.prod.yml`. The design's §5 note names only the first three.
  It also defines the single `standard` validation profile (check `syntax`).
- `package.json` — dependencies and the run scripts. Two facts matter: there is
  **no byte-sniffing library** (only `mime-types`, which maps names, not bytes),
  and the scripts `fetch-video` / `fetch-video:story` point at
  `src/scripts/fetch-and-upload.js`, the file D8 deletes.
- `Dockerfile` (**protected**) — `FROM node:22-alpine`, and line 34
  `COPY test.html compare.html stats.html ./`. Node 22 means global `fetch` and
  `AbortSignal.timeout` are available, so the D6 gateway call needs no new
  dependency (`src/api/stats.js:60-63` already uses both).
- `docker-compose.yml` / `docker-compose.prod.yml` (prod is **protected**) — the
  runtime topology, port mapping `4001:3000`, env wiring, and the Loki logging
  driver.
- `.env.development` / `.env.production` — hold `API_KEY`, `REDIS_URL`, the size
  and rate-limit knobs. Neither currently defines a **gateway base URL**, a
  **timeout**, `CORS_ORIGIN`, or `TRUST_PROXY`. `src/config/env.js` (**protected**)
  loads `.env.<NODE_ENV>` then `.env` with `override: false`.
- Documentation that publishes the current auth scheme: `README.md:348`,
  `SETUP.md:128-142`, `USER_GUIDE.md` (six `x-api-key` examples). None is listed
  in the design's scope.

## Possibly affected services

- **Auth middleware** — `src/middleware/auth.js:1-24`. Today it allowlists
  `/metrics`, `/health`, `/test*`, `/compare*`, `/stats*`, `OPTIONS`, and any URL
  containing `/media|image|video|file/upload/`, then compares `x-api-key` to
  `API_KEY`. `/gated/*` must be recognised here, and the debug-page entries become
  dead once D8 removes the routes.
- **Upload route** — `src/api/upload.js`. Buffers every file (`:154`, `:296`,
  `:304`), enforces 10 MB per type (`:20-23`), derives the extension from the
  client filename (`:36-43`), interpolates `folder` into the key with **no**
  traversal guard (`:54-56`), and names the object `Date.now()+Math.random()`
  (`:53`). Video uploads probe, build snapshot + webp poster inline, add an
  instant variant when `isWebPlayable` is false, then enqueue (`:207-254`).
- **Files route** — `src/api/files.js`. Already has the two pieces the media route
  lacks: a folder guard (`:133-142`) and a **streaming magic-byte validator**
  (`:74-101`) that verifies the container as bytes flow to S3. This is the working
  model for D19/D20/D21. `GET /file/upload/*` (`:282-321`) is public today.
- **Delivery route** — `src/api/transform.js`. `setImageDeliveryHeaders`
  (`:57-62`) sets `Content-Disposition: inline` unconditionally; `sendOriginal`
  (`:861-886`) replays the stored `ContentType`; the `f_svg` passthrough is at
  `:400-402`. The byte-target fallback path (`:620-665`) already serves the
  instant variant or the original and enqueues — this is what makes D29 safe.
- **Storage** — `src/storage/s3Client.js:70-104`. `putObject` (buffer) and
  `uploadStream` (multipart, memory-flat, `leavePartsOnError: false`) — neither
  writes user metadata today.
- **Video queue and worker** — `src/services/videoQueue.js` (job payload is
  `{originalKey, relativePath, story}`, `jobId: originalKey`, 3 attempts, failures
  kept 24 h), `src/worker.js:56` (destructures exactly those three fields),
  `src/services/videoJobs.js` (re-reads the original from S3, writes preview/full
  or the two story variants). D24 adds three fields through all three.
- **Redis / locking** — `src/services/lockService.js`. `initRedis()` is
  fire-and-forget and `redisAvailable` is a module-level flag; `acquireLock`
  **falls back to an in-memory Map** (`:61-87`). D12 forbids copying that pattern.
  There is no exported health probe today.
- **Rate limiting** — `src/app.js:156-179`. One global limiter, `keyGenerator`
  returns `k:<apiKey>` or `ip:<ip>`; per-route overrides exist already
  (`uploadRateLimit`, `bulkUploadRateLimit`, `excelRateLimit`).
  `trustProxy: process.env.TRUST_PROXY !== "false"` (`:108`) — effectively `true`.
- **CORS** — `src/app.js:149-154`. `allowedHeaders: ["Content-Type", "X-API-Key",
  "Range"]`; origin defaults to `true` (allow all) because `CORS_ORIGIN` is unset.
- **Stats / observability** — `src/api/stats.js` serves the dashboard with the key
  injected (`:107-108`) and proxies LogQL. Deleting it removes both. Logging
  (`src/app.js:188-237`) merges `request._logExtra` into one line per request and
  redacts `x-api-key` / `authorization` (`:90-92`) — the D23 contact fields are
  deliberately **not** redacted.

## Test / validation commands available

Listed, not run. There is **no test runner, linter, formatter or build step** in
this repository.

- `bash -c 'find src -name "*.js" -print0 | xargs -0 -n1 node --check'` — the
  `syntax` check defined in `project-config.yaml > validation_checks`; the only
  deterministic, non-interactive, read-only signal available. It is the whole of
  the `standard` validation profile.
- `node --check <file>` — same check for one file.
- `npm run dev` / `npm start` — boot the API (manual smoke only, not deterministic).
- `npm run worker` — the BullMQ worker; **required** for polished variants, and
  more so after D29 moves poster generation there.
- `docker compose up` — local MinIO + Redis + Loki + Grafana, app on `:3000`.
- `npm run preprocess-videos:dry` — lists variant backfill work without writing.
- Manual request checks with `curl` against a running instance (status codes for
  401/403/413/503, `Content-Disposition` on delivery, ticket single-use).
- `docker build .` — proves the image still builds after files are deleted.

## Risks and unknowns

- **Deleting the three HTML pages breaks the Docker build.** `Dockerfile:34`
  copies `test.html compare.html stats.html` by name; a `COPY` of a missing file
  fails the build. `Dockerfile` is a **protected path**. The design's §5 scope list
  does not mention it. Impact: high (deploy stops); likelihood: certain.
- **Deleting `src/scripts/fetch-and-upload.js` breaks two npm scripts.**
  `package.json` still declares `fetch-video` and `fetch-video:story`. Impact:
  low; likelihood: certain. `package.json` is not in the design's scope list.
- **CORS conflicts with the parallel-route promise.** D26 removes `X-API-Key`
  from `allowedHeaders`, but D1/D2 keep the legacy routes live until the cutover.
  Any browser consumer still calling a legacy upload route cross-origin would be
  blocked by the preflight the moment D26 lands — the exact breakage D1 exists to
  avoid. Impact: high; likelihood: high if any consumer is browser-side.
- **Byte sniffing has no library here.** `mime-types` maps names, not bytes.
  Sniffing must either be hand-rolled (the `files.js:74-101` pattern) or added as
  a dependency — and the popular `file-type` package is ESM-only while this
  codebase is CommonJS (`require`), so it cannot simply be required.
- **Streaming and size enforcement pull against each other.** D18 forbids
  buffering, so the 100 MB limit (D10 → 413) has to be counted as bytes pass, and
  the sniffed extension has to be decided from the **first** chunks before the key
  is known. `files.js` shows both are possible, but the ordering is delicate: the
  S3 key is chosen before the upload starts.
- **Moving the duration check to the worker changes a user-visible behaviour.**
  Today an over-long video is rejected with 400 and never enqueued
  (`upload.js:214-218`). After D29 the original is already stored when the worker
  finds it too long, so the request cannot report it. Whether the stored object is
  deleted, kept, or flagged is not stated anywhere.
- **`GETDEL` needs Redis ≥ 6.2.** The deployed Redis version is not pinned in this
  repository (`REDIS_URL` points at an external instance in production). If it is
  older, D13's atomic single-use redemption silently has no command.
- **Adding Redis to `/health` can restart the container.** `/health` is the
  Docker health probe; making it fail when Redis is down changes it from a
  liveness signal into a dependency signal.
- **Narrowing `trustProxy` changes `request.ip` everywhere**, not just for the new
  routes — it feeds the existing rate-limit key, every log line, and
  `files.js:156-162` (`buildAbsoluteUrl` relies on `request.protocol`, which
  honours `X-Forwarded-Proto` only while proxies are trusted).
- **Removing `api/stats.js` removes the only in-repo log dashboard** and its Loki
  proxy. Any Grafana dashboard or bookmark pointing at `/stats` stops working.
- **Attribution rides a deduped job id.** `videoQueue.js:7` uses
  `jobId: originalKey`. Keys are unique per upload, so collapsing is harmless
  today — but a re-enqueue from the delivery path (`transform.js:635`) carries
  **no** ticket, so those jobs must be allowed to have empty attribution rather
  than fail.
- **Hardening the legacy routes changes their stored objects** (UUID names,
  sniffed extensions). Old objects keep their old keys; only new uploads differ.
  Consumers that infer anything from the generated filename shape would notice.
- **Public documentation still teaches `x-api-key`** (`README.md`, `SETUP.md`,
  `USER_GUIDE.md`). Left untouched, the repo documents an auth scheme that the
  new routes reject.
- **`/gated/*` is not in the auth allowlist and has no `x-api-key`**, so with
  today's `authHook` every gated request would be rejected before its handler
  runs. The allowlist edit is on a protected path and is a prerequisite, not a
  detail.
- **Redis becomes a hard dependency for uploading** (D12). Today an upload
  succeeds with Redis down (locks degrade, enqueue warns). After this change a
  Redis outage stops all gated uploads with 503. That is intended, but it is a new
  and larger blast radius for one dependency.

## Open questions

> Give each question a stable ID (`OQ-1`, `OQ-2`, …). `spec.md` must record an
> answer for every one of them (SP-9) — an answer given only in chat does not
> count. A question about touching `protected_paths` is answered by putting the
> path in scope (then `plan.md > Files to change`) or by putting it Out of Scope.

| ID | Question | Why it matters |
|------|----------|----------------|
| OQ-1 | Is the cutover (delete `API_KEY`, the legacy upload routes, `GET /file/upload/*`) **out of scope** for this ticket, as `intake.md` records and the design's §8 `SEPERATE-TASK` marker says? | It decides whether this ticket can ever be verified and closed. If it is in scope, the ticket blocks on three external consumers migrating. |
| OQ-2 | Is `Dockerfile` in scope? Deleting the three HTML pages makes `COPY test.html compare.html stats.html ./` fail, so the image stops building. | It is a `protected_paths` file: unless it is named in `plan.md > Files to change`, `/implement` must refuse to touch it (GU-2/IM-5) — and the change cannot ship without it. |
| OQ-3 | Is `package.json` in scope, to drop the `fetch-video` / `fetch-video:story` scripts that point at the deleted `src/scripts/fetch-and-upload.js`? | Otherwise the repo ships two scripts that fail immediately. |
| OQ-4 | Are `README.md`, `SETUP.md` and `USER_GUIDE.md` in scope, or explicitly out? | They currently document `x-api-key` as *the* way to upload. Leaving them is defensible while the legacy routes live, but it must be a decision, not an oversight. |
| OQ-5 | Does `X-API-Key` stay in the CORS `allowedHeaders` until the cutover, with `X-Upload-Ticket` **added** rather than swapped in (D26)? | Removing it now breaks browser callers of the legacy routes that are deliberately still serving — the exact break D1 exists to prevent. |
| OQ-6 | How are magic bytes sniffed: hand-rolled detection following `files.js:74-101`, or a new dependency? | There is no sniffing library today, and `file-type` is ESM-only while this codebase is CommonJS. D20 and D21 both rest on this. |
| OQ-7 | After D29 moves the duration check to the worker, what happens to a stored original that turns out to exceed `MAX_VIDEO_DURATION_SECONDS`: deleted, kept, or marked? And does the upload response stop reporting duration? | Today it is a 400 and nothing is stored (`upload.js:214-218`). The design does not say, and it changes both the API response and what accumulates in the bucket. |
| OQ-8 | Does `/gated/upload` support `?story=true` (10 MB cap, story presets, story variant URLs in the response)? | The design never mentions story mode on the gated path, but it exists on the legacy route and has its own size cap and preset family. Silence here would silently drop a feature. |
| OQ-9 | Is the deployed Redis version ≥ 6.2, so `GETDEL` exists (D13)? If not, is a Lua `GET`+`DEL` acceptable as the atomic equivalent? | Without an atomic redeem, single use is not enforced and two concurrent requests can both pass. |
| OQ-10 | When `/health` gains its Redis check (D12), may it return non-200 — given `/health` is the container health probe? | A failing probe can make the orchestrator restart or drop the container during a Redis blip, turning a degraded upload path into an outage. |
| OQ-11 | What is the real proxy hop count for `trustProxy` (D25), and is changing it for **all** routes (not just gated ones) accepted? | It changes `request.ip` for the existing limiter, every log line, and the absolute URL built in `files.js:156-162`. |
| OQ-12 | Is losing the `/stats` dashboard and its Loki proxy accepted with no replacement in this ticket? | D8 deletes the only in-repo view of the logs; whoever uses it needs to know it moves to Grafana or disappears. |
| OQ-13 | Must `/gated/upload` and `/gated/upload/bulk` return **byte-identical** response shapes to the legacy routes, including the `customers/profile` bare-path special case (`upload.js:70-72`) and bulk's basename-only list (`:415`)? | The design says "same request bodies and response shapes"; these two are irregular enough that a faithful copy has to be deliberate. |
| OQ-14 | Which rate-limit bucket does `/gated/ticket` use, and does the per-route `keyGenerator` override the global one cleanly? | The global `keyGenerator` (`app.js:162-165`) keys on `x-api-key`, which gated routes never send — so without an explicit per-route key every gated caller falls back to one IP bucket. |
| OQ-15 | Do the legacy routes get the D19/D20 hardening (folder guard, UUID key, sniffed extension) **before** the gated routes exist, per the §8 step 1 ordering? | It is the only part of this work that closes a real hole on the routes running today, and it is independent of the gateway. |

## Notes

- No code was changed during research.
- No `protected_paths` files were modified.
