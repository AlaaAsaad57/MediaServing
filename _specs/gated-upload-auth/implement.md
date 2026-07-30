---
ticket: gated-upload-auth
stage: implement
mode: standard          # single workflow form — no other modes (ADR-011)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-07-29
links:
  clickup:
  github:
---

# Implement — gated-upload-auth

> Record of what was actually built, following `plan.md` (revision 5).

Branch `ticket/gated-upload-auth`, cut from clean `main` at `98d506a`. All work
is applied as **uncommitted working-tree edits** — no commit, no push (IM-9); the
single publishable commit is `/publish-pr`'s job.

**Two passes over this branch:**

1. *Initial* — the full plan, below.
2. *Resume* — after `/verify` returned FAILED on AC-8 and AC-19. Both were
   defects in this ticket's own new code; the fixes are recorded under
   "Rework after the first verification" and touched only files already in the
   approved list.

## Changes made

**Pass A — hardening**

- `src/utils/byteSniffer.js` *(new)* — leading-byte container detection for JPEG,
  PNG, GIF, WebP, AVIF, the ISO-BMFF family (MP4/MOV), WebM, plus the ZIP and
  OLE2 spreadsheet containers. Returns extension, content type, media class and
  an `inlineSafe` flag; anything unrecognised (including SVG and HTML) becomes
  `application/octet-stream`, `.bin`, not inline-safe. Also carries `readHead` /
  `prependHead`, which let the object key be chosen from the bytes *before* the
  upload starts while the body still streams.
- `src/api/upload.js` — folder guard (D19 rules), `crypto.randomUUID()` object
  name, extension and stored content type from the sniffed bytes, and the
  resource type (and therefore the returned URL prefix) driven by the bytes
  rather than the client filename. The per-type size cap also detects by bytes,
  so a video mislabelled as an image cannot pick up the image cap. Request and
  response shapes unchanged.
- `src/api/files.js` — `randomUUID()` object name; its local
  `detectContainerKind` replaced by the shared sniffer, keeping the same
  accept/reject behaviour.
- `src/api/transform.js` — the `f_svg` passthrough is gone; content disposition
  is derived from the stored content type (`inline` only for recognised safe
  image and video types, `attachment` otherwise); video-byte targets
  (`full`/`preview`/`story`) now **stream** from storage on both the cache-hit
  and cache-miss paths via a new `sendVideoStream`, instead of buffering whole
  objects.
- Deleted: `src/api/stats.js`, `stats.html`, `test.html`, `compare.html`,
  `src/scripts/fetch-and-upload.js`.
- `Dockerfile` *(protected)* — dropped the three HTML files from the copy list.
- `docker-compose.yml` — dropped the two read-only bind mounts of the deleted
  pages (left in place, `docker compose up` would recreate them as empty
  directories in the very stack the acceptance checks run on).
- `package.json` — removed `fetch-video` and `fetch-video:story`, which pointed
  at the deleted helper.

**Pass B — the gated flow**

- `src/services/userinfoClient.js` *(new)* — `GET {GATEWAY_BASE_URL}/api/v1/userinfo`
  with the caller's bearer token, 2 s per attempt via `AbortSignal.timeout`, one
  retry on gateway failure or timeout only (never on 401), envelope unwrapped to
  `data`, never cached, raw body never forwarded. `mayUpload()` requires **both**
  the recognised-true flag and one of the five known account types.
- `src/services/ticketService.js` *(new)* — opaque 32-byte token in Redis under a
  120 s expiry; `mint`, `peek` (non-destructive), `redeem` (`MULTI`/`EXEC` holding
  `GET` then `DEL` — atomic on every Redis version), `isReachable` for `/health`,
  `consumeQuota` for the peer bucket and the outbound ceiling, and `validateFolder`.
  Lifetime and byte cap are constants, not configuration. **No in-memory
  fallback**: the store being away is a 503, never an allow.
- `src/api/ticket.js` *(new)* — `POST /gated/ticket` with three bounds: a
  per-token bucket (route rate limit), a connection-peer bucket consumed **before**
  the gateway call, and a service-wide per-minute ceiling on outbound identity
  calls which also suppresses the retry when nearly exhausted. Then the identity
  check, folder validation, ticket write, and a response carrying the ticket, its
  lifetime and the byte cap.
