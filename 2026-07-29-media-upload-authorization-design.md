# Media Upload Authorization — Design

**Status:** all decisions agreed, nothing open. Intended as ticket intake.
**Scope:** MediaServing. Other systems appear only in §6 as contracts this
repo depends on — no work in other repos is planned or described here.
**Gateway:** the identity endpoint is **delivered and live**. Its contract is
`GO-ME-API-CONTRACT.md` in this repo; every gateway fact below is taken from it,
not assumed.
**Context:** the service is **not yet in production**. The defects in §1 are
real and are what this design fixes, but they are not live exposure today — so
the migration can be sequenced deliberately rather than rushed, and the
rate-limiting weaknesses are accepted as-is until the gated routes exist.

Every code reference below was verified against the working tree.

## 1. Problem

Every upload is authorized by a single static `API_KEY` (`middleware/auth.js:20-23`).
That key is public: it is injected verbatim into three unauthenticated HTML pages
(`app.js:255-256` `/test`, `app.js:266-268` `/compare`, `stats.js:107-108`
`/stats`), all of which are allowlisted at `auth.js:3-18` and exempt from rate
limiting. It is also shipped in client bundles and committed in documentation.
Anyone can therefore upload anything, into any folder, anonymously.

Three defects compound it:

- **No content validation.** `resolveExtension` (`upload.js:36-43`) trusts the
  client's filename and mimetype. Bytes named `x.html` with
  `Content-Type: text/html` are stored, then replayed by `sendOriginal`
  (`transform.js:861-874`), which sets the stored content type and
  `Content-Disposition: inline` (`transform.js:57-62`) — stored XSS on the media
  origin. `nosniff` does not help when the declared type *is* `text/html`. The
  `f_svg` passthrough (`transform.js:400-402`) is the same hole.
- **No folder validation.** `saveUploadedImage` (`upload.js:54-56`) interpolates
  the client's `folder` straight into the S3 key, with no traversal guard —
  unlike `files.js:133-142`, which has one.
- **One rate-limit bucket.** The limiter keys on the shared key
  (`app.js:162-165`), so every caller shares one budget.

## 2. Approach

A **two-stage upload**: the caller proves who it is and receives a short-lived,
single-use, scoped **ticket**; the upload is authorized only by that ticket.

```
caller ──1── POST /gated/ticket   (Authorization: Bearer <market token>)
                    │
                    ├── GET /api/v1/userinfo → (user_type, id) + upload permission
                    │
             { ticket, expires_in, max_bytes }
                    │
caller ──2── POST /gated/upload   (X-Upload-Ticket: …)
```

This ships **beside** the current endpoints. The ticket-authorized routes live
under a new `/gated/*` prefix with the same request bodies and response shapes;
the existing routes are untouched until every consumer has moved (D1/D2).

## 3. Decisions

### Authorization

