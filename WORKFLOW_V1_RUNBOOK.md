# Workflow V1 — Operational Runbook

> ⚠️ **Superseded (ADR-011).** This runbook still describes two execution modes
> (`standard`/`high_risk`), mode selection, and a distinct reviewer / separation
> of duties. All of that is **removed**: there is now **one uniform workflow form**
> run by a **single owner** who executes their own `/review` and `/verify`
> (self-review). Gate integrity comes from a **comprehension check** (the owner
> answers questions generated from the artifact under review), not a second
> person. No risk tiers: 1 self-approval, ADR optional, `all-ac` verification for
> every ticket. Wherever this runbook says a "mode", `standard`, `high_risk`, "a
> reviewer who is not the author", two approvers, or a rollback rehearsal, read the
> single-owner form + comprehension gate. Canonical:
> `.claude/project-config.yaml > workflow_form` / `> comprehension_gates`. (Full
> text reconciliation pending.)

> **Status:** production / stable. Documents the workflow **exactly as it exists
> today** (validated by WF-PILOT-001, WF-PILOT-002, WF-PILOT-003, WF-004, and
> WF-005, all closed/PASSED).
> This runbook is descriptive, not prescriptive of future work. Canonical sources
> remain `CLAUDE.md`, `.claude/project-config.yaml`,
> `.claude/rules/workflow-rules.md`, `.claude/rules/validation-model.md`, and
> `.claude/docs/command-architecture.md`. Where this runbook and a canonical
> source ever disagree, the canonical source wins.

---

## 1. Executive Summary

Workflow V1 is a **document-driven, gated engineering workflow** for this
repository (a local observability stack: Loki, Grafana, Prometheus,
Alertmanager). Every change moves through a fixed sequence of seven lifecycle stages, each
producing one Markdown artifact under `_specs/<ticket>/`, with two mandatory
human review gates before and after implementation. A separate eighth operator
command, `/publish-pr`, performs Git/GitHub delivery after successful
verification; it is not a lifecycle stage and performs no state transition.

The workflow's defining property: **one ticket's workflow state lives in exactly
one place** — `_specs/<ticket>/ticket.md > state` (ADR-003) — and the repository
itself (artifacts + git) is the source of truth. Each lifecycle slash
commands reads that state, validates the transition against a canonical state
machine, does its work, and writes the new state back. No state is ever inferred
from which files exist.

Two execution modes exist: **`standard`** (normal work, one reviewer approval)
and **`high_risk`** (runtime/observability or wide-blast-radius work, two
approvals + mandatory ADR + rollback rehearsal). A third mode, `fast`, is
**deferred and not selectable in V1**.

An optional, **read-only** ClickUp intake can seed a new ticket's title,
description, and link from an existing ClickUp task. Nothing is ever written back
to ClickUp.

GitHub is available only as a delivery surface. `/publish-pr` creates or reuses a
GitHub PR through the GitHub CLI (`gh`) and records the URL in
`ticket.md > links.github`, but GitHub PR status, review state, checks, merge
state, and comments are never read back into workflow state.

## 2. Workflow Goals

