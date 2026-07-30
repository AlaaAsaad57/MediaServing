# Workflow V1 — Guide for AI-authored / human-reviewed tickets

> Step-by-step for the way you run Engineering Workflow v1: **Claude authors**
> the artifacts and implementation, and **a human (you or a teammate) reviews and
> verifies** at the two gates. This satisfies separation of duties *without*
> weakening any guardrail.
>
> Companion to `WORKFLOW_V1_RUNBOOK.md` (full detail) and
> `WORKFLOW_V1_DEVELOPER_CHEAT_SHEET.md` (quick reference). Canonical sources win
> on any conflict: `.claude/project-config.yaml`, `.claude/rules/*`,
> `.claude/docs/command-architecture.md`.

---

## 0. Why this works — author vs reviewer (READ FIRST)

The gates `/review` and `/verify` enforce **separation of duties** (RA-3):

> the reviewer must **not be the author** of the work under review.

This is a check on **two distinct actors**, not on the same person playing two
roles. So the model below is naturally compliant:

| Actor | Role | Does |
|---|---|---|
| **Claude** (`ai_agent`) | author | `/research`, `/spec`, `/plan`, `/implement` — history records `by: ai_agent` |
| **You / a teammate** (human) | reviewer | `/review`, `/verify` — a *different* actor from the author |

Because the author is `ai_agent` and the reviewer is a human, the two actors
differ → **RA-3 passes**. You do **not** enable self-review; leave it off:

```yaml
separation_of_duties:
  enabled: true
  allow_self_review:
    standard: false      # leave as-is — you do NOT need to flip this
    high_risk: false
```

### The one thing you must get right: attribute authorship to `ai_agent`

By default `/start-ticket` sets `owner: developer`. If **you** are recorded as
the owner/author and then **you** review, that *is* self-review and RA-3 blocks
it. So always start tickets with the author set to Claude:

```
/start-ticket <slug> "title" mode=standard owner=ai_agent
```

Then the human simply acts as the reviewer at the two gates. No config change.

### Two honest caveats

1. **The human review must be real.** This is meaningful separation of duties
   only if the human genuinely, critically reviews Claude's plan and diff — not a
   rubber stamp. That human judgement is the entire quality gate.
2. **`high_risk` needs two humans.** If a ticket touches a `protected_paths`
   entry it *must* be `high_risk` (MO-3), which requires **2 approvers + an ADR**
   and can never self-review. Author = `ai_agent`, reviewer = human #1, second
   approver = human #2. Protected paths: `proxy.ts`, `serverRequests/**`,
   `utils/cookies/**`, `app/api/auth/**`, `services/auth.ts|cart.ts|order.ts|orders.ts`,
   `store/index.ts`, `next.config.ts`.

---

## 1. Who does what

| Step | Run by | Mindset |
|---|---|---|
| `/start-ticket` (with `owner=ai_agent`) | Claude (you trigger it) | bootstrap; record Claude as author |
| `/research`, `/spec`, `/plan`, `/implement` | **Claude (author)** | build the smallest correct change; touch only planned files |
| `/review` (gate 1) | **Human (reviewer)** | "Is this plan right *before* any code is written?" |
| `/verify` (gate 2) | **Human (reviewer)** | "Does every acceptance criterion actually pass?" |
| `/publish-pr` (delivery) | Claude / you | open the GitHub PR after closure |

State lives in exactly one place — `_specs/<slug>/ticket.md > state`. If you ever
lose track, read that field.

---

## 2. Happy path — full step-by-step (standard ticket)

Replace `<slug>` with a short kebab-case name, e.g. `fix-settings-button`.

### Step 1 — Intake (Claude authors)  → state `draft`
```
/start-ticket <slug> "Short clear title" mode=standard owner=ai_agent
```
- Creates `_specs/<slug>/ticket.md` (state `draft`, **owner `ai_agent`**) and
  `intake.md`.
- Then fill `_specs/<slug>/intake.md` and set **Readiness Status: READY**
  (`/research` won't run until it's READY).
- *(From ClickUp instead? See §5.)*

### Step 2 — Research (Claude)  → state `ready-for-research`
```
/research <slug>
```
Read-only investigation → `research.md` (dirs, config, affected services,
validation commands, risks, open questions). No source touched.

### Step 3 — Spec (Claude)  → state `research-complete`
```
/spec <slug>
```
`spec.md`: business goal, user story, requirements, constraints, edge cases,
**acceptance criteria with stable IDs `AC-1`, `AC-2`, …**, out-of-scope. **No
implementation detail.**

### Step 4 — Plan (Claude)  → state `spec-complete`
```
/plan <slug>
```
`plan.md`: approach, steps, **Files to change**, validation strategy, rollback,
out-of-scope. Optionally name a validation profile (see §6).

> ⏸ **Hand-off point.** Authoring is done. A **human** now takes the next step.

### Step 5 — Review gate (Human reviewer)  → state `approved`
```
/review <slug> APPROVED "what you checked and why the plan is sound"
```
- The human reviewer makes this call — confirm the plan maps to every
  requirement/AC, scope is bounded, the files-to-change list is complete.