| # | Decision | Rationale |
|---|---|---|
| D1 | The ticket flow ships as a **new parallel route family**: `POST /gated/ticket`, `/gated/upload`, `/gated/upload/bulk`, `/gated/upload/excel`. `x-api-key` is not accepted anywhere under `/gated/*`. The existing routes stay live and unchanged. | Consumers migrate independently and nothing breaks on release day. A parallel route is not a fallback: the new path has no bypass — the old path is a separate door with a scheduled demolition. |
| D2 | **`API_KEY` and the legacy upload routes are deleted together, at the end**, once the other consumers confirm they have migrated. The key is not rotated before then. | Rotating earlier breaks the legacy routes that are deliberately still serving. Honest cost: the key stays as usable as it is today for the whole migration, so anonymous upload remains possible until then — accepted pre-production, and it must land before launch. |
| D3 | Upload authorization is a **two-stage ticket flow**. | A per-user, per-upload, short-lived capability instead of one shared forever-secret. |
| D4 | Identity is resolved by calling **`GET /api/v1/userinfo`** with the caller's market access token as `Authorization: Bearer …`. The answer sits in the envelope's **`data`** object — `data.id`, `data.user_type`, `data.is_allowed_to_upload_files`, `data.phone`, `data.email`. Minting requires **both**: (a) `data.is_allowed_to_upload_files` is one of `true`, `1`, `"1"`, `"true"` — every other value, and a missing field, denies; **and** (b) `data.user_type` is one of the five known values `guest`, `customer`, `shop_employee`, `seller`, `admin`. Either one failing is **403**. Guests need no special case: their flag is always `false`. | This service holds no user database; the gateway is the authority. The contract guarantees the flag is a boolean that is never null, so the allowlist is belt-and-braces against a future serialization change, not a known variance — it still **fails closed**, because a truthiness test would read the string `"false"` as permission to upload, the classic form of this bug. Condition (b) is the contract's own instruction: an unrecognised `user_type` is untrusted and denied. The cost, stated plainly: a sixth type the gateway adds later is denied here until this list is updated — a visible failure, which is the right direction to fail in. |
| D5 | **The flag decides *who*, not *what*.** Any permitted caller may upload any file type into any valid folder. D4(b) checks only that the type is *recognised*; it never decides what that caller may upload. Accepted risk: a file lands in a folder that is not the uploader's. | Bounded by D20 — the server names the object, so a caller can only add, never overwrite. The alternative is a permission matrix duplicating the gateway's roles. |
| D6 | Gateway outcomes map as: **401 → 401** (token missing, malformed, expired, revoked, or its account no longer exists — treated as not signed in); **500 → retried once, then 503**; a valid token whose account is refused by D4 → our own **403**. Each attempt carries a **2 s timeout**, so the worst a caller waits is **~4 s**. Never "allow on error". The gateway's raw body is never forwarded, and a 401 **never** causes this service to create or assume a guest. | An identity-service outage must not become an open upload endpoint. The gateway returns only 401 or 500 — never 403 — so there is nothing to mirror; 503 says "my dependency is down" (consistent with D12) instead of blaming the caller with a 500. One retry is what the contract itself calls reasonable, and the endpoint is two indexed primary-key lookups, so 2 s sits far above its real cost and only absorbs network trouble. Other flows in that system auto-register a guest when a token is rejected; this one must not. Nothing reaching the client may name the backend technology. |
| D7 | Every check **this service** performs — ticket missing, expired, spent, folder/count mismatch — answers a single **403** with no sub-code. Size is the one exception: **413**. | One opaque code gives no probing oracle, and D17 means no client needs to tell the cases apart. 413 and 403 mean different things to a client. |
| D8 | **The debug pages are removed**: `/test`, `/test.html`, `/compare`, `/compare.html`, `/stats`, `/stats.html`, and the Loki query proxy behind stats. | Each injects the key into public HTML; stats additionally proxies arbitrary LogQL unauthenticated. Independent of everything else here. |

### The ticket

| # | Decision | Rationale |
|---|---|---|
| D9 | The ticket binds **`user_type`, `user_id`, `folder`, `max_bytes`, `count`, `jti`** — nothing else. No `purpose`, no `resource_type`. `user_type` and `user_id` travel together everywhere as one identity (D22). | A ticket saying only "may upload" is redeemable for a huge object in someone else's folder, repeatedly. Type restriction was dropped deliberately: what makes a hostile file safe is how it is stored and served (D21), not whether an allowlist recognised its extension. |
| D10 | **`max_bytes` = 100 MB per request**, platform-wide, returned in the mint response. | One number, no table to keep in sync. Returning it lets the client reject an oversized file before sending bytes. Note this raises the effective limit from today's 10 MB (`upload.js:20-21`). |
| D11 | The ticket is an **opaque random token in Redis**, not a JWT. | Redis is already wired. It gives expiry, single-use and revocation for free, with no signing key to manage. A JWT can be neither used up nor cancelled. |
| D12 | **No fallback.** Redis unavailable → `/gated/ticket` and `/gated/upload*` return **503**. Redis becomes a documented hard dependency and is added to `/health`. | Redis is the permission store. An in-memory map would break single use, and would break outright the moment a second instance exists — the deployment is a single container today, so that failure would appear later and look random. `lockService.js:64-75` *does* fall back; that pattern must not be copied here. |
| D13 | **Single use.** The ticket is deleted when the upload request starts, atomically (`GETDEL`). | Deleting at the end lets two concurrent requests both pass the opening check. |
| D14 | **`count` is the number of files in one multipart request**, not a number of redemptions — so bulk mints once. It defaults to 1 and is capped by the existing `UPLOAD_BULK_MAX_FILES` (`upload.js:127`, default 50). Bulk keeps today's per-file behaviour: a bad file is skipped and reported, the rest still store. | One `GETDEL`, one request. All-or-nothing bulk would make one bad file in fifty force a full re-upload — a behaviour change for consumers who are only changing how they authenticate. |
| D14a | **`/gated/upload/bulk` is images-only.** A video part is rejected per-file (D14). Video is uploaded one at a time through `/gated/upload`, so the bulk route carries **no** probe, poster, instant-variant or queue path at all. | Matches how bulk is actually used, and keeps every video concern — the buffer dependency in D18, duration checks, the worker enqueue — on exactly one route instead of two. The current bulk handler does have a video branch (`upload.js:374-412`); it is simply not carried over. |
| D15 | Sent as the **`X-Upload-Ticket` header**. No cookies, no `credentials: "include"`. | A cross-origin cookie needs `SameSite=None` (silently broken in Safari) and is attached automatically, which is CSRF. A header is attached deliberately and behaves the same everywhere. |
| D16 | **TTL 120 s**, a **start** deadline: validated once when the request arrives, before the body is read, never re-checked while bytes stream. | A completion deadline fails a slow upload at 100 % progress. Once the ticket is single-use and scoped, a tighter TTL buys nothing. |
| D17 | Minted **when the user presses Upload**, never earlier. **No automatic retry** — any failure means the client mints a fresh ticket and the user retries. | The TTL only suffices if nothing sits between minting and sending. An auto-retry would need to distinguish "expired" from "denied", which D7 refuses to expose. |

