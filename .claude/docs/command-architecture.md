# Command Architecture — Engineering Workflow v1 (Phase 5, design only)

> **Status: architecture/design.** No command files, slash-command markdown, or
> automation are created by this phase. This document is the contract a
> developer implements against in a later phase — it should require **no further
> architectural decisions** to implement.

> **Superseded re: modes & reviewers (ADR-011).** The execution modes below
> (STANDARD / HIGH_RISK / FAST) and the separate-reviewer model are **removed**.
> There is now **one uniform workflow form** for every ticket, run by a **single
> owner** who executes their own `/review` and `/verify` gates (self-review). Gate
> integrity comes from a **comprehension check** (the owner answers questions
> generated from the artifact under review), not a second person — see
> `project-config.yaml > workflow_form` / `> comprehension_gates`. There are no
> risk tiers: 1 self-approval, ADR optional, `all-ac` verification for every
> ticket. Wherever this document says "mode", STANDARD, HIGH_RISK, "reviewer (not
> the author)", two approvers, or rollback rehearsal, read the single-owner form +
> comprehension gate. §4 is rewritten accordingly; `project-config.yaml` is canonical.

All commands operate on a single ticket workspace `_specs/<ticket>/` and the
front-matter defined in `.claude/rules/workflow-rules.md`. Non-mutating commands
(`/research`, `/spec`, `/plan`, `/review`) must not edit source or
`protected_paths`. Every command updates the ticket's canonical state (§2) and
the touched artifact's `status` front-matter.

**State ownership (ADR-003):** the ticket's workflow state is owned solely by
`_specs/<ticket>/ticket.md > state`. `/start-ticket` creates that record with
`state: draft`; every other command **reads** `ticket.md`, validates the
transition, performs its work, then **writes** the new `state` back to
`ticket.md`. Commands must never infer state from artifact existence.

---

## 1. Command contracts

Conventions: "ticket state" = `ticket.md > state` (the canonical state machine,
§2). "artifact status" = `not_started | in_progress | blocked | complete`, local
to each artifact. `<ticket>` = slug.

### /start-ticket
- **Purpose:** Create the ticket workspace, author `intake.md`, set the single
  form's `mode: standard`, initialize state. **Does not create a branch** (see §3).
- **Inputs:** `id/slug`, `title`, `goal`, optional `links` (ClickUp/GitHub),
  optional `clickup_id` (read-only ClickUp intake — see below). **No `mode`
  input** — the single workflow form is always written as `mode: standard`.
- **Outputs:** `_specs/<ticket>/` dir; `ticket.md` (the state record, `state:
  draft`, with an initial state-history row); `intake.md` (front-matter filled).
- **ClickUp intake (optional, read-only — CU-1..CU-5):** if `clickup_id` is given,
  `/start-ticket` invokes the isolated helper `scripts/clickup_intake.py` (the
  **only** home of ClickUp HTTP logic — the command embeds none) to fetch
  `title`/`description`/`url` via a single read-only GET, then maps them into
  `ticket.md`/`intake.md` (`url` → `links.clickup`). **Slug:** user-provided slug
  is primary; default `cu-<clickup_id>` only when no slug is supplied. **Token:**
  the helper reads `CLICKUP_API_TOKEN` from the environment — obtain a ClickUp
  personal API token (read scope) and export it; it is never stored in a
  committed file. Read-only: never writes to ClickUp; `ticket.md` stays the
  canonical state owner. On fetch failure → abort atomically (CU-4).
- **Preconditions:** slug unused (no workspace dir); valid mode; if `clickup_id`,
  CU-1 (token set) and CU-2 (fetch succeeds).
- **Postconditions:** workspace + `ticket.md` + `intake.md` exist; state =
  `draft` (→ `ready-for-research` once intake `READY`). No branch is created.
- **Stop conditions:** slug collision; dirty base; invalid `mode` (only
  `standard` is legal); request targets `protected_paths` outside an approved
  implement stage.
- **State transitions:** ∅ → `draft` only. The `draft → ready-for-research`
  transition is owned by `/research` (after intake is marked `READY`), not here.

### /research
- **Purpose:** Investigate the repo (read-only), author `research.md`, and
  advance the ticket `draft → ready-for-research`.
- **Inputs:** `<ticket>`.
- **Outputs:** (1) `research.md` (dirs, configs, affected services, validation
  commands, risks, open questions); (2) `ticket.md` updated — `state:
  ready-for-research`, bumped `updated_at`, **appended state-history entry**.
