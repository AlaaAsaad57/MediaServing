---
ticket: gated-upload-auth
stage: plan
mode: standard          # single workflow form — no other modes (ADR-011)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-07-29
links:
  clickup:
  github:
---

# Plan — gated-upload-auth

> Decide the approach before changing code. Plan only — no implementation here.
>
> **Revision 5** — addresses the eight follow-ups in `review.md` round 4 (PL-10).

## Approach

Two passes. Pass A hardens the routes running today (byte-derived types, folder
guard, random object names, safe delivery disposition, debug pages gone). Pass B
adds the `/gated/*` family beside them: mint a ticket from the gateway's identity
answer, redeem it once per upload, stream to storage, stamp the identity onto the
object.

**Video handling.** While the incoming bytes stream to storage they are also
written to a temp file, in one pass — both sinks are piped so the source pauses
for whichever is slower, which is what keeps the tee memory-flat. From that file
the route probes for `durationSeconds` (AC-17) and extracts the snapshot and webp
poster (AC-16), warm at upload as the legacy route makes them. The heavy
transcodes (instant variant, polished variants) stay on the worker.

**Large objects on the delivery route.** Raising the cap to 100 MB moves cost
onto a route that is unauthenticated. Every path that can hold a whole object is
addressed or named: the video-byte targets stream on both the cache-miss and the
**cache-hit** path; the image paths still buffer, because Sharp decodes from a
buffer, and that residual is stated in Out of scope rather than left to be found.

The helpers this needs already work in file paths internally —
`src/processors/videoProcessor.js` has `probe(inputPath)` and
`extractFrame(inputPath, …)`. Both that file and the protected file holding the
poster helper are listed; each gains a **path-accepting variant while keeping its
buffer signature**, so the legacy route and the worker keep working unchanged.

**OQ-6:** byte sniffing implemented here, no dependency — CommonJS codebase, the
popular package is ESM-only, and the recognised set is small because anything
unrecognised is served as a download.
**OQ-9:** redemption is a `MULTI`/`EXEC` transaction holding `GET` then `DEL` —
atomic on every Redis version.
**OQ-14:** per-route `keyGenerator`, confirmed in `@fastify/rate-limit@10.3.0`;
it may return a promise, which is what makes the gated-upload bucket in step 9
possible.
**OQ-11 — the global trusted-proxy setting is left exactly as it is, out of
scope.** `.env.production` sets `PUBLIC_BASE_URL` to a placeholder, so the
spreadsheet route's absolute URL already depends on the request's own protocol
and host; `.env.development` sets `TRUST_PROXY=true`, which a hop-count parse
reads as `NaN`; and the real hop count is not knowable from this repository.

## Steps

**Pass A — hardening**

1. Add a byte-sniffing helper: container from the leading bytes → canonical
   extension, content type, recognised-safe flag (**OQ-6**). JPEG, PNG, WebP,
   GIF, AVIF, the MP4 family, WebM, plus the ZIP and OLE2 containers the
   spreadsheet route already detects; SVG and anything unknown are unrecognised.
2. Folder guard, `crypto.randomUUID()` object name and sniffed extension on the
   existing media upload route. **Stored resource type and returned URL prefix
   come from the sniffed bytes, not the client filename.** Shapes unchanged
   (AC-18).
3. Same random object name on the spreadsheet route; its folder guard and
   magic-byte check already exist.
4. Delivery safety: drop the SVG passthrough; content disposition from the
   recognised type — `inline` for recognised safe image and video types,
   `attachment` otherwise (AC-19).
5. Delete the two debug pages, the statistics page, the statistics route and its
   log-query proxy, and the key-carrying helper script. **In one change**: remove
   their route registrations and dead auth allowlist entries, drop the three HTML
   files from the image build's copy list, remove the two bind mounts from the
   development compose file, and remove the two packaged commands pointing at the
   deleted script (AC-21, **OQ-2**, **OQ-3**).

**Pass B — the gated flow**

6. Identity client: one `GET` to the gateway with the caller's bearer token, 2 s
   per attempt, one retry on gateway failure or timeout only, unwrap `data`,
   never cache, never forward the raw body (AC-4).
