# Validation Model — Engineering Workflow v1

> **One validation model for the whole workflow.** Every command MUST run the
> relevant rules below and MUST NOT invent its own validation logic. This model
> is **derived from** (never contradicts) the canonical sources:
> `.claude/project-config.yaml` (state machine, single workflow form + comprehension gate, closure),
> `.claude/rules/workflow-rules.md` (gates/guardrails), and
> `.claude/docs/command-architecture.md` (command contracts).
>
> This phase defines the model only. **No automation/validator code is created.**

## Result model

- Each rule evaluates to `PASS` or a **violation** `{ code, severity, message }`.
- **Severity:** `ERROR` blocks the command (it must abort and report);
  `WARN` is advisory (command may proceed, must surface it).
- A command may perform its action only if **no `ERROR` violations** remain
  across its applicable rule set.
- Validation runs at two points per command: **precondition** (before acting)
  and **postcondition** (after writing its artifact / making changes).

## Rule catalogue

### FM — Front-matter (every artifact)
| Code | Severity | Condition |
|------|----------|-----------|
| FM-1 | ERROR | All keys present: `ticket, stage, mode, status, owner, updated, links`. |
| FM-2 | ERROR | `stage` ∈ canonical stages **and** equals the artifact's own stage. |
| FM-3 | ERROR | `mode` == `standard` — the sole legal value (the single workflow form; ADR-011). `high_risk` and `fast` are invalid and must be rejected (e.g. at `/start-ticket`). (Legacy already-closed tickets carrying `high_risk` are historical and out of scope — not rewritten.) |
| FM-4 | ERROR | `status` ∈ {`not_started`, `in_progress`, `blocked`, `complete`}. |
| FM-5 | ERROR | `ticket` matches slug pattern `^[A-Za-z0-9][A-Za-z0-9._-]*$`. |
| FM-6 | WARN  | `updated` is an ISO date `YYYY-MM-DD`. |
| FM-7 | WARN  | `links` contains `clickup` and `github` keys (values may be empty). |
| FM-8 | ERROR | `mode` is identical across all artifacts of the same ticket. |

### TS — Ticket state source (ADR-003)
| Code | Severity | Condition |
|------|----------|-----------|
| TS-1 | ERROR | Ticket state is read **only** from `_specs/<ticket>/ticket.md > state`. Inferring state from artifact existence/content is forbidden. |
| TS-2 | ERROR | `ticket.md` exists and its front-matter has all required fields (`ticket, title, mode, state, status, owner, created_at, updated_at`). |
| TS-3 | ERROR | `ticket.md > state` ∈ canonical states; `ticket.md > status` ∈ {`active`, `blocked`}. |
| TS-4 | ERROR | A transition updates `ticket.md` (`state`, `updated_at`) — the single write point. |
| TS-5 | WARN  | `ticket.md > mode/owner` agree with artifact front-matter (ticket.md is canonical; artifacts mirror). |

### ST — State machine
> The "current state" in every ST rule is `_specs/<ticket>/ticket.md > state` (TS-1).

| Code | Severity | Condition |
|------|----------|-----------|
| ST-1 | ERROR | Current ticket state (`ticket.md > state`) ∈ canonical states (`project-config.yaml > lifecycle.states`). |
| ST-2 | ERROR | A state **change** must target a state ∈ `allowed[current]`. A command that does **not** change state (idempotent re-run, `/plan` revision, `/research` refresh, `/implement` resume/block) is exempt — it appends history without a transition. Anything else is forbidden. |
| ST-3 | ERROR | No stage advances while `ticket.md > status: blocked`. The ticket must first be unblocked (e.g. `/implement` resume resets `status: active`). |
| ST-4 | ERROR | No transition originates from `closed` (terminal). |
| ST-5 | ERROR | `implementation-in-progress` is reachable only from `approved` (initial implementation) or from `implemented` / `verified` (rework after a failed `/verify`). No other source. |

### MO — Workflow form (single, uniform)
> No execution modes and no risk tiers (ADR-011): one uniform workflow form for
> every ticket, with the same safeguards. A single owner runs their own gates
> (self-review); the comprehension gate (CG-*) is the integrity control.
> Canonical: `project-config.yaml > workflow_form`.