### Upload handling

| # | Decision | Rationale |
|---|---|---|
| D18 | **The gated upload path streams to S3** via the existing `uploadStream` (`s3Client.js:89-104`) and never buffers the file. | Today media uploads are held entirely in RAM (`upload.js:154`, `:296`; bulk collects every file into an array at `:304` before writing any). At 10 MB that is harmless; at D10's 100 MB each concurrent upload would cost up to 100 MB of RSS. `uploadStream` is already multipart and memory-flat — this is reuse, not new machinery. `probeMedia`, `extractSnapshot` and `createWebpPosterVariant` all take buffers (`upload.js:207-245`), so they move to the worker (D29). Bulk is unaffected — it is images-only (D14a). |
| D19 | **Folder validation:** a `/`-separated relative path of plain segments (`product`, `product/descriptors`, `a/b/c`). Rejected: any segment `.` or `..`, leading/trailing `/`, empty segment, backslash, NUL, or any character outside `[A-Za-z0-9._-]`. The validated value is bound into the ticket at mint; the upload uses the ticket's folder. | Closes `upload.js:54-56` with the guard `files.js:133-142` already applies. With D20 the folder is the only client-controlled part of the key, and it can only name a directory inside `originals/`. |
| D20 | The object key stays **server-generated**, with two changes: `crypto.randomUUID()` instead of `Date.now()` + `Math.floor(Math.random()*1000)` (`upload.js:53`, `files.js:210`), and the extension from **sniffed magic bytes** instead of the client filename. | Not new behaviour — hardening. The current scheme silently collides for two uploads in the same millisecond (1-in-1000) and `Math.random()` is not a CSPRNG. Deriving the extension from bytes is what stops `x.html` being stored as HTML. |
| D21 | **Content safety, without a type allowlist:** stored extension and `Content-Type` come from sniffed bytes; SVG is never served inline (the `f_svg` passthrough at `transform.js:400-402` goes); anything not a recognised-safe image or video is served `Content-Disposition: attachment` rather than the current unconditional `inline` (`transform.js:57-62`). | Since any type may be uploaded, the whole defence is that the bytes decide what the object is and that anything unrecognised downloads instead of rendering. Mirrors the magic-byte check `files.js:74-101` already does for spreadsheets. |
| D22 | **Every object stored through `/gated/*` carries attribution in its S3 object metadata**: `user-type`, `user-id`, `ticket-jti`, `uploaded-at`. **`user-type` and `user-id` are both required** — they are one identity, never one field. | Today no upload is attributable to a person, and logs alone are not enough — log retention expires, the objects do not. The gateway's `id` is **not unique on its own**: `customer` 7, `seller` 7 and `admin` 7 are three different people, living in three tables with independent id sequences. Keying on the id alone would silently merge unrelated uploaders into one attribution record. The contract guarantees `user_type` is present and never null (the list is generated from the code into Swagger), so requiring it costs nothing. The **pair** resolves to a person in the dashboard, so the object stays traceable for as long as it exists. |
| D23 | **Never phone or email on the object** — the contact snapshot goes in the upload log line only (`user_type`, `user_id`, `phone`, `email`, `ticket_jti` via `request._logExtra`). **Placeholders are filtered to `null` before logging:** a `phone` of the literal string `"0"` and any `guest.*@guest.com` `email` are written as `null`, as are the genuine nulls the gateway returns for admins and sellers. Those two fields are used for nothing else. | S3 metadata cannot be edited in place, so a contact snapshot there goes stale the moment the user edits their profile and turns an erasure request into a rewrite of every object they ever uploaded. A log line is inherently point-in-time, which is the correct semantic for a snapshot. The filter follows the contract: guest rows carry filler the gateway returns exactly as stored, and an account that verified by OTP but was never promoted can still show it. With the filter, a value in this log is a real contact or nothing — nobody chases `"0"`. |
| D24 | The **video worker job payload carries the attribution** (`user_type`, `user_id`, `ticket_jti`) and the worker stamps it on the variants it writes. | Variants are written after the request ends (`upload.js:248` → `worker.js` → `videoJobs.js`), with no ticket in scope; without this, D22 covers originals only. The type travels with the id for the same reason it does on the object — the id alone names three different people (D22). Identifiers only: a failed job keeps its payload 24 h (`videoQueue.js:11`), so contact fields must not ride along — the log line already has them (D23). |
| D25 | **Rate limits:** `/gated/upload*` keyed on the identity pair from the ticket — bucket `u:<user_type>:<user_id>`, **20 requests/min** (matching the existing Excel limit; bulk is one request whatever its file count). Keying on the id alone would put `customer` 7 and `admin` 7 in one bucket, so one account could exhaust another's budget. `/gated/ticket` keyed on `sha256(access_token)` truncated to 32 chars. `trustProxy` (`app.js:108`) is narrowed from `true` to the real proxy hop count. The existing shared-bucket limiter (`app.js:162-165`) stays untouched on the legacy routes until the sweep — accepted. | An IP key is wrong for the mint: a web caller proxies through its own server, so every user would share one bucket — the defect being fixed. The token is one-per-caller by construction and cannot be forged for someone else. `trustProxy: true` currently trusts the whole `X-Forwarded-For` chain, so a caller can pick its own bucket. The hash is a limiter key only — never logged, stored or returned. |
| D26 | **CORS:** add `X-Upload-Ticket` to `allowedHeaders` and remove `X-API-Key` (`app.js:152`); set `CORS_ORIGIN` for production. | A custom header is only usable cross-origin once allow-listed. It also makes every upload a preflight plus a request — the accepted cost of D15. |
| D27 | `POST /gated/upload/excel` returns the **S3 key only**, no public URL. `GET /file/upload/*` is removed with the legacy sweep. | That route is allowlisted today (`auth.js:16`), so any spreadsheet is downloadable by anyone holding the URL — and the URL is not a secret (`files.js:210`). No end user downloads these files; the consumer reads them from S3. Removed on the migration's schedule because deleting a live delivery route is the kind of break this design avoids. |
| D28 | **No byte quota and no per-upload accounting table** — accepted risk. | Deliberate simplicity trade while the service is in development; the per-user rate limit (D25) is the only bound. See §7.3. |
| D30 | **The gateway response is never cached** — every mint calls it, which is one call per upload request (bulk mints once for its whole batch, D14). | The contract instructs it directly: blocking an abusive account, revoking a token or deactivating a user must take effect on the **next** request, and a cache turns a ban into a delay. It also states the endpoint is two indexed primary-key lookups, so it is cheap by design and the round trip is affordable. There is no lever to revisit here — a cache keyed by token hash would reintroduce exactly the revocation lag the contract forbids. |
| D29 | **The video poster/snapshot work moves to the worker.** `/gated/upload` streams the original to S3 and enqueues; it runs no probe, no `extractSnapshot`, no `createWebpPosterVariant` inline. The duration check moves to the worker with them. | Streaming (D18) removes the buffer those helpers need, and the delivery path already covers the gap both ways: poster targets (`snapshot`/`webp`) **transcode inline on a cache miss**, and byte targets (`full`/`preview`/`story`) serve the instant variant or the original as a playable fallback and enqueue the job (`transform.js:620-665`). So the inline work at upload was a warm-up, not a correctness requirement — its only cost is that the very first poster request after an upload is slower. Re-reading the object from S3 inside the request was the alternative and buys nothing for two extra transfers. |