Why this workflow exists (from `CLAUDE.md` "Mission" and "Small-change
philosophy"):

- **Small, reviewed, verifiable changes.** Every change is the smallest one that
  satisfies its acceptance criteria, reviewed before code is written, and
  individually verifiable afterward.
- **No improvised scope.** One ticket = one focused outcome. Anything larger is
  split. Scope growth beyond the approved spec/plan is a hard-stop.
- **Read-only first, mutate last.** Investigation (research/spec/plan/review) is
  non-mutating; source is touched only during `implement`, and only files the
  plan named.
- **Protect the observability runtime.** `observability/**` files are never
  modified by workflow/governance work and only by an approved `high_risk`
  implement stage.
- **Traceability and reversibility.** Acceptance criteria carry stable IDs that
  thread spec → verify; every change is reversible and tied to a reviewed plan.

## 3. Core Principles

1. **`ticket.md` is canonical (ADR-003).** `_specs/<ticket>/ticket.md > state`
   is the *only* authoritative workflow state. Stage artifacts may carry a
   *local* `status` for their own progress but never own workflow state.
2. **The repository is the source of truth.** State, history, decisions, and
   evidence live in versioned files under `_specs/` and in git. External systems
   (ClickUp/GitHub) are *links* or delivery surfaces, never the authority.
3. **Reviewer-owned gates.** `/review` (before implementation) and `/verify`
   (closure) are owned by the **reviewer** role — a qualified person who is **not**
   the ticket's author. These gates are never skipped, in any mode.
4. **AI is advisory only.** An AI agent may draft artifacts and run author
   commands, but it is **never an approval authority**. Gate decisions
   (`APPROVED` / `CHANGES_REQUESTED` / `REJECTED`, and PASSED/FAILED sign-off)
   are made by a human reviewer.
5. **Separation of duties.** The reviewer at a gate must not be the author of the
   work under review. (Self-review is configurable for `standard` only, and is
   currently **disabled** — see §4 and §7.)
6. **Atomic transitions.** Every command validates fully *before* writing. On any
   precondition failure it writes nothing — no partial artifacts, no half
   transitions.
7. **One canonical state machine.** Allowed transitions are defined once in
   `project-config.yaml > lifecycle`; `blocked` is an orthogonal flag, not a
   state; `closed` is terminal.

## 4. Roles and Responsibilities

Four roles exist (`project-config.yaml > roles`). The legacy `em` actor seen in
older artifacts maps to `reviewer` (for gates) or `workflow_owner` (for
governance).

### Workflow Owner — governance, not per-ticket
Owns workflow evolution, governance decisions, escalations, and cross-project
issues. **Does not** sign off on individual tickets. Is *eligible* to serve as a
reviewer or as the second `high_risk` approver, but the workflow never *requires*
Workflow Owner participation on a given ticket.

### Reviewer — the gate authority
Owns the `/review` and `/verify` gates for a ticket. May be any qualified team
member (Developer, Senior, Tech Lead, Project Lead, or the Workflow Owner) **who
is not the ticket's author**. Records `APPROVED` / `CHANGES_REQUESTED` /
`REJECTED` at `/review` and the PASSED/FAILED sign-off at `/verify`. For
`high_risk`, a second approver is required and an ADR must be referenced.

### Developer — ticket execution owner
Authors and runs the author commands: `/start-ticket`, `/research`, `/spec`,
`/plan`, `/implement`, and `/publish-pr`. Owns the ticket's artifacts, the
implementation branch, and delivery handoff. Cannot approve their own work at a
gate (separation of duties).

### AI Agent — assistant only
Assists across stages within the rules in `CLAUDE.md` (drafting research, spec,
plan, implement artifacts; running author commands). **Never holds approval
authority** at `/review` or `/verify`; those decisions are the human reviewer's.

### Ownership matrix — who invokes each command

| Command | Invoked by | Gate? | Approval authority |
|---|---|---|---|
| `/start-ticket` | Developer / AI Agent | no | — |
| `/research` | Developer / AI Agent | no | — |
| `/spec` | Developer / AI Agent | no | — |
| `/plan` | Developer / AI Agent | no | — |
| `/review` | **Reviewer** | **yes** | Reviewer (human) |
| `/implement` | Developer / AI Agent | no | — |
| `/verify` | **Reviewer** | **yes** | Reviewer (human) |
| `/publish-pr` | Developer / AI Agent | no | — |

### Ownership matrix — who owns each decision/asset

| Decision / asset | Owner |
|---|---|
| Ticket workflow state (`ticket.md > state`) | Whichever command performs the transition; the *record* is canonical in `ticket.md` |
| Plan approval (`APPROVED`/`CHANGES_REQUESTED`/`REJECTED`) | Reviewer |
| Verification sign-off (PASSED/FAILED) | Reviewer |
| Implementation branch `ticket/<slug>` | Developer |
| GitHub PR delivery (`/publish-pr`, `links.github`) | Developer / AI Agent; metadata remains in `ticket.md` |
| Mode selection (`standard`/`high_risk`) | Developer at intake; escalated to Workflow Owner if disputed |
| ADR for `high_risk` | Developer authors; Reviewer requires it at `/review` |
| Workflow rules / governance | Workflow Owner |

## 5. End-to-End Ticket Lifecycle

Canonical states (`project-config.yaml > lifecycle`). `blocked` is **not** a
state — it is an orthogonal flag (`status: blocked`) on a non-terminal state.
`closed` is terminal (no reopen; open a new ticket).

```
draft
  → ready-for-research        (/research)
  → research-complete         (/spec)
  → spec-complete             (/plan, initial)
  → plan-complete → approved  (/review, APPROVED)
  → implementation-in-progress (/implement, initial)
  → implemented               (/implement, complete)
  → verified → closed         (/verify, PASSED)
```

Back-edges and exits that currently exist:
- `/review` **CHANGES_REQUESTED** → stays `spec-complete`; revise via `/plan`
  (revision) then re-`/review`.
- `/review` **REJECTED** → `spec-complete → closed` (terminal).
- `/implement` **blocked** → stays `implementation-in-progress`,
  `status: blocked`; resume via `/implement`.
- `/verify` **FAILED** → `implemented → implementation-in-progress`,
  `status: blocked`; fix via `/implement` (resume), then re-`/verify`.

Step-by-step (happy path, `standard` mode):

1. **Intake** — `/start-ticket <slug> "<title>"` creates `_specs/<slug>/` with
   `ticket.md` (`state: draft`) and `intake.md`. The author fills `intake.md` and
   marks **Readiness Status: READY**.
2. **Research** — `/research <slug>` performs read-only repo discovery, writes
   `research.md`, advances `draft → ready-for-research`.
3. **Spec** — `/spec <slug>` validates research, writes `spec.md` with stable
   acceptance-criteria IDs (`AC-1`, `AC-2`, …), advances
   `ready-for-research → research-complete`.
4. **Plan** — `/plan <slug>` writes `plan.md` (approach, steps, files to change,
   validation, rollback), advances `research-complete → spec-complete`.
5. **Review gate** — a reviewer runs `/review <slug> APPROVED "<rationale>"`.
   On APPROVED, advances `spec-complete → plan-complete → approved`.
6. **Implement** — `/implement <slug>` creates branch `ticket/<slug>` from clean
   `main`, applies **only** the files named in `plan.md`, leaves the work
   uncommitted, writes `implement.md`, advances `approved →
   implementation-in-progress → implemented`.
7. **Verify gate** — a reviewer runs `/verify <slug>`. On PASSED, writes
   `verify.md` and advances `implemented → verified → closed`.
8. **Publish delivery** — `/publish-pr <slug>` stages and commits the
   publishable set (implementation changes + `implement.md` + `verify.md` + the
   `ticket.md` closure update), pushes `ticket/<slug>`, creates/reuses a GitHub
   PR through `gh`, and records the URL in `ticket.md > links.github`. State stays
   unchanged.

## 6. Command Usage Guide

All commands operate on `_specs/<slug>/`. Every command except `/start-ticket`
begins by reading `ticket.md` and ends by writing the transition back to
`ticket.md` (the single state write per ADR-003). `/publish-pr` also reads
`ticket.md`, but it writes only `links.github` and never changes `state` or
state-history. All commands are **atomic** — on precondition failure they write
nothing.

### `/start-ticket`
- **Purpose:** Bootstrap a ticket workspace; set mode; initialize state to
  `draft`. Does **not** create a branch.
- **Inputs:** `slug` (required), `"title"` (required unless seeded from ClickUp),
  `mode=standard|high_risk` (default `standard`; `fast` rejected), optional
  `owner=`, optional `links`, optional `clickup_id=` (see §8).
- **Outputs / artifacts:** `_specs/<slug>/ticket.md` (state record, initial
  history row) + `_specs/<slug>/intake.md`.
- **Owner:** Developer / AI Agent.
- **Result state:** `draft`.

### `/research`
- **Purpose:** Read-only investigation of the repo and impact.
- **Inputs:** `slug`.
- **Outputs / artifacts:** `research.md` (relevant directories, config files,
  affected services, available validation commands, risks, open questions);
  updates `ticket.md`.
- **Precondition:** `state = draft` **and** `intake.md` Readiness = `READY`.
- **Owner:** Developer / AI Agent.
- **Result state:** `ready-for-research`.

### `/spec`
- **Purpose:** Define what "done" means — requirements + acceptance criteria with
  stable IDs. **No implementation detail** (no file names, code, or steps).
- **Inputs:** `slug`.
- **Outputs / artifacts:** `spec.md` (business goal, user story, functional /
  non-functional requirements, constraints, edge cases, `AC-n` mapping, out of
  scope); updates `ticket.md`.
- **Precondition:** `state = ready-for-research`; `research.md` complete.
- **Owner:** Developer / AI Agent.
- **Result state:** `research-complete`.

### `/plan`
- **Purpose:** Decide the approach and concrete steps. Does **not** approve and
  does **not** branch.
- **Inputs:** `slug`.
- **Outputs / artifacts:** `plan.md` (approach, steps, **files to change**,
  validation strategy, rollback, out of scope); updates `ticket.md`.
- **Precondition (one of):** *Initial* — `state = research-complete`; *Revision* —
  `state = spec-complete` **and** latest `review.md` Decision =
  `CHANGES_REQUESTED` (then it addresses the Required Follow-up Actions).
- **Owner:** Developer / AI Agent.
- **Result state:** `spec-complete` (initial advances to it; revision stays
  there).

### `/review` — gate
- **Purpose:** Reviewer validates spec + plan and records the decision; only
  `APPROVED` unlocks implementation.
- **Inputs:** `slug`, `decision` (`APPROVED|CHANGES_REQUESTED|REJECTED`),
  `"rationale"`; for `high_risk` + `APPROVED`: two approver names + ADR reference.
- **Outputs / artifacts:** `review.md` (scope, decision, approvals, ADR
  reference, required follow-ups); updates `ticket.md` on APPROVED/REJECTED.
- **Precondition:** `state = spec-complete`; `plan.md` complete with plan↔REQ/AC
  traceability; invoker is the `reviewer` and not the author (see §7).
- **Owner:** **Reviewer**.
- **Result state:** `APPROVED → approved`; `CHANGES_REQUESTED → spec-complete`
  (unchanged); `REJECTED → closed`.

### `/implement`
- **Purpose:** Apply **only** the changes `plan.md` lists. First command that
  mutates source.
- **Inputs:** `slug`.
- **Outputs / artifacts:** branch `ticket/<slug>` (initial path only, from clean
  `main`); working-tree changes left **uncommitted** on that branch;
  `implement.md` (changes prepared, deviations, validation run). The commit is
  created later by `/publish-pr`.
- **Precondition (one of):** *Initial* — `state = approved` and `review.md` =
  APPROVED, no existing branch, clean `main`; *Resume* — `state =
  implementation-in-progress` with the branch already checked out.
- **Owner:** Developer / AI Agent.
- **Result state:** `implemented` (complete) **or** `implementation-in-progress`
  + `status: blocked` (blocked).

### `/verify` — gate
- **Purpose:** Validate that every acceptance criterion is met (read-only on
  implementation); owns success-closure.
- **Inputs:** `slug`.
- **Outputs / artifacts:** `verify.md` (AC→test→result table, commands + output,
  observability-impact yes/no statement, sign-off); updates `ticket.md`.
- **Precondition:** `state = implemented`; `spec.md` has `AC-n` IDs;
  `implement.md` records changed files and implementation evidence; invoker is
  the `reviewer` and not the author (see §7).
- **Verification depth:** `standard` → every AC; `high_risk` → every AC **plus a
  rollback rehearsal**.
- **Owner:** **Reviewer**.
- **Result state:** `PASSED → closed`; `FAILED → implementation-in-progress` +
  `status: blocked`.

### `/publish-pr`
- **Purpose:** Deliver a verified/closed ticket to GitHub as a Pull Request. This
  is the single Git/GitHub delivery boundary and is orthogonal to the lifecycle
  state machine.
- **Inputs:** `slug`.
- **Outputs / artifacts:** one publishable commit on `ticket/<slug>`; branch
  pushed to `origin`; GitHub PR created or reused via `gh`; `ticket.md >
  links.github` set to the PR URL.
- **Precondition:** `state ∈ {verified, closed}` after successful `/verify`;
  local branch `ticket/<slug>` exists; GitHub CLI is installed/authenticated.
- **Owner:** Developer / AI Agent.
- **Result state:** unchanged. No state-history entry is appended.
- **Boundaries:** GitHub is delivery only. PR status, review state, checks, merge
  state, comments, labels, and branch deletion are out of scope and never drive
  workflow state. All `git`/`gh` logic lives in `scripts/github_publish.py`.

### Expected artifacts and delivery outputs

| Stage/action | Artifact or delivery output | Owner role |
|---|---|---|
| intake | `ticket.md`, `intake.md` | developer / ai_agent |
| research | `research.md` | developer / ai_agent |
| spec | `spec.md` | developer / ai_agent |
| plan | `plan.md` | developer / ai_agent |
| review | `review.md` | reviewer |
| implement | `implement.md` (+ uncommitted branch work) | developer / ai_agent |
| verify | `verify.md` | reviewer |
| publish | Git commit + GitHub PR + `links.github` | developer / ai_agent |

### Validation profiles (config-driven, optional)

A ticket *may* name one **validation profile** in `plan.md`'s Validation
strategy. Profiles let `/verify` run real checks without hardcoding any
framework-specific command (ADR-006, rules VP-1..VP-5):

- **Two separate config concepts** in `project-config.yaml`: `validation_checks`
  (definitions — a check-id → command + pass condition; **commands live only
  here**) and `validation_profiles` (selection — a profile lists required
  check-ids + a depth tag, and references **check-ids only**).
- **`/verify` resolves** profile → checks → commands, executes each required check
  (depth ≤ the mode tier) **locally**, and records the command, exit code, output
  summary, and result mapped to `AC-n`.
- Commands must be **deterministic, non-interactive, and read-only** w.r.t.
  implementation files (VP-2/VP-3, preserving `VF-7`).
- **Opt-in:** no profile named ⇒ `/plan` and `/verify` behave exactly as before
  (VP-5). Execution is **local only** — no GitHub, CI/CD, MCP, or external runner.

### Next-step guidance

Every command, including `/publish-pr`, emits a short **Next step** block after
successful completion or a safe blocked/failed outcome:

- **Current state** — `ticket.md > state` after the command, or unchanged for
  `/publish-pr`.
- **Next command** — the next legal workflow command, or `none` when no workflow
  command remains.
- **Required actions** — manual work needed before the next command can run.
- **Optional actions** — useful but non-required actions, such as `/publish-pr`
  after `/verify` closes a ticket.
- **Terminal?** — whether the workflow itself is complete.

This guidance is derived from `ticket.md` and the canonical state machine; it is
operator help only and never changes state.

## 7. Approval Gates

There are exactly **two** gates, both reviewer-owned, both mandatory in every
mode.

### Gate 1 — `/review` (before any implementation)
- **Who approves:** the reviewer (not the author).
- **What it decides:** whether the spec + plan may proceed to implementation.
- **Approvals required:** `standard` = **1** reviewer; `high_risk` = **2**
  approvers **and** an ADR reference (`project-config.yaml > modes`).
- **What blocks progress:** any state other than `spec-complete`; an incomplete
  `plan.md`; missing plan↔REQ/AC traceability; `high_risk` without two approvers
  or without an ADR. A `CHANGES_REQUESTED` keeps the ticket at `spec-complete`; a
  `REJECTED` closes it (terminal).
- **What does *not* block:** nothing about artifact existence alone advances or
  blocks — only `ticket.md > state` and the recorded decision matter.

### Gate 2 — `/verify` (closure)
- **Who approves:** the reviewer (not the author).
- **What it decides:** PASSED (close the ticket) or FAILED (return to rework).
- **Pass condition:** every `AC-n` maps to a passing result at the mode's depth
  (`standard` all-AC; `high_risk` all-AC + rollback rehearsal).
- **What blocks progress:** any state other than `implemented`; a missing AC
  mapping; missing implementation evidence in `implement.md`; any failing AC.
- **What does *not* block:** the observability-impact statement must be *present*
  (yes/no), but a "no impact" answer does not block.

### Separation of duties (current configuration)
`separation_of_duties.enabled: true`. `allow_self_review.standard: false` and
`high_risk: false`. **Therefore, today, every ticket requires the reviewer at
both gates to be someone other than the author** — self-review is not currently
permitted for any mode. (`standard` self-review is a configurable opt-in that is
switched off.)

### What is *not* a gate
- `/start-ticket`, `/research`, `/spec`, `/plan`, `/implement` are **not**
  approval gates. They are author actions. `/plan` produces the plan but does not
  approve it; approval is exclusively `/review`.
- `/publish-pr` is **not** an approval gate and not a lifecycle transition. It is
  delivery-only after successful verification.
- There is **no `/close` command.** Closure happens only at `/verify` (PASSED) or
  `/review` (REJECTED).

## 8. ClickUp Intake Process

ClickUp integration is **read-only** (ADR-005, CU-1..CU-5). It is an optional
intake convenience on `/start-ticket` only.

### How it works
- Invoke `/start-ticket` with `clickup_id=<task-id>`.
- The command calls the isolated helper `scripts/clickup_intake.py`, which
  performs **one** read-only `GET /api/v2/task/{id}` and returns
  `{title, description, url}`. All ClickUp HTTP logic lives only in that helper;
  the command embeds none.
- Authentication: the helper reads `CLICKUP_API_TOKEN` from the **environment**
  (a ClickUp personal API token, read scope). It is never stored in a committed
  file.
- Atomicity: if the token is unset (CU-1) or the fetch fails (CU-2 — e.g. 401,
  404, network), `/start-ticket` aborts and **creates nothing**.

### Exactly what is imported
- **Task title** → ticket title (`ticket.md > title`).
- **Task description** → intake summary (`intake.md` Ticket Summary).
- **Task URL** → `links.clickup` (in `ticket.md` / `intake.md`).
- **Slug:** a user-supplied slug is primary; if none is given, the slug defaults
  to `cu-<clickup_id>`.

### Exactly what is NOT imported / NOT done
- **No status sync** — ClickUp task status is never read into workflow state.
- **No comment sync.**
- **No write-back** — no POST/PUT/DELETE/PATCH; nothing is ever sent to ClickUp.
- **No task creation or closure** in ClickUp.
- **No workflow-state mapping** — `ticket.md` remains the sole canonical state
  owner; no state is derived from ClickUp.
- **No MCP** — direct REST only, by design.

## 9. Common Operational Scenarios

### A. Create a ticket from scratch
1. `/start-ticket my-slug "Short title" mode=standard`
2. Edit `_specs/my-slug/intake.md`; set Readiness Status to `READY`.
3. `/research my-slug` → `/spec my-slug` → `/plan my-slug`.
4. Reviewer: `/review my-slug APPROVED "rationale"`.
5. `/implement my-slug` → `/verify my-slug`.
6. Optional delivery after closure: `/publish-pr my-slug`.

### B. Create a ticket from ClickUp
1. Locally: `export CLICKUP_API_TOKEN=<read-scope token>` (never commit/paste it).
2. `/start-ticket clickup_id=<task-id>` (slug defaults to `cu-<task-id>`; or pass
   an explicit slug to override).
3. Confirm `ticket.md` title and `links.clickup` were seeded; `state` is `draft`.
4. Continue as in Scenario A from step 2.

### C. Reviewer requests changes
1. Reviewer: `/review my-slug CHANGES_REQUESTED "what to fix"`. Ticket stays at
   `spec-complete`; follow-ups recorded in `review.md`.
2. Author: `/plan my-slug` (revision mode) — rewrites `plan.md` addressing the
   Required Follow-up Actions; stays `spec-complete`, resets any `blocked` flag.
3. Reviewer: `/review my-slug APPROVED "rationale"` → `approved`.

### D. Verification fails
1. Reviewer: `/verify my-slug` finds a failing AC → writes `verify.md` with the
   failure, sets `state = implementation-in-progress`, `status: blocked`.
2. Author: `/implement my-slug` (resume) — fixes on the existing branch (no new
   branch), advances back to `implemented`.
3. Reviewer: `/verify my-slug` again.

### E. Ticket returns to implementation (rework)
This is the union of D and the `/implement` blocked path. Any return to
`implementation-in-progress` is resumed by `/implement` on the **existing**
`ticket/<slug>` branch — `/implement` never creates a second branch on resume.

### F. Ticket closure
- **Success:** `/verify` PASSED → `implemented → verified → closed`.
- **Rejection:** `/review` REJECTED → `spec-complete → closed`.
- In both cases `closed` is terminal — to revisit the work, open a new ticket.

### G. Publish to GitHub
1. Confirm the ticket is `closed` after a PASSED `/verify`.
2. Run `/publish-pr my-slug`.
3. Confirm `ticket.md > links.github` contains the PR URL and `state` is
   unchanged. GitHub review/merge then happens out of band and is not read back
   into the workflow.

## 10. Troubleshooting Guide

Commands report a stable rule code (e.g. `ST-2`, `CMD-1`) on failure
(`validation-model.md`). Common situations:

| Symptom / rule code | Likely cause | Expected action |
|---|---|---|
| `/research` aborts (`RS-7`/`CMD-1`) | `intake.md` not marked `READY`, or state ≠ `draft` | Fill intake, set Readiness `READY`, retry |
| `/spec` aborts (`SP-7`) | `research.md` missing/incomplete | Run/complete `/research` first |
| `/plan` aborts (`PL-7`) | Not at `research-complete`, or revision attempted without a `CHANGES_REQUESTED` review | Confirm entry mode; only revise after CHANGES_REQUESTED |
| `/review` aborts (`RA-1`/`RA-3`) | Invoker is the author, or not the reviewer role (self-review is off) | A different qualified reviewer runs the gate |
| `/review` high_risk aborts (`RV-5`/`RV-6`) | Missing second approver or ADR reference | Supply two approvers + ADR, retry |
| `/implement` blocks (`IM-8`) | Dirty `main`, branch collision, ambiguous plan, or `observability/**` without `high_risk` | Clean `main` / resolve branch / tighten `plan.md` / re-scope as `high_risk` |
| `/implement` sets `status: blocked` (`IM-10`) | Needed file not in plan (scope creep) or unsafe/unclear condition | Resume after `/plan` revision, or fix the blocker and resume |
| `/verify` aborts (`VF-8`/`CMD-1`) | State ≠ `implemented`, or missing AC IDs / implementation evidence | Complete `/implement`; ensure `spec.md` has `AC-n` and `implement.md` records changed files/evidence |
| `/verify` FAILED | An AC did not pass | Fix via `/implement` resume, re-verify |
| ClickUp intake aborts (`CU-1`/`CU-2`) | `CLICKUP_API_TOKEN` unset, or fetch failed (401/404/network) | Set a valid read-scope token; verify the task id; retry (nothing was written) |
| `/publish-pr` aborts (`PB-*`/`GH-*`) | Ticket not verified/closed, branch missing, or `gh` missing/unauthenticated | Finish `/verify`, restore/check out the branch, or install/authenticate `gh`; retry (state unchanged) |
| Any command made a partial write | Should not happen — all commands are atomic | Treat as a bug; the ticket state in `ticket.md` is authoritative — reconcile from it |

**General rule:** when in doubt about "where is this ticket?", read
`_specs/<slug>/ticket.md > state`. That field — not the presence of any artifact
— is the truth.

## 11. Governance Escalation Guide

Escalate to the **Workflow Owner** (not the per-ticket reviewer) when a situation
is a *governance* question rather than a ticket decision. From `CLAUDE.md` "Hard
stop conditions" and the role model:

Escalate when:
- A change would touch **`observability/**` runtime files** outside an approved
  `high_risk` implement stage.
- A request requires **deleting or rewriting existing workflow artifacts**, or
  the canonical config (`project-config.yaml`, `_specs/`,
  `.claude/commands/README.md`).
- **Acceptance criteria are missing, ambiguous, or untestable** and cannot be
  resolved within the spec stage.
- **Scope grows beyond** the approved spec/plan.
- A **stage's entry criteria cannot be met** legitimately (e.g. pressure to
  implement before approval, or to skip a gate).