| Code | Severity | Condition |
|------|----------|-----------|
| MO-1 | ERROR | The single workflow form includes **all seven stages for every ticket** — there are no modes and no risk tiers. `mode` is a legacy single value (`standard`); `high_risk`/`fast` are invalid values (ADR-011). Every stage is valid for every ticket. |
| MO-2 | — | *Removed.* (Former fast-mode eligibility; fast mode is gone — ADR-011.) |
| MO-3 | — | *Removed.* (Former risk classification; there are no risk tiers — every change is treated the same, ADR-011.) |
| MO-4 | ERROR | Approval count before `/implement` is **1** (`workflow_form.approvals`) — a single self-approval by the owner, read from `review.md > Approvals`. |
| MO-5 | — | *Removed.* (No mandatory-ADR tier; ADRs are optional for every ticket — ADR-011.) |
| MO-6 | ERROR | Verification depth is **`all-ac` for every ticket** (`workflow_form.verification`): every acceptance criterion mapped to a result. No rollback-rehearsal tier (ADR-011). |

### CMD — Command pre/postconditions
The authoritative pre/postconditions are in `command-architecture.md §1`. The
validator enforces them as state checks (mapping in "Invocation map" below).
| Code | Severity | Condition |
|------|----------|-----------|
| CMD-1 | ERROR | Command's documented **precondition state** equals the current state. |
| CMD-2 | ERROR | After the command, state equals one of the command's documented postcondition states. A command may have multiple outcome states (e.g. `/review` → {`approved`, `closed`, `spec-complete`}; `/verify` → {`closed`, `implementation-in-progress`}). |
| CMD-3 | ERROR | `/start-ticket` only: slug has no existing workspace dir. (No branch is created or checked at start-ticket.) |

### GU — Guardrails
| Code | Severity | Condition |
|------|----------|-----------|
| GU-1 | ERROR | Non-mutating stages (`research`, `spec`, `plan`, `review`) produced no diff outside `_specs/<ticket>/`. |
| GU-2 | ERROR | `protected_paths` runtime is modified **only** inside an approved `/implement` stage on the ticket branch (listed in `plan.md`; CLAUDE.md hard-stop). There is no risk tier — the comprehension gate and this hard-stop are the only guards (ADR-011). |
| GU-3 | ERROR | A command writes only inside `_specs/<ticket>/` (and, for `/implement`, the approved files on branch `ticket/<slug>`). |
| GU-4 | ERROR | Branches are created only by the implementation-entry command (after state = `approved`), named `ticket/<slug>`, from clean `develop`. `/start-ticket` must NOT create a branch, and no branch may exist for a not-yet-approved ticket. |

### RS — Research artifact (`/research`)
| Code | Severity | Condition |
|------|----------|-----------|
| RS-1 | ERROR | `research.md` lists relevant directories. |
| RS-2 | ERROR | `research.md` lists relevant config files. |
| RS-3 | ERROR | `research.md` lists possibly affected services and available test/validation commands. |
| RS-4 | ERROR | `research.md` documents risks/unknowns. |
| RS-5 | ERROR | `research.md` documents open questions, each with a stable ID (`OQ-n`) — the IDs `spec.md` answers under SP-9 (ADR-015). Tickets closed before ADR-015 keep their un-numbered lists; they are not rewritten. |
| RS-6 | ERROR | On success `/research` updates `ticket.md` exactly once (TS-4): `state draft → ready-for-research`, bump `updated_at`, append a state-history entry. Writes confined to `ticket.md` + `research.md`; repository investigation stays read-only. |
| RS-7 | ERROR | Precondition: state = `draft` and `intake.md` Readiness Status = `READY`. |
| RS-8 | ERROR | **Atomicity:** on any precondition/validation failure, `/research` writes nothing — neither `ticket.md` nor `research.md`. |