- `src/api/gatedUpload.js` *(new)* — `POST /gated/upload`, `/gated/upload/bulk`,
  `/gated/upload/excel`. Ticket redeemed at request start; bytes streamed to
  storage through a counting cap; object key server-generated from the sniffed
  extension; attribution written as S3 user metadata. For video the same stream is
  teed to a temp file (both sinks piped, so the source pauses for the slower one),
  and probe, snapshot and poster run from that file before it is removed in a
  `finally`. Bulk is images-only. Excel returns the storage key with no public URL.
  All three carry the same per-route rate-limit config, keyed on the identity pair
  read non-destructively from the ticket.
- `src/middleware/auth.js` *(protected)* — a `/gated/*` branch evaluated **before**
  the legacy allowlist and matched on the parsed pathname, with both cases
  explicit: `/gated/ticket` requires no ticket and no static key; every other
  `/gated/*` path requires a ticket and never accepts the static key. Entries for
  the deleted pages removed. **The legacy clauses are untouched** — see Deviations.
- `src/app.js` *(protected)* — debug page handlers and the statistics
  registration removed; the two gated route groups registered; `X-Upload-Ticket`
  added to the CORS allowed headers **without** removing `X-API-Key`; `/health`
  reports `ticket_store` while keeping its 200. `trustProxy` untouched.
- `src/storage/s3Client.js` *(protected)* — optional `metadata` on `putObject`
  and `uploadStream`, optional `range` on `getObjectStream`. Each is
  backward-compatible when the new argument is absent, which is what keeps the
  derived-cache write path free of edits.
- `src/processors/videoProcessor.js` — path-accepting variants
  (`probeMediaFromPath`, `probeDurationFromPath`, `extractSnapshotFromPath`,
  `extractRawFrameFromPath`) plus `tmpPath`/`cleanup` exported. The buffer
  wrappers keep their signatures and now delegate to these.
- `src/services/videoPreprocessor.js` *(protected)* —
  `createWebpPosterVariantFromPath` alongside the buffer version, sharing one
  `posterFromFrame`; the concurrency constant documented as TASK concurrency.
- `src/services/videoQueue.js` — job payload carries optional `attribution`.
- `src/services/videoJobs.js` — stamps attribution on variant writes by calling
  the storage helper directly (the cache helper takes no metadata and is not part
  of this change); generates the instant variant when the source is not
  web-playable; documents the TASK-concurrency key.
- `src/worker.js` — reads the new `VIDEO_JOB_CONCURRENCY` (job fan-out, default 2)
  separately from `VIDEO_PREPROCESS_CONCURRENCY` (task fan-out); wraps the job in
  an explicit timeout; passes `attribution` through and tolerates its absence.
- `docker-compose.yml`, `docker-compose.prod.yml` *(prod is protected)* —
  `VIDEO_PREPROCESS_CONCURRENCY: "1"`, `VIDEO_JOB_CONCURRENCY: "2"`,
  `VIDEO_JOB_TIMEOUT_MS: "300000"`, in the `environment:` block of **both** the app
  and worker services in **both** files (four sites total).
- `.env.development`, `.env.production` — gateway base URL and timeout, the mint
  rate-limit tiers and outbound ceiling, the gated-upload rate limit, the worker
  job concurrency and timeout, and `CORS_ORIGIN` for production. **These files are
  gitignored** — see Deviations.

## Rework after the first verification

`/verify` (2026-07-29) returned **FAILED**: 18 pass, 2 fail, 4 could-not-run.
Both failures were real defects introduced by this ticket, found before delivery.
No plan revision was needed — both fixes are local to files already listed.

### AC-8 — an over-cap upload was accepted and stored truncated

*Symptom:* 11 MB against a 10 MB ticket cap returned **201** and stored a
silently truncated 10,485,760-byte object.

*Cause:* `@fastify/multipart` enforces `limits.fileSize` by **truncating** the
part stream and ending it normally, not by raising. The counting guard in
`storeStream` therefore never saw the excess — the stream just ended at the cap.

*Fix* (`src/api/gatedUpload.js`): the counting guard is now the single
enforcement point, and multipart's limit is set deliberately **above** it
(`partLimits()`, +1 MB headroom) so the guard always fires first. When it fires
mid-stream the multipart upload is aborted (`leavePartsOnError: false`), so
nothing is stored. An `assertNotTruncated(part)` check was added after each store
as a backstop, in case a lower limit is ever applied further up the stack.