## 4. Rejected

| Rejected | Why |
|---|---|
| Keep `x-api-key` as a fallback **on the gated endpoints** | Any accepted fallback is the bypass; the ticket work becomes decorative. This is not what D1 does — a legacy route being demolished on a schedule is not a permanent hole inside the new door. |
| A flag-day cutover (delete the key, everyone moves at once) | Makes a shipped mobile build the pacing item for a security fix, with no way back if the new flow misbehaves. Replaced by D1, at the cost stated in D2. |
| A `purpose` table deriving folder, types and limits | Would have to be enumerated against every upload site before anything could ship, to express limits that are uniform anyway (D10) and a folder guarantee D20 already provides. |
| A file-type allowlist | An allowlist that recognises extensions is not what makes an upload safe — sniffing bytes and refusing to serve anything unrecognised inline is (D21), and that works for types nobody enumerated. |
| JWT ticket signed with a local secret | Cannot be single-use or revoked, and adds key management for no gain over Redis, which is already running. |
| Ticket in a cookie | `SameSite=None` breakage plus CSRF, for zero benefit over a header. |
| Client-supplied object filename | Lets one caller overwrite another's object and makes collisions on common names a data-loss bug. |
| Silent re-mint and retry on failure | Requires telling "expired" apart from "denied", which D7 refuses to expose. |
| Phone/email in object metadata or the job payload | The attribution requirement is real, but an immutable object is the wrong carrier for a snapshot that goes stale (D23). |
| Treating the gateway's `id` as the identity on its own | Three account tables with independent id sequences: `customer` 7, `seller` 7 and `admin` 7 are three people. The id alone would merge them in the attribution metadata, the log, the job payload and the rate-limit bucket. The pair `(user_type, id)` is the identity (D22). |
| Caching the identity response | Directly against the contract. It would turn a block or a token revocation into a delay of however long the cache lives (D30). |
| Pointing an OIDC client library at the identity endpoint | The path reads `/userinfo`, but it is not an OpenID Connect endpoint and returns no OIDC claims (`sub`, `phone_number`, `email_verified`). It is a plain authenticated GET whose answer is unwrapped from the envelope's `data` (D4). |