- **Preconditions:** `ticket.md` exists; state = `draft`; `intake.md` Readiness
  Status = `READY`. (Single workflow form — no mode gate.)
- **Postconditions:** `research.md` complete (RS-1..RS-5 — open questions carry
  `OQ-n` IDs; ADR-015); `ticket.md > state` = `ready-for-research` with a new
  history row.
- **Stop conditions / failure:** `ticket.md` missing; state ≠ `draft`; intake
  not `READY`. **On any validation failure,
  write nothing** — neither `research.md` nor `ticket.md` is touched (atomic).
  Repository investigation is still read-only (no source/protected-path mutation).
- **State transitions:** `draft` → `ready-for-research` (owned by `/research`).
  The subsequent `ready-for-research → research-complete` is owned by `/spec`.
  (Re-run while already `ready-for-research`: refresh `research.md` only, no
  re-transition, no duplicate history.)

### /spec
- **Purpose:** Validate research, advance the ticket to `research-complete`, then
  define requirements + acceptance criteria (stable AC IDs) in `spec.md`. No
  implementation planning.
- **Inputs:** `<ticket>`.
- **Outputs:** (1) `ticket.md` updated — `state: research-complete`, bumped
  `updated_at`, **appended state-history entry**; (2) `spec.md` with
  requirements, AC IDs, and AC→requirement mapping.
- **Preconditions:** `ticket.md` exists; state = `ready-for-research`;
  `research.md` present and complete (RS-1..RS-5). (Single form — no mode gate.)
- **Postconditions:** `ticket.md > state` = `research-complete` with a new
  history row; `spec.md` complete (SP-1..SP-5, TR-1, **SP-9** — every `OQ-n` from
  `research.md` answered or deferred with its ID; ADR-015).
- **Stop conditions / failure:** `research.md` missing or incomplete; state ≠
  `ready-for-research`; any file
  name/code in spec (SP-4). **On any validation failure, write nothing** —
  neither `ticket.md` nor `spec.md` is touched (atomic).
- **State transitions:** `ready-for-research` → `research-complete` (owned by
  `/spec`). The subsequent `research-complete → spec-complete` is owned by a
  later stage.

### /plan
- **Purpose:** Validate the spec, advance the ticket to `spec-complete`, then
  decide approach, steps, files to change, validation, rollback in `plan.md`.
  Does **not** approve implementation and does **not** create branches.
- **Inputs:** `<ticket>`.
- **Outputs:** (1) `ticket.md` updated — `state: spec-complete`, bumped
  `updated_at`, **appended state-history entry**; (2) `plan.md`. The plan's
  Validation strategy **may** name one validation profile
  (`project-config.yaml > validation_profiles`) by id; commands are never written
  into `plan.md` (they live in `validation_checks`). See VP-1..VP-5 / ADR-006.
- **Preconditions:** `ticket.md` exists; `spec.md` complete
  (SP-1..SP-5, TR-1); and **one** entry path:
  - *Initial:* state = `research-complete`; or
  - *Revision:* state = `spec-complete` and `review.md` Decision =
    `CHANGES_REQUESTED`.
- **Postconditions:** `ticket.md > state` = `spec-complete` with a new history
  row; `plan.md` complete (PL-1..PL-5 **+ PL-11**, the required
  **Integration surface**; ADR-014 — **+ PL-12**, every `OQ-n` deferred by
  `spec.md` answered; ADR-015). No approval, no branch.
- **Stop conditions / failure:** neither entry mode matched; `spec.md` missing or
  incomplete. **On any validation failure, write nothing** — neither `ticket.md`
  nor `plan.md` (atomic).
- **State transitions:** *Initial:* `research-complete` → `spec-complete`
  (history `spec-validated`). *Revision:* stays `spec-complete` (history
  `plan-revised`; resets `status: blocked → active`). The
  `spec-complete → plan-complete → approved` transitions are owned by `/review`.
- **No fast path (ADR-011):** there is a single workflow form; no stage is
  skipped and no `spec.md`-skipping edge exists.

### /review  (review gate)
- **Purpose:** The owner validates the plan (self-review) after a comprehension
  check, records the decision in `review.md`, and — only when APPROVED — advances
  `spec-complete → plan-complete → approved`. Does not create branches and does
  not implement anything.
