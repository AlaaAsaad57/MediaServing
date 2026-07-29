# Workflow Rules — Engineering Workflow v1

Defines each stage, its gates, and the cross-cutting guardrails. Stages, the
single workflow form + comprehension gate, lifecycle states, and decision
tracking are canonical in `.claude/project-config.yaml`.

## Stage definitions, entry & exit criteria

### 1. intake
- **Definition:** Capture and qualify the request; create the ticket workspace.
- **Entry:** A request exists with at least a title and goal.
- **Exit:** `_specs/<ticket>/` created; metadata per `ticket-standard.md` filled.

### 2. research
- **Definition:** Read-only investigation of repo, configs, and impact.
- **Entry:** Intake complete.
- **Exit:** `research.md` lists relevant directories, config files, affected
  services, validation commands, risks, and open questions with `OQ-n` IDs
  (ADR-015). **No code changed.**

### 3. spec
- **Definition:** Define acceptance criteria and test cases.
- **Entry:** Research complete.
- **Exit:** Acceptance criteria + test cases exist and are unambiguous, and every
  `OQ-n` from research is answered or deferred to `/plan` with its ID (SP-9).

### 4. plan
- **Definition:** Decide the approach and concrete steps.
- **Entry:** Spec complete.
- **Exit:** `plan.md` has approach, steps, files to change, validation, rollback,
  integration surface, and an answer for every `OQ-n` the spec deferred (PL-12).

### 5. review  (review gate)
- **Definition:** The owner reviews spec + plan (self-review) with a comprehension check before any implementation.
- **Entry:** Spec and plan complete.
- **Exit:** Owner records `APPROVED` after the comprehension check. `CHANGES_REQUESTED`/`REJECTED` returns to spec/plan.

### 6. implement
- **Definition:** Apply the change per the approved plan only.
- **Entry:** Review `APPROVED`.
- **Exit:** `implement.md` records files changed and deviations. Changes are
  applied to the working tree on `ticket/<slug>` but **not committed** — the
  single publishable commit is created later by `/publish-pr` (the git delivery
  boundary; ADR-008).

### 7. verify  (review gate)
- **Definition:** Validate the change and review runtime impact.
- **Entry:** Implementation complete.
- **Exit:** `verify.md` shows passing checks; the owner signs off after the
  comprehension check; ticket `verified` → `closed` (see closure strategy below).

## Single workflow form (single owner + comprehension gate)

There are **no execution modes and no risk tiers** (ADR-011). Every ticket runs
the **one uniform workflow form**: all seven stages and both gates, carried by a
**single owner**. Canonical: `project-config.yaml > workflow_form` and
`> comprehension_gates` — this section only summarizes them. (`standard`,
`high_risk`, and `fast` are removed; the `mode:` front-matter field is a legacy
single value, `standard`.)

- **Single owner:** one person authors the ticket **and** runs its `/review` and
  `/verify` gates themselves (self-review is expected). There is no separate
  reviewer and no separation of duties.
- **Comprehension gate = the control.** In place of a second person, each gate
  requires the owner to answer questions generated **from the artifact under
  review** (`plan.md`/`spec.md` at `/review`; `implement.md`/`spec.md` at
  `/verify`) before it may record its decision — this is what guards against
  rubber-stamping (CG-1..CG-6). **At least 3 questions — a floor, not a fixed
  count** (ADR-014): always **≥1 on the integration / cross-flow axis** (CG-5,
  sourced from the plan's `Integration surface`), plus **one per `major` advisory
  panel finding** at `/review` (CG-6). The panel still never blocks — the owner may
  dismiss a finding, but only after showing they understood it.
- **Uniform safeguards (every ticket):** all seven stages, **1 self-approval** by
  the owner, `adr_required: false` (ADRs optional), verification `all-ac` (every
  acceptance criterion mapped to a result). No risk classification, no second
  approver, no rollback-rehearsal tier.

The `/review` and `/verify` gates are **never** skipped, and neither may record
its decision until the comprehension questions are answered.

## Lifecycle states

The canonical ticket **state machine** (states + allowed transitions) is defined
in `project-config.yaml > lifecycle`. This is the single source of truth:

`draft → ready-for-research → research-complete → spec-complete → plan-complete
→ approved → implementation-in-progress → implemented → verified → closed`

- `blocked` is **not** a state; it is an orthogonal flag carried in artifact
  front-matter (`status: blocked`). A stage may not advance while its artifact
  status is `blocked`.
- The only path into `implementation-in-progress` is from `approved` — nothing
  bypasses the review gate.
- `closed` is terminal: no reopen; open a new ticket.

## Closure strategy

There is **no `/close` command.** Closure is owned by two commands
(`project-config.yaml > closure`):

- **Success:** `/verify` — at reviewer sign-off the ticket transitions
  `verified → closed`.
- **Rejection:** `/review` — a `REJECTED` decision transitions
  `spec-complete → closed` (terminal).

In both cases `closed` is terminal: no reopen; open a new ticket.

## Ticket state ownership

The ticket's workflow state has exactly one owner (see
[ADR-003](../docs/adr/ADR-003-ticket-state-ownership.md)):

