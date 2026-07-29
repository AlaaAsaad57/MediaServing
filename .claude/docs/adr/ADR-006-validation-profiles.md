# ADR 006: Framework-agnostic, config-driven validation profiles

- **Status:** accepted
- **Date:** 2026-06-15
- **Ticket:** wf-pilot-003
- **Deciders:** reviewer (gate), developer

## Context

Verification depth is configured per mode (`MO-6`: `all-ac` / `all-ac+rollback`),
but the actual validation *commands* were bespoke prose re-authored in each
ticket's `plan.md`/`spec.md`. There was no reusable definition of "what
validation runs" for a class of change, and no way to require execution without
either re-typing commands per ticket or hardcoding framework-specific commands
into `/verify` (which would couple the workflow to a stack). We want real check
execution at `/verify` while keeping the workflow framework- and
execution-agnostic, with no automation, CI/CD, or external runner.

## Decision

Add two **separate, additive** configuration concepts to `project-config.yaml`:

- `validation_checks` — **definitions**: a check-id mapped to a `command` and a
  `pass_when` condition (optional `output_contains`). **Commands live only here.**
- `validation_profiles` — **selection**: a profile-id mapped to the check-ids it
  requires, each with a `depth` tag reusing the existing verification tiers
  (`smoke` / `all-ac` / `rollback`). **Profiles reference check-ids only.**

A ticket optionally names **one** profile in `plan.md`'s Validation strategy.
`/verify` resolves **profile → checks → commands**, executes each required
command (whose `depth` ≤ the mode tier) **locally**, and records the command,
exit code, output summary, and result mapped to `AC-n`. The workflow logic
contains no framework-specific command; supporting a new stack is a
configuration-only edit. Governed by rules **VP-1..VP-5**. Execution is local and
config-driven — **no GitHub, CI/CD, MCP, or external runner.** `ticket.md` remains
the sole canonical owner of workflow state (ADR-003): profiles, checks, and
results are configuration/records, never state. The mechanism is opt-in — with no
profile referenced, `/plan` and `/verify` behave exactly as before.

## Consequences

- **Positive:** reusable, consistent "definition of validated"; real execution
  without framework coupling; commands are versioned, review-gated config;
  additive and fully reversible; existing/closed tickets unaffected.
- **Negative / cost:** `/verify` executes config-defined commands, so commands
  must be trusted (mitigated: they come only from review-gated config), read-only
  (VP-2), and deterministic/non-interactive (VP-3); a required command absent in
  the local environment is recorded as an explicit failure (no CI fallback by
  design).

## Alternatives considered

- **Evidence-only / manual attestation** — rejected: the team requires actual
  check execution, not just recorded evidence.
- **Hardcode commands in `/verify`** — rejected: couples the workflow to specific
  frameworks/tools.
- **Embed commands inside profiles** — rejected: conflates selection with
  definition; profiles must reference check-ids only (VP-4).
- **External runner / CI (GitHub Actions, Jenkins, GitLab) or MCP** — rejected for
  V1: adds infrastructure and an external dependency; execution stays local.
