# ADR 012: Advisory AI review panel at the /review gate

- **Status:** accepted — alternative #3 amended by
  [ADR-014](./ADR-014-integration-aware-comprehension.md) (a `major` finding now
  seeds a comprehension question; the panel still never blocks or decides)
- **Date:** 2026-07-17
- **Ticket:** — (Workflow Owner governance directive; applied directly to the governance corpus)
- **Deciders:** Workflow Owner

## Context

ADR-011 made every ticket single-owner: the owner authors the work and runs their
own `/review` and `/verify` gates, with the **comprehension gate** (CG-1..CG-4)
as the control against rubber-stamping. That removes the *human* second reviewer,
but a single owner still has blind spots — a security angle, a performance cost,
or a design smell they simply don't see in their own plan.

We want extra perspectives at `/review` **without** bringing back separation of
duties or a second human. AI reviewer lenses can provide those perspectives
cheaply and read-only.

## Decision

Add an **advisory** AI review panel to the `/review` gate. It **assists** the
owner; it does not decide.

- **Lenses (from the start):** `senior`, `security`, `performance` — one
  read-only subagent each, defined under `.claude/agents/` and run **in parallel**
  over `plan.md` + `spec.md`. Roster is config-driven (`review_panel.lenses`).
- **Placement:** a new **Step 1a** in `/review`, after Step 1 validation and
  **before** the comprehension check (Step 1b). Findings are surfaced to the owner
  so they inform both the comprehension answers and the decision (RP-4).
- **Advisory, never blocking (`review_panel.advisory: true`):** a finding — even
  `major` — is recorded for the owner to weigh; it never forces
  CHANGES_REQUESTED and never gates APPROVED. APPROVED remains gated only by the
  comprehension check (CG-*) and plan validation (RV-3). This is why the panel
  does **not** reintroduce separation of duties: no lens holds a veto.
- **Recorded:** findings + the owner's disposition per finding go in the
  **Panel Findings** section of `review.md`. Enforced by RP-1..RP-4.
- **Opt-in:** gated by `review_panel.enabled`; when off, `/review` behaves exactly
  as before.

## Consequences

- **+** Multiple expert perspectives per review with no second human and no
  scheduling dependency; catches blind spots the owner's own comprehension check
  cannot.
- **+** Consistent with the corpus patterns: config roster (like
  `validation_profiles`), subagent personas (`.claude/agents/`), rule codes
  (RP-*), an artifact section, and this ADR.
- **+** Read-only and advisory — zero risk to workflow state or the working tree
  outside `review.md`.
- **−** Advisory means a real finding can still be dismissed by the owner; the
  panel raises awareness, it does not guarantee action. Promoting a lens to
  **blocking** (e.g. a critical security finding) would reintroduce an automated
  gate and require a follow-up ADR that amends this one.
- **−** Adds subagent runs (cost/latency) to every `/review`; acceptable for the
  perspective gained, and disableable via `review_panel.enabled`.

## Alternatives considered

- **Blocking panel (a lens can veto APPROVED)** — rejected for v1: that is
  automated separation of duties and partially reverses ADR-011; revisit via a
  follow-up ADR if advisory proves too weak.
- **Run the panel at `/verify` on the real diff instead of `/review` on the plan**
  — deferred: reviewing the plan catches issues before code is written (cheaper to
  fix); a `/verify` diff panel is a natural future extension, not the first step.
- **Fold the lenses into the comprehension questions instead of a separate panel**
  — rejected: couples two concerns and complicates question generation; keep the
  quiz independent (owner's understanding) from the panel (external perspectives).
- **A single generalist reviewer subagent** — rejected: distinct lenses give
  sharper, non-overlapping findings than one prompt trying to cover everything.