- **`_specs/<ticket>/ticket.md` owns workflow state** — its front-matter `state`
  field is authoritative.
- **Artifact files never own workflow state.** They may carry a *local* `status`
  describing only their own stage progress.
- **Only `ticket.md` defines the current ticket state.** A `review.md` may
  document *why* a transition happened, but does not own the state.
- Commands **must never** infer state from artifact existence or content. They
  read `ticket.md`, validate the transition, then update `ticket.md`.

## Role authority (single-owner model)

(Canonical: `project-config.yaml > role_authority` / `separation_of_duties`;
validation: RA-1..RA-3.)

- **Roles:** `workflow_owner` (governance — workflow evolution, governance
  decisions, escalations, cross-project issues; **not** a per-ticket gate),
  `reviewer` (the gate actor at `/review` and `/verify` — normally the ticket
  **owner** running their own gate, self-review; ADR-011), `developer`/`ai_agent`
  (authors/owners). Legacy `em` maps to `reviewer` (gate) / `workflow_owner`
  (governance).
- The gates `/review` and `/verify` are run by the ticket **owner** themselves
  (self-review; RA-1). Authoring commands are run by `developer`/`ai_agent`. **The
  workflow never requires Engineering Manager participation on a ticket.**
- Every recorded actor (`owner`, history `by`) must be a defined role (RA-2).
- **No separation of duties (single-owner model, ADR-011):** the ticket owner
  authors the work **and** runs its `/review` and `/verify` gates themselves —
  self-review is expected, not forbidden. The control against rubber-stamping is
  the **comprehension gate** (CG-1..CG-6), not a distinct reviewer. There is no
  second approver.

## Traceability

- Every stage artifact begins with YAML front-matter carrying `ticket`, `stage`,
  `mode`, `status`, `owner`, `updated`, and `links` (ClickUp/GitHub).
- Acceptance criteria are given stable IDs in `spec.md` and referenced by the
  same IDs in `verify.md`, giving criterion → test → result traceability.

## Architectural decisions (ADRs)

- Significant or hard-to-reverse choices are recorded as ADRs under
  `.claude/docs/adr/` using `ADR-0000-template.md`.
- An ADR references the originating ticket; a ticket references its ADRs in the
  relevant artifact. ADRs are append-only (supersede, never rewrite).

## Guardrails

- No stage may begin before the previous stage's exit criteria are met.
- Research/spec/plan/review are **non-mutating** — no source or config edits.
- Protected runtime paths (`protected_paths` in `project-config.yaml`) are never
  modified by workflow tooling or governance work.
- Each stage writes only inside its own `_specs/<ticket>/` folder.
- No workflow commands are created except where a phase explicitly authorizes it.

## Verification requirements

- Every acceptance criterion (by ID) maps to at least one executed test case in
  `verify.md`, with its result recorded.
- The `verify` stage must explicitly state whether any `protected_paths` file
  changed (yes/no) and, if yes, that it was intended and approved at the review gate.
- Verification commands and their output must be reproducible.

## Documentation requirements

- Each stage produces its artifact from `_specs/_templates/`, including front-matter.
- Deviations from the plan are documented in `implement.md`.
- Review decisions (`APPROVED` / `CHANGES_REQUESTED` / `REJECTED`) are recorded
  against the stage.
- Architectural decisions are recorded as ADRs (see above).
- This rules file and `project-config.yaml` are the source of truth; other docs
  must be reconciled to them.
