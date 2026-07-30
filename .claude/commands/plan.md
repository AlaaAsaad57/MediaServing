---
description: Validate the spec and author plan.md. First run advances research-complete → spec-complete; supports a revision re-run after CHANGES_REQUESTED. Does not approve or branch. Atomic on failure.
argument-hint: <slug>
allowed-tools: Read, Grep, Glob, Write
---

# /plan

For ticket `<slug>`: validate the spec and write the plan artifact
`_specs/<slug>/plan.md` (approach, steps, files to change, validation, rollback).

`/plan` has two entry modes:
- **Initial** — from `state: research-complete`: writes `plan.md` and advances
  the ticket `research-complete → spec-complete`.
- **Revision** — from `state: spec-complete` when the latest `review.md` decision
  is `CHANGES_REQUESTED`: rewrites `plan.md` to address the follow-ups, keeps
  state at `spec-complete`, and records a revision history entry. This makes a
  CHANGES_REQUESTED review recoverable **without manual state edits**.

**This command does NOT approve implementation and does NOT create a branch.**

**Atomic:** validate first. If any check fails, write **nothing** — neither
`ticket.md` nor `plan.md`.

Authoritative references (apply, do not reinvent):
- Command contract: `.claude/docs/command-architecture.md` (`/plan`)
- **Validation: `.claude/rules/validation-model.md` — apply rule codes only; no
  custom validation logic.**
- State ownership: `.claude/rules/workflow-rules.md` + ADR-003.

## Inputs

- `slug` (required) — workspace `_specs/<slug>/`. If missing, ask once.

## Step 1 — Validate (abort on any ERROR, writing nothing — PL-8)

Read `_specs/<slug>/ticket.md`, `spec.md`, and (if present) `review.md`; then
apply:
- **TS-1 / TS-2 / TS-3** — `ticket.md` exists, valid; read current `state` here.
- **MO-1** — the single workflow form has no modes; abort if `ticket.md > mode`
  is anything other than `standard` (`MO-1 ERROR: only the single workflow form
  is supported — ADR-011`).
- **PL-7 (entry mode)** — exactly one of:
  - *Initial:* `state == research-complete`; or
  - *Revision:* `state == spec-complete` **and** `review.md` exists with
    `Decision: CHANGES_REQUESTED`.
  Any other state → abort.
- **SP-validation** — `spec.md` exists and satisfies **SP-1..SP-5 + TR-1**.
- **VP-1 / VP-4 (only if the Validation strategy names a profile)** — the named
  validation profile must exist in `project-config.yaml > validation_profiles`,
  every check it requires must be defined in `validation_checks`, and the plan
  must reference the profile by id only (no command strings in `plan.md`).
  Otherwise abort.

If any ERROR fires, stop and report the rule code + message. **Make no writes.**

## Step 2 — Write plan.md

Read `_specs/_templates/plan.md` and write `_specs/<slug>/plan.md` (overwrites on
revision): front-matter (`ticket`, `stage: plan`, `mode: standard`, `status: complete`,
`owner: developer`, `updated: <today>`, `links`) and every section — Approach,
Steps, Files to change, **Integration surface**, Validation strategy, Rollback,
Out of scope — grounded in `spec.md`'s acceptance criteria. **On revision,
explicitly address the `Required Follow-up Actions` from `review.md`.**

The **Integration surface** (PL-11, ADR-014) is not optional and not a summary of
the steps. Investigate (read-only) and state: which components / services /
shared config this change touches beyond its own files; who *else* reads or
depends on them (another ticket's flow, a dashboard, an alert, a metric label, an
env var, a port, a path, an interface); where this ticket's flow **overlaps
another use case in the same code**; any ordering or lockstep dependency; and
what breaks if that is wrong. `none — self-contained` is allowed **only** with the
reason stated. `/review` draws its mandatory integration question from this
section (CG-5) — a vague section produces a vague gate.

Every `OQ-n` that `spec.md > Open Questions` deferred must be **answered here**
(PL-12, ADR-015), naming the ID in the section that carries the answer — Approach,
Files to change, Integration surface, or Out of scope. After `/plan` no `OQ-n` is
still open; `/review` checks this before it may record APPROVED (RV-3). A question
about `protected_paths` is answered by listing the exact paths under **Files to
change** — that listing, once APPROVED, is the only thing that makes editing them
legal at `/implement` (GU-2 / IM-5). Nobody's verbal "yes" grants that.

The **Validation strategy** may optionally name **one** validation profile
(`Validation profile: <profile-id>`) defined in
`project-config.yaml > validation_profiles`; `/verify` later resolves it to its
checks and commands. Commands are **never** written into `plan.md` — they live
only in `validation_checks` (VP-4). Omit the line (or `none`) to keep the current
free-form validation behavior (VP-5).

## Step 3 — Update ticket.md (TS-4)

**Initial entry** (`research-complete`):
- `state: spec-complete`, `updated_at: <today>`; append:
  ```yaml
  - state: spec-complete
    event: spec-validated
    by: ai_agent
    timestamp: <today>
  ```

**Revision entry** (already `spec-complete`):
- Keep `state: spec-complete`; `updated_at: <today>`; if `status: blocked`, reset
  to `status: active`; append:
  ```yaml
  - state: spec-complete
    event: plan-revised
    by: developer
    timestamp: <today>
  ```

## Postconditions — validate AFTER writing

- **PL-1..PL-5 + PL-11** plan.md content present, incl. the Integration surface
  (and follow-ups addressed on revision) · **PL-12** every `OQ-n` deferred by
  `spec.md` answered, with its ID named.
- **PL-6 / TS-4** `ticket.md` updated once; `state = spec-complete`; history
  appended (`spec-validated` initial, or `plan-revised` on revision).
- **PL-9** no approval; no branch.
- **CMD-2** postcondition state = `spec-complete`.
- **FM-1..FM-8** `plan.md` front-matter valid; **GU-1 / GU-3** writes confined to
  `plan.md` + `ticket.md`.

## MUST NOT

- Do **not** approve implementation or advance to `approved` / `plan-complete`
  (PL-9; those are the `/review` gate).
- Do **not** create a git branch (PL-9 / GU-4).
- Do **not** modify source code or any `protected_paths` runtime file.
- Do **not** create any other artifact.
- Do **not** perform a partial write: if Step 1 fails, nothing is written (PL-8).

## Report

State that `_specs/<slug>/plan.md` was created/revised, the entry mode (initial
vs revision), that `ticket.md` is at `spec-complete` (history appended), that no
approval/branch was performed, and the next step: a reviewer runs `/review`.

## Next step (NS-1..NS-4)

Emit the next-step block (`command-architecture.md §6`):

- **Current state:** `spec-complete`
- **Next command:** `/review <slug> <APPROVED|CHANGES_REQUESTED|REJECTED> "<rationale>"`
- **Required actions:** none — the ticket **owner** runs `/review` themselves
  (self-review) and answers the comprehension questions at the gate (CG-1).
- **Optional actions:** revise via `/plan <slug>` again before review if needed.
- **Terminal?** no