### SP — Specification artifact (`/spec`)
| Code | Severity | Condition |
|------|----------|-----------|
| SP-1 | ERROR | `spec.md` states a Business Goal and a User Story. |
| SP-2 | ERROR | `spec.md` lists Functional Requirements and Non-Functional Requirements (+ Constraints). |
| SP-3 | ERROR | Acceptance criteria have stable IDs (`AC-n`) and each maps to a requirement (extends TR-1). |
| SP-4 | ERROR | `spec.md` contains **no implementation detail** — no file paths, no code, no approach/steps. (Implementation planning belongs to `/plan`.) |
| SP-5 | ERROR | `spec.md` declares Out of Scope. |
| SP-6 | ERROR | On success `/spec` updates `ticket.md` exactly once (TS-4): `state → research-complete`, bump `updated_at`, append a state-history entry. Writes confined to `ticket.md` + `spec.md`. |
| SP-7 | ERROR | Precondition: `research.md` exists and satisfies RS-1..RS-5, and state = `ready-for-research`, before `/spec` proceeds. |
| SP-8 | ERROR | **Atomicity:** on any precondition/validation failure, `/spec` writes nothing — neither `ticket.md` nor `spec.md`. |
| SP-9 | ERROR | **Every `OQ-n` in `research.md` is resolved in `spec.md`** (ADR-015), under **Research Questions Resolved**, as either: *answered* — the answer plus where it lands (a requirement, an `AC-n`, a constraint, or Out of Scope); or *deferred* — the answer needs the approach, so it is repeated under `spec.md > Open Questions` with the same ID for `/plan` to answer (PL-12). An `OQ-n` that appears nowhere in `spec.md` is an ERROR. **An answer given in conversation is not a resolution** — only the artifact counts (ADR-003). Recording the answer is not implementation detail and does not breach SP-4: state the scope decision, never the file paths or the approach. |

### PL — Plan artifact (`/plan`)
| Code | Severity | Condition |
|------|----------|-----------|
| PL-1 | ERROR | `plan.md` states an Approach. |
| PL-2 | ERROR | `plan.md` lists Steps. |
| PL-3 | ERROR | `plan.md` lists Files to change. |
| PL-4 | ERROR | `plan.md` states a Validation strategy and a Rollback. |
| PL-5 | ERROR | `plan.md` declares Out of scope. |
| PL-6 | ERROR | On success `/plan` updates `ticket.md` exactly once (TS-4): *initial* `research-complete → spec-complete` (history `spec-validated`); *revision* keeps `spec-complete` (history `plan-revised`, reset `status: blocked → active`). Bump `updated_at`. Writes confined to `plan.md` + `ticket.md`. |
| PL-7 | ERROR | Precondition (exactly one entry mode), with `spec.md` satisfying SP-1..SP-5 + TR-1: *initial* state = `research-complete`; OR *revision* state = `spec-complete` AND `review.md` Decision = `CHANGES_REQUESTED`. |
| PL-8 | ERROR | **Atomicity:** on any precondition/validation failure, `/plan` writes nothing — neither `ticket.md` nor `plan.md`. |
| PL-9 | ERROR | `/plan` does **not** approve implementation (no `→ approved`) and does **not** create a branch. |
| PL-10 | ERROR | Revision re-run must address `review.md > Required Follow-up Actions` in the rewritten `plan.md`. |
| PL-11 | ERROR | `plan.md` declares an **Integration surface** (ADR-014): the components / flows / shared config this change touches, who else depends on them, where this ticket's flow overlaps another use case, and what breaks if that is wrong. `none — self-contained` is a valid answer only when stated explicitly with its reason. This is the artifact source CG-5 draws its integration question from. |
| PL-12 | ERROR | **Every `OQ-n` deferred by `spec.md > Open Questions` is answered in `plan.md`** (ADR-015), naming the ID, in the section that carries the answer (Approach, Files to change, Integration surface, or Out of scope). After `/plan`, no `OQ-n` is still open — that is what RV-3 checks before APPROVED. |

### RV — Review artifact (`/review`, review gate)
| Code | Severity | Condition |
|------|----------|-----------|
| RV-1 | ERROR | `review.md` exists (written for every decision). |
| RV-2 | ERROR | Decision ∈ {`APPROVED`, `CHANGES_REQUESTED`, `REJECTED`}. |
| RV-3 | ERROR | `APPROVED` requires `plan.md` satisfies PL-1..PL-5 **+ PL-11** (Integration surface; ADR-014) **+ PL-12** (no `OQ-n` left open; ADR-015) and plan↔REQ/AC traceability. |
| RV-4 | ERROR | `APPROVED` updates `ticket.md` to `approved` (TS-4): `spec-complete → plan-complete → approved`, bump `updated_at`, append history (`plan-validated`, `plan-approved`). |
| RV-5 | — | *Removed.* (No two-approver tier; a single self-approval by the owner — ADR-011. Integrity comes from the comprehension gate, CG-*.) |
| RV-6 | — | *Removed.* (No mandatory-ADR tier; ADRs optional — ADR-011.) |
| RV-7 | ERROR | `CHANGES_REQUESTED` and `REJECTED` must **not** advance to `approved`. `CHANGES_REQUESTED` keeps `state = spec-complete`; `REJECTED` advances to `closed` (RV-10). |
| RV-8 | ERROR | **Atomicity:** if required validation fails, nothing is written (neither `review.md` nor `ticket.md`). |
| RV-9 | ERROR | `/review` never creates a branch and performs no implementation. |
| RV-10 | ERROR | `REJECTED` updates `ticket.md` (TS-4): `spec-complete → closed` (terminal), bump `updated_at`, append history (`plan-rejected`); rejection reasons documented in `review.md`. No `/close` command is used. |