- **Inputs:** `<ticket>`, decision (`APPROVED | CHANGES_REQUESTED | REJECTED`),
  rationale. A comprehension check is required before the decision is recorded
  (CG-1..CG-6): ≥3 questions from `plan.md`/`spec.md` (a floor, not a fixed
  count), **≥1 on the integration / cross-flow axis** sourced from the plan's
  `Integration surface` (CG-5), **plus one per `major` panel finding** (CG-6).
- **Advisory review panel (ADR-012, opt-in `review_panel.enabled`):** after
  validation and before the comprehension check, read-only lenses
  (senior / security / performance, `.claude/agents/`) review `plan.md`/`spec.md`
  in parallel; findings are recorded in `review.md` and inform the owner.
  **Advisory only — never blocks or decides** (RP-1..RP-4). The comprehension gate
  remains the integrity control; the panel does not reintroduce separation of duties.
- **Outputs:** `review.md` with decision + follow-ups; on APPROVED, `ticket.md`
  updated (`state: approved`, bumped `updated_at`, history appended).
- **Preconditions:** `ticket.md` exists; state = `spec-complete`; `plan.md`
  present and complete (PL-1..PL-5) with plan↔REQ/AC traceability. Re-review
  after a `/plan` revision is supported (state is still `spec-complete`);
  `review.md` is overwritten with the new decision.
- **Postconditions:**
  - APPROVED → `ticket.md > state` = `approved` (history: `plan-validated` then
    `plan-approved`); `review.md` records the owner's single self-approval.
  - CHANGES_REQUESTED → `review.md` written; state stays `spec-complete` (no
    approval); `status: blocked` optional.
  - REJECTED → `review.md` written with reasons; `ticket.md` advances
    `spec-complete → closed` (terminal, history `plan-rejected`). No `/close`
    command needed.
- **Stop conditions / failure:** state ≠ `spec-complete`; `plan.md` missing or
  incomplete; comprehension check not completed (CG-1). **On any
  required-validation failure, write nothing** (atomic). Never creates a branch.
- **State transitions (owned by `/review`):** APPROVED: `spec-complete` →
  `plan-complete` → `approved`. REJECTED: `spec-complete` → `closed` (terminal).
  CHANGES_REQUESTED: no transition (stays `spec-complete`).

### /implement
- **Purpose:** Apply **only** the changes declared in `plan.md`; record
  `implement.md`; advance the ticket to `implemented`. First command that mutates
  source. Two entry paths: **initial** (from `approved`) and **resume** (from
  `implementation-in-progress`).
- **Inputs:** `<ticket>`.
- **Outputs:** branch `ticket/<slug>` (created on the *initial* path only, from
  clean `develop`); code/doc changes confined to `plan.md`'s "Files to change",
  applied to the working tree on that branch (**no commit, no push** — the commit
  is created later by `/publish-pr`, the single git delivery boundary);
  `implement.md` (files changed, deviations, validation).
- **Preconditions (entry path):**
  - *Initial:* state = `approved` AND `review.md` Decision = APPROVED; no existing
    `ticket/<slug>` branch; `develop` clean.
  - *Resume:* state = `implementation-in-progress`; the `ticket/<slug>` branch
    already exists and is checked out.
  - Both: `plan.md` complete (PL-1..PL-5) with an explicit, unambiguous
    "Files to change" list.
- **Postconditions (complete):** changes applied to the working tree on the
  branch (**uncommitted**); `implement.md` records results; `ticket.md > state` =
  `implemented` with history — *initial*
  (`implementation-started`, `implementation-completed`) or *resume*
  (`implementation-resumed`, `implementation-completed`).
- **Blocked behavior:** if work cannot continue (scope creep / unsafe / unclear),
  keep state = `implementation-in-progress`, set `status: blocked`, and record in
  `implement.md`: blocking reason, partial changes, recommended next action, and
  whether plan revision is required. Do **not** set `implemented` (IM-10). The
  ticket is then recoverable by re-running `/implement` (resume) or revising via
  `/plan`.
- **Stop / block conditions (do NOT mutate):** state ∉ {`approved`,
  `implementation-in-progress`}; (initial) review not APPROVED / `develop` dirty /
  branch exists; (resume) expected branch missing or not checked out; `plan.md`
  ambiguous; `protected_paths` not listed in the approved `plan.md`.