7. Ticket store: an opaque 32-byte random token under a namespaced key with a
   120 s expiry, binding account type, account id, folder, max bytes, count and
   the ticket identifier. **Lifetime and byte cap are constants.** Redemption is
   a `MULTI`/`EXEC` transaction (**OQ-9**). No in-memory fallback (AC-7, AC-20).
8. Mint route with **three bounds** — kept deliberately, against the panel's
   advice, because dropping the ceiling would let rotated tokens each cost an
   unauthenticated outbound gateway call: a per-caller bucket keyed on the token
   hash; a bucket keyed on the **connection peer address**, evaluated **before**
   the gateway is called; and a **service-wide ceiling on outbound identity
   calls** in Redis as a per-minute counter, checked before each call, with the
   retry suppressed once the ceiling is near. **Stated residual:** behind a proxy
   the peer bucket collapses to one bucket, so an abusive source can consume the
   shared ceiling and deny minting to others — a denial of service, not an
   amplification; removing it needs the real hop count (**OQ-11**). Then the
   identity check (recognised-true flag **and** known account type), folder
   validation, ticket write, and a response carrying the ticket, its lifetime and
   the byte cap (AC-1, AC-2, AC-3, AC-5).
9. Gated upload routes. Redeem at request start, before the body is read. Stream
   each file to storage through a counting guard that aborts past the cap and a
   sniffing head that fixes the extension from the first bytes, then write the
   object with attribution metadata. Bulk is images-only and skips bad files per
   file; the spreadsheet route returns the key only (AC-8, AC-11, AC-12, AC-15,
   AC-17, AC-22). Two additions this revision:
   - **Rate limiting (AC-23).** The gated upload routes carry a per-route
     `keyGenerator` returning `u:<user_type>:<user_id>` from the ticket. The key
     generator runs in the plugin's hook, **before** the handler redeems the
     ticket, so it performs a **plain non-destructive read** of the ticket to
     obtain the identity pair; the `MULTI`/`EXEC` redemption in the handler
     remains the single consuming step, so single use (AC-7) is unaffected. A
     missing, expired or unreadable ticket yields no identity, so the key falls
     back to the connection peer address — such a request is refused by the
     handler anyway (AC-9), and the fallback stops an unauthenticated caller from
     sharing everyone's bucket.
   - **Log line (AC-13).** The request log carries account type, account id,
     ticket identifier, phone and email, with a phone of the literal `"0"` and
     any generated guest-domain email written as empty, alongside the genuine
     empties the gateway returns.
10. **Video and story on the gated single route.** The temp file is written from
    the incoming stream (step 9), both sinks piped so the source pauses for the
    slower one. From that file: probe for `durationSeconds` (AC-17), extract the
    snapshot, build the webp poster (AC-16); write those two derived objects with
    attribution; remove the temp file in a `finally`. Enqueue the instant variant
    and the polished variants.
    **Story cap (AC-16):** the 10 MB story limit is the same counting guard with
    a 10 MB threshold in story mode; duration comes from the temp-file probe. The
    legacy story check is a local function in the existing upload route and the
    story preset module is used read-only, so **neither needs to change**.
    **Stated consequence:** a large video that is not web-playable has no playable
    variant until the worker finishes; delivery serves the original, which may not
    play in a browser.
11. Auth hook `/gated/*` branch, **both cases stated**: evaluated **before** the
    existing allowlist, matching the parsed pathname, never the raw URL;
    `POST /gated/ticket` requires **no ticket and no static key** (it carries a
    bearer token); every other `/gated/*` path requires a ticket and never
    accepts the static key. The legacy key check is untouched — see Out of scope.
12. Attribution into the job payload, stamped on everything the worker writes; a
    job with no attribution (delivery path, backfill script) still runs (AC-14).
    **The worker stamps attribution by calling the storage helper with metadata
    directly**, not through the protected cache helper. Bound the worker:
    - **Memory — three readers, named.** `VIDEO_PREPROCESS_CONCURRENCY` is
      currently read in three places: the job file, the worker entry point, and
      the preset module used by the backfill script. It keeps its meaning as
      **task concurrency** and is set to **1**, which covers the job file and the
      backfill path. A **new** key carries the worker's **job concurrency**, set
      to 2, and is read only by the worker entry point. Both are set in **both**
      compose files. *Consequence, stated:* the backfill script also runs one
      task at a time; it can be raised for a manual run by setting the existing
      key for that invocation.
    - **Wall clock** — a per-job timeout that **kills the ffmpeg child and
      removes its temp output**, set above the existing per-ffmpeg timeout so an
      attempt is fully dead before a retry begins. No processing ceiling.
