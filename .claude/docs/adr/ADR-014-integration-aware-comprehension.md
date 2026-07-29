# ADR 014: Integration-aware, panel-seeded comprehension questions

- **Status:** accepted
- **Date:** 2026-07-26
- **Ticket:** — (Workflow Owner governance directive; applied directly to the governance corpus)
- **Deciders:** Workflow Owner
- **Amends:** ADR-012 (alternative #3 — "fold the lenses into the comprehension
  questions" — is now partially adopted, scoped to `major` findings). Does **not**
  supersede ADR-011 or ADR-012.

## Context

Two controls exist at `/review`, and they cover different things:

- The **comprehension gate** (CG-1..CG-4) is the only control that **blocks**
  (pass threshold 1.0). Its question topics were defined artifact-locally —
  "acceptance criteria / files / rollback / risks" (CG-2, `review.md` Step 1b,
  `verify.md` Step 2b). Every one of those asks *did you read your own plan?*
- The **advisory panel** (ADR-012), specifically `senior-reviewer`, is the only
  thing that asks *what else might this break?* — system integration, breaking a
  working flow, hidden coupling and shared state, blast radius, ordering
  hazards, cross-component rollback. And it is `advisory: true` — it never
  blocks, and a `major` finding can be dismissed with a one-line disposition.

So the highest-risk axis — how a change interacts with components and flows it
does not own, and where two use cases overlap in the same code — was carried
**only** by the non-blocking control, and was absent from the blocking one.

There was also a structural blocker: CG-2 requires questions to be *derived from
the artifact under review*, and `plan.md` had no section describing the change's
integration surface. A question about cross-component impact had no legal source
in the artifact.

## Decision

Make the integration axis a first-class, **blocking** part of the comprehension
gate, and let the panel seed questions when it finds something material.

1. **`plan.md` gains a required `## Integration surface` section** (new rule
   **PL-11**): the components / flows / shared config this change touches, who
   else depends on them, where this ticket's flow overlaps another use case, and
   what breaks if the assumption is wrong. This is the legal CG-2 source for
   integration questions. Required for APPROVED (RV-3).
2. **The question count is a floor, not a fixed number.**
   `comprehension_gates.questions` becomes **`questions_min: 3`** — at least
   three, more when the artifact warrants it. The count follows the risk of the
   change instead of being pinned.
3. **At least one question per gate is on the integration / cross-flow axis**
   (new rule **CG-5**), sourced at `/review` from `plan.md > Integration surface`
   (+ the panel) and at `/verify` from `implement.md`/`spec.md` (+ the plan's
   Integration surface): what the change touches outside itself, which other flow
   shares that code or config, and what would break.
4. **Every `major` panel finding seeds one additional question** (new rule
   **CG-6**), above the `questions_min` floor. A gate with two `major` findings
   therefore asks ≥5 questions. `minor`/`info` findings seed nothing.
5. **The panel still never decides (RP-2 stands).** A `major` finding does not
   force CHANGES_REQUESTED and the owner may still dismiss it — they must simply
   demonstrate they *understood* it first. What blocks is failing the question,
   never the finding. This is why the coupling does not reintroduce separation of
   duties (ADR-011): no lens holds a veto; the quiz remains the only gate.
6. **Unchanged:** `pass_threshold: 1.0`, `options_min: 4`, alphabetical option
   ordering, atomicity on failure, the `/verify` gate having no panel (ADR-012
   deferred it — its integration question is sourced from the artifacts).

## Consequences

- **+** The blocking control now covers the axis that was only advisory: a change
  cannot be approved by an owner who has not demonstrated they understand its
  cross-component and cross-flow impact.
- **+** Question count scales with the risk the panel actually found, instead of
  being a fixed 3 regardless of how hairy the change is.
- **+** `Integration surface` forces the coupling to be *written down* at `/plan`
  — which is where the senior lens and the owner can both argue with it.
- **−** Longer gates. A plan with several `major` findings gets a noticeably
  longer quiz — that friction is the point, but it is real cost on every review.
- **−** **The quiz measures understanding, not truth.** If the plan misses a
  coupling *and* the panel misses it, no question will surface it. The
  `Integration surface` section is self-declared; the senior lens (which reads
  the repo, not just the plan) remains the only thing that can contradict it.
- **−** Partially reverses ADR-012's alternative #3: quiz and panel are no longer
  fully independent concerns. Deliberately scoped to `major` findings to keep
  question generation simple and the coupling narrow.

## Alternatives considered

- **Promote the senior lens to blocking (a `major` finding vetoes APPROVED)** —
  rejected: that is automated separation of duties and reverses ADR-011. Making
  the owner *answer for* the finding achieves the awareness without the veto.
- **Seed a question from every finding regardless of severity** — rejected:
  `info`/`minor` noise would bury the questions that matter and make every gate
  expensive.
- **Raise the fixed count to 5** — rejected: a fixed number is the original
  defect. The floor plus severity-driven additions makes depth track risk.
- **Add the integration axis to CG-2's topic list only, without
  `Integration surface`** — rejected: CG-2 requires an artifact source; without
  the plan section the question would be generic, which CG-2 forbids.
