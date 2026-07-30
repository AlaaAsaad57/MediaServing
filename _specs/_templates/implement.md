---
ticket: <ticket-id>
stage: implement
mode: standard          # single workflow form — no other modes (ADR-011)
status: not_started     # not_started | in_progress | blocked | complete
owner: developer
updated: <YYYY-MM-DD>
links:
  clickup:
  github:
---

# Implement — <ticket>

> Record of what was actually built, following `plan.md`.

## Changes made

- `path/file` — what changed

## Changes prepared (uncommitted)

> `/implement` creates **no commit** (IM-9 / ADR-008); there are no SHAs to
> record here. List the changed files — the single publishable commit is created
> later by `/publish-pr` (the git delivery boundary).

- `path/file` — what changed

## Deviations from plan

- what differed from `plan.md` and why (or "none")

## Validation run during implementation

- `command` — result
