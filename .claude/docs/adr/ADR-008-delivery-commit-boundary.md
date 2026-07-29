# ADR 008: Publishing is the single git delivery boundary; standardized next-step guidance

- **Status:** accepted
- **Date:** 2026-06-17
- **Ticket:** wf-005
- **Deciders:** reviewer (gate), developer/ai_agent (author), workflow_owner (governance)
- **Extends:** ADR-007 (GitHub PR publish as a delivery-only surface). ADR-007 is
  **not superseded** — its delivery-only, no-state-ownership decisions stand;
  this ADR refines *where the git commit is created*.

## Context

Under ADR-007, `/implement` committed the work to `ticket/<slug>` and
`/publish-pr` pushed that branch and opened a PR. Commit creation was therefore
spread across the lifecycle (implement committed; publish pushed), which made the
delivery lifecycle harder to reason about and easier to get wrong. Separately,
the seven stage commands + `/publish-pr` each reported "what's next" in ad-hoc
prose, so operators — especially newcomers — could not rely on a consistent,
complete statement of the next legal action, required manual steps, or terminal
conditions.

wf-005 asks to (a) make publishing the single git delivery boundary and (b) make
the next expected action explicit after every command — **without** changing the
canonical state machine, approval gates, or `ticket.md` state ownership.

## Decision

1. **`/publish-pr` is the single git delivery boundary.** It is the *only*
   command that creates a git commit. It stages and creates **one publishable
   commit** on `ticket/<slug>` (when the working tree has uncommitted changes),
   then pushes and opens/reuses the PR.
2. **`/implement` creates no commit.** It applies the planned changes to the
   working tree on the branch and records `implement.md`; the changes remain
   uncommitted until publishing (IM-9). No SHAs are recorded at implement.
3. **`/verify` creates no commit.** Validation stays read-only; the absence of a
   commit is expected and is not treated as missing evidence (VF-10, VF-3).
4. **The publishable commit/PR includes the full set** (PB-9 / AC-8):
   implementation changes + `implement.md` + `verify.md` + the `ticket.md`
   closure update. On a ticket branch the working-tree changes are exactly the
   ticket's own work, so staging is naturally confined (GU-3).
5. **All git staging/commit/push logic stays isolated** in
   `scripts/github_publish.py` (the ADR-005 pattern, already fixed by ADR-007).
   The command embeds none; it generates the title/body/commit-message from
   artifacts.
6. **Standardized next-step guidance.** Every command (all seven stages **and**
   `/publish-pr`) emits, on completion, a next-step block with five fields:
   current workflow state; next legal command; required manual actions; optional
   actions; terminal-state condition when applicable. Blocked outcomes state the
   unblock condition; terminal outcomes state that no further workflow action is
   required. The contract lives in `command-architecture.md §6`; validation is
   NS-1..NS-4.
7. **Governance is unchanged in meaning** (AC-9..AC-11): the lifecycle states,
   allowed transitions, approval counts, and `ticket.md` state ownership are
   untouched. `/publish-pr` remains orthogonal to the state machine and performs
   no transition (ADR-007 decisions 6/7 stand). Next-step guidance is
   presentation-only and never changes state.

## Consequences

- **Positive:** one obvious place where git history is written; `/implement` and
  `/verify` become pure working-tree/validation steps; PRs always contain the
  complete, verified, closed unit of work; operators get consistent, complete
  next-step guidance. Fully framework- and environment-agnostic (AC-12) — no
  CI/CD, MCP, or GitHub-state readback introduced.
- **Negative / cost:** between `/implement` and `/publish-pr` the work lives
  uncommitted on the branch, so an operator who abandons a ticket without
  publishing leaves no commit (acceptable — nothing was delivered). The helper
  now performs `git add -A` + commit; on a ticket branch this is confined to the
  ticket's work, but the isolation depends on the branch holding only that work.

## Alternatives considered

- **Keep `/implement` commits, defer only the push to publish** — rejected: the
  AC requires commit creation to *no longer happen* at implement/verify, and a
  single preparation point is simpler than "commit here, push there".
- **A shared snippet file imported by each command** — rejected: commands are
  standalone markdown; a documented contract (§6) that each command fills is
  simpler and avoids a new include mechanism.
- **Reclassify wf-005 as `high_risk`** — not required: no `observability/**`
  runtime is touched and every change is reversible text/script; the reviewer may
  still escalate at the gate. This ADR is recorded even though `standard` does
  not mandate one, satisfying AC-11's "governance recorded, not silently changed".

## Out of scope

Unchanged from ADR-007: reading/syncing GitHub state into the workflow,
merge/auto-merge, reviewer/label/milestone management, branch deletion, and any
`observability/**` change. Also out of scope: changes to lifecycle states,
allowed transitions, approval counts, or `ticket.md` ownership.