13. **Stream the delivery route's video-byte targets** (`full`/`preview`/`story`)
    on **both** paths: the cache-miss fallback and the **cache-hit** path, which
    still loads a whole variant into heap today. The storage stream helper gains
    an optional range and the route pipes the body through. **No inline-poster
    size threshold** — it was scope no criterion asked for and it regressed a
    working flow (NFR-6); with posters warm at upload (step 10) the inline poster
    path is cold by construction, reached only for a legacy object (capped at
    10 MB) or a gated upload whose poster stage failed.
14. Wire the app: register the two new route groups, add the ticket header to the
    cross-origin allowlist **while keeping the key header** (**OQ-5**), report
    store reachability in the health body without changing its status code
    (AC-20). `trustProxy` **not** touched (**OQ-11**).
15. Configuration keys in both environment files: gateway base URL, per-attempt
    timeout, the mint rate-limit tiers and outbound ceiling, the gated-upload
    rate limit, the worker job timeout and task concurrency, and the production
    cross-origin list. **Not** among them: ticket lifetime, byte cap, any poster
    threshold, or a temp directory — constants, using the repository's existing
    temp-directory pattern.

## Files to change

*Assembled by walking every step and listing each file it implies; each entry
names its step. This list was independently verified complete at round 4.*

**New**

- `src/utils/byteSniffer.js` — leading-byte detection (**OQ-6**). *(step 1)*
- `src/services/userinfoClient.js` — the gateway call. *(step 6)*
- `src/services/ticketService.js` — mint / redeem / non-destructive read /
  store-reachability / outbound ceiling; own Redis client; no fallback;
  constants. *(steps 7, 8, 9)*
- `src/api/ticket.js` — `POST /gated/ticket`. *(step 8)*
- `src/api/gatedUpload.js` — the three gated routes, the rate-limit key
  generator, the log fields, and the temp-file stage. *(steps 9, 10)*

**Changed — `protected_paths` (listing them here is what makes editing them legal
at `/implement`; GU-2 / IM-5)**

- `src/middleware/auth.js` *(protected)* — the `/gated/*` branch with its two
  cases, before the allowlist, on the parsed pathname; remove the entries for the
  deleted pages. *(steps 5, 11)*
- `src/app.js` *(protected)* — remove the debug page handlers and the statistics
  registration; register the new route groups; add `X-Upload-Ticket` to the
  cross-origin allowed headers without removing `X-API-Key`; add store
  reachability to the health body. `trustProxy` untouched. *(steps 5, 14)*
- `src/storage/s3Client.js` *(protected)* — optional metadata argument on
  `putObject` and `uploadStream`; optional range on `getObjectStream`. Each keeps
  current behaviour when the new argument is absent, which keeps the
  derived-cache write path edit-free. *(steps 9, 10, 12, 13)*
- `src/services/videoPreprocessor.js` *(protected)* — the poster helper accepts a
  file path in addition to a buffer; its concurrency constant keeps its name and
  becomes task concurrency. *(steps 10, 12)*
- `Dockerfile` *(protected)* — drop the three HTML files from the copy list
  (**OQ-2**). *(step 5)*
- `docker-compose.prod.yml` *(protected)* — task concurrency 1, the new job
  concurrency key at 2, and the worker job timeout; pinned in the `environment:`
  block of both services. *(step 12)*

**Changed — ordinary paths**

- `src/processors/videoProcessor.js` — path-accepting variants of probe, snapshot
  and raw-frame extraction, keeping the buffer signatures. *(step 10)*
- `docker-compose.yml` — remove the two bind mounts, **and** the same concurrency
  keys and job timeout (pinned here too). *(steps 5, 12)*
