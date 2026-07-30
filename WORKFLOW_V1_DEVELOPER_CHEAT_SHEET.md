# Workflow V1 — Developer Cheat Sheet

> ⚠️ **Superseded (ADR-011).** No modes, no risk tiers, no separate reviewer — one
> uniform workflow form run by a **single owner** who runs their own `/review` and
> `/verify` (self-review). The gate control is a **comprehension check** (answer
> 2–3 questions generated from the artifact under review) before recording a
> decision. Every ticket: 1 self-approval, ADR optional, `all-ac` verification.
> Read any "mode"/`standard`/`high_risk`/"different reviewer"/two-approver text
> below as the single-owner form + comprehension gate.

> Quick daily reference. **Not** a replacement for `WORKFLOW_V1_RUNBOOK.md` —
> see the Runbook for full detail, edge cases, and rule codes. Describes current
> behavior only.

---

## The workflow path (standard mode)

```
/start-ticket  → draft
   (fill intake.md, set Readiness: READY)
/research      → ready-for-research
/spec          → research-complete      (writes AC-1, AC-2, …)
/plan          → spec-complete
/review APPROVED → approved              ← reviewer, not you
/implement     → implemented             (creates branch ticket/<slug>)
/verify        → closed                  ← reviewer, not you
/publish-pr    → state unchanged         (delivery only; creates/uses GitHub PR)
```

- Author/delivery commands (you/AI): `start-ticket, research, spec, plan, implement, publish-pr`
- Gate commands (a different reviewer): `review, verify`
- `/publish-pr` is optional after closure for GitHub delivery. It is not a gate
  and does not change workflow state.

## Command quick reference

| Command | Does | Precondition state | Result state |
|---|---|---|---|
| `/start-ticket <slug> "<title>"` | Create workspace + `intake.md` | — | `draft` |
| `/research <slug>` | Read-only repo investigation | `draft` + intake `READY` | `ready-for-research` |
| `/spec <slug>` | Requirements + acceptance criteria (`AC-n`) | `ready-for-research` | `research-complete` |
| `/plan <slug>` | Approach, steps, files, validation, rollback | `research-complete` (or revision) | `spec-complete` |
| `/review <slug> <decision> "<why>"` | Reviewer approves/blocks the plan | `spec-complete` | `approved` / stays / `closed` |
| `/implement <slug>` | Apply only planned files; branch, no commit/push | `approved` (or resume) | `implemented` / blocked |
| `/verify <slug>` | Reviewer checks every AC; closes ticket | `implemented` | `closed` / FAILED→rework |
| `/publish-pr <slug>` | Commit, push, open/reuse GitHub PR; write `links.github` | `verified`/`closed` | unchanged |

## Daily rules of thumb

- **State lives in one place:** `_specs/<slug>/ticket.md > state`. To find "where
  is my ticket?", read that field — never guess from which files exist.
- **Every command is atomic:** if a precondition fails, *nothing* is written.
  Fix the cause and re-run.
- **You can't approve your own work.** Self-review is off — a different qualified
  reviewer runs `/review` and `/verify`.
- **AI is advisory.** It can draft and run author commands; it never approves.
- **Touch source only in `/implement`,** and only files listed in `plan.md`.
- **`spec.md` has no implementation detail** — no file names, no code. That's
  `plan.md`'s job.
- **Branch is born at `/implement`,** named `ticket/<slug>`, from clean `main`,
  only after `approved`. `/implement` leaves changes uncommitted; `/publish-pr`
  creates the single publishable commit and pushes.
- **GitHub is delivery only.** `/publish-pr` writes `ticket.md > links.github`;
  PR status/reviews/checks/merge state never drive workflow state.
- **`closed` is terminal.** No reopen — open a new ticket.
- **`blocked` is a flag, not a state** (`status: blocked`), and halts advancement.

## Modes (pick at `/start-ticket`)

| | standard | high_risk |
|---|---|---|
| Use for | normal, bounded work | `observability/**`, irreversible, wide blast radius |
| Approvals | 1 reviewer | 2 approvers |
| ADR | optional | **mandatory** |
| Verify depth | every AC | every AC + **rollback rehearsal** |

- `fast` mode is **deferred — not selectable.** `/start-ticket` rejects it.

## Review outcomes — what to do next

