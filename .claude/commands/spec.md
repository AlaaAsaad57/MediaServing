---
description: Validate research, advance ticket to research-complete, and author a traceable specification (no implementation planning). Atomic — nothing is written on validation failure.
argument-hint: <slug>
allowed-tools: Read, Grep, Glob, Write
---

# /spec

For ticket `<slug>`: validate that research is complete, advance the ticket state
to `research-complete` (appending a history entry), and write the specification
artifact `_specs/<slug>/spec.md` (requirements + acceptance criteria with stable
AC IDs). **No implementation planning.**

**Atomic:** validate everything first. If any check fails, write **nothing** —
neither `ticket.md` nor `spec.md`.

Authoritative references (apply, do not reinvent):
- Command contract: `.claude/docs/command-architecture.md` (`/spec`)
- **Validation: `.claude/rules/validation-model.md` — apply rule codes only; no
  custom validation logic.**
- Ticket standard: `.claude/docs/ticket-standard.md`. State ownership: ADR-003.

## Inputs

- `slug` (required) — workspace `_specs/<slug>/`. If missing, ask once.

## Step 1 — Validate (abort on any ERROR, writing nothing — SP-8)

Read `_specs/<slug>/ticket.md`, `intake.md`, and `research.md`, then apply:
- **TS-1 / TS-2 / TS-3** — `ticket.md` exists, valid; read current `state` here.
- **CMD-1 / ST-2** — `state` must be `ready-for-research` (the only legal source
  for the `→ research-complete` transition). Otherwise abort.
- **MO-1** — the single workflow form has no modes; `spec` always applies.
  `ticket.md > mode` must be the sole legal value `standard`; abort on any other
  (`MO-1 ERROR: only the single workflow form is supported — ADR-011`).
- **SP-7** — `research.md` exists and satisfies **RS-1..RS-5** (relevant dirs,
  config files, affected services + validation commands, risks, open questions).
  If missing/incomplete, abort and tell the user to run `/research`.

If any ERROR fires, stop and report the rule code + message. **Make no writes.**

## Step 2 — Write spec.md

Read `_specs/_templates/spec.md` and write `_specs/<slug>/spec.md`:
- Front-matter: `ticket: <slug>`, `stage: spec`, `mode: <ticket.md mode>`,
  `status: complete`, `owner: developer`, `updated: <today YYYY-MM-DD>`, `links`
  mirrored from `ticket.md`.
- Fill every section from `intake.md` (goal/user story) and `research.md`
  (constraints/edge cases/open questions): Feature Name, Business Goal, User
  Story, Functional Requirements, Non-Functional Requirements, Constraints, Edge
  Cases, **Research Questions Resolved**, Open Questions, **Acceptance Criteria
  Mapping** (each criterion gets a stable ID `AC-1`, `AC-2`, … mapped to a
  requirement), Out of Scope.

**Research Questions Resolved** (SP-9, ADR-015) is not optional. Every `OQ-n` in
`research.md` gets a row — either *answered* (the answer plus where it lands: a
requirement, an `AC-n`, a constraint, or Out of Scope) or *deferred* (the answer
needs the approach, so it is repeated under Open Questions with the same ID and
`/plan` answers it — PL-12). If the owner answered a question in conversation,
write that answer down here; **the conversation is not an artifact** and the next
command cannot see it (ADR-003). Keep the answer at spec level — the scope
decision, not the file paths or the approach (SP-4). Example: an `OQ-n` asking
whether `protected_paths` is touched is answered by putting that behavior in
scope (`/plan` then names the files) or by declaring it Out of Scope.

## Step 3 — Advance ticket state (TS-4)

Update `_specs/<slug>/ticket.md` (the single state write):
- `state: research-complete`
- `updated_at: <today>`
- Append one state-history entry:
  ```yaml
  - state: research-complete
    event: research-validated
    by: ai_agent
    timestamp: <today>
  ```

## Postconditions — validate AFTER writing

- **SP-1** Business Goal + User Story · **SP-2** Functional + Non-Functional
  Requirements (+ Constraints) · **SP-3 / TR-1** stable `AC-n` IDs mapped to
  requirements · **SP-4** no implementation detail (no file paths/code/steps) ·
  **SP-5** Out of Scope · **SP-9** every `OQ-n` from `research.md` answered or
  deferred with its ID.
- **SP-6 / TS-4** `ticket.md` updated once: `state = research-complete`,
  `updated_at` bumped, history appended.
- **CMD-2** postcondition state = `research-complete`.
- **FM-1..FM-8** `spec.md` front-matter valid; `mode` agrees with `ticket.md`.
- **GU-1 / GU-3** writes confined to `spec.md` + `ticket.md`.

## MUST NOT

- Do **not** introduce implementation planning: no approach, steps, file names,
  or code (SP-4). That is `/plan`'s job.
- Do **not** drop an `OQ-n`, and do **not** treat a chat answer as the resolution
  (SP-9). Every ID is answered here or deferred here — an ID that appears nowhere
  in `spec.md` aborts the command.
- Do **not** advance state beyond `research-complete` (the
  `research-complete → spec-complete` transition is owned by a later stage).
- Do **not** modify source code or any `protected_paths` runtime file.
- Do **not** create any other artifact or a branch.
- Do **not** perform a partial write: if Step 1 fails, nothing is written (SP-8).

## Report

State that `_specs/<slug>/spec.md` was created with N acceptance criteria
(`AC-1..AC-N`), that `ticket.md` advanced to `research-complete` (history
appended), and the next step: run `/plan`.

## Next step (NS-1..NS-4)

Emit the next-step block (`command-architecture.md §6`):

- **Current state:** `research-complete`
- **Next command:** `/plan <slug>`
- **Required actions:** none
- **Optional actions:** none
- **Terminal?** no