- A **mode dispute** arises (e.g. whether work is `standard` vs `high_risk`).
- A **workflow rule itself** needs changing, or a cross-project/governance
  decision is required.

Do **not** escalate routine ticket decisions (plan approval, change requests,
verification outcomes) — those are the reviewer's authority. The Workflow Owner
owns the *workflow*, not individual tickets.

## 12. Frequently Asked Questions

**Q: Where does a ticket's state actually live?**
In `_specs/<slug>/ticket.md > state`. Nowhere else. Don't infer state from which
files exist (ADR-003).

**Q: Can the person who wrote the plan also approve it?**
No. Self-review is currently disabled for all modes
(`allow_self_review.standard: false`). A different qualified reviewer must run
`/review` and `/verify`.

**Q: Can the AI agent approve my ticket?**
No. The AI is advisory only and never an approval authority. A human reviewer
makes gate decisions.

**Q: When is the git branch created?**
Only by `/implement`, on the initial path, after the ticket is `approved`, from a
clean `main`, named `ticket/<slug>`. `/start-ticket` never creates a branch, and
no branch exists for an unapproved ticket. `/implement` does not commit or push;
`/publish-pr` creates the single publishable commit and pushes the branch after
successful verification.

**Q: Does GitHub PR state ever update `ticket.md > state`?**
No. GitHub is delivery only. `/publish-pr` writes the PR URL to
`ticket.md > links.github`; no PR status, review, check, merge, or comment data
is read back into workflow state.