*Re-verified:* over-cap → `413`, **stored=null**; under-cap → `201`.

### AC-19 — unrecognised content returned 500 instead of downloading

*Symptom:* a real PNG served `200 inline` correctly, but an object whose bytes
were never recognised (stored `.bin` / `application/octet-stream`) returned
**500** with no disposition.

*Cause:* removing the `f_svg` passthrough made `sendOriginal` **unreachable**.
Its only remaining call site sits behind `Object.keys(params).length === 0`, but
`params.f` is unconditionally defaulted a few lines above, so that branch is
dead. The object fell through to Sharp, which cannot decode it.

*Fix* (`src/utils/byteSniffer.js`, `src/api/transform.js`): added
`isInlineSafeExtension()`, and `handleImage` now hands anything outside that set
straight to `sendOriginal`, which streams it back with the disposition taken from
the **stored content type**. Deciding the *path* by extension costs no extra
storage call, and safety still rests on the content type — so a legacy object
with a friendly extension but a dangerous stored type still downloads. Aliases
(`jpeg`, `jpe`, `m4v`, …) are included because objects stored before this ticket
carry client-supplied extensions. The stale comment claiming `sendOriginal`
already handled this case was corrected.

*Re-verified:* unrecognised → `200` `attachment`; PNG → `200` `inline`.

**Files touched during rework:** `src/api/gatedUpload.js`,
`src/api/transform.js`, `src/utils/byteSniffer.js` — all three already in the
approved "Files to change" list. No new file, no protected path beyond those
already approved.

## Changes prepared (uncommitted)

> `/implement` creates **no commit** (IM-9 / ADR-008); there are no SHAs to
> record here. The single publishable commit is created later by `/publish-pr`.

New: `src/utils/byteSniffer.js`, `src/services/userinfoClient.js`,
`src/services/ticketService.js`, `src/api/ticket.js`, `src/api/gatedUpload.js`.

Modified: `src/api/upload.js`, `src/api/files.js`, `src/api/transform.js`,
`src/app.js`, `src/middleware/auth.js`,
`src/storage/s3Client.js`, `src/processors/videoProcessor.js`,
`src/services/videoPreprocessor.js`, `src/services/videoQueue.js`,
`src/services/videoJobs.js`, `src/worker.js`, `Dockerfile`,
`docker-compose.yml`, `docker-compose.prod.yml`, `package.json`,
`_specs/gated-upload-auth/ticket.md`.

Deleted: `src/api/stats.js`, `stats.html`, `test.html`, `compare.html`,
`src/scripts/fetch-and-upload.js`.

Untracked and therefore **not** in the working tree diff: `.env.development`,
`.env.production` (gitignored).

**No file outside `plan.md > Files to change` was modified** (IM-4). Verified by
comparing `git status` against the plan's list.

## Deviations from plan

1. **The ticket record carries a contact snapshot.** `spec.md` FR-6 says the
   ticket binds the identity pair, folder, byte cap, count and `jti` — "nothing
   else". But AC-13/FR-17 require the **upload** log line to carry `phone` and
   `email`, and the upload request never talks to the gateway, so those two values
   can only reach it through the ticket record. They are stored alongside the
   authorization scope, are used for nothing but the log line, and never reach the
   stored object (AC-12) or a job payload (FR-18). This is a real deviation from
   FR-6 as literally written, and the alternative — dropping AC-13's contact
   fields, or logging them only on the mint request — would fail AC-13. Flagged
   for the `/verify` gate to accept or reject.
2. **Gated bulk adds a `skipped` array**, and only when something was actually
   rejected. AC-15 requires rejected parts to be *reported*; AC-17 requires shape
   parity with the route it mirrors. The ordinary response is byte-identical
   (`{urls}` / `{url}`); the extra key appears only in the case AC-15 describes.
3. **The gated spreadsheet extension comes from the client filename**, validated
   against the four allowed values, not from the bytes — `.xlsx`, `.xlsm` and
   `.xlsb` are all ZIP archives, so the bytes cannot distinguish them. The bytes
   must still agree with the container the extension implies, which is the same
   safety property the existing spreadsheet route enforces. AC-11's
   "extension from the bytes" is a media-object requirement; storing a spreadsheet
   as `.zip` would break its consumer for no security gain.
