---
ticket: gated-upload-auth
stage: review
mode: standard          # single workflow form — no other modes (ADR-011)
status: complete        # not_started | in_progress | blocked | complete
owner: reviewer
updated: 2026-07-29
links:
  clickup:
  github:
---

# Review — gated-upload-auth

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

**Round 5 — the approving round.** `spec.md` (AC-1..AC-24, unchanged) and
`plan.md` **revision 5**. The advisory panel re-ran read-only over both artifacts
under the owner's standing directive, "Don't over-engineer at all".

**Convergence across all five rounds:** 7 `major` → 6 → 3 → 2 → **0**.

| Round | Decision | Majors | What it closed |
|-------|----------|--------|----------------|
| 1 | CHANGES_REQUESTED | 7 | dev compose mounts; gated video byte source; trusted-proxy scope; mint amplification; worker memory, wall clock, delivery transcode |
| 2 | CHANGES_REQUESTED | 6 | AC-17 verification dead end; compose concurrency override; video-byte fallback; mint bound honesty |
| 3 | CHANGES_REQUESTED | 3 | missing video-helper files; worker memory arithmetic; temp-disk statement |
| 4 | CHANGES_REQUESTED | 2 | AC-23 had no step; warm delivery path buffering |
| 5 | **APPROVED** | **0** | — |

The recurring defect of rounds 1–3 — a required file missing from "Files to
change" — is closed and was independently re-verified this round: the senior lens
walked the list against the repository and confirmed it complete, and the
security lens confirmed all six touched protected paths are listed with every
"deliberately not changed" claim holding.

## Plan Summary

Two passes. Pass A hardens the routes running today: byte-derived types, folder
guard, random object names, safe content disposition, and removal of the debug
pages, the statistics route and the key-carrying helper script. Pass B adds the
`/gated/*` family beside the existing routes — mint a short-lived single-use
ticket from the identity gateway, redeem it once per upload, stream the bytes to
storage, and stamp the identity pair onto the object and the background job.

Video work is split by cost: the temp file written from the incoming stream
carries probe, snapshot and poster (warm at upload, `durationSeconds` in the
response); the heavy transcodes stay on the worker, bounded by job concurrency 2,
task concurrency 1, and a per-job timeout that kills the ffmpeg child. The
delivery route streams video-byte targets on both the cache-miss and cache-hit
paths. Six protected paths are listed for change.

## Risks

- **Accepted, owner decision:** anonymous keyless upload remains possible on the
  legacy routes for the whole migration window, via the pre-existing allowlist
  bypass that matches the query string. Pass A removes the pages that leak the
  key, so those routes will *look* protected while this stands. The cutover
  ticket inherits it.
- **Named residual:** image delivery still buffers whole objects, because Sharp
  decodes from a buffer. Under FR-14 an image may be up to 100 MB, so a burst of
  range-less GETs for one large warm image costs that much heap per request on an
  unauthenticated route. Bounded only by lowering the cap — a `spec.md` change.
  `/verify` measures it so the number is on record.
- **Stated residual:** behind a proxy the mint route's peer bucket collapses to
  one bucket, so an abusive source can consume the shared outbound ceiling and
  deny minting to others — a denial of service, not an amplification.
- A large video that is not web-playable has no playable variant until the worker
  finishes; delivery serves the original, which may not play in a browser.
- Temp disk is measured, not bounded: concurrent gated video uploads each hold a
  file up to the cap, on the same disk the worker's ffmpeg uses.

## Assumptions

- The identity gateway is live and behaves as `GO-ME-API-CONTRACT.md` states.
- The legacy routes and the static key stay live and unchanged until the cutover
  ticket (OQ-1).
- Redis is reachable wherever uploads are expected to work.
- The deployment's real proxy hop count stays unknown and is an operational item
  (OQ-11); `.env.production`'s `PUBLIC_BASE_URL` is a placeholder, which is why
  the global trusted-proxy setting is left alone.

## Open Questions

- **Should video and images keep a lower cap than 100 MB?** Raised by the panel
  in all five rounds. It drives the image residual above and drove seven earlier
  findings. It is a `spec.md` change (FR-14 / AC-8) and remains available to the
  owner at any time — including before `/implement`.

## Panel Findings (advisory)

> Findings from the advisory review panel (senior / security / performance) run
> at Step 1a — read-only lenses over `plan.md` + `spec.md` (ADR-012 / RP-1).
> **Advisory only:** these inform the owner; they never block the decision (RP-2).