- `src/api/upload.js` — folder guard, random object name, sniffed extension,
  resource type from the bytes. *(step 2)*
- `src/api/files.js` — random object name; reuse the shared sniffer. *(step 3)*
- `src/api/transform.js` — drop the SVG passthrough; disposition from the
  recognised type; stream the video-byte targets on both the miss and hit paths.
  *(steps 4, 13)*
- `src/services/videoQueue.js` — attribution in the job payload. *(step 12)*
- `src/services/videoJobs.js` — attribution on variant writes via the storage
  helper directly; the instant variant generated here; reads task concurrency.
  *(step 12)*
- `src/worker.js` — attribution fields; job timeout with child kill; reads the
  new job-concurrency key. *(step 12)*
- `package.json` — remove the two commands pointing at the deleted script
  (**OQ-3**). *(step 5)*
- `.env.development`, `.env.production` — the keys in step 15. *(step 15)*

**Deleted**

- `src/api/stats.js`, `stats.html`, `test.html`, `compare.html`,
  `src/scripts/fetch-and-upload.js`. *(step 5)*

**Deliberately not changed, each checked against the steps:**
`src/services/cacheService.js` *(protected)* — the worker and the gated route call
the storage helper directly for metadata writes. `src/services/storyVideoService.js`
*(protected)* — read-only for response URLs; the legacy story check is a local
function in the existing upload route. `src/utils/paramParser.js` and
`src/utils/hashGenerator.js` *(protected)* — no transform key or cache-key input
changes; the SVG passthrough and the delivery header helpers are local to the
delivery route. `src/config/env.js` *(protected)* — new settings come from the
environment already loaded. `src/services/lockService.js` *(protected)* — the
ticket store brings its own client. `src/utils/mediaProbe.js` — pure helper, used
read-only.

## Integration surface

> Required (PL-11, ADR-014). What this change touches **beyond its own files** —
> the source of the mandatory integration question at `/review` (CG-5).

- **Components / shared config touched:** the global auth `preHandler` (runs
  before every route and matches the raw URL including the query string); the
  **global rate limiter**, whose key generator now runs per gated route and reads
  Redis before the handler; the cross-origin allowed-header list; the shared
  storage helpers (`putObject`, `uploadStream`, `getObjectStream`), used by gated
  uploads, legacy uploads, the spreadsheet download and every derived-cache
  write; the image delivery header helper (four call sites); the video helper
  signatures, shared by the legacy route, the worker and the gated route; the
  background job payload; **the task-concurrency key, read in three places
  including the backfill script**; the container image build; the development
  compose stack; the health probe; and the container filesystem, holding a temp
  file per in-flight video upload.
- **Who else depends on them:** social preview crawlers depend on images being
  served inline and are exempt from rate limiting on public media paths — which
  is why the delivery route's memory profile is a shared concern, not a gated-route
  one; the log stack consumes the request log line's field names; the delivery
  route enqueues jobs with no ticket and therefore no attribution; the backfill
  script produces variants in-process, bypassing the queue, and reads the same
  task-concurrency key; the production health check restarts the container on
  repeated failure; the three consumers call the legacy routes and must keep
  working untouched; and the acceptance evidence runs on the development compose
  stack, so a stale mount or wrong concurrency value there corrupts the evidence
  for every criterion.
- **Overlapping flows:** gated and legacy uploads write through the same storage
  helpers, so a non-backward-compatible signature breaks the cache-write path
  that has nothing to do with uploading; the image delivery response is shared by
  originals, transformed variants and crawler responses; **the video helpers are
  the sharpest overlap** — legacy route and worker pass buffers, the gated route
  passes a path, and the same functions serve all three; **the rate-limit key
  generator overlaps the ticket lifecycle** — it reads the ticket that the
  handler then consumes, so a destructive read there would break single use;
  variant generation is reachable three ways (upload enqueue, delivery enqueue,
  backfill) and only the first carries a ticket; the temp file shares container
  disk with ffmpeg's own temp output.