- **Guarantees:** never creates a second branch on resume; never modifies files
  not listed in `plan.md`; **never commits**; never pushes; never advances past
  `implemented`.
- **State transitions:** *initial* `approved` → `implementation-in-progress` →
  `implemented`; *resume* `implementation-in-progress` → `implemented` (owned by
  `/implement`). `implemented → verified → closed` is owned by `/verify`.

### /verify  (review gate)
- **Purpose:** Validate AC coverage and implementation evidence (read-only),
  author `verify.md`, and close on PASSED or block on FAILED. Last command;
  owns success-closure.
- **Inputs:** `<ticket>`.
- **Outputs:** `verify.md` (AC→test→result table, commands+output, protected-path
  impact statement, sign-off); `ticket.md` updated per outcome.
- **Preconditions:** `ticket.md` exists; state = `implemented`; `spec.md` has AC
  IDs (TR-1); `implement.md` present with evidence (files + commits, IM-6).
- **Verification depth (MO-6):** `all-ac` for every ticket — every AC mapped to a
  result (no risk tiers, no rollback rehearsal). A comprehension check (≥3
  questions from `implement.md`/`spec.md`, ≥1 of them on the integration /
  cross-flow axis) is required before PASSED (CG-1..CG-5; CG-6 n/a — no panel here).
- **Validation profiles (config-driven; VP-1..VP-5 / ADR-006):** if `plan.md`
  names a profile, `/verify` resolves **profile → checks → commands** from
  `project-config.yaml`, executes them locally (deterministic, non-interactive,
  read-only), and records command, exit code, output summary, and result mapped to
  `AC-n`. No profile ⇒ unchanged behavior. Local only — no GitHub/CI-CD/MCP/
  external runner.
- **Postconditions:**
  - **PASSED** (every AC mapped to a passing result + reviewer sign-off): `ticket.md`
    `implemented → verified → closed` (history `verification-passed`,
    `ticket-closed`).
  - **FAILED** (any AC fails / evidence insufficient): `ticket.md`
    `implemented → implementation-in-progress`, `status: blocked` (history
    `verification-failed`); failures documented in `verify.md`. **Not closed.**
- **Stop conditions / failure:** state ≠ `implemented`; missing AC mapping;
  `implement.md` missing. **On precondition failure, write nothing** (atomic).
- **Guarantees:** does **not** modify implementation files and **creates no
  commit** (validation is read-only); writes confined to `verify.md` +
  `ticket.md`.
- **State transitions (owned by `/verify`):** PASSED `implemented → verified →
  closed`; FAILED `implemented → implementation-in-progress` (rework, recoverable
  via `/implement` resume).

### /publish-pr  (delivery, additive — wf-004 / ADR-007)

- **Purpose:** Publish a ticket's reviewed implementation branch to GitHub as a
  Pull Request. As the **single git delivery boundary**, it prepares the
  publishable changes — staging and committing the full publishable set
  (implementation changes + `implement.md` + `verify.md` + the `ticket.md`
  closure update) — then pushes `ticket/<slug>`, opens a PR via `gh`, and records
  the PR URL in `ticket.md > links.github`. **Not part of the seven-stage
  lifecycle** — it is a delivery action that is **orthogonal to the state
  machine**.
- **Inputs:** `<ticket>`.
- **Outputs:** a single publishable commit on `ticket/<slug>` capturing the
  implementation changes and workspace artifacts; the branch pushed to `origin`;
  a GitHub PR (title/body generated from artifacts); `ticket.md > links.github`
  set to the PR URL. The commit captures pre-existing changes/artifacts; it
  creates no workflow state and performs no transition — only `links.github` is
  written as a workflow field.
- **Preconditions:** `ticket.md` exists; `state ∈ {verified, closed}` (publishing
  is allowed only after a successful `/verify`); the `ticket/<slug>` branch exists.
- **Postconditions:** `links.github` holds the PR URL; **`state` is unchanged** and
  **no state-history entry is appended** (PB-3/PB-4).
- **State ownership (ADR-003/ADR-007):** GitHub is a delivery surface only.
  `/publish-pr` performs **no state transition**; opening/closing/approving/
  merging a PR never changes workflow state, and no GitHub status/review/check/
  merge state is read back into the workflow (one-way: workflow → GitHub).
