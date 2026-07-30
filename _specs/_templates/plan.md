---
ticket: <ticket-id>
stage: plan
mode: standard          # single workflow form — no other modes (ADR-011)
status: not_started     # not_started | in_progress | blocked | complete
owner: developer
updated: <YYYY-MM-DD>
links:
  clickup:
  github:
---

# Plan — <ticket>

> Decide the approach before changing code. Plan only — no implementation here.

## Approach

<chosen approach in 2-3 sentences, and why over alternatives>

## Steps

1. step
2. step

## Files to change

- `path/file` — what changes and why

## Integration surface

> Required (PL-11, ADR-014). What this change touches **beyond its own files** —
> the source of the mandatory integration question at `/review` (CG-5).
> `none — self-contained` is valid only with the reason stated.

- **Components / shared config touched:** <service, config file, metric, alert, dashboard, env var, port, path, interface>
- **Who else depends on them:** <other ticket, flow, component that reads or relies on the above>
- **Overlapping flows:** <where this ticket's flow shares code/state with another use case>
- **Ordering / lockstep dependencies:** <what must change together, and in what order>
- **What breaks if this is wrong:** <the concrete failure, and how it would show up>

## Validation strategy

- Validation profile: <profile-id, or none>   # optional; must exist in
  project-config.yaml > validation_profiles. Commands live in validation_checks,
  never here (VP-4). Omit/none = current free-form behavior (VP-5).
- how the change will be proven correct (commands, checks)

## Rollback

- how to revert if it goes wrong

## Out of scope

- explicitly not doing X
