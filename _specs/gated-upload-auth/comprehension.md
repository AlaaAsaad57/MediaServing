---
ticket: gated-upload-auth
stage: review              # the gate that last updated this record
mode: standard             # single workflow form — no other modes (ADR-011)
status: complete           # not_started | in_progress | complete
owner: developer           # the ticket owner (self-review)
updated: 2026-07-29
result: passed             # quiz outcome — were ALL answers correct? (CG-4)
score: 4/4                 # correct / total
decision: APPROVED         # gate decision (the notification hook reads these — ADR-013)
missed:                    # empty when passed
links:
  clickup:
  github:
---

# Comprehension — gated-upload-auth

> Single-owner gate control (ADR-011 / ADR-014 / CG-1..CG-6). At each gate the
> owner answers multiple-choice questions (**≥4 options each**) generated **from
> the artifact under review**. One section per gate — never overwrite another
> gate's section. The gate records its decision **only if 100% of answers are
> correct** (CG-4); any wrong answer blocks it. Each question's options are listed
> **alphabetically** — the correct answer's position must carry no signal.
>
> **English only.** Questions, options, answers, and every other word in this file
> are written in English — whatever language the conversation used (CLAUDE.md).
>
> **Three rows is the floor, not the form** (CG-1): add rows freely. Every gate
> carries **≥1 integration / cross-flow question** (CG-5), and `/review` adds
> **one row per `major` panel finding** on top of the floor (CG-6).

## Review gate

> Questions derived from `plan.md` + `spec.md` (CG-2), incl. `plan.md >
> Integration surface` and the Step 1a panel findings. Answered before recording
> the `/review` decision.
>
> Asked on `plan.md` **revision 5**. The advisory panel returned **zero `major`
> findings** this round, so CG-6 added no rows; four questions were asked against
> a floor of three.

| # | Question (from the artifact) | Source (plan §/AC-n/panel:lens) | Axis | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|------|---------------------------------|----------------|----------|
| 1 | The gated-upload rate-limit key generator does a **non-destructive** read of the ticket. What breaks if it consumes the ticket instead? | `plan.md > Integration surface` ("What breaks if this is wrong"); step 9; AC-7, AC-23 | **integration (CG-5)** | a) Bulk minting changes — bulk would mint one ticket per file instead of one per request. b) **Redemption finds nothing — the key generator runs in an `onRequest` hook, before the handler, so the handler's `MULTI`/`EXEC` redemption would find the ticket already gone and every gated upload would fail. (correct)** c) The mint ceiling stops — the mint route would stop enforcing its outbound identity-call ceiling. d) Two accounts share a bucket — same id, different account types, one bucket. | b) Redemption finds nothing | ✅ |
| 2 | Deleting `test.html` and `compare.html` forces which other file to change in the same lockstep group? | `plan.md > Integration surface` (ordering/lockstep); step 5; AC-21 | integration / ordering | a) `.env.production` — the pages read configuration from it. b) `docker-compose.prod.yml` — it mounts the pages into the production container. c) **`docker-compose.yml` — the development compose file bind-mounts both pages read-only; left in place, `docker compose up` recreates them as empty directories, in the very stack where the acceptance checks run. (correct)** d) `src/api/stats.js` — it serves those two pages. | c) `docker-compose.yml` | ✅ |
| 3 | Which file is deliberately **not** in "Files to change", and why does the plan get away with that? | `plan.md > Files to change` ("Deliberately not changed"); step 12; AC-14 | protected paths / scope | a) `docker-compose.prod.yml` — not listed; the split is applied only via environment files. b) **`src/services/cacheService.js` — protected and not changed: the worker and the gated route write attribution by calling the storage helper with metadata directly, instead of going through the cache helper. (correct)** c) `src/services/videoPreprocessor.js` — not listed; the poster helper stays buffer-only. d) `src/storage/s3Client.js` — not listed; the new arguments go on the callers. | b) `src/services/cacheService.js` | ✅ |
| 4 | Image delivery still buffers whole objects. What actually bounds that residual? | `plan.md > Out of scope` (named residual); step 13; FR-14 / AC-8; panel:security (round 4) | risk / residual | a) Add range to image path — apply the new optional range argument as the video targets do. b) **Lower the image cap — nothing in this plan bounds it; Sharp decodes from a buffer, so the only bound is lowering the upload cap for images, a `spec.md` change (FR-14 / AC-8) and therefore the owner's decision, with `/verify` measuring it. (correct)** c) The per-identity rate limit on the gated upload routes. d) The per-job ffmpeg timeout that kills the child and removes its temp output. | b) Lower the image cap | ✅ |

- Score (optional, only if `comprehension_gates.ai_graded`): 4/4 — 1.0

## Verify gate

> Questions derived from `implement.md` + `spec.md` (CG-2), incl. whether the
> plan's declared Integration surface held. Answered before recording PASSED at
> `/verify`. No panel here (ADR-012) — CG-6 does not apply.

| # | Question (from the artifact) | Source (implement.md/AC-n/plan §) | Axis | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|-----------------------------------|------|---------------------------------|----------------|----------|
| 1 |                              |                                   |      |                                 |                |          |
| 2 |                              |                                   |      |                                 |                |          |
| 3 |                              |                                   | integration (CG-5) |                   |                |          |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a