**Q: How do I fix a plan the reviewer rejected with CHANGES_REQUESTED?**
Re-run `/plan` in revision mode; it rewrites `plan.md` to address the follow-ups
and keeps the ticket at `spec-complete`. Then re-run `/review`.

**Q: What's the difference between `REJECTED` and `CHANGES_REQUESTED`?**
`CHANGES_REQUESTED` keeps the ticket alive at `spec-complete` for revision.
`REJECTED` closes the ticket (terminal) — you would open a new ticket to revisit.

**Q: My verification couldn't run a check because of missing credentials. Is that
a FAIL?**
`/verify` is binary today: PASSED (→closed) or FAILED (→rework). There is no
"pending/incomplete" outcome in V1. If an AC genuinely cannot be evidenced, it
cannot be recorded as passing, so the ticket cannot be closed; the reviewer
decides whether to record FAILED (rework) or hold the ticket at `implemented`
until evidence is available. (This binary limitation is a known characteristic of
V1; resolving it is a governance matter, not a per-ticket action.)

**Q: Can I use `fast` mode?**
No. `fast` is deferred and not selectable in V1 — `/start-ticket` rejects
`mode: fast`. Use `standard` or `high_risk`.

**Q: What does `high_risk` require that `standard` doesn't?**
Two approvers (not one), a mandatory ADR referenced at `/review`, and a rollback
rehearsal during `/verify`. Use it for `observability/**` runtime,
irreversible, or wide-blast-radius work.

**Q: Does ClickUp ever get updated by the workflow?**
No. ClickUp is read-only intake (title, description, URL). No status sync, no
comments, no write-back, no task creation/closure, no MCP.

**Q: What can I safely re-run?**
`/research` is idempotent while at `ready-for-research`/`research-complete`.
`/plan` supports a revision re-run after `CHANGES_REQUESTED`. `/implement`
supports resume from `implementation-in-progress`. Re-running a command in the
wrong state aborts atomically (nothing is written).

---

*Runbook updated 2026-06-18. Reflects Workflow V1 as implemented and validated
by WF-PILOT-001, WF-PILOT-002, WF-PILOT-003, WF-004, and WF-005. Describes
current behavior only; proposes no changes.*
