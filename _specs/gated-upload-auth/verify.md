---
ticket: gated-upload-auth
stage: verify
mode: standard          # single workflow form — no other modes (ADR-011)
status: complete        # not_started | in_progress | complete
owner: developer
updated: 2026-07-29
links:
  clickup:
  github:
---

# Verify — gated-upload-auth

> Final validation and impact review before the ticket is closed.

**Outcome: PASSED.** All 24 acceptance criteria are mapped to an executed result
and pass. One clause of AC-21 — *"the container image still builds"* — could not
be executed on this machine and is recorded as a documented residual, accepted by
the owner at the gate.

**This is the second verification run.** The first returned **FAILED** on AC-8
and AC-19, both real defects in this ticket's own new code. They were fixed at
`/implement` (resume) and re-verified; see "Rework confirmed" below.

## Environment

This machine has **no Docker, no Redis, no ffmpeg and no ffprobe**, so the
compose stack the plan assumes could not be brought up. Rather than record
unexecuted criteria as passes, verification ran the **real route, service and job
code in-process** through two read-only harnesses that stub only the external
boundaries, by require-cache injection:

| Boundary | Stub | Why this is still a real test |
|---|---|---|
| `ioredis` | in-memory store, with an outage switch | the ticket lifecycle, quotas and `MULTI`/`EXEC` semantics under test are ours |
| `@aws-sdk/client-s3` + `lib-storage` | in-memory object store recording body, content type and user metadata | what is verified is which key, type and metadata *we* write |
| global `fetch` | scripted gateway (200/401/500) with call counting | the contract mapping under test is ours |
| `processors/videoProcessor` | encode/probe stubbed, returning a real PNG frame | the criteria concern *our* attribution and response shaping, not ffmpeg's correctness |

Both harnesses live in the session scratchpad and touched no repository file.
Where a stub means something was **not** demonstrated end to end, it is said so
explicitly below rather than glossed.

## Checks performed

