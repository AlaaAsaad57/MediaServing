# Ticket Standard — Engineering Workflow v1

Defines what a ticket must contain to enter and move through the workflow.

## Required metadata

Every ticket must declare:

- `id` / slug — stable, filesystem-safe (e.g. `OBS-123`, `add-alert-routing`).
- `title` — one line.
- `stage` — current workflow stage (`intake` … `verify`).
- `owner` — responsible developer.
- `created` — date (absolute).
- `links` — ClickUp task and/or GitHub issue/PR where applicable.

## Required sections

A ticket's artifacts (under `_specs/<ticket>/`) must cover, across their
stages:

- **Goal** — the outcome in one or two sentences.
- **Context / research** — relevant directories, config files, affected services.
- **Acceptance criteria** — see rules below.
- **Test cases** — see rules below.
- **Plan** — approach, steps, files to change, rollback.
- **Verification** — checks performed and results.
- **Risks & unknowns**.

## Acceptance criteria rules

- Written as a checklist of **observable, testable** statements.
- Each criterion is independently verifiable (pass/fail, no ambiguity).
- No criterion may require touching a `protected_paths` entry unless that change
  is explicitly part of the ticket and listed in the approved `plan.md`.
- "Done" is defined only by the acceptance criteria — not by effort spent.

## Test case rules

- At least one test case per acceptance criterion.
- Each test case states: precondition, action, expected result.
- Prefer commands that already exist in the repo for validation.
- A test case must be reproducible by someone other than the author.

## Readiness definition

A ticket is **ready to advance** from a stage only when:

- All required metadata is present.
- The current stage's exit criteria (in `workflow-rules.md`) are met.
- Acceptance criteria and test cases exist and are unambiguous (required before
  leaving `spec`).
- A reviewer has approved where the stage requires it (`review`, `verify`).