### IM — Implementation (`/implement`)
| Code | Severity | Condition |
|------|----------|-----------|
| IM-1 | ERROR | Precondition (entry path): *initial* state = `approved` AND `review.md` Decision = APPROVED; OR *resume* state = `implementation-in-progress`. Any other state blocks. |
| IM-2 | ERROR | `plan.md` complete (PL-1..PL-5) with an explicit, unambiguous "Files to change" list. |
| IM-3 | ERROR | *Initial path:* branch `ticket/<slug>` is created here (GU-4), from clean `develop`, only after approval; no pre-existing branch. |
| IM-3a | ERROR | *Resume path:* the `ticket/<slug>` branch already exists and is checked out; `/implement` must **not** create a second branch. |
| IM-4 | ERROR | Changes are confined to files listed in `plan.md` "Files to change". **No unrelated file is modified** (no silent scope creep). |
| IM-5 | ERROR | `protected_paths` is modified only when listed in the approved `plan.md` "Files to change" and only inside the `/implement` stage (GU-2). No risk tier is required (ADR-011). |
| IM-6 | ERROR | `implement.md` records files changed, deviations, and validation run. **No commit is created at `/implement`** (IM-9); commit SHAs are therefore not recorded here — committing is the delivery boundary's job (PB-8). |
| IM-7 | ERROR | `state = implemented` requires **all** planned work complete and validation recorded. On completion update `ticket.md` (TS-4), bump `updated_at`, append history: *initial* `implementation-started` then `implementation-completed`; *resume* `implementation-resumed` then `implementation-completed`. |
| IM-8 | ERROR | **Block on unsafe/unclear:** ambiguous plan, scope creep, dirty `develop`, branch collision/mismatch, or `protected_paths` not listed in the approved `plan.md` → make NO changes and report. |
| IM-9 | ERROR | `/implement` creates **no commit** and never pushes; changes remain as uncommitted working-tree edits on the local `ticket/<slug>` branch (the single publishable commit is created later by `/publish-pr`, PB-8). It never advances past `implemented`. |
| IM-10 | ERROR | **Blocked is valid but not complete:** if work cannot continue, keep `state = implementation-in-progress`, set `status: blocked`, and `implement.md` records blocking reason + partial changes + recommended next action + whether plan revision is required. Do **not** set `implemented`. |

### VF — Verification (`/verify`, review gate)
| Code | Severity | Condition |
|------|----------|-----------|
| VF-1 | ERROR | `verify.md` exists (written for both PASSED and FAILED outcomes). |
| VF-2 | ERROR | **AC coverage:** every acceptance criterion (`AC-n`) in `spec.md` is mapped to an executed result in `verify.md` (TR-2). |
| VF-3 | ERROR | **Implementation evidence:** `implement.md` records the changed files (and any validation run); `PASSED` requires every AC result to pass. Because `/implement` creates no commit (IM-9), commit SHAs are **not** required evidence — the absence of a commit is expected, not a failure. |
| VF-10 | ERROR | `/verify` creates **no commit** (AC-6); validation is read-only and committing is exclusively the delivery boundary's job (PB-8). |
| VF-4 | ERROR | Verification depth is **`all-ac`** for every ticket (MO-6): every AC mapped to a result. No risk tiers, no rollback-rehearsal tier (ADR-011). |
| VF-5 | ERROR | **PASSED closes (TS-4):** `implemented → verified → closed`, bump `updated_at`, append history (`verification-passed`, `ticket-closed`). |
| VF-6 | ERROR | **FAILED blocks (TS-4):** `implemented → implementation-in-progress`, `status: blocked`, append history (`verification-failed`); ticket is **not** closed; failures documented in `verify.md`. |
| VF-7 | ERROR | `/verify` does **not** modify implementation files; writes are confined to `verify.md` + `ticket.md` (validation is read-only). |
| VF-8 | ERROR | **Atomicity:** on precondition failure, `/verify` writes nothing. |
| VF-9 | ERROR | `verify.md` records the protected-path impact yes/no statement (TR-3). |