- RA-3 passes automatically because the author is `ai_agent` and you're the
  reviewer (no self-review flag needed).
- Other outcomes:
  - `CHANGES_REQUESTED "what to fix"` → stays `spec-complete`; Claude revises via
    `/plan` (revision), then re-review.
  - `REJECTED "why"` → `closed` (terminal); open a new ticket to revisit.

### Step 6 — Implement (Claude)  → state `implemented`
```
/implement <slug>
```
Creates branch `ticket/<slug>` from **clean `main`** (commit/stash other work
first), applies **only** the files in `plan.md`, writes `implement.md`, leaves
changes **uncommitted**. If it blocks (`status: blocked`): revise via `/plan` then
resume, or clear the blocker and re-run `/implement` (resume — same branch).

### Step 7 — Verify gate (Human reviewer)  → state `closed`
```
/verify <slug>
```
- The human verifier maps **every `AC-n`** to a result, runs any validation
  profile, records the protected-path impact statement.
- **PASSED** → `implemented → verified → closed`. Done.
- **FAILED** → `implementation-in-progress` + `status: blocked`; Claude fixes via
  `/implement` (resume), then re-verify.

### Step 8 — Publish (optional)  → state unchanged
```
/publish-pr <slug>
```
Creates the single publishable commit on `ticket/<slug>` (implementation +
`implement.md` + `verify.md` + closure), pushes, opens/reuses a GitHub PR via
`gh`, writes the URL to `ticket.md > links.github`. Needs `gh` authenticated.
State does not change.

---

## 3. The one-screen checklist

```
□ /start-ticket <slug> "title" mode=standard owner=ai_agent   → draft   [Claude]
□ edit intake.md → Readiness Status: READY
□ /research <slug>                               → ready-for-research   [Claude]
□ /spec <slug>   (writes AC-1, AC-2, …)          → research-complete    [Claude]
□ /plan <slug>   (Files to change + rollback)    → spec-complete        [Claude]
──────── hand off to a human reviewer ────────
□ commit/stash unrelated work; main is clean
□ /review <slug> APPROVED "rationale"            → approved             [Human]
□ /implement <slug>  (branch ticket/<slug>)      → implemented          [Claude]
□ /verify <slug>                                 → closed               [Human]
□ /publish-pr <slug>   (optional GitHub PR)      → unchanged
```

---

## 4. When it's high_risk (needs two humans)

A ticket is `high_risk` if its plan touches any `protected_paths` entry, is
irreversible, or has wide blast radius:
```
/start-ticket <slug> "title" mode=high_risk owner=ai_agent
```
- `/review` needs **2 approver names + an ADR reference** (no self-review, ever).
  Author = `ai_agent`, reviewer = human #1, second approver = human #2.
- `/verify` depth = **every AC + a rollback rehearsal**.

Don't downgrade high_risk to standard to avoid the second approver — that's a
guardrail violation; escalate a mode dispute to the Workflow Owner.

---

## 5. Start from a ClickUp task (optional, read-only)

Token is wired in `.claude/settings.local.json` (`CLICKUP_API_TOKEN`).
```
/start-ticket clickup_id=<task-id> owner=ai_agent            # slug → cu-<task-id>
/start-ticket <slug> clickup_id=<task-id> owner=ai_agent     # explicit slug
```
Imports title → ticket title, description → intake summary, URL →
`links.clickup`. Nothing is written back to ClickUp. Then continue from Step 1's
intake/READY onward.

---

## 6. Validation profiles (optional — makes `/verify` run real checks)

Name **one** profile in `plan.md` Validation strategy; `/verify` runs it locally
and records command + exit code + output → `AC-n`:

| Profile | Runs | Use for |
|---|---|---|
| `standard-frontend` | `tsc --noEmit` + `pnpm lint` | normal standard tickets |
| `full-build` | typecheck + lint + `pnpm build` | high-blast-radius / high_risk |

No profile named ⇒ `/verify` behaves exactly as before. Local execution only (no
CI/GitHub/MCP).

---

## 7. Gotchas

- **Gate aborts `RA-3`?** The ticket owner/author is recorded as a human, not
  `ai_agent` — so the human reviewer counts as the author. Fix: start tickets
  with `owner=ai_agent` (§0). Do **not** enable self-review to work around it.
- **Review must be real.** Author=AI + human reviewer is only meaningful if the
  human critically reads the plan/diff. Use `CHANGES_REQUESTED` when it's not
  right.
- **`/implement` blocks on dirty `main` / branch collision (`IM-8`).** Clean
  `main` before Step 6; resume reuses the existing `ticket/<slug>` branch.
- **`/verify` is binary.** PASSED (close) or FAILED (rework) — no "partial". An
  AC that can't be evidenced can't be recorded passing, so you can't close.
- **`closed` is terminal.** No reopen — open a new ticket.
- **Lost?** `_specs/<slug>/ticket.md > state` is the single source of truth.

---

*Reflects current behavior. No guardrail is weakened: separation of duties stays
enabled and self-review stays off — compliance comes from author (`ai_agent`)
and reviewer (human) being distinct actors.*
