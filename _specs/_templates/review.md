---
ticket: <ticket-id>
stage: review
mode: standard          # single workflow form — no other modes (ADR-011)
status: not_started     # not_started | in_progress | blocked | complete
owner: reviewer
updated: <YYYY-MM-DD>
links:
  clickup:
  github:
---

# Review — <ticket>

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

<what was reviewed: spec, plan, and any context>

## Plan Summary

<the proposed approach, in the reviewer's words>

## Risks

- <risks identified during review>

## Assumptions

- <assumptions the plan relies on>

## Open Questions

- <questions the reviewer needs answered>

## Panel Findings (advisory)

> Findings from the advisory review panel (senior / security / performance) run
> at Step 1a — read-only lenses over `plan.md` + `spec.md` (ADR-012 / RP-1).
> **Advisory only:** these inform the owner; they never block the decision (RP-2).
> Record each finding and the owner's disposition. If the panel is disabled or
> returned nothing material, write "none".

| Lens | Severity | Finding | Ref (AC-n / step / file) | Owner's disposition |
|------|----------|---------|--------------------------|---------------------|
|      |          |         |                          |                     |

## Decision

`APPROVED` | `CHANGES_REQUESTED` | `REJECTED`

- Rationale:

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner):

## ADR reference

> Optional — record an ADR only if the decision is notable; otherwise "none".

- ADR: <e.g. ADR-0001, or none>

## Required Follow-up Actions

- <actions needed before implementation may begin, or "none">