| Lens | Severity | Finding | Ref | Owner's disposition |
|------|----------|---------|-----|---------------------|
| senior | — | **Zero findings.** Verified against the repository: the rate-limit key generator runs in an `onRequest` hook, so the non-destructive read genuinely precedes the handler's `MULTI`/`EXEC` and AC-7 is untouched; the peer-address fallback (rather than the proxy-aware address) is what keeps NFR-8/AC-23 true given `trustProxy` is left on; the legacy 10 MB cap confirms the inline-poster path is cold by construction, so dropping its threshold costs nothing; the three concurrency readers map exactly as named; Files-to-change remains complete, and AC-13 needs no extra file because the app already merges `_logExtra` into the request line generically. Nothing in revision 5 is over-built — two of its five changes remove scope. | `plan.md` steps 9, 12, 13; Files to change | **Accept — no action.** |
| performance | — | **Zero findings.** Warm-path streaming is strictly cheaper than buffering (removes a whole-object heap allocation, first byte sooner, backpressure handled by the pipe). The extra Redis read is one sub-millisecond `GET` on a request that then performs a multipart body read and an S3 multipart write — immaterial. Backfill at task concurrency 1 is an offline batch job with a documented override, and the key deliberately keeps its name so that reader is not orphaned. | `plan.md` steps 9, 12, 13 | **Accept — no action.** |
| security | — | The round-4 major is **closed**: video-byte targets stream on both the miss and hit paths, and the image residual is named with its bound rather than hidden. The non-destructive ticket read creates no material exposure — the ticket value is never echoed, the bucket key is internal, `MULTI`/`EXEC` remains the sole consuming step, and the peer fallback is not header-steerable. Dropping the poster threshold is safe as justified. | `plan.md` steps 9, 13; Out of scope | **Accept — no action.** |
| security | minor | Because the key generator's ticket read decides which bucket applies, the `x-ratelimit-*` headers differ between a request with a live ticket and one with an expired or spent ticket — a weak oracle separating those cases from a folder or count mismatch, even though the response body is the uniform forbidden result (NFR-4 / AC-9). Exploitable only by a caller who already holds the ticket, so impact is low. | `plan.md` step 9; NFR-4, AC-9 | **Accept — closed at implementation, no plan change.** The gated-upload bucket and the peer fallback carry the **same limit and window**, so the headers cannot diverge. The plan leaves limit values to configuration, so this is a config choice within its latitude rather than a new step. The AC-9 verification additionally checks the response headers, not only the body, so the property is proven rather than assumed. |

## Decision

`APPROVED`

- Rationale: the plan is complete, executable and traceable to the acceptance
  criteria. Every `OQ-n` is answered (RV-3 / PL-12), the Integration surface names
  the cross-flow risks concretely rather than restating the steps (PL-11), all six
  protected paths this work touches are listed with justification — which is what
  makes editing them legal at `/implement` — and the five protected paths that are
  *not* touched are each named with the reason. The panel returned **zero `major`
  findings** for the first time, with two lenses independently confirming against
  the repository that the file list is complete and the mechanisms sound. The one
  `minor` is closed by a configuration choice already inside the plan's latitude
  and is verified rather than assumed.
- Four rounds of `CHANGES_REQUESTED` preceded this. Each closed real defects: a
  verification dead end that would have made the ticket impossible to close, three
  separate instances of a required file missing from the change list, an
  unauthenticated container-restart vector, and an acceptance criterion with no
  implementing step. Approving earlier would have spent an implementation cycle to
  discover them.
- Two risks are approved **knowingly**, not overlooked: the legacy allowlist
  bypass (owner decision, recorded in the plan's Out of scope with its full
  consequence) and the image-delivery buffering residual (named, bounded only by a
  cap change that remains the owner's). Both are stated in the plan so
  `/implement` and `/verify` cannot rediscover them as surprises.
- Comprehension check: **4/4 correct** (CG-4 requires 100%), covering the
  integration axis (CG-5), the lockstep ordering, the protected-path scope, and
  the named residual. Recorded in `comprehension.md`. CG-6 added no questions
  because there were no `major` findings.

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner): `developer` — self-review under the single-owner model
  (ADR-011, RA-1), after passing the comprehension check 4/4 on 2026-07-29. One
  approval, as `workflow_form.approvals` requires (MO-4).

## ADR reference

> Optional — record an ADR only if the decision is notable; otherwise "none".

- ADR: none recorded. Two candidates remain optional (`adr_required: false`) and
  can be written at any point: the deliberate acceptance of the legacy allowlist
  bypass for the migration window, and the decision to keep three mint bounds
  against the panel's advice.

## Required Follow-up Actions

- None blocking. Implementation may begin.
- Carried into `/implement` and `/verify` as recorded items, not new work:
  - the gated-upload bucket and its peer fallback carry the **same limit and
    window** (security minor), verified through AC-9's header check;
  - `/verify` records the image-delivery buffering measurement, the
    gated-versus-legacy upload time, the disk-headroom number, the log-retention
    expectation for the contact fields, and the public retrievability of gated
    spreadsheet objects.
- Available to the owner at any time: lower the upload cap in `spec.md`, which
  would close the image residual and shrink three of the plan's stated worst
  cases.