- **Isolation (ADR-005 pattern):** all `git` (staging/commit/push) and `gh` logic
  lives only in `scripts/github_publish.py`; the command embeds none. The helper
  prechecks `gh` and **fails safely** (no commit/push/PR/ticket change) when `gh`
  is missing or unauthenticated.
- **Out of scope (ADR-007):** GitHub API tokens, MCP, CI/CD, comment/status sync,
  auto-merge, branch deletion, and any reading of GitHub state into the workflow.
- **State transitions:** none. `/publish-pr` does not appear in the state machine
  in §2; it only writes the `links.github` metadata field.

---

## 2. Canonical workflow state machine

`blocked` is **not** a state; it is an orthogonal flag (`status: blocked`) on any
non-terminal state. The ticket states are:

| State                        | Allowed next states                                                       | Forbidden (examples)                              |
|------------------------------|---------------------------------------------------------------------------|---------------------------------------------------|
| `draft`                      | `ready-for-research`, `closed`                                            | anything past research; `approved`, `implemented` |
| `ready-for-research`         | `research-complete`, `closed`                                            | `approved`, `implemented`, `verified`, `plan-complete` |
| `research-complete`          | `spec-complete`, `research-complete` (re-run), `closed`                   | `approved`, `implemented`                          |
| `spec-complete`              | `plan-complete`, `research-complete` (back), `closed`                     | `approved` (skips plan), `implemented`            |
| `plan-complete`              | `approved`, `plan-complete`/`spec-complete` (changes), `closed` (reject)  | `implementation-in-progress` (skips approval)     |
| `approved`                   | `implementation-in-progress`, `plan-complete` (revoke), `closed`         | `verified` (skips implement)                       |
| `implementation-in-progress` | `implemented`, `closed` (abort)                                          | `verified`, `approved` (backwards)                |
| `implemented`                | `verified`, `implementation-in-progress` (rework), `closed`              | `approved`, `plan-complete` (backwards)           |
| `verified`                   | `closed`, `implementation-in-progress` (late rework)                     | `approved`, `draft` (backwards)                   |
| `closed`                     | — (terminal)                                                              | **all** — reopen forbidden; open a new ticket     |

Key invariant: the only path into `implementation-in-progress` is from
`approved`. There is no way to reach implementation without passing the
`/review` gate, in any mode.

---

## 3. Branch strategy

- **When created:** **after review-gate approval only.** `/start-ticket` does **not**
  create a branch. The branch is created when the ticket enters implementation —
  i.e. by the future implementation-entry command, once state = `approved`.
- **Naming convention:** `ticket/<slug>` (slug = the filesystem-safe ticket
  slug). One branch per ticket holds the implementation work.
- **When committed:** `/implement` applies changes to the working tree on the
  branch but does **not** commit; the single publishable commit is created by
  `/publish-pr` (the single git delivery boundary). Between `/implement` and
  `/publish-pr` the work lives uncommitted on the branch.
- **When forbidden:**
  - `/start-ticket` creating a branch (workspace setup is branch-free).
  - Any branch creation while the ticket is **not READY** / before state `approved`.
  - A branch for that slug already exists (collision).
  - Base `develop` is dirty (uncommitted changes) at branch-creation time.
  - Branching to modify `protected_paths` unless it is listed in the approved
    `plan.md` (review-gate approved).
- **Rationale:** The non-mutating stages (`intake → research → spec → plan →
  review`) only produce documentation and need no isolated branch. Deferring
  branch creation until `approved` means no branch ever exists for a ticket that
  was never approved, keeping the branch namespace clean and tying every branch
  to a reviewed, implementation-bound change.

---

## 4. Single workflow form + comprehension gate (ADR-011)

**There are no execution modes and no risk tiers.** Every ticket runs the **one
uniform workflow form** (all seven stages, both gates), carried by a **single
owner**. The owner runs their own `/review` and `/verify` (self-review); there is
no separate reviewer and no separation of duties. Gate integrity comes from a
**comprehension check**: at each gate the owner must answer questions generated
from the artifact under review before the gate records its decision — **at least
3, a floor and not a fixed count** (ADR-014), always including **≥1 on the
integration / cross-flow axis** (CG-5) plus **one per `major` panel finding** at
`/review` (CG-6).
Canonical: `project-config.yaml > workflow_form` / `> comprehension_gates`.

