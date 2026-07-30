---
description: Review gate — validate plan.md, record APPROVED/CHANGES_REQUESTED/REJECTED, and advance to approved only when APPROVED. No branches, no implementation. Atomic on failure.
argument-hint: <slug> <APPROVED|CHANGES_REQUESTED|REJECTED> "<rationale>"
allowed-tools: Read, Grep, Glob, Write, AskUserQuestion, Task
---

# /review

The review gate for ticket `<slug>`. Validate the plan, record the decision in
`_specs/<slug>/review.md`, and **only when APPROVED** advance the ticket
`spec-complete → plan-complete → approved`.

**This command does NOT create a branch and does NOT implement anything.**

**Signal over noise — do not over-react or over-engineer.** Report only real
risks, actual bugs, and genuine gaps (an AC with no covering step, a missing
rollback, a protected-path touch not listed in the plan). Do not pad the review
with hypothetical edge cases, style preferences, "could also add…" scope
suggestions, or demands for abstractions/tests/hardening the spec never asked
for. A short review with zero findings is a valid, good outcome — never invent
findings to appear thorough.

**Atomic:** validate first. If a required check fails, write **nothing** —
neither `review.md` nor `ticket.md`.

Authoritative references (apply, do not reinvent):
- Command contract: `.claude/docs/command-architecture.md` (`/review`)
- **Validation: `.claude/rules/validation-model.md` — apply rule codes only; no
  custom validation logic.**
- Workflow form + comprehension gate: `.claude/project-config.yaml > workflow_form` / `> comprehension_gates`. State ownership: ADR-003.

## Inputs

- `slug` (required) — workspace `_specs/<slug>/`.
- `decision` (required) — `APPROVED | CHANGES_REQUESTED | REJECTED` (RV-2).
- `rationale` (required) — reason for the decision.
If any required input is missing, ask once.

## Step 1 — Validate (abort on required-validation failure, writing nothing — RV-8)

Read `_specs/<slug>/ticket.md`, `spec.md`, `plan.md`, then apply:
- **RA-1** — this gate is run by the ticket **owner** themselves (self-review is
  expected; ADR-011). No distinct reviewer is required; there is **no** RA-3
  separation-of-duties check.
- **TS-1 / TS-2 / TS-3** — `ticket.md` exists, valid; read current `state` here.
- **CMD-1 / ST-2** — `state` must be `spec-complete`. Otherwise abort.
- **RV-2** — decision is one of the three allowed values.
- For **APPROVED** only:
  - **RV-3** — `plan.md` exists and satisfies **PL-1..PL-5 + PL-11** (an explicit
    **Integration surface**; ADR-014) **+ PL-12** (no `OQ-n` from `research.md` is
    still open — each is answered in `spec.md` or `plan.md`; ADR-015) with
    plan↔REQ/AC traceability. Otherwise abort.

If a required check fails, stop and report the rule code + message. **Make no writes.**

## Step 1a — Advisory review panel (RP-1..RP-4)

Runs only after Step 1 passes and **before** the comprehension check (RP-4). If
`project-config.yaml > review_panel.enabled` is false, skip this step.

1. Dispatch every lens in `review_panel.lenses` **in parallel**, each as a
   read-only subagent (RP-3), passing the ticket slug so it reads
   `_specs/<slug>/plan.md` + `spec.md`:
   - `senior` → `senior-reviewer` · `security` → `security-reviewer` ·
     `performance` → `performance-reviewer` (`.claude/agents/`).
2. Collect each lens's findings list.
3. Record them under the **Panel Findings** section of `review.md` (Step 2):
   one row per finding — lens, severity, finding, plan/spec reference, and the
   owner's disposition (accept / mitigate / dismiss, with a one-line reason).
4. **Advisory only (RP-2):** the panel **never** blocks the decision. Even a
   `major` finding does not force CHANGES_REQUESTED — it is surfaced for the
   owner to weigh. APPROVED remains the owner's call and is gated only by the
   comprehension check (CG-*), never by panel output.