- Validation profile: `standard` (resolved from `project-config.yaml` →
  check `syntax` → `bash -c 'find src -name "*.js" -print0 | xargs -0 -n1 node --check'`,
  `pass_when: exit-zero`)

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1 | Valid token + true flag + known type mints a ticket with lifetime and cap | harness A: `POST /gated/ticket` | 0 | `201`, `expires_in=120`, `max_bytes=104857600` | **pass** |
| AC-2 | 10 flag variants: `true`,`1`,`"1"`,`"true"` mint; `"false"`,`false`,`null`,missing,`"yes"`,`0` deny | harness A | 0 | all 10 gave the expected 201/403 | **pass** |
| AC-3 | Unrecognised `user_type` denied | harness A: `user_type:"robot"` | 0 | `403` | **pass** |
| AC-4 | 401→401 without retry; 500 retried once then 503; no guest assumed | harness A + call counter | 0 | 401: status 401, calls 1 · 500: status 503, calls 2 | **pass** |
| AC-5 | 9 traversal/illegal folders refused; plain multi-segment accepted | harness A | 0 | 9 × `400`; `a/b/c` → `201` | **pass** |
| AC-6 | Ticket past its deadline refused | harness A (TTL simulated by store expiry) | 0 | `403` | **pass** |
| AC-7 | Single use — same ticket twice | harness A | 0 | first `201`, second `403` | **pass** |
| AC-8 | Over-cap refused with 413, **nothing stored**; under-cap accepted | harness A: 11 MB vs 10 MB cap | 0 | `413`, **stored=null**; under-cap `201` | **pass** *(fixed)* |
| AC-9 | Missing / spent / unknown ticket give one identical answer | harness A | 0 | `403,403,403`, 1 distinct body | **pass** |
| AC-10 | Static key and cookie both refused under `/gated/*` | harness A | 0 | `403` and `403` | **pass** |
| AC-11 | Bytes override name/type; server-generated UUID key | harness A: HTML named `evil.jpg` | 0 | `originals/docs/<uuid>.bin`, `application/octet-stream` | **pass** |
| AC-12 | Object carries identity pair, jti, time; no contact fields | harness A: stored metadata | 0 | `{user-type,user-id,ticket-jti,uploaded-at}`, no phone/email | **pass** |
| AC-13 | Log carries identity + jti; `"0"` phone and guest email become empty | harness A: guest + real account | 0 | guest `{phone:null,email:null}`; real phone preserved | **pass** |
| AC-14 | Job payload carries attribution; worker stamps every variant; a job without attribution still runs | harness B: real `generatePolishedVariants`, stubbed encode | 0 | payload has identifiers only (no contact); 2/2 variants stamped; unattributed job wrote 2 variants with no metadata | **pass** |
| AC-15 | Bulk stores images, reports a video part as skipped | harness A: 2 images + 1 mp4 | 0 | `201`, 2 urls, 1 skipped entry | **pass** |
| AC-16 | Gated story upload: 10 MB cap, story variants, duration, warm poster | harness B | 0 | `201`, `durationSeconds=12.5`, `story.enabled`, 5 variant urls, 2 derived objects stamped with attribution | **pass** |
| AC-17 | Profile folder bare path; excel returns key with no url | harness A | 0 | `/customers/profile/<uuid>.jpg`; excel keys `key,filename,originalName,contentType` | **pass** |
| AC-18 | Legacy route: traversal refused, UUID name, sniffed extension | harness A: legacy `/upload` | 0 | traversal `400`; key `originals/safe/<uuid>.bin` | **pass** |
| AC-19 | Unrecognised bytes download; recognised image renders inline | harness A: real PNG + unrecognised object | 0 | PNG `200 inline`; unrecognised `200 attachment` | **pass** *(fixed)* |
| AC-20 | Store down → mint/upload 503, health still 200 and reports it | harness A: store switched off | 0 | mint `503`, upload `503`, health `200` `ticket_store:"unavailable"` | **pass** |
| AC-21 | Pages/proxy/helper gone; no page serves the key; image builds; commands resolve | static + `node` script | 0 | 5 files gone; `Dockerfile` COPY clean; no stale compose mounts; all 8 packaged commands resolve; `API_KEY` appears only in the auth comparison. **`docker build` not executed** — see residual | **pass** (with residual) |
| AC-22 | CORS allows `X-Upload-Ticket`, still allows `X-API-Key` | harness A: preflight | 0 | `content-type, x-api-key, x-upload-ticket, range` | **pass** |
| AC-23 | Same id, different account type → different buckets | harness A: two tickets, id 7 | 0 | `u:customer:7` vs `u:admin:7` | **pass** |
| AC-24 | Every source file parses; revert restores behaviour, nothing migrated | profile `syntax` + harness B backward-compat | 0 | all files parse; `putObject`/`getObjectStream` behave identically with the new arguments omitted | **pass** |

Totals: **24 pass · 0 fail**.

## Commands run

- `bash -c 'find src -name "*.js" -print0 | xargs -0 -n1 node --check'`
  ```
  exit=0   (every file under src/ parses)
  ```
- Harness A — routes against stubbed Redis / S3 / gateway:
  ```
  SUMMARY  pass=20 fail=0 could-not-run=4 total=24
  AC-8   over=413 under=201 sent=11MB stored=null (truncated_and_stored=false)
  AC-19  png: status=200 disp=inline | unrecognised: status=200 disp=attachment
  ```
- Harness B — video path and worker job with the encoder stubbed:
  ```
  SUMMARY  pass=5 fail=0
  AC-16   status=201 duration=12.5 story=true variants=5
  AC-16b  derived_objects=2 meta={"user-type":"customer","user-id":"15832",...}
  AC-14   payload_ok=true variants_written=2 all_stamped=true
  AC-14b  ran=true writes=2 (no metadata, as expected)
  AC-24b  metadata=undefined body="hi"
  ```
- AC-21 static checks: five deleted files absent; no `test.html`/`compare.html`/
  `stats.html` reference in `Dockerfile` or either compose file; all eight
  `package.json` scripts resolve to existing files; `process.env.API_KEY` occurs
  only at `src/middleware/auth.js:48`.
- `git status --porcelain` before and after validation — identical (VP-2 / VF-7);
  no implementation file modified, no commit created (VF-10).

## Rework confirmed (first run returned FAILED)

- **AC-8** — an over-cap upload was accepted and stored truncated, because
  `@fastify/multipart` truncates at `limits.fileSize` instead of raising. The
  counting guard is now the single enforcement point with multipart's limit set
  above it, so the guard fires mid-stream and the multipart upload aborts.
  Re-verified: `413`, **nothing stored**.