- **Ordering / lockstep dependencies:** the auth-hook edit must land with the
  gated routes; deleting the three HTML pages, editing the image copy list and
  removing the development compose mounts are one change; the two concurrency
  keys must land in both compose files together, and the task key must keep its
  name so the backfill reader is not orphaned; deleting the helper script and
  removing the two packaged commands are one change; the video helpers' path
  variants must land before the gated route that calls them and must keep the
  buffer signatures; the storage helper's optional arguments must land before or
  with their callers; pass A before pass B.
- **What breaks if this is wrong:** a mistake in the auth allowlist opens every
  upload route — the highest blast radius here — and a branch placed after the
  existing block can be stepped around with a query string; removing the key
  header from the cross-origin list breaks browser consumers of the legacy routes
  mid-migration; serving recognised images as attachments breaks social previews
  and in-page rendering site-wide; **a destructive read in the rate-limit key
  generator would consume the ticket before the handler, making every gated
  upload fail**; changing a video helper's signature instead of extending it
  breaks the legacy upload route and the worker at once, and neither is exercised
  by gated tests; renaming the task-concurrency key silently returns the backfill
  script to four ffmpeg children; a worker that rejects a job lacking attribution
  stops every variant from the delivery path and the backfill; and a temp file
  not removed on the error path fills the container disk, failing uploads and the
  worker alike.

## Validation strategy

- Validation profile: `standard`
- Each acceptance criterion is demonstrated by a reproducible request-level check
  against the local compose stack, recorded in `verify.md` with the request made
  and the status observed:
  - Identity outcomes (AC-1..AC-4) against a stubbed gateway returning each
    documented shape, including the string `"false"` flag and an unknown type.
  - Ticket behaviour (AC-5..AC-7, AC-9) by replaying one ticket twice, past its
    deadline, and against a mismatched folder — answers must be
    indistinguishable. **Single use is checked with rate limiting active**, since
    the key generator reads the same ticket.
  - Rate limiting (AC-23): two accounts with the same id and different account
    types consume separate budgets; a caller cannot move buckets with a
    forwarding header (checked on a gated route); the mint tiers are exhausted in
    turn and the outbound ceiling is shown to stop gateway calls, not just client
    requests.
  - Size, memory **and disk** (AC-8) with a file at the limit, one over it, and
    several concurrent uploads — recording resident memory and a **disk-headroom
    number** (free disk ÷ cap = concurrent uploads tolerated), not merely "disk
    was watched".
  - Worker bounds: worker memory across concurrent 100 MB jobs; a forced job
    timeout showing the ffmpeg child gone and memory returned.
  - Delivery bounds: a video-byte target for both a **cold** and a **warm**
    100 MB object, confirming app memory does not rise by the object's size in
    either case.
  - Video parity (AC-16, AC-17): gated versus legacy response for the same video,
    including `durationSeconds` and the story fields, and the poster warm
    immediately after upload. **The legacy upload route and a worker job are
    exercised too**, since all three share the video helpers being extended.
  - Content handling (AC-11, AC-19) with bytes whose name disagrees with content.
  - Attribution (AC-12..AC-14): object metadata and the log line, including the
    `"0"` phone and guest-domain email written as empty.
  - Shape parity (AC-18, AC-22) by diffing gated against legacy.
  - Store outage (AC-20): stop Redis, call mint, upload and health.
  - Build and packaging (AC-21): build the image, bring the compose stack up
    cleanly, resolve every packaged command.
  - Reversibility (AC-24): revert the branch, re-run the profile.
- Recorded as observations, not pass/fail: the gated-versus-legacy upload time;
  the retention and access expectation for the contact fields in the log line
  (unredacted PII, protected only by log access, an out-of-scope launch item);
  and that gated spreadsheet objects remain publicly retrievable by key path
  until the cutover ticket closes that route.

**Worst-case worker memory.** Job concurrency 2, task concurrency 1 — at most two
ffmpeg children. Per job: the original buffer (up to 100 MB) plus one output
buffer of the same order, ~200 MB; two jobs ~400 MB; two children at ~100–200 MB
resident each; plus the Node baseline. Roughly **0.7–0.9 GB against the worker's
2 GB limit** — measured by the worker-bounds check, not asserted.