### CU — ClickUp intake (`/start-ticket`, optional, read-only)
| Code | Severity | Condition |
|------|----------|-----------|
| CU-1 | ERROR | If `clickup_id` is given, `CLICKUP_API_TOKEN` must be set in the environment. |
| CU-2 | ERROR | The read-only fetch (`scripts/clickup_intake.py <id>`) must succeed (task exists / authorized / reachable). |
| CU-3 | ERROR | ClickUp access is **read-only** — only a `GET` is issued; no write (POST/PUT/DELETE), no status/comment change, no task creation/closure. |
| CU-4 | ERROR | **Atomicity:** if `clickup_id` is given and CU-1/CU-2 fail, `/start-ticket` writes nothing (no workspace created). |
| CU-5 | ERROR | ClickUp seeds only `title`/`description`/`url`; `ticket.md` remains the canonical workflow-state owner (no state derived from ClickUp). |

### VP — Validation profiles (`/plan` selection, `/verify` execution; WF-PILOT-003)
> Applies only when a ticket's `plan.md` Validation strategy names a validation
> profile. Two **separate** concepts in `project-config.yaml`: `validation_checks`
> (definitions — commands) and `validation_profiles` (selection — check-ids only).
> Execution is **local and config-driven**: no GitHub/CI-CD/MCP/external runner.
> Canonical state ownership is unchanged (ADR-003): profiles, checks, and results
> are configuration/records, never workflow state. Decision: ADR-006.

| Code | Severity | Condition |
|------|----------|-----------|
| VP-1 | ERROR | If `plan.md` references a profile, the profile exists in `project-config.yaml > validation_profiles` and **every** check it requires is defined in `validation_checks`. (Enforced at `/plan` and `/verify`.) |
| VP-2 | ERROR | Validation commands are **read-only** w.r.t. implementation files — running them introduces no working-tree change (reinforces VF-7). |
| VP-3 | ERROR | Validation commands are **deterministic and non-interactive** (stable, repeatable result; no prompts or human input). |
| VP-4 | ERROR | **Separation of concepts:** profiles reference only check-ids; commands exist **only** in `validation_checks`. A profile carrying a command string is invalid. |
| VP-5 | ERROR | **Backward compatibility:** when no profile is referenced, `/verify` runs no profile-execution path and behaves exactly as before (config-driven execution is opt-in). |

### RA — Role authority (single-owner; separation of duties removed)
| Code | Severity | Condition |
|------|----------|-----------|
| RA-1 | ERROR | Gate commands (`/review`, `/verify`) are run by the **ticket owner** themselves (self-review; `project-config.yaml > role_authority.gate_commands`). No distinct reviewer is required (ADR-011). The workflow never requires Engineering Manager participation. |
| RA-2 | ERROR | Every recorded actor (`owner`, history `by`) ∈ defined roles {`workflow_owner`, `reviewer`, `developer`, `ai_agent`} (or a named person mapped to one). Legacy `em` maps to `reviewer` (gate) / `workflow_owner` (governance). |
| RA-3 | — | *Removed.* (No separation of duties — the owner runs their own gates, ADR-011. The anti-rubber-stamp control is the comprehension gate, CG-1..CG-6.) |

### CG — Comprehension gate (`/review`, `/verify`; every gate — ADR-011, ADR-014)
> The single-owner model has no distinct reviewer, so gate integrity comes from a
> comprehension check: the owner answers questions generated FROM the artifact
> under review before the gate records its decision. It is the **only** control
> that blocks a gate — so it must cover the risky axes, not just the artifact-local
> ones (ADR-014). Canonical: `project-config.yaml > comprehension_gates`.

