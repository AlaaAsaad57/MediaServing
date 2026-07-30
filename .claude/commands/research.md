---
description: Investigate the repo (read-only), author research.md, and advance the ticket draft → ready-for-research. Atomic — nothing is written on validation failure.
argument-hint: <slug>
allowed-tools: Read, Grep, Glob, Write
---

# /research

For ticket `<slug>`: validate the ticket is ready, perform **read-only**
repository discovery, write `_specs/<slug>/research.md`, and advance the ticket
state `draft → ready-for-research` (appending a history entry).

**Atomic:** validate everything first. If any check fails, write **nothing** —
neither `research.md` nor `ticket.md`. Repository investigation never mutates
source or `protected_paths`.

Authoritative references (apply, do not reinvent):
- Command contract: `.claude/docs/command-architecture.md` (`/research`)
- **Validation: `.claude/rules/validation-model.md` — apply rule codes only; no
  custom validation logic.**
- State ownership: `.claude/rules/workflow-rules.md` + ADR-003.

## Inputs

- `slug` (required) — workspace `_specs/<slug>/`. If missing, ask once.

## Step 1 — Validate (abort on any ERROR, writing nothing — RS-8)

Read `_specs/<slug>/ticket.md` and `intake.md`, then apply:
- **TS-1 / TS-2 / TS-3** — `ticket.md` exists, valid; read current `state` here.
- **RS-7 / CMD-1 / ST-2** — `state` must be `draft` **and** `intake.md` Readiness
  Status must be `READY` (the legal source for the `→ ready-for-research`
  transition). If `state` is already `ready-for-research`, skip the transition
  and only refresh `research.md` (idempotent re-run). Otherwise abort.
- **MO-1** — the single workflow form has no modes; `research` always applies.
  `ticket.md > mode` must be the sole legal value `standard`; abort on any other
  (`MO-1 ERROR: only the single workflow form is supported — ADR-011`).

If any ERROR fires, stop and report the rule code + message. **Make no writes.**

## Step 2 — Discover (read-only) and write research.md

Investigate using **Read / Grep / Glob only** (no mutation, no shell side
effects). From the ticket goal in `intake.md`, gather: relevant directories;
relevant config files (read `protected_paths` only to understand it, never
modify); possibly affected services; available test/validation commands (list,
do not run); risks/unknowns; open questions.

Give every open question a stable ID — `OQ-1`, `OQ-2`, … (RS-5, ADR-015). These
IDs are what `/spec` must answer (SP-9) and, when deferred, `/plan` (PL-12), so a
question raised here cannot be lost. Ask them here even when the answer looks
obvious — an answer given in chat is not recorded anywhere and does not carry.

Read `_specs/_templates/research.md` and write `_specs/<slug>/research.md`:
- Front-matter: `ticket: <slug>`, `stage: research`, `mode: <ticket.md mode>`,
  `status: complete`, `owner: ai_agent`, `updated: <today YYYY-MM-DD>`, `links`
  mirrored from `ticket.md`.
- Fill every section (RS-1..RS-5); leave the "Notes" read-only assertions intact.

## Step 3 — Advance ticket state (TS-4)

Only when entering from `state: draft`, update `_specs/<slug>/ticket.md` (the
single state write):
- `state: ready-for-research`
- `updated_at: <today>`
- Append one state-history entry:
  ```yaml
  - state: ready-for-research
    event: research-started
    by: ai_agent
    timestamp: <today>
  ```
(On an idempotent re-run already at `ready-for-research`, do not append a
duplicate entry.)

## Postconditions — validate AFTER writing

- **RS-1..RS-5** — `research.md` contains relevant directories, config files,
  affected services + validation commands, risks, and open questions **with
  `OQ-n` IDs**.
- **RS-6 / TS-4** — `ticket.md` updated once: `state = ready-for-research`,
  `updated_at` bumped, history appended.
- **CMD-2** — postcondition state = `ready-for-research`.
- **FM-1..FM-8** — `research.md` front-matter valid; `mode` agrees with `ticket.md`.
- **GU-1 / GU-3** — writes confined to `research.md` + `ticket.md`; repo read-only.

## MUST NOT

- Do **not** advance state beyond `ready-for-research` (the `ready-for-research →
  research-complete` transition is owned by `/spec`).
- Do **not** modify source code or any `protected_paths` runtime file.
- Do **not** run validation/test commands — only discover and list them.
- Do **not** create any other artifact or a branch.
- Do **not** perform a partial write: if Step 1 fails, nothing is written (RS-8).

## Report

State that `_specs/<slug>/research.md` was created (read-only discovery), that
`ticket.md` advanced `draft → ready-for-research` (history appended), and the
next step: run `/spec`.

## Next step (NS-1..NS-4)

Emit the next-step block (`command-architecture.md §6`):

- **Current state:** `ready-for-research`
- **Next command:** `/spec <slug>`
- **Required actions:** none
- **Optional actions:** re-run `/research <slug>` to refresh `research.md`
  (idempotent — no re-transition).
- **Terminal?** no
