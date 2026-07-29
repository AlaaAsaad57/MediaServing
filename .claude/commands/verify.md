---
description: Validate AC coverage and implementation evidence (read-only), author verify.md, then close the ticket on PASSED or block it on FAILED. Does not modify implementation files and creates no commit; does nothing on precondition failure.
argument-hint: <slug>
allowed-tools: Read, Grep, Glob, Bash, Write, AskUserQuestion
---

# /verify

For ticket `<slug>`: validate that the implementation satisfies every acceptance
criterion, author `_specs/<slug>/verify.md`, and either **close** the ticket
(PASSED) or **block** it for rework (FAILED). This is the final review-gate command
and owns success-closure.

**Read-only on implementation:** `/verify` runs validation/test commands but
**does not modify implementation files and creates no commit (VF-10 / AC-6)**.
Its only writes are `verify.md` and `ticket.md`. (Committing is exclusively the
job of `/publish-pr`, the single git delivery boundary — PB-8 / ADR-008.)

**Signal over noise — do not over-react or over-engineer.** Verify against the
spec's acceptance criteria, nothing more. FAIL only for a real defect: an AC
that demonstrably does not hold, a genuine bug, or a planned change that is
missing. Do not fail (or clutter `verify.md` with) style preferences,
hypothetical edge cases outside the ACs, or improvements the spec never asked
for — out-of-scope observations are at most a one-line note, never a failure.
A clean PASSED with no caveats is a valid, good outcome.

Authoritative references (apply, do not reinvent):
- Command contract: `.claude/docs/command-architecture.md` (`/verify`)
- **Validation: `.claude/rules/validation-model.md` — apply rule codes only; no
  custom validation logic.**
- Closure: `.claude/project-config.yaml > closure`. State ownership: ADR-003.

## Inputs

- `slug` (required) — workspace `_specs/<slug>/`. If missing, ask once.

## Step 1 — Validate preconditions (abort on ERROR, writing nothing — VF-8)

Read `_specs/<slug>/ticket.md`, `spec.md`, `plan.md`, `implement.md`; then apply:
- **RA-1** — this gate is run by the ticket **owner** themselves (self-review is
  expected; ADR-011). No distinct reviewer is required; there is **no** RA-3
  separation-of-duties check.
- **TS-1 / TS-2 / TS-3** — `ticket.md` exists, valid; read current `state`.
- **CMD-1 / ST-2** — state must be `implemented`. Otherwise abort.
- **VF-2 (coverage input)** — `spec.md` has acceptance criteria with stable
  `AC-n` IDs (TR-1). If absent → abort.
- **VF-3 (evidence input)** — `implement.md` records changed files + commits.
  If missing → abort.
- **VP-1 (only if `plan.md` names a validation profile)** — the profile exists in
  `project-config.yaml > validation_profiles` and every check it requires is
  defined in `validation_checks`. Otherwise abort.

If any check fails, stop and report the rule code + message. **Make no writes.**

## Step 2 — Verify (read-only)

On the ticket's branch (`ticket/<slug>`), validate **every** `AC-n` at depth
`all-ac` (VF-4 / MO-6) — every acceptance criterion mapped to a result. There is
no risk tier and no rollback-rehearsal tier (ADR-011).

**Validation-profile resolution (config-driven; VP-1..VP-5).** If `plan.md`'s
Validation strategy names a validation profile:
- Resolve **profile → required checks → commands**: for each required check whose
  `depth` ≤ `all-ac`, look up its `command` and `pass_when` from
  `project-config.yaml > validation_checks`. The command is **never** hardcoded
  here (VP-4) — it comes only from configuration.
- **Execute** each resolved command locally (VP-3: deterministic,
  non-interactive). A check **passes** when `pass_when` holds (e.g. `exit-zero`,
  `exit-code:<n>`, plus any `output_contains`). A command that cannot run is
  recorded as `error` (could-not-run) — a non-pass.
- **VP-2:** commands must be read-only w.r.t. implementation files; after running,
  confirm no working-tree change was introduced.
- Execution is **local only** — no GitHub/CI-CD/MCP/external runner.

If **no** profile is named (**VP-5**), run no profile-execution path and validate
as before — behavior is unchanged.

For **each** `AC-n` in `spec.md`, record a result (pass/fail), mapping each
executed check to the AC(s) it covers. Do **not** edit any implementation file.
Determine the protected-path impact statement (yes/no) (VF-9 / TR-3).

Outcome = **PASSED** iff every AC result passes; otherwise **FAILED**.

## Step 2b — Comprehension check (CG-1..CG-5)

The outcome is now known but **nothing is written yet**. Before recording it,
the owner must show they understand what was built:
1. Generate multiple-choice questions **derived from `implement.md`/`spec.md`**
   (what changed, which acceptance criteria it satisfies, how to roll it back, its
   runtime impact) — specific, not generic (CG-2). Each question offers **at least 4
   candidate answers** drawn from the artifact: one correct plus ≥3 plausible
   distractors. **Sort each question's options alphabetically** — the correct
   answer's position must carry no signal (never habitually first).
   **Write every question, option, and recorded answer in English** — the
   conversation language never changes the gate language (CLAUDE.md).

   **How many (CG-1):** `comprehension_gates.questions_min` (3) is a **floor, not
   a fixed count** — ask more when the change warrants it. CG-6 does not apply
   here (no panel at `/verify` — ADR-012). Mandatory on top of the floor:
   - **CG-5 — integration question (≥1, counts toward the floor):** on what the
     *implemented* change actually touches outside itself — which other component
     or use-case flow shares the files, config, interface, metric, or path that
     changed; whether the plan's declared **Integration surface** turned out to be
     complete; and what a rollback would drag with it. Source: `implement.md`
     (files changed + deviations), `spec.md`, and `plan.md > Integration surface`.
     A deviation from the declared surface is the strongest question available —
     prefer it.