| Code | Severity | Condition |
|------|----------|-----------|
| CG-1 | ERROR | A gate (`/review`, `/verify`) may not record its decision (APPROVED / PASSED) until `_specs/<ticket>/comprehension.md` exists with **all** questions for this stage answered (non-empty answers). The count is a **floor, not a fixed number**: ≥ `comprehension_gates.questions_min`, plus any question required by CG-5/CG-6. Asking more than the floor is always valid; asking fewer is an ERROR. |
| CG-2 | ERROR | The questions are **derived from the artifact under review** (`/review`: `plan.md` + `spec.md`; `/verify`: `implement.md` + `spec.md`) — specific to its acceptance criteria / files / **integration surface** / rollback / risks, not generic. Each is **multiple-choice** with **at least 4** candidate answers (one correct + ≥3 plausible distractors) drawn from the artifact (`comprehension_gates.options_min`); the selected answer, its **source** (artifact section, `AC-n`, or panel finding), and its correctness are recorded. |
| CG-3 | ERROR | The comprehension gate is **required at every gate for every ticket** (`comprehension_gates.required: always`); it is the control that replaces a distinct reviewer. `comprehension.md` writes are confined to `_specs/<ticket>/` (GU-3). |
| CG-4 | ERROR | **Pass threshold = 100% (`comprehension_gates.pass_threshold: 1.0`).** The gate records APPROVED / PASSED **only if every answer is correct**. Any incorrect answer blocks the gate: it records no decision and does not advance `ticket.md` (atomic, like RV-8 / VF-8); it reports the missed questions, and the owner re-reads the artifact and re-runs. |
| CG-5 | ERROR | **Integration question is mandatory (`comprehension_gates.integration_question: required`; ADR-014).** At least one question per gate is on the **integration / cross-flow axis** — what this change touches outside itself, which other component or use-case flow shares that code / config / interface, ordering or lockstep dependencies, and what breaks if the assumption is wrong. Source: at `/review` `plan.md > Integration surface` (PL-11) + `spec.md` (+ panel findings); at `/verify` `implement.md` + `spec.md` + the plan's Integration surface. A plan that declares `none — self-contained` is still questioned on *why* it is self-contained. This question counts toward the CG-1 floor. |
| CG-6 | ERROR | **Panel-seeded questions (ADR-014).** When the panel ran (RP-1), **every** finding at severity `comprehension_gates.panel_question_severity` (`major`) seeds **one additional** question **above** the CG-1 floor, recorded with that finding as its source. `minor`/`info` seed nothing. This does **not** give a lens a veto (RP-2): the owner may still dismiss the finding in `review.md` — they must first demonstrate they understood it. What blocks is a wrong answer, never the finding itself. |

### RP — Advisory review panel (`/review`; ADR-012)
> AI reviewer lenses (senior / security / performance) that **assist** the single
> owner at `/review`. They inform the decision; they never make it. This does
> **not** reintroduce separation of duties (ADR-011) — the panel is advisory and
> the comprehension gate (CG-*) remains the integrity control. Canonical:
> `project-config.yaml > review_panel`. Applies only when `review_panel.enabled`.

| Code | Severity | Condition |
|------|----------|-----------|
| RP-1 | ERROR | When `review_panel.enabled`, `/review` dispatches **every** lens in `review_panel.lenses` (each a read-only subagent under `.claude/agents/`) and records their findings in the **Panel Findings** section of `review.md`. When disabled, `/review` runs no panel path (opt-in; behaves exactly as before). |
| RP-2 | ERROR | **Advisory (`review_panel.advisory: true`):** a panel finding **never** blocks or forces a decision. APPROVED is gated only by the comprehension check (CG-*) and RV-3 — never by panel output. A `major` finding is surfaced, not enforced; per CG-6 it also **seeds a comprehension question**, which obliges the owner to understand it, not to act on it — dismissing it in `review.md` remains legal. No lens holds a veto (ADR-014 does not change this). |
| RP-3 | ERROR | Panel subagents are **read-only**: they may read `plan.md`/`spec.md` (and referenced context) but produce **no** working-tree change outside `review.md` (reinforces GU-1). |
| RP-4 | ERROR | **Ordering:** the panel runs only **after** Step 1 validation passes and **before** the comprehension check (Step 1a → Step 1b). It is never run on a plan that failed validation, and never gates or precedes validation. |

### NT — Gate notifications (local hook; ADR-013)
> A deterministic notice on every gate decision, delivered by a local PostToolUse
> hook (`.claude/hooks/notify_gate.py`) that fires when `comprehension.md` is
> written. Reuses the existing Alertmanager Telegram bot (token/chat via a
> gitignored local config file or env, never committed). Delivery is the
> **harness's** job (hook), not the AI's memory — the same I/O-isolation pattern as
> ClickUp/GitHub (ADR-005/007). Canonical: `project-config.yaml > notifications`.
> Applies only when `notifications.enabled`.

