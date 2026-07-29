---
ticket: <ticket-id>
stage: research
mode: standard          # single workflow form — no other modes (ADR-011)
status: not_started     # not_started | in_progress | blocked | complete
owner: ai_agent
updated: <YYYY-MM-DD>
links:
  clickup:
  github:
---

# Research — <ticket>

> Read-only phase. **No implementation is allowed in this command.**

## Goal

<one-line statement of what this ticket needs to achieve>

## Relevant directories

- `path/` — why it matters

## Relevant config files

- `path/file.yml` — what it controls

## Possibly affected services

- service — how it could be impacted

## Test / validation commands available

- `command` — what it checks

## Risks and unknowns

- risk — impact / likelihood

## Open questions

> Give each question a stable ID (`OQ-1`, `OQ-2`, …). `spec.md` must record an
> answer for every one of them (SP-9) — an answer given only in chat does not
> count. A question about touching `protected_paths` is answered by putting the
> path in scope (then `plan.md > Files to change`) or by putting it Out of Scope.

| ID   | Question | Why it matters |
|------|----------|----------------|
| OQ-1 |          |                |

## Notes

- No code was changed during research.
- No `protected_paths` files were modified.