## 5. Scope of work

One ticket, one branch. Files to change, in dependency order:

**New files**
- `services/ticketService.js` — mint / redeem (`GETDEL`) / validate against
  Redis. **No in-memory fallback** (D12).
- `api/ticket.js` — `POST /gated/ticket`: `GET /api/v1/userinfo` with the
  caller's token (2 s timeout, one retry on 500 — D6), envelope unwrap to `data`,
  flag **and** `user_type` check (D4), folder validation (D19), Redis write
  binding the identity pair (D9), `max_bytes` in the response.
- `api/gatedUpload.js` — `POST /gated/upload`, `/gated/upload/bulk`,
  `/gated/upload/excel`: ticket redemption at request start, **streaming to S3**
  (D18), 100 MB → 413, server-generated key from sniffed bytes (D20),
  attribution on the object (D22) and in `_logExtra` (D23). Only
  `/gated/upload` handles video; bulk is images-only with no video path (D14a).
  Excel returns the S3 key, no URL (D27).

**Changed files**
- `middleware/auth.js` *(protected path)* — `/gated/*` requires a ticket and
  never accepts `x-api-key`; **then**, at the cutover, delete the `API_KEY`
  check and the legacy allowlist entries including `/file/upload/`.
- `storage/s3Client.js` *(protected path)* — `putObject` (`:70-78`) and
  `uploadStream` (`:89-104`) take an optional `metadata` argument; today neither
  writes any.
- `app.js` — delete `/test*`, `/compare*`, `serveTestPage`, `serveComparePage`
  (`:252-301`) and the `api/stats.js` registration (`:305`); narrow `trustProxy`
  (`:108`); CORS headers (`:152`, D26); rate limiting (`:162-165`, D25); register
  the gated routes.
- `api/upload.js`, `api/files.js` — folder validation (D19), `crypto.randomUUID()`
  keys and sniffed extensions (D20) applied to the existing routes too; **then**,
  at the cutover, delete the legacy upload routes and `GET /file/upload/*`.
- `api/transform.js` — drop the `f_svg` passthrough (`:400-402`); safe
  `Content-Disposition` in place of the unconditional `inline` (`:57-62`,
  `:861-874`) (D21).
- `services/videoQueue.js`, `worker.js`, `services/videoJobs.js` — attribution in
  the job payload (D24).
- `.env.*` — gateway base URL and the 2 s per-attempt timeout in (D6);
  `CORS_ORIGIN` set for production; **then**, at the cutover, `API_KEY` out and
  the value rotated.