5. **But a `major` finding is not free to ignore (CG-6, ADR-014):** each one seeds
   an extra comprehension question in Step 1b. The owner may still dismiss it —
   after demonstrating they understood it. Carry the `major` findings forward.

Surface the findings to the owner before Step 1b so they inform the decision.

## Step 1b — Comprehension check (CG-1..CG-6)

The single-owner gate has no second reviewer, so the owner must show they
understand the plan before deciding:
1. Generate multiple-choice questions **derived from `plan.md`/`spec.md`** (the
   acceptance criteria, the "Files to change", the **Integration surface**, the
   rollback, the risks) — specific, not generic (CG-2). Each question offers
   **at least 4 candidate answers** drawn from the artifact: one correct plus ≥3
   plausible distractors. **Sort each question's options alphabetically** — the
   correct answer's position must carry no signal (never habitually first).
   **Write every question, option, and recorded answer in English** — the
   conversation language never changes the gate language (CLAUDE.md).

   **How many (CG-1):** `comprehension_gates.questions_min` (3) is a **floor, not
   a fixed count** — ask more whenever the plan warrants it. On top of the floor:
   - **CG-5 — mandatory integration question (≥1, counts toward the floor):** on
     the cross-component / cross-flow axis — what this change touches outside
     itself, which other component or use-case flow shares that code, config,
     interface, metric, or file path, ordering / lockstep dependencies, and what
     breaks if the assumption is wrong. Source it from `plan.md > Integration
     surface` (PL-11) and the Step 1a findings. If the plan declares
     `none — self-contained`, ask *why* it is self-contained.
   - **CG-6 — one extra question per `major` panel finding, above the floor.**
     Two `major` findings ⇒ at least 5 questions; `minor`/`info` seed none. This
     is **not** a veto (RP-2): the owner may still dismiss the finding in
     `review.md` — they must first show they understood it.
2. Ask them via `AskUserQuestion`; the owner selects an option per question.
3. Record, under the **review** section of `_specs/<slug>/comprehension.md`
   (create it from `_specs/_templates/comprehension.md` if absent): each question,
   its options, its **source** (`plan.md` section / `AC-n` / `panel:<lens>`), the
   owner's selected answer, and whether it was correct. Set the
   front-matter (read by the notification hook — ADR-013): `stage: review`,
   `result: passed|failed`, `score: <correct>/<total>`, `decision:` = the
   gate decision when the quiz passed, `none` when it failed, and `missed:` =
   the missed questions + axis on a failed quiz (e.g. `Q2 (integration)`), empty
   when passed.
4. **Pass = 100% correct (CG-4).** If **any** answer is wrong, record **no**
   decision and leave `ticket.md` unchanged (atomic); report which questions were
   missed and stop — the owner re-reads the plan and re-runs `/review`. Proceed to
   record the decision only when every answer is correct.

This is the control that replaces a distinct reviewer (CG-1).

## Step 2 — Write review.md (RV-1)

Read `_specs/_templates/review.md` and write `_specs/<slug>/review.md`:
- Front-matter: `ticket: <slug>`, `stage: review`, `mode: <ticket.md mode>`,
  `status: complete`, `owner: reviewer`, `updated: <today YYYY-MM-DD>`, `links`.
- Fill: Review Scope, Plan Summary, Risks, Assumptions, Open Questions,
  **Panel Findings** (the advisory panel's findings from Step 1a + the owner's
  disposition per finding; RP-1), **Decision** (the chosen value + rationale),
  **Approvals** (a single self-approval by the owner), **ADR reference**
  (optional; `none` if not used), Required Follow-up Actions.

## Step 3 — Apply the decision

**If APPROVED** — update `_specs/<slug>/ticket.md` (TS-4 / RV-4):
- `state: approved`, `updated_at: <today>`.
- Append two state-history entries:
  ```yaml
  - state: plan-complete
    event: plan-validated
    by: reviewer
    timestamp: <today>
  - state: approved
    event: plan-approved
    by: reviewer
    timestamp: <today>
  ```