| Code | Severity | Condition |
|------|----------|-----------|
| NT-1 | ERROR | Delivery is performed **only** by the local hook; **no command embeds the delivery HTTP** (I/O isolation). Commands write the artifact; the harness runs the hook. |
| NT-2 | ERROR | The hook is **one-way** (workflow → channel): it reads artifacts + config/env and sends. It **never** writes `ticket.md`, changes workflow state, or edits a `protected_paths` file (reuses the bot via credentials only — mirrors PB-4). |
| NT-3 | ERROR | Delivery failure behaves per `notifications.enforcement`: `warn` (default) logs and the gate **completes** (hook exit 0); `block` **fails** the gate (hook exit 2). Unconfigured (no token/chat) is always fail-open — missing credentials must never freeze a gate. |

### TR — Traceability
| Code | Severity | Condition |
|------|----------|-----------|
| TR-1 | ERROR | Every acceptance criterion in `spec.md` has a stable ID (`AC-n`). |
| TR-2 | ERROR | Every `AC-n` is referenced in `verify.md` with a recorded result. |
| TR-3 | ERROR | `verify.md` contains the protected-path impact yes/no statement. |

### CL — Closure
| Code | Severity | Condition |
|------|----------|-----------|
| CL-1 | ERROR | `verified → closed` is performed only at `/verify` sign-off by the reviewer. |
| CL-2 | ERROR | No `/close` command exists; closure outside `/verify` is invalid. |

### PB — GitHub PR publish (`/publish-pr`, delivery; wf-004)
> `/publish-pr` is an **additive delivery command, orthogonal to the state
> machine** — it is not one of the seven lifecycle stages and performs **no** state
> transition. GitHub is a delivery surface only; `ticket.md` stays canonical
> (ADR-003). Decision: ADR-007. `git`/`gh` logic lives only in
> `scripts/github_publish.py` (ADR-005 pattern).

| Code | Severity | Condition |
|------|----------|-----------|
| PB-1 | ERROR | Precondition: `ticket.md > state` ∈ {`verified`, `closed`}. Publishing is allowed only after a successful `/verify`. |
| PB-2 | ERROR | The `ticket/<slug>` implementation branch exists before publishing. |
| PB-3 | ERROR | `/publish-pr` performs **no** state transition: `ticket.md > state` is unchanged; it writes **only** `links.github` (AC-6). |
| PB-4 | ERROR | `/publish-pr` appends **no** state-history entry and reads **no** GitHub state (status/review/comment/check/merge) into the workflow — one-way, workflow → GitHub (AC-7). |
| PB-5 | ERROR | **Atomicity:** on precondition failure or helper non-zero exit, nothing is written — `ticket.md` is left unchanged. |
| PB-6 | ERROR | **Fail-safe (AC-9):** when `gh` is unavailable/unauthenticated the helper aborts (GH-1/GH-2) with **no commit**, no push, no PR, and no `ticket.md` change. |
| PB-7 | ERROR | `git` (staging, commit, push) and `gh` (PR) logic lives **only** in `scripts/github_publish.py` (the command embeds none); PR title/body are generated from workflow artifacts (AC-3/AC-4). |
| PB-8 | ERROR | `/publish-pr` is the **single git delivery boundary**: it stages and creates the one publishable commit on `ticket/<slug>` (when uncommitted changes exist) **before** pushing/opening the PR. No other command creates commits (IM-9, VF-10). |
| PB-9 | ERROR | The publishable commit/PR includes the full set (AC-8): implementation changes + `implement.md` + `verify.md` + the `ticket.md` closure update. Staging is confined to the implemented source (per `plan.md`) and `_specs/<slug>/`; no unrelated path is staged (GU-3). |

### NS — Next-step guidance (every command; wf-005)
> Usability layer: every command tells the operator what comes next. Guidance is
> **presentation-only** — derived from the §2 state machine (canonical in
> `project-config.yaml > lifecycle`); it never changes or owns state (ADR-003).
> Field definitions: `command-architecture.md §6`. Decision: ADR-008.