**Deleted**
- `api/stats.js`, `stats.html`, `test.html`, `compare.html` (D8).
- `src/scripts/fetch-and-upload.js` — its only credential was `API_KEY`.

> **The three "then, at the cutover" items are the only ones that break a
> consumer** (D2). Everything else is additive or invisible. They are held until
> the other developers confirm they have migrated — which is why this ticket
> cannot be verified and closed on the day the code is written. If that is
> unacceptable for ticket hygiene, they are the natural seam for a second ticket.

> `middleware/auth.js` and `storage/s3Client.js` are `protected_paths`
> (`.claude/project-config.yaml`) and must be named in the approved plan.

## 6. Depends on

- **Gateway — delivered.** `GET /api/v1/userinfo` is live and its contract is
  agreed (`GO-ME-API-CONTRACT.md`). Nothing is waiting on another team here.
  For a valid market access token it returns, under `data`: `id` (never null,
  **unique only when paired with `user_type`**), `user_type` (never null; one of
  `guest`, `customer`, `shop_employee`, `seller`, `admin`),
  `is_allowed_to_upload_files` (boolean, never null), and `phone`/`email`
  (either may be `null`, and guests carry placeholders — D23). Read-only, called
  once per mint, never cached (D30). Errors are 401 or 500 only (D6).
  Two limitations we inherit rather than fix: **seller tokens do not exist yet**
  (sellers still authenticate by session elsewhere, so no seller can reach the
  endpoint — the branch is implemented and will start working with no change on
  our side), and **admin tokens return 401 if the admin OAuth client has no
  `provider` configured**. Both are gateway-side; see §7.5.
- **Consumers** — three of them (web, dashboard, mobile), all authenticating with
  the same market token. Each moves to `/gated/*` on its own schedule and drops
  its copy of `API_KEY`; the web client needs a small server-side proxy for the
  mint because its token is in an HttpOnly cookie, and must forward the **user's**
  token, not a service credential, or D25's per-user limit degrades to per-server.
  No work in those repos is in scope here.

## 7. Carried to launch (no design question left)

Nothing here changes the implementation — the design is settled. These are
operational items for whoever prepares the service for real traffic.

1. **Restrict `/metrics` at the network layer.** With no key left, `/metrics` is
   open to anything that can reach the server. Firewall or security group, not
   code. Owner not yet assigned.
2. **Restrict log access.** D23 puts `phone`/`email` in the upload log line
   deliberately, so log access is now a privacy control and log retention is that
   snapshot's retention period. `app.js:90-92` redacts `x-api-key`/`authorization`
   — these fields are *not* redacted, by design, so the control has to be access.
3. **Revisit the quota.** With no accounting table (D28) and 100 MB per request
   (D10), a permitted account can sustain roughly 20 × 100 MB/min, bounded only
   by D25. Accepted while in development. If it needs a control later it is a
   per-upload record (`user_type`, `user_id`, `key`, `size`, timestamp) — cheap to add,
   painful to backfill.
4. **Objects uploaded before this ticket have no attribution.** No backfill is
   possible; the information does not exist anywhere. Everything uploaded after
   carries the pair `user-type` + `user-id` (D22), which the dashboard can
   resolve to a person — so the pair is sufficient forever, and beyond log
   retention it is all you need. Whoever reads that metadata must look up **both**
   fields: an id read on its own points at three different people.
5. **Two gateway-side gaps will look like bugs here.** No seller can upload,
   because seller tokens do not exist yet — every seller request stops at the
   gateway with a 401, which this service reports as 401 (D6) with no hint why.
   Admins get the same 401 if the admin OAuth client has no `provider` set. Both
   are configuration on the gateway's side, not defects in this service; when
   somebody reports "upload says I am not signed in", check that first. Owner not
   yet assigned.

## 8. Sequencing

Within the single ticket:

1. **Hardening + debug-page removal** — breaks no consumer, depends on nothing,
   and closes the content holes on the routes running today.
2. **Ticket service and gated routes** — additive, and no longer waiting on
   anyone: the gateway endpoint is live with an agreed contract (§6).
3. **Consumers migrate** to `/gated/*` (§6) — outside this repo, so this step is
   waiting, not working.
4. **Cutover** — delete the legacy routes and the `API_KEY` check, rotate the
   key. The only breaking step, and the only one gated on someone else. SEPERATE-TASK

Steps 1–2 can be built and reviewed in one pass. The key stays valid — and
anonymous upload therefore possible — until step 4; pre-production that is the
accepted cost of not forcing a flag day, but it must land before launch.
