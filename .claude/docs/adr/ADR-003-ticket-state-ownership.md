# ADR 003: Ticket state ownership

- **Status:** accepted
- **Date:** 2026-06-13
- **Ticket:** workflow-phase-5.95 (governance)
- **Deciders:** EM, developer, ai_agent

## Context

The workflow has a canonical state machine (`project-config.yaml > lifecycle`),
a validation model, and per-stage artifacts (`intake.md` … `verify.md`) that each
carry front-matter with a local `status`. Readiness review found that **no single
location owns the ticket's workflow state**. State could only be inferred by
scanning which artifacts exist and reading their individual `status` fields.

## Problem

Inferring ticket state from artifact existence/contents is ambiguous and fragile:

- Two artifacts could imply conflicting states (e.g. `review.md` says approved
  while `plan.md status` is still `in_progress`).
- Fast mode skips artifacts, so "artifact exists ⇒ stage done" is unsound.
- Every command would have to re-implement the same scan-and-reconcile logic —
  exactly the duplicated validation the validation model forbids.
- There is no atomic place to record a transition.

## Decision

**Each workflow ticket owns a single canonical ticket record at
`_specs/<ticket>/ticket.md`.** Its front-matter `state` field is the *only*
authoritative source of the ticket's workflow state.

- `/start-ticket` creates `ticket.md` with `state: draft`.
- Every other command **reads** `ticket.md` to learn the current state,
  validates the requested transition against the canonical state machine, then
  **updates** `ticket.md` (`state`, `updated_at`).
- Stage artifacts may carry a *local* `status` describing their own progress,
  but they **never** own workflow state.
- Commands **must never** derive ticket state from artifact existence or content.

## Consequences

- **Positive:** one read/one write per transition; no scan/reconcile; unambiguous
  state; mode-agnostic (works when stages are skipped); atomic transition point;
  the validation model's `ST` rules now have a single, well-defined input.
- **Negative / cost:** a new required file per ticket; `ticket.md` and artifact
  `status` must be kept coherent (the validator checks this); a small duplication
  of `mode`/`owner` between `ticket.md` and artifact front-matter (ticket.md is
  canonical; artifacts mirror).

## Alternatives considered

- **Derive state from artifacts** — rejected: ambiguous, mode-fragile, forces
  duplicated logic into every command.
- **Store state in `project-config.yaml`** — rejected: that file is global config,
  not per-ticket; would not scale to many tickets.
- **Track state in an external system (ClickUp/GitHub) only** — rejected for the
  canonical source: not always available offline/headless; kept as a *mirror*
  via the `links` field instead.