- **APPROVED** → `approved`; run `/implement`.
- **CHANGES_REQUESTED** → stays `spec-complete`; re-run `/plan` (revision,
  addressing the follow-ups) → `/review` again.
- **REJECTED** → `closed` (terminal); open a new ticket to revisit.

## When things stall

- **Verify FAILED** → `implementation-in-progress` + `blocked`. Run `/implement`
  (resume — same branch, no new branch), then `/verify` again.
- **Implement blocked** (needed file not in plan / unsafe) → ticket stays
  `implementation-in-progress` + `blocked`. Either revise via `/plan` then
  resume, or clear the blocker and resume `/implement`.
- **Re-runs that are safe:** `/research` (idempotent while at research stages),
  `/plan` (revision after CHANGES_REQUESTED), `/implement` (resume).

## Next steps

Every command prints a **Next step** block: current state, next command, required
actions, optional actions, and whether the workflow is terminal. Treat it as
operator guidance derived from `ticket.md`; it is not state. After `/verify`
PASSES and closes the ticket, the next workflow command is `none`; optional
delivery is `/publish-pr <slug>`.

## ClickUp intake (optional, read-only)

```bash
export CLICKUP_API_TOKEN=<read-scope token>   # local shell only; never commit
/start-ticket clickup_id=<task-id>            # slug defaults to cu-<task-id>
```

- **Imports:** title → ticket title, description → intake summary, URL →
  `links.clickup`.
- **Never:** status sync, comments, write-back, task create/close, MCP, or any
  workflow-state from ClickUp. `ticket.md` stays canonical.
- Fetch/token failure → aborts, **creates nothing**.

## Validation profiles (optional, config-driven)

- Name **one** profile in `plan.md` Validation strategy: `Validation profile: <id>`.
- Two separate config blocks in `project-config.yaml`: `validation_checks`
  (check-id → command + pass condition; **commands only here**) and
  `validation_profiles` (lists required check-ids + depth; **no commands**).
- `/verify` resolves profile → checks → commands, runs them **locally**, records
  command + exit code + output summary + result → `AC-n`.
- Commands must be **deterministic, non-interactive, read-only**. No profile ⇒
  behaves exactly as before. No GitHub/CI/MCP/external runner.

## GitHub PR publishing (delivery only)

```bash
/publish-pr <slug>
```

- Runs after successful `/verify` (`state: verified` or `closed`).
- Uses `scripts/github_publish.py` and GitHub CLI (`gh`) for all `git`/`gh`
  work: stage, commit, push `ticket/<slug>`, and create/reuse the PR.
- Writes only `ticket.md > links.github`; `ticket.md > state` and state-history
  stay unchanged.
- GitHub remains out of band: no status sync, review sync, checks sync,
  auto-merge, branch deletion, or GitHub-derived workflow state.

## Common failures → fast fixes

| Hitting | Cause | Fix |
|---|---|---|
| `/research` won't run | intake not `READY` / not `draft` | set Readiness `READY`, retry |
| `/spec` won't run | `research.md` incomplete | finish `/research` |
| `/plan` won't run | not at `research-complete` (or no CHANGES_REQUESTED for revision) | check state/entry mode |
| `/review` won't run | you're the author / not reviewer | a different reviewer runs it |
| `/implement` blocks | dirty `main`, branch exists, vague plan, `observability/**` w/o high_risk | clean main / tighten plan / use high_risk |
| `/verify` won't run | state ≠ `implemented`, missing AC IDs or implementation evidence | complete `/implement` first |
| `/publish-pr` won't run | not verified/closed, branch missing, or `gh` unavailable | finish `/verify`, restore branch, install/auth `gh` |
| ClickUp intake fails | token unset / fetch 401·404 | set valid token, check task id, retry |

## Escalate to the Workflow Owner when…

- A change would hit `observability/**` outside an approved `high_risk` implement.
- You'd need to delete/rewrite workflow artifacts or canonical config.
- Acceptance criteria are missing/ambiguous/untestable.
- Scope grows beyond the approved spec/plan, or a gate would be skipped.
- Mode (`standard` vs `high_risk`) is disputed.

*(Routine plan/verify decisions are the reviewer's call — not an escalation.)*

---

*Companion to `WORKFLOW_V1_RUNBOOK.md` (updated 2026-06-18). Current behavior
only; no workflow changes.*
