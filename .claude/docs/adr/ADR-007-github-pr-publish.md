# ADR 007: GitHub PR publish as a delivery-only surface

- **Status:** accepted
- **Date:** 2026-06-17
- **Ticket:** wf-004
- **Deciders:** reviewer (gate), developer, workflow_owner (authorized the new command)

## Context

Reviewed implementation branches currently live only locally — `/implement`
commits to `ticket/<slug>` and never pushes. Teams that review and merge through
GitHub cannot see or act on the work there. We want to publish a branch as a
GitHub Pull Request for delivery/code review **without** letting GitHub become an
owner of workflow state. The workflow's state ownership is fixed by ADR-003
(`ticket.md` is canonical), and CLAUDE.md forbids creating new workflow commands
unless explicitly authorized.

## Decision

Add a new, additive command **`/publish-pr`** (Workflow-Owner authorized for
wf-004), backed by an isolated helper `scripts/github_publish.py` that is the
**only** home of `git push`/`gh` logic (the ADR-005 pattern). The following are
fixed:

1. **GitHub is a delivery surface only** — never a workflow-state owner.
2. **`ticket.md` remains the canonical workflow-state owner** (ADR-003).
3. **A new command** (`/publish-pr`) is used rather than extending `/implement`
   or `/verify`, so the existing seven command contracts are untouched.
4. **Publishing is allowed only after a successful `/verify`** — precondition
   `state ∈ {verified, closed}`.
5. The command **pushes the ticket branch**, **creates a PR via `gh`**, and
   **writes the PR URL into `ticket.md > links.github`**.
6. **Opening, closing, approving, or merging a PR does not change workflow
   state.** `/publish-pr` writes only `links.github` — never `state`, never a
   state-history entry. It is orthogonal to the lifecycle state machine.
7. **GitHub status, reviews, comments, checks, and merges are not workflow
   state** and are never read back into the workflow (one-way: workflow → GitHub).
8. **PR title/body are generated from workflow artifacts** (ticket title; spec
   goal + AC table; verify outcome; ClickUp link).
9. **`gh` is assumed installed and authenticated via SSH**; the helper prechecks
   this and fails safely (no push/PR/ticket change) if not (AC-9).
10. **Explicitly excluded:** GitHub API tokens, MCP, CI/CD integration, comment
    sync, status sync, auto-merge, and branch deletion.

To give the PR URL a canonical home, an **optional `links` block** is added to
the `ticket.md` template; required front-matter keys (FM-1) are unchanged.

## Consequences

- **Positive:** delivery/code review on GitHub with full ticket→PR traceability
  via `links.github`; integration isolated to one helper; the workflow stays
  fully usable without GitHub; entirely additive and reversible; the review gate
  and state machine are unaffected.
- **Negative / cost:** an external `gh`/network/SSH dependency at publish time
  (handled atomically — failure changes nothing); a real PR/branch is created on
  `origin`, and cleanup (close PR / delete branch) is manual by design.

## Alternatives considered

- **Extend `/implement` or `/verify` to push + open a PR** — rejected: couples a
  delivery action to existing gated commands and would change their contracts
  (violates AC-8).
- **Embed `git`/`gh` logic directly in the command** — rejected: turns the
  command into a shell wrapper, hard to test/maintain (same reasoning as ADR-005).
- **Use the GitHub API with a token / an MCP server / CI-CD** — rejected as more
  infrastructure than needed; `gh`'s existing SSH auth suffices (decision 10).
- **Add a `published` lifecycle state** — rejected: publishing must be orthogonal
  to state so GitHub never drives the workflow (decisions 6, 7).

## Out of scope

Reading/syncing GitHub state into the workflow, merging/auto-merge, reviewer/
label/milestone management, branch deletion, and any `observability/**` change.