4. **The job timeout does not itself kill the ffmpeg child.** It does not need
   to: `videoProcessor` already `SIGKILL`s its own child at
   `VIDEO_FFMPEG_TIMEOUT_MS` (120 s default), and the job timeout is set above it
   (300 s default), so by the time it fires the child that caused it is already
   dead. No process-tree killer was added, which the plan's "no new machinery"
   direction favours. The `/verify` worker check should confirm this empirically.
5. **`.env.development` and `.env.production` are gitignored**, so the new
   configuration keys exist on disk but will **not** be in the publishable commit
   or the PR. The deployment must set `GATEWAY_BASE_URL` (required — an unset
   gateway makes every mint answer 503 by design), and should review the rate
   limits, `VIDEO_JOB_CONCURRENCY`, `VIDEO_JOB_TIMEOUT_MS` and `CORS_ORIGIN`.
   The compose files carry the concurrency and timeout values, so those are in the
   commit.
6. **The folder guard is implemented twice**: in `ticketService.validateFolder`
   (used by the mint route, and bound into the ticket) and locally in
   `src/api/upload.js` for the legacy route. Sharing it would have meant a sixth
   new file, which the plan does not list; duplicating a twelve-line pure function
   was the smaller cost.
7. **The worker now also generates the instant variant for legacy-originated
   jobs.** It is guarded by a cache check, so where the legacy route already made
   it inline this is a no-op. This follows from moving the instant variant to the
   worker for the gated path; the two paths share one job.
8. **`mime-types` and `path` imports removed** from `src/api/upload.js` and
   `src/api/transform.js` respectively, having become unused. The `mime-types`
   dependency stays in `package.json` — `imageProcessor.js` still uses it.

**Explicitly NOT done, on the recorded decision:** the legacy allowlist bypass
(`request.url` matching the query string, so `POST /upload?x=/image/upload/` skips
the key check) is left exactly as it was. It is an accepted risk for the migration
window recorded in `plan.md > Out of scope`, and a comment in
`src/middleware/auth.js` now says so at the line, so it is not "fixed" by accident
later. Only the `/gated/*` branch uses the parsed pathname.

## Validation run during implementation

- `bash -c 'find src -name "*.js" -print0 | xargs -0 -n1 node --check'` — **pass**,
  every file under `src/` parses (the `standard` validation profile's only check).
- `node --check` on each individually edited file as it was written — **pass**.
- App boot + route table via `buildApp().ready()` — **pass**; `/gated/ticket`,
  `/gated/upload`, `/gated/upload/bulk`, `/gated/upload/excel` all registered
  alongside the existing routes.
- Behavioural smoke tests via `app.inject()` (no S3/Redis running):
  - `GET /health` → **200** `{"status":"ok","ticket_store":"unavailable"}` — the
    store is reported without changing the status code.
  - `GET /test`, `GET /stats` → **401** (routes gone, no longer allowlisted).
  - `POST /gated/upload` with no ticket → **403** uniform.
  - `POST /gated/upload` with `x-api-key` only → **403** — the static key is not
    accepted under `/gated/*`.
  - `POST /gated/ticket` with no bearer token → **401**.
  - `POST /upload` with no key → **401** — legacy behaviour unchanged.
  - `GET /image/upload/...` → 500 only because MinIO is not running locally; the
    route resolves.
- Byte sniffer exercised directly against JPEG, PNG, WebP, MP4, AVIF, WebM, ZIP
  and OLE2 signatures plus HTML and SVG payloads — recognised types map to their
  extension and content type with `inline=true`; **HTML and SVG both fall to
  `application/octet-stream` with `inline=false`**, which is the property D21
  depends on.

**After the rework**, the same checks were re-run plus the full read-only
verification harness (real routes, stubbed Redis/S3/gateway):

- `bash -c 'find src -name "*.js" -print0 | xargs -0 -n1 node --check'` — **pass**.
- Verification harness — **20 pass, 0 fail, 4 could-not-run** (AC-14 and AC-16
  need ffmpeg, AC-21 needs docker, AC-24's revert half is git-level). Both
  previously failing criteria now pass, with the evidence quoted above.

Full acceptance-criteria verification is `/verify`'s to record. The four
could-not-run criteria need a machine with Docker and ffmpeg; nothing about them
is known to be wrong, only undemonstrated here.
