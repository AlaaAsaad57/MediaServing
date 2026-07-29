---
ticket: <ticket-id>
stage: verify
mode: standard          # single workflow form — no other modes (ADR-011)
status: not_started     # not_started | in_progress | blocked | complete
owner: developer
updated: <YYYY-MM-DD>
links:
  clickup:
  github:
---

# Verify — <ticket>

> Final validation and impact review before the ticket is closed.

## Checks performed

> Reference acceptance-criteria IDs from `spec.md` (AC-1, AC-2, …).
> If `plan.md` named a validation profile, record each executed check resolved
> from `project-config.yaml` (profile → check → command), incl. exit code and a
> bounded output summary.

- Validation profile: <profile-id, or none>

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1  |                   |                    |      |                |        |

## Commands run

- `command`
  ```
  <output / result>
  ```

## Protected-path & runtime impact review

- Were any `protected_paths` files changed by this ticket? (yes/no)
- If yes: which files, and was the change intended and reviewed?

## Sign-off

- Outcome: <verified / blocked / needs-rework>
- Final ticket state: <verified | closed>   # reviewer transitions verified → closed
- Sign-off: <owner>   # single self sign-off by the ticket owner
- Commit: none created at verify (VF-10 / ADR-008 — committing is the delivery
  boundary's job, owned by `/publish-pr`)
- Notes:
