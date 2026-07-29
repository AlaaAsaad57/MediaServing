---
ticket: <ticket-id>
stage: spec
mode: standard          # single workflow form — no other modes (ADR-011)
status: not_started     # not_started | in_progress | blocked | complete
owner: developer
updated: <YYYY-MM-DD>
links:
  clickup:
  github:
---

# Spec — <ticket>

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**

## Feature Name

<name>

## Business Goal

<why this matters — the value delivered>

## User Story

> As a <role>, I want <capability>, so that <outcome>.

## Functional Requirements

- <observable behavior the solution must provide>

## Non-Functional Requirements

- <performance, reliability, usability, etc.>

## Constraints

- <boundaries the solution must respect>

## Edge Cases

- <unusual or boundary conditions to handle>

## Research Questions Resolved

> Required (SP-9). One row per `OQ-n` in `research.md` — none may be skipped.
> **Answered:** write the answer and where it lands (a requirement, an `AC-n`, a
> constraint, or Out of Scope). **Deferred:** the answer needs the approach, so
> `/plan` answers it (PL-12) — repeat it under Open Questions with the same ID.

| OQ   | Answer | Lands in |
|------|--------|----------|
| OQ-1 |        |          |

## Open Questions

- <OQ-n deferred to /plan, or a new question still open — with its ID>

## Acceptance Criteria Mapping

> Give each criterion a stable ID (AC-1, AC-2, …); `verify.md` references these.

| ID   | Acceptance criterion | Maps to requirement |
|------|----------------------|---------------------|
| AC-1 |                      |                     |

## Out of Scope

- <explicitly not included>