| Code | Severity | Condition |
|------|----------|-----------|
| NS-1 | ERROR | Every command — all seven lifecycle stages **and** `/publish-pr` — emits next-step guidance on completion (AC-1). |
| NS-2 | ERROR | The guidance identifies all five fields: current workflow state; next legal command; required manual actions; optional actions; and the terminal-state condition when applicable (AC-2). |
| NS-3 | ERROR | On a **blocked** outcome (`status: blocked`, e.g. `/implement` blocked or `/verify` FAILED), the required-actions field states exactly what must be completed before the workflow can continue (AC-3) — not a generic message. |
| NS-4 | ERROR | On a **terminal** outcome (`closed`), the guidance sets next command = `none` and states that no further workflow action is required (AC-4). |
| NS-5 | WARN  | Guidance vocabulary/structure is consistent across all commands and agrees with the canonical state machine (usability/NFR). |

## Invocation map (command → applicable rules)

Every command except `/start-ticket` begins by reading `ticket.md` (TS-1..TS-3)
and ends by writing the transition to `ticket.md` (TS-4). `/start-ticket`
**creates** `ticket.md` with `state: draft`. All commands enforce **RA-1/RA-2**
(role authorization). The review gates `/review` and `/verify` additionally run
the **comprehension gate (CG-1..CG-6)** before recording a decision (CG-6 applies
only where the panel ran — `/review`). Every command
additionally emits next-step guidance at completion (**NS-1..NS-4**), so it is not
repeated per row below.

| Command        | Precondition rules                          | Postcondition rules                     |
|----------------|---------------------------------------------|-----------------------------------------|
| `/start-ticket`| FM-3, FM-5, CMD-3, GU-4, MO-1, CU-1..CU-5 (if `clickup_id`) | TS-2/3/4, FM-1..FM-8, ST-1, CMD-2 |
| `/research`    | TS-1/2/3, FM-*, ST-1, ST-2, MO-1, CMD-1, RS-7, RS-8 | RS-1..RS-6, TS-4, FM-*, GU-1, GU-3, CMD-2 (state → ready-for-research) |
| `/spec`        | TS-1/2/3, FM-*, ST-1, ST-2, MO-1, CMD-1, SP-7 (RS-1..RS-5), SP-8 | SP-1..SP-6, SP-9, TR-1, TS-4, FM-*, GU-1, GU-3, CMD-2 (state → research-complete) |
| `/plan`        | TS-1/2/3, FM-*, ST-1, ST-2, MO-1, CMD-1, PL-7, PL-8, VP-1/VP-4 (if a profile is named) | PL-1..PL-6, PL-9, PL-10 (revision), PL-11, PL-12, TS-4, FM-*, GU-1, GU-3, CMD-2 (state stays/→ spec-complete) |
| `/review`      | TS-1/2/3, FM-*, ST-1, ST-2, CMD-1, RV-2, RV-8, RP-4, CG-1..CG-6 | RP-1..RP-3 (if `review_panel.enabled`), RV-1, RV-3, RV-4, RV-7, RV-9, RV-10, TS-4 (APPROVED → approved; REJECTED → closed), FM-*, GU-1, GU-3, CMD-2 |
| `/implement`   | TS-1/2/3, FM-*, ST-2, ST-5, MO-4, CMD-1, IM-1, IM-2, IM-8 | IM-3 or IM-3a, IM-4, IM-5, IM-6, IM-9, then IM-7 (complete → `implemented`) **or** IM-10 (blocked → `implementation-in-progress` + `status: blocked`), TS-4, FM-*, GU-2, GU-3, CMD-2 |
| `/verify`      | TS-1/2/3, FM-*, ST-2, MO-6, CMD-1, VF-8, CG-1..CG-5 (CG-6 n/a — no panel at `/verify`), VP-1 (if a profile is named) | VF-1..VF-4, VF-7, VF-9, VF-10, VP-2..VP-5 (if a profile is named), then VF-5 (PASSED → closed) or VF-6 (FAILED → implementation-in-progress + blocked), TR-2, TR-3, CL-1, TS-4, FM-*, GU-3, CMD-2 |
| `/publish-pr`  | TS-1/2/3, RA-1/RA-2, PB-1, PB-2, PB-6 | PB-3, PB-4, PB-5, PB-7, PB-8, PB-9, GU-3 (the publishable commit stages the implemented source + `_specs/<slug>/`; the only workflow **state** write remains `ticket.md > links.github`, plus the `origin` push); **no** TS-4 transition |

## Error code conventions

- Codes are stable identifiers (`FM-1`, `ST-2`, …) so command output and logs
  are greppable and consistent across all commands.
- A command reports the **first** `ERROR` per category plus all `WARN`s.

## Out of scope (this phase)

- No validator implementation, scripts, hooks, or commands.
- No changes to `protected_paths` runtime files.
