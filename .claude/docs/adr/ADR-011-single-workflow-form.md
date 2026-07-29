# ADR 011: Single-owner workflow with a comprehension gate (remove modes, risk tiers, and separation of duties)

- **Status:** accepted — question count amended by
  [ADR-014](./ADR-014-integration-aware-comprehension.md) (the "2–3 questions"
  below is now a **floor of 3**, with a mandatory integration question)
- **Date:** 2026-07-16
- **Ticket:** — (Workflow Owner governance directive; applied directly to the governance corpus)
- **Deciders:** Workflow Owner

## Context

Engineering Workflow v1 carried two execution modes (`standard`/`high_risk`, with
`fast` deferred), a `standard`-only self-review exception, and separation of duties
that required a distinct reviewer at each gate. This layered several overlapping
conditions (mode selection, risk level, who may review) that added complexity
without a matching gain in safety, and it assumed a second person is available to
review every ticket.

The Workflow Owner directed a simpler model: **one person owns a ticket end to
end** — including its `/review` and `/verify` gates — and the guard against
rubber-stamping is not a second reviewer but a **comprehension check** the owner
must pass at each gate. Risk classification and its tiered safeguards are removed.

## Decision

There are **no execution modes and no risk tiers.** Every ticket runs one uniform
workflow form: all seven stages and both gates. The `mode` front-matter field is
retained only as a legacy single value (`mode: standard`).

- **Single owner.** One person authors the ticket and runs its `/review` and
  `/verify` gates themselves. **Self-review is expected**; there is no separate
  reviewer and **no separation of duties** (`separation_of_duties.enabled: false`).
- **Comprehension gate is the control.** At each gate the owner must answer 2–3
  questions generated **from the artifact under review** (`plan.md`/`spec.md` at
  `/review`; `implement.md`/`spec.md` at `/verify`), recorded in
  `comprehension.md`. A gate may not record its decision until this stage's
  questions are answered (CG-1..CG-4).
- **Uniform safeguards.** 1 self-approval, ADRs optional, verification `all-ac`
  (every acceptance criterion mapped to a result) for every ticket. No risk
  classification, no second approver, no rollback-rehearsal tier.
- **`protected_paths` changes** are treated like any other change: the only
  guards are the comprehension gate and the standing CLAUDE.md hard-stop (touched
  only inside an approved implement stage, per the approved plan).

## Consequences

- **+** One simple workflow; no mode/risk/reviewer conditionals to learn or police.
- **+** Works with a single person per ticket — no dependency on a second reviewer.
- **+** Gate integrity is explicit and recorded (`comprehension.md`), not implicit.
- **−** The safeguard is only as strong as the questions and the owner's honesty;
  there is no independent human check. Optional AI grading of answers
  (`comprehension_gates.ai_graded`) can be enabled later to harden it.
- **−** `protected_paths` and irreversible changes lose their former extra
  safeguards; they rely on the comprehension gate + the CLAUDE.md hard-stop.
- Applied across the governance corpus: `project-config.yaml`, `CLAUDE.md`,
  `workflow-rules.md`, `validation-model.md` (new CG-1..CG-4; MO/RV/RA/VF
  simplified), all command files (comprehension step added to `/review` and
  `/verify`), templates (new `comprehension.md`), and `command-architecture.md`.

## Alternatives considered

- **Keep separation of duties (distinct reviewer)** — rejected: the team wants
  single-person ownership and cannot guarantee a second reviewer per ticket.
- **Keep risk tiers (normal/elevated)** — rejected: added conditional complexity;
  the comprehension gate applies uniformly instead.
- **No gate control at all (pure self-approval)** — rejected: that is exactly the
  rubber-stamp risk; the comprehension check exists to counter it.