**If CHANGES_REQUESTED** (RV-7) — do **not** advance to `approved`. Keep
`ticket.md > state` at `spec-complete`. Optionally set `status: blocked` if the
follow-up requires it. (No state-history transition entry.)

**If REJECTED** (RV-7 / RV-10) — do **not** advance to `approved`. Document
rejection reasons in `review.md`, then update `_specs/<slug>/ticket.md` (TS-4):
- `state: closed` (terminal), `updated_at: <today>`.
- Append one state-history entry:
  ```yaml
  - state: closed
    event: plan-rejected
    by: reviewer
    timestamp: <today>
  ```
This closes the ticket without a `/close` command. `closed` is terminal — to
revisit the work, open a new ticket.

## Postconditions — validate AFTER writing

- **RV-1** `review.md` written. **RV-2** decision valid.
- **RP-1** advisory panel ran (if enabled) and its findings are recorded in
  `review.md`; **RP-2** no decision was gated on panel output.
- APPROVED: **RV-3** plan validated (incl. **PL-11** + **PL-12**) · **CG-1** comprehension
  recorded at ≥ the floor · **CG-5** an integration question was asked · **CG-6**
  one question per `major` panel finding · **RV-4 /
  TS-4** `state = approved` with `plan-validated` + `plan-approved` history ·
  **CMD-2** state = `approved`.
- CHANGES_REQUESTED: **RV-7** state still `spec-complete`.
- REJECTED: **RV-7 / RV-10** state `spec-complete → closed` (terminal) with
  `plan-rejected` history; reasons documented in `review.md`.
- **RV-9** no branch created; nothing implemented.
- **FM-1..FM-8** `review.md` front-matter valid; **GU-1 / GU-3** writes confined
  to `review.md` (+ `ticket.md` on APPROVED or REJECTED).

## MUST NOT

- Do **not** advance to `approved` for CHANGES_REQUESTED or REJECTED (RV-7).
- Do **not** create a git branch (RV-9 / GU-4) or perform any implementation.
- Do **not** record any decision before the comprehension check is complete (CG-1).
- Do **not** treat `questions_min` as a cap (CG-1), skip the integration question
  (CG-5), or drop a `major` finding's seeded question (CG-6).
- Do **not** let the advisory panel block or decide: it never gates APPROVED and
  never runs before Step 1 validation (RP-2 / RP-4). Panel subagents are
  read-only — they must produce no diff outside `review.md` (RP-3 / GU-1).
- Do **not** modify source code or any `protected_paths` runtime file.
- Do **not** perform a partial write: if Step 1 fails, nothing is written (RV-8).

## Report

State the decision recorded, the resulting `ticket.md` state + history, and the
next step:
- APPROVED → `approved`; next: `/implement` (which creates the branch).
- CHANGES_REQUESTED → stays `spec-complete`; next: revise via `/plan` (revision
  mode) → `/review`.
- REJECTED → `closed` (terminal); the ticket is done — open a new ticket to
  revisit.

## Next step (NS-1..NS-4)

Emit the next-step block (`command-architecture.md §6`) for the recorded decision:

- **APPROVED:**
  - **Current state:** `approved`
  - **Next command:** `/implement <slug>` (the author; creates the branch)
  - **Required actions:** none
  - **Optional actions:** none
  - **Terminal?** no
- **CHANGES_REQUESTED:**
  - **Current state:** `spec-complete` (`status: blocked` if set)
  - **Next command:** `/plan <slug>` (revision), then `/review <slug>` again
  - **Required actions (NS-3):** address the `Required Follow-up Actions` in
    `review.md` via a `/plan` revision before re-review.
  - **Optional actions:** none
  - **Terminal?** no
- **REJECTED (terminal; NS-4):**
  - **Current state:** `closed`
  - **Next command:** none — `closed` is terminal.
  - **Required actions:** none — open a new ticket to revisit the work.
  - **Optional actions:** none
  - **Terminal?** yes — no further workflow action is required.