**Worst-case temp disk.** One file per in-flight gated video upload, each bounded
by the counting guard at the request cap, removed in a `finally`. The aggregate
is *concurrent gated video uploads × the cap*, on the same disk the worker's
ffmpeg uses; a full disk fails uploads and the worker together. Nothing caps the
number in flight, which is why the check records headroom.

## Rollback

**Branch-level only.** This workflow produces exactly one publishable commit per
ticket (PB-8/PB-9), so a per-pass revert is a manual follow-up.

The revert is clean: the five new files are additions; the edits to shared files
restore current behaviour, and the video helpers' path variants are additive so
removing them cannot break the buffer callers. Nothing is migrated — no stored
object is rewritten, no cache-key input changes, the derived cache is untouched.
Attribution metadata already written is inert. Tickets expire within 120 s; the
outbound counter within its window. Temp files are removed in a `finally`. The
deleted pages, statistics route and helper script return with the revert.

## Out of scope

- The cutover — retiring the static key, deleting the legacy upload routes,
  removing the public spreadsheet download, rotating the key (**OQ-1**).
- **The legacy allowlist bypass — accepted by explicit owner decision.** The
  allowlist matches the raw URL including the query string, so
  `POST /upload?x=/image/upload/` skips the key check entirely: anonymous keyless
  upload to `/upload`, `/upload/bulk` and `/upload/excel` remains possible for the
  whole migration window, on top of the known key exposure. Pass A removes the
  pages that leak the key, so the routes will *look* protected while this stands.
  The cutover ticket inherits it.
- **Image delivery still buffers whole objects — named residual.** Sharp decodes
  from a buffer, so the image paths load the original into heap. Under FR-14 an
  image may now be up to 100 MB, so a concurrent burst of range-less GETs for one
  large warm image costs that much heap per request on an unauthenticated route.
  This is inherent to the image pipeline, not an oversight in the streaming work:
  the video-byte targets stream on both paths (step 13), and this is the sibling
  that cannot. **It is bounded only by lowering the cap for images** — a
  `spec.md` change (FR-14 / AC-8) and therefore the owner's, which is why it is
  named here rather than silently left. The `/verify` delivery check measures it
  so the number is on record.
- The three guide documents (**OQ-4**).
- Any replacement for the statistics dashboard (**OQ-12**).
- **The global trusted-proxy setting (OQ-11)** — confirming the real hop count
  and `PUBLIC_BASE_URL` is an operational item.
- Consumer migrations, in their own repositories.
- Byte quotas and per-upload accounting.
- Backfilling attribution onto older objects, and on variants from the backfill
  script, which has no uploader.
- Restricting the metrics endpoint and log access at the network layer.
- Rewriting the existing upload route to stream; it stays buffered.
- A circuit breaker or cache in front of the identity gateway — NFR-3 forbids
  caching for a stated reason, and the outbound ceiling bounds what a breaker
  would have bounded.
- A cap on concurrent in-flight uploads; the temp-disk aggregate is measured and
  recorded instead.

## How this revision answers the review

| # | Follow-up (round 4) | Where it is answered |
|---|---------------------|----------------------|
| 1 | Gated-upload rate-limit bucket + keying vs redemption (F1) | Step 9 first bullet — non-destructive read in the key generator, `MULTI`/`EXEC` still the single consuming step, peer-address fallback |
| 2 | Stream the warm delivery path; name what stays buffered (F2) | Step 13 (both paths); Out of scope names the image residual and ties it to the cap |
| 3 | Which concurrency key each of the three readers uses | Step 12 — task key keeps its name (job file + backfill), new key for worker job concurrency, both in both compose files |
| 4 | AC-13 log fields and normalisation | Step 9 second bullet |
| 5 | Pipe both tee sinks | Approach; step 10 |
| 6 | Disk-headroom number | Validation strategy; "Worst-case temp disk" |
| 7 | Drop the inline-poster threshold | Step 13 — dropped, with why the path is now cold by construction |
| 8 | Keep the three mint bounds | Step 8 — kept, with the reason and the residual restated |

**Still open, four rounds running:** should video — and now images — keep a lower
cap than 100 MB? The image residual above is the second finding to trace directly
to that number. It is a `spec.md` change (FR-14 / AC-8) and remains the owner's.
