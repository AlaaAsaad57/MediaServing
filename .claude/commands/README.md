# `.claude/commands/`

The ticket-workflow slash commands. All of them exist and are in use.

| Command | Stage | What it does |
|---|---|---|
| [`/start-ticket`](start-ticket.md) | intake | Creates `_specs/<slug>/` with `ticket.md` at `state: draft`. Optionally seeds from ClickUp (read-only). Creates **no** branch. |
| [`/research`](research.md) | research | Read-only investigation; writes `research.md` with `OQ-n` open questions. |
| [`/spec`](spec.md) | spec | Writes `spec.md`: acceptance criteria `AC-n`, no implementation detail. |
| [`/plan`](plan.md) | plan | Writes `plan.md`: approach, steps, files to change, validation, rollback, integration surface. |
| [`/review`](review.md) | review (gate) | Advisory panel, then the comprehension check, then `APPROVED` / `CHANGES_REQUESTED` / `REJECTED`. |
| [`/implement`](implement.md) | implement | Cuts `ticket/<slug>` from clean `main` and applies the plan. Creates **no** commit. |
| [`/verify`](verify.md) | verify (gate) | Runs the acceptance criteria, comprehension check, then closes the ticket or blocks it. |
| [`/publish-pr`](publish-pr.md) | — (delivery) | The single git delivery boundary: one commit on `ticket/<slug>`, push, open the PR against `main`. Performs no state transition. |

Each command operates on a ticket workspace under `_specs/<ticket>/` and produces
its artifact from [`_specs/_templates/`](../../_specs/_templates).

**Authority:** [`../project-config.yaml`](../project-config.yaml) is canonical for
stages, the state machine, and the gates. [`../rules/validation-model.md`](../rules/validation-model.md)
holds the rule codes each command enforces; [`../docs/command-architecture.md`](../docs/command-architecture.md)
holds the pre/postcondition contracts. When any of them disagrees with this table,
they win — this file is a map, not a source of truth.