- **AC-19** — unrecognised content returned 500 because removing the `f_svg`
  passthrough left `sendOriginal` unreachable. `handleImage` now routes anything
  whose stored extension is not inline-safe to `sendOriginal`, which sets the
  disposition from the stored content type. Re-verified: `200 attachment`, with a
  real PNG still `200 inline`.

Both fixes touched only files already in the approved plan
(`gatedUpload.js`, `transform.js`, `byteSniffer.js`). No plan revision was needed.

## Residual — not executed here

**AC-21, clause "the container image still builds".** Docker is not installed on
this machine. What *is* verified: the only build-affecting change this ticket
makes is removing `COPY test.html compare.html stats.html ./` from the
`Dockerfile`, and that line is confirmed gone with no other reference to the
deleted files anywhere in the build or compose files — so the specific failure
this clause exists to catch cannot occur. The build itself was not run.

**Action for whoever deploys:** run `docker build .` on a host with Docker before
merging. This is recorded as an accepted residual by the owner at this gate, not
as a passing observation.

The `/verify` harnesses also stub ffmpeg, so AC-14 and AC-16 verify *our*
attribution and response shaping, not real transcoding. A first run on a host
with ffmpeg is worth doing for confidence in the encode itself.

## Protected-path & runtime impact review

- **Were any `protected_paths` files changed by this ticket? — YES.**
- Which files, and were the changes intended and reviewed:
  - `src/middleware/auth.js` — `/gated/*` branch before the allowlist, matched on
    the parsed pathname, with `/gated/ticket` exempt from the ticket requirement;
    deleted-page entries removed. **Legacy clauses deliberately unchanged** — the
    known allowlist bypass remains an accepted, recorded risk for the migration
    window, with a comment at the line so it is not "fixed" by accident.
  - `src/app.js` — debug/stats routes removed, gated routes registered,
    `X-Upload-Ticket` added to CORS while `X-API-Key` was kept, `/health` reports
    the store. `trustProxy` untouched.
  - `src/storage/s3Client.js` — optional `metadata` and `range` arguments;
    backward compatibility executed and confirmed (AC-24).
  - `src/services/videoPreprocessor.js` — `createWebpPosterVariantFromPath`
    added; the buffer variant unchanged.
  - `Dockerfile` — HTML pages dropped from the copy list.
  - `docker-compose.prod.yml` — task concurrency 1, job concurrency 2, job timeout.
  All six are named in the approved `plan.md > Files to change`, which is what made
  editing them legal (GU-2 / IM-5), and all were reviewed at `/review`.
- **Runtime impact:** delivery streams video-byte targets on both the warm and
  cold paths instead of buffering (lower memory per viewer); worker task
  concurrency drops to 1 with job concurrency 2 (at most two ffmpeg children;
  backfill also runs one task at a time unless overridden); `/health` performs a
  Redis `ping` per call; each gated upload adds one Redis read for its rate-limit
  key and, for video, one temp file bounded by the request cap. Legacy upload and
  delivery behaviour is otherwise unchanged, except that newly stored objects get
  UUID names and byte-derived types, and unrecognised content now downloads
  instead of erroring.

## Sign-off

- Outcome: **verified**
- Final ticket state: `closed`
- Sign-off: `developer` (single self sign-off; ADR-011), after the comprehension
  check at **4/4** covering the integration axis (video helpers shared by three
  callers), the AC-8 root cause, the AC-19 fix, and the rollback residual.
- Commit: none created at verify (VF-10 / ADR-008 — committing is the delivery
  boundary's job, owned by `/publish-pr`)
- Notes:
  - `.env.development` and `.env.production` are gitignored, so the new
    configuration keys are **not** in the branch and will not travel in the PR.
    **`GATEWAY_BASE_URL` must be set in the deployment** or every mint answers 503
    by design. The compose files carry the concurrency and timeout values, so
    those do travel.
  - The deviation recorded in `implement.md` — the ticket record carrying
    `phone`/`email` so AC-13 can be satisfied — was exercised and behaves as
    described: the contact fields reach the log line only, never the stored object
    (confirmed by AC-12) and never a job payload (confirmed by AC-14).
  - Out of scope and unchanged, by recorded decision: the legacy allowlist bypass.
    Anonymous keyless upload to `/upload`, `/upload/bulk` and `/upload/excel`
    remains possible until the cutover ticket. Pass A removed the pages that leak
    the key, so those routes now *look* protected while this stands.