2. Ask them via `AskUserQuestion`; the owner selects an option per question.
3. Record, under the **verify** section of `_specs/<slug>/comprehension.md`
   (create it from the template if absent; do **not** overwrite the `review`
   section): each question, its options, its **source** (`implement.md` /
   `AC-n` / `plan.md > Integration surface`), the selected answer, and whether it
   was correct. Set the front-matter (read by the notification hook — ADR-013):
   `stage: verify`, `result: passed|failed`, `score: <correct>/<total>`,
   `decision:` = the Step 2 outcome (`PASSED`/`FAILED`) when the quiz passed,
   `none` when it failed, and `missed:` = the missed questions + axis on a failed
   quiz (e.g. `Q3 (integration)`), empty when passed.
4. **Pass = 100% correct (CG-4).** If **any** answer is wrong, record **no** PASSED
   and leave `ticket.md` unchanged (atomic); report the missed questions and stop —
   the owner re-reads and re-runs `/verify`. Proceed only when every answer is correct.

## Step 3 — Write verify.md (VF-1)

Write `_specs/<slug>/verify.md` from `_specs/_templates/verify.md`: front-matter
(`ticket`, `stage: verify`, `mode`, `status: complete`, `owner: developer`,
`updated: <today>`, `links`) + the AC→test→result table (VF-2), commands run with
output, the protected-path & runtime impact review (VF-9), and the sign-off with
the outcome and the owner's self sign-off.
When a validation profile was used, record the resolved **profile id** and, per
executed check, the **command**, **exit code**, a bounded **output summary**, the
**result**, and the `AC-n` it maps to.

## Step 4 — Apply outcome to ticket.md (TS-4)

**If PASSED** (VF-5) — close the ticket:
- `state: closed`, `status: active`, `updated_at: <today>`; append:
  ```yaml
  - state: verified
    event: verification-passed
    by: reviewer
    timestamp: <today>
  - state: closed
    event: ticket-closed
    by: reviewer
    timestamp: <today>
  ```

**If FAILED** (VF-6) — block for rework, do **not** close:
- `state: implementation-in-progress`, `status: blocked`, `updated_at: <today>`;
  append:
  ```yaml
  - state: implementation-in-progress
    event: verification-failed
    by: reviewer
    timestamp: <today>
  ```
- Document the failing AC(s) and required fixes in `verify.md`. The ticket is
  recoverable via `/implement` (resume).

## Postconditions — validate AFTER

- **VF-1** verify.md written · **VF-2** every AC mapped to a result · **VF-3**
  evidence checked · **VF-4** depth = all-ac · **CG-1** comprehension recorded at ≥ the floor · **CG-5** an integration question was asked · **VF-9 / TR-3** protected-path
  statement present.
- PASSED: **VF-5 / CL-1 / TS-4 / CMD-2** state = `closed`.
- FAILED: **VF-6 / TS-4** state = `implementation-in-progress`, `status: blocked`.
- **VF-7** no implementation file modified; writes confined to `verify.md` +
  `ticket.md`. **VF-10** no commit created. **FM-1..FM-8** front-matter valid.
- **VP-1..VP-5 (if a profile was used)** — profile/checks resolved from config;
  commands deterministic, non-interactive, and read-only; no-profile path
  unchanged.

## MUST NOT

- Do **not** close the ticket unless the outcome is PASSED (VF-5).
- Do **not** modify implementation files / source (VF-7) — validation is read-only.
- Do **not** create any commit (VF-10) — committing is exclusively `/publish-pr`'s job.
- Do **not** modify `protected_paths` runtime files.
- Do **not** run if state ≠ `implemented` (VF-8 — write nothing).

## Report

State the outcome (PASSED/FAILED), the AC results summary, the protected-path
impact, and the resulting `ticket.md` state:
- PASSED → `closed` (workflow complete).
- FAILED → `implementation-in-progress` + `status: blocked`; next: `/implement`
  (resume) to fix, then `/verify` again.

## Next step (NS-1..NS-4)

Emit the next-step block (`command-architecture.md §6`):

- **PASSED → `closed` (terminal; NS-4):**
  - **Current state:** `closed`
  - **Next command:** none — the workflow is complete.
  - **Required actions:** none
  - **Optional actions:** `/publish-pr <slug>` to deliver the work to GitHub (the
    single git delivery boundary; orthogonal to state).
  - **Terminal?** yes — no further workflow action is required.
- **FAILED → `implementation-in-progress` + `status: blocked` (NS-3):**
  - **Current state:** `implementation-in-progress` (`status: blocked`)
  - **Next command:** `/implement <slug>` (resume), then `/verify <slug>` again.
  - **Required actions:** fix the failing acceptance criteria documented in
    `verify.md` (revise via `/plan` first if the fix changes the plan).
  - **Optional actions:** none
  - **Terminal?** no
