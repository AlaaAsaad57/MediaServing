# /publish-pr

Publish a ticket's reviewed implementation branch to GitHub as a Pull Request.
For ticket `<slug>`, as the **single git delivery boundary** (PB-8 / ADR-008):
stage and commit the publishable set (implementation changes + `implement.md` +
`verify.md` + the `ticket.md` closure update), push the `ticket/<slug>` branch,
open a PR via the GitHub CLI with a title/body generated from workflow artifacts,
and record the PR URL in `ticket.md > links.github`.

> **GitHub is a delivery surface only (ADR-007).** This command performs **no**
> workflow-state transition: it writes only `links.github` and never touches
> `state` or the state-history. Opening, approving, closing, or merging a PR does
> not change workflow state, and no GitHub status/review/check/merge state is ever
> read back into the workflow. `ticket.md` remains the canonical state owner
> (ADR-003).

Authoritative references (do not duplicate or reinvent their rules):
- Command contract: `.claude/docs/command-architecture.md` (`/publish-pr`)
- Decision record: `.claude/docs/adr/ADR-007-github-pr-publish.md`
- **Validation: `.claude/rules/validation-model.md` — apply the `PB` rule codes;
  do NOT write any custom validation logic.**

## Inputs

- `slug` (required) — workspace `_specs/<slug>/`. If missing, ask once.

## ClickUp/GitHub isolation

All `git` (staging, commit, push) and `gh` logic lives **only** in
`scripts/github_publish.py` (the ADR-005 pattern). This command embeds no
`git`/`gh` invocation logic; it generates the title/body/commit-message from
artifacts, invokes the helper, and records the returned URL.

## Preconditions — validate BEFORE acting (abort on any ERROR, write nothing — PB-5)

Read `_specs/<slug>/ticket.md`, `spec.md`, and `verify.md`; then apply:
- **TS-1 / TS-2 / TS-3** — `ticket.md` exists, valid; read current `state`.
- **PB-1** — `state ∈ {verified, closed}`. Publishing is allowed only after a
  successful `/verify`. Any earlier state → abort.
- **PB-2** — the `ticket/<slug>` branch exists locally (the implementation
  branch). If missing → abort (nothing to publish).
- **PB-6 (AC-9)** — the helper prechecks `gh` availability/auth; if `gh` is
  missing or unauthenticated the helper fails safely (GH-1/GH-2) and this command
  makes no push, no PR, and no change to `ticket.md`.

If any ERROR fires, stop and report the rule code + message. Make no changes.

## Actions (only on all-clear)

1. **Generate the PR title (AC-3)** from artifacts — e.g. `ticket.md > title`.
2. **Generate the PR body (AC-4)** from artifacts — e.g. the ticket reference and
   `links.clickup`, the `spec.md` business goal + acceptance-criteria table, and
   the `verify.md` outcome. Write it to a temporary body file.
3. **Generate the commit message** from artifacts — e.g. `<slug>: <ticket title>`.
4. **Invoke the helper** (the only `git`/`gh` home):
   ```
   python scripts/github_publish.py --branch ticket/<slug> \
       --title "<generated title>" --body-file <body-file> --base develop \
       --commit-message "<generated commit message>"
   ```
   As the single git delivery boundary, the helper **stages the working-tree
   changes on the branch and creates one publishable commit** when there is
   anything to commit (PB-8/PB-9 — on a ticket branch those changes are exactly
   the implementation + `_specs/<slug>/` artifacts + closure), **pushes** the
   branch (AC-1), **opens** the PR (AC-2) — or returns the existing PR URL if one
   is already open (idempotent) — and prints `{"pr_url": "..."}`.
5. **Record the PR URL (AC-5):** write the returned `pr_url` into
   `ticket.md > links.github`. **Do not** change `state`, and **do not** append a
   state-history entry (PB-3/PB-4). This is a metadata-only write to the workflow
   state record (the commit captured the prior closure write; this step does not
   transition state).

## Postconditions — validate AFTER

- **PB-1** acted only from `verified`/`closed`.
- **PB-3** `ticket.md > state` is unchanged by this command (AC-6).
- **PB-4** no state-history entry was appended; no GitHub state was read into the
  workflow (AC-7).
- **PB-8** the single publishable commit was created here (the delivery boundary)
  before the push.
- **PB-9** the commit/PR includes the implementation changes + `implement.md` +
  `verify.md` + the `ticket.md` closure update.
- **AC-5** `ticket.md > links.github` holds the PR URL.
- **GU-3** the commit/push stage only the branch's own work (implemented source +
  `_specs/<slug>/`); the only workflow **state** field written is
  `ticket.md > links.github`; no source file is *modified* (only committed).

## MUST NOT

- Do **not** change workflow `state` or append a state-history entry (PB-3/PB-4).
- Do **not** read GitHub status/reviews/comments/checks/merge state into the
  workflow (AC-7 / ADR-007).
- Do **not** merge, auto-merge, manage reviewers/labels, or delete branches
  (out of scope; ADR-007).
- Do **not** embed `git`/`gh` logic here — it lives only in the helper.
- Do **not** modify any `protected_paths` runtime file or any of the existing
  seven command contracts (AC-8).
- Do **not** perform a partial write: if a precondition fails or the helper exits
  non-zero, `ticket.md` is left unchanged (PB-5 / AC-9).

## Report

State the publishable commit created, the branch pushed, the PR URL (created or
pre-existing), that `ticket.md > links.github` was updated, and that workflow
`state` was left unchanged. If publishing failed safely (gh missing/
unauthenticated), report the GH code and that nothing was changed.

## Next step (NS-1..NS-4)

Emit the next-step block (`command-architecture.md §6`). `/publish-pr` is
orthogonal to the state machine, so it never changes state:

- **Published (commit + push + PR):**
  - **Current state:** unchanged (`verified`/`closed` — delivery is orthogonal).
  - **Next command:** none — publishing is the final delivery action.
  - **Required actions:** none (GitHub-side review/merge is out of band and never
    read back into the workflow).
  - **Optional actions:** none
  - **Terminal?** the workflow itself was already terminal at `closed`; this
    delivery action requires no further workflow step.
- **Failed safely (gh missing/unauthenticated):**
  - **Current state:** unchanged; nothing was committed, pushed, or written.
  - **Next command:** `/publish-pr <slug>` again after fixing `gh`.
  - **Required actions:** install/authenticate `gh` (resolve GH-1/GH-2).
  - **Optional actions:** none
  - **Terminal?** no — re-run once `gh` is available.
