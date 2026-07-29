# ADR 015: Traceable open questions (`OQ-n`)

- **Status:** accepted
- **Date:** 2026-07-29
- **Ticket:** — (Workflow Owner governance directive; applied directly to the governance corpus)
- **Deciders:** Workflow Owner
- **Extends:** ADR-003 (artifacts own state and record; conversation does not).
  Supersedes nothing.

## Context

`/research` must document open questions (RS-5), and that was the whole rule.
Nothing gave a question an identity, and nothing made a later stage answer it:

- The questions had no IDs, so no other artifact could point at one.
- `spec.md` and `plan.md` had no place that says "this question got answered".
  In practice `/plan` sometimes resolved the *spec's* open questions, but that
  was a habit, not a rule.
- So the answer usually happened in **chat** — the owner reads the question and
  says "yes, that is fine". The next command starts with a fresh read of the
  files, finds the same question still open, and raises it again. To the owner it
  looks like the workflow contradicts itself.

The costly case is a question about `protected_paths`. Saying "yes, go ahead" in
chat feels like permission, but the workflow grants that permission in exactly
one way: the path is listed in `plan.md > Files to change`, `/review` records
APPROVED, and `/implement` makes the edit (GU-2, IM-5, CLAUDE.md hard stop). A
chat answer and the artifacts then disagree, and the ticket stalls at the gate —
correctly, but for a reason nobody can see in the files.

## Decision

Give every open question an ID and make each later stage answer it in writing.

1. **`research.md` numbers its open questions `OQ-1`, `OQ-2`, …** (RS-5 updated).
   The IDs work like `AC-n`: a stable handle other artifacts can reference.
2. **`spec.md` gains a required `## Research Questions Resolved` section**
   (new rule **SP-9**). Every `OQ-n` gets a row — *answered* (the answer plus
   where it lands: a requirement, an `AC-n`, a constraint, or Out of Scope) or
   *deferred* (repeated under `Open Questions` with the same ID because the
   answer needs the approach). An `OQ-n` that appears nowhere is an ERROR.
3. **`plan.md` answers every deferred `OQ-n`** (new rule **PL-12**), naming the
   ID in the section that carries the answer.
4. **`/review` checks it before APPROVED** (RV-3 extended): no `OQ-n` may still be
   open at the gate.
5. **A chat answer is not a resolution.** Only the artifact counts (ADR-003).
6. **Not implementation detail.** Recording an answer in `spec.md` does not breach
   SP-4: the spec states the scope decision, never the file paths or the approach.
7. **Legacy:** tickets closed before this ADR keep their un-numbered lists. They
   are not rewritten.

## Consequences

- **+** A question raised at research cannot be lost. It is answered in a file, or
  the command aborts.
- **+** The `protected_paths` case now has one visible path: the question is
  answered as scope in `spec.md`, the paths are named in `plan.md > Files to
  change`, and APPROVED is what grants the edit. No verbal permission, no
  contradiction at the gate.
- **+** `/review` gets a cheap, mechanical check (open IDs) instead of relying on
  the owner noticing.
- **−** `/spec` and `/plan` now abort on something that used to pass. A ticket
  whose research asked five vague questions has to deal with all five.
- **−** Slight pressure to ask fewer questions at `/research` to keep later stages
  short. That would be the wrong fix, and no rule can prevent it.
- **−** Another required section in two templates. The corpus keeps growing.

## Alternatives considered

- **Let `research.md` hold the answers itself (an "Answer" column)** — rejected:
  research is the read-only discovery stage and gets re-run; scope decisions
  belong to `spec.md`, approach decisions to `plan.md`.
- **Make the answer a comprehension question at `/review`** — rejected: the quiz
  tests understanding, not record-keeping, and a question answered at the gate is
  still not written into the artifact that `/implement` reads.
- **Require `/spec` to answer everything, with no deferral** — rejected: some
  questions genuinely cannot be answered before the approach is chosen. Forcing
  an answer at `/spec` would push implementation detail into the spec (SP-4).
- **Leave it to the owner's discipline** — rejected: that is the current state,
  and it is what produced the confusion this ADR fixes.