| Aspect         | Every ticket (uniform)                                            |
|----------------|------------------------------------------------------------------|
| Stages         | all 7                                                            |
| Who runs gates | the ticket **owner** (self-review) — no distinct reviewer        |
| Gate control   | **comprehension check** (≥3 questions from the artifact, ≥1 on integration; CG-1..CG-6) |
| Approval       | 1 self-approval by the owner                                     |
| Verification   | `all-ac` — every AC mapped to a result                          |
| ADR            | optional (record if notable)                                    |

The `/review` and `/verify` gates are mandatory and never skipped, and neither may
record its decision until the comprehension questions are answered.

---

## 5. Command interactions (expected behavior)

| Question                                   | Behavior                                                                                 |
|--------------------------------------------|------------------------------------------------------------------------------------------|
| Can `/research` run twice?                 | Yes, while state is `ready-for-research`/`research-complete` (idempotent, re-derives `research.md`). Forbidden once `approved` — must revoke review first. |
| Can `/spec` run before `/research`?        | No — precondition is `ready-for-research` (research must have run). (FAST is deferred in v1.) |
| Can `/verify` run without `/implement`?    | No. Precondition is state `implemented`; from any earlier state it is rejected.          |
| Can `/review` reject an already-approved plan? | Yes, **only** before `implementation-in-progress`: a re-review may move `approved` → `plan-complete` (CHANGES_REQUESTED) or `closed` (REJECTED). Once implementation has started, review is locked until implement is aborted. |
| Can `/start-ticket` run twice for a slug?  | No — slug collision is a stop condition (idempotent guard).                              |
| Can `/plan` run before `/spec`?            | No — `/plan` requires `research-complete` (produced by `/spec`). (FAST is deferred in v1.) |
| Can `/implement` run before `/review`?     | No — precondition is `approved`; this is the core gate.                                  |
| Can a closed ticket be reopened?           | No — `closed` is terminal. Open a new ticket.                                            |

---

## 6. Next-step guidance contract

Every command (all seven lifecycle stages **and** `/publish-pr`) must, on
completion, emit **next-step guidance** so the operator always knows what comes
next (AC-1). The guidance is a short, standardized block with these fields (AC-2):

| Field | Meaning |
|-------|---------|
| **Current state** | `ticket.md > state` after this command (or "unchanged" for the orthogonal `/publish-pr`). |
| **Next command** | The next legal command in the workflow, or `none` when the state is terminal. |
| **Required actions** | Manual actions that MUST happen before the next command can run (e.g. mark intake `READY`, supply a reviewer). `none` if there are none. |
| **Optional actions** | Useful-but-optional actions available now (e.g. `/publish-pr` after closure). `none` if there are none. |
| **Terminal?** | `yes — no further workflow action required` when the state is terminal (`closed`); otherwise `no`. |

Outcome-specific wording:
- **Blocked outcomes (AC-3)** — when a command blocks (`status: blocked`, e.g.
  `/implement` blocked or `/verify` FAILED), the **Required actions** field MUST
  state exactly what has to be completed before the workflow can continue, not a
  generic message.
- **Terminal outcomes (AC-4)** — when the outcome is terminal (`/verify`
  PASSED → `closed`, or `/review` REJECTED → `closed`), **Next command** is
  `none` and **Terminal?** states that no further workflow action is required.

The guidance is presentation/usability only: it is derived from the canonical
state machine (§2) and never itself changes state. Each command's "Next step"
section fills this contract for its own outcomes. (Validation: NS-1..NS-4.)

## Reconciliation status (resolved in the consolidation phase)

The items previously flagged here have been reconciled — this document and
`.claude/project-config.yaml` are now consistent:

1. **State machine — RESOLVED.** `project-config.yaml > lifecycle` now defines
   this exact 10-state machine (with `blocked` as an orthogonal flag) as the
   single source of truth. §2 here mirrors it.
2. **Modes & reviewers — REMOVED (ADR-011).** No execution modes, no risk tiers,
   no separate reviewer. `project-config.yaml > workflow_form` defines the single
   uniform form and `> comprehension_gates` the gate control (the owner answers
   questions from the artifact); §4 here mirrors them. `standard`/`high_risk`/
   `fast` are gone — the `mode` field is a legacy single value `standard`.
3. **Closure — RESOLVED.** One closure strategy: no `/close` command; the reviewer
   transitions `verified → closed` at `/verify` sign-off
   (`project-config.yaml > closure`).
