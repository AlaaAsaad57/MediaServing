# `_specs/` — Ticket Workflow Workspace

This directory is the workspace root for the ticket-driven development workflow.
Each ticket gets its own folder under `_specs/<ticket>/` and moves through the
canonical sequence of **stages**. Every stage produces a markdown artifact from
the templates in [`_templates/`](./_templates).

The canonical stage list, roles, and features are defined in
[`.claude/project-config.yaml`](../.claude/project-config.yaml). Stage gates and
criteria are in [`.claude/rules/workflow-rules.md`](../.claude/rules/workflow-rules.md).
This README must stay consistent with those sources of truth.

## Stages

| # | Stage       | Artifact                       | Owner     | Purpose                                                          |
|---|-------------|--------------------------------|-----------|------------------------------------------------------------------|
| 1 | `intake`    | `intake.md`                    | developer | Capture and qualify the request. No technical planning.          |
| 2 | `research`  | `research.md`                  | ai_agent  | Map the repo, find relevant files, surface risks. **No code.**   |
| 3 | `spec`      | `spec.md`                      | developer | Define what "done" means. No implementation details.            |
| 4 | `plan`      | `plan.md`                      | developer | Decide the approach and concrete steps before touching code.     |
| 5 | `review`    | `review.md`                    | em        | EM gate: approve spec + plan before implementation.              |
| 6 | `implement` | `implement.md`                 | developer | Apply the change per the approved plan; record what changed.     |
| 7 | `verify`    | `verify.md`                    | developer | Validate the change and review runtime impact; EM signs off.     |

## Per-ticket layout

```
_specs/
  <ticket>/
    ticket.md        # from _templates/ticket.md — OWNS the ticket's workflow state
    intake.md        # from _templates/intake.md
    research.md      # from _templates/research.md
    spec.md          # from _templates/spec.md
    plan.md          # from _templates/plan.md
    review.md        # from _templates/review.md
    implement.md     # from _templates/implement.md
    verify.md        # from _templates/verify.md
```

`<ticket>` should be a stable, filesystem-safe slug (e.g. `OBS-123` or
`add-alert-routing`).

## Modes, state & decisions

- **Execution modes (v1)** — `standard` (all 7 stages) or `high_risk`
  (runtime/observability or irreversible work: all 7 stages, 2 approvals,
  mandatory ADR + rollback rehearsal). `fast` mode is **deferred (not in v1)**.
  The EM `review` gate is never skipped. Modes are defined canonically in
  [`.claude/project-config.yaml`](../.claude/project-config.yaml).
- **Traceability & state** — every artifact begins with YAML front-matter
  (`ticket`, `stage`, `mode`, `status`, `owner`, `updated`, `links`). Acceptance
  criteria get stable IDs in `spec.md` and are referenced in `verify.md`.
  Workflow **state** is owned solely by `ticket.md` (artifact `status` is local
  to each stage) — see [ADR-003](../.claude/docs/adr/ADR-003-ticket-state-ownership.md).
- **Decisions** — significant choices are recorded as ADRs under
  [`.claude/docs/adr/`](../.claude/docs/adr).

## Guardrails

- **`intake`, `research`, `spec`, `plan`, and `review` are non-mutating.** No
  source or config edits before an approved `implement` stage.
- **Observability runtime configs are never modified by workflow tooling.**
  Files under `observability/` (Prometheus, Alertmanager, Loki, Grafana,
  `docker-compose.yml`) are the system under study, not workflow scaffolding.
- Each stage only writes inside its own ticket folder under `_specs/<ticket>/`.
- Workflow commands are created only when a phase explicitly authorizes it; none
  exist yet.
