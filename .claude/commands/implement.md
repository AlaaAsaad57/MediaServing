---
description: After an APPROVED review, create the ticket branch and apply ONLY the changes declared in plan.md; record implement.md; advance ticket to implemented. Supports resume from implementation-in-progress. Blocks (status=blocked) on unsafe/unclear conditions; never touches unrelated files; never commits or pushes (publishing is the single git delivery boundary).
argument-hint: <slug>
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# /implement

For ticket `<slug>`: apply **only** the changes declared in `plan.md`, record
`implement.md`, and advance the ticket to `implemented`. This is the **first
command that mutates source code**.

`/implement` has two entry paths (chosen by current `ticket.md > state`):
- **Initial** — from `state: approved`: create the branch, then implement.
- **Resume** — from `state: implementation-in-progress`: do **not** create a new
  branch; continue the remaining planned work. This makes a ticket stuck at
  `implementation-in-progress` recoverable **without manual state edits**.

It must: implement only what `plan.md` lists, never silently modify unrelated
files, block (`status: blocked`) on unsafe/unclear conditions, and never push.

Authoritative references (apply, do not reinvent):
- Command contract: `.claude/docs/command-architecture.md` (`/implement`)
- **Validation: `.claude/rules/validation-model.md` — apply rule codes only; no
  custom validation logic.**
- Branch strategy: `command-architecture.md §3`. State ownership: ADR-003.

## Inputs

- `slug` (required) — workspace `_specs/<slug>/`. If missing, ask once.

## Step 1 — Validate & choose path (block on ERROR, make NO changes — IM-8)

Read `_specs/<slug>/ticket.md`, `plan.md`, `review.md`, and `implement.md` (if
present); then apply:
- **TS-1 / TS-2 / TS-3** — `ticket.md` exists, valid; read current `state`.
- **IM-1 (entry path)** — exactly one of:
  - *Initial:* `state == approved` AND `review.md` Decision = APPROVED.
  - *Resume:* `state == implementation-in-progress`.
  Any other state → block.
- **IM-2** — `plan.md` complete (PL-1..PL-5) with an explicit, **unambiguous**
  "Files to change" list.
- **IM-5 / GU-2** — `protected_paths` may be changed only when listed in the
  approved `plan.md` "Files to change"; else block (CLAUDE.md hard-stop).
- Branch checks:
  - *Initial (IM-3 / GU-4):* `develop` clean AND no `ticket/<slug>` branch exists.
  - *Resume (IM-3a):* the `ticket/<slug>` branch **already exists** and is the
    current checked-out branch. If missing or mismatched → block (do not create
    a second branch).

If any check fails, stop and report the rule code + message. **No branch, no file
changes, no state change.**

## Step 2 — Branch / enter (path-specific)

- **Initial:** create and check out `ticket/<slug>` from clean `develop` (IM-3, the
  only branch-creation point). Update `ticket.md`: `state:
  implementation-in-progress`, `updated_at: <today>`; append:
  ```yaml
  - state: implementation-in-progress
    event: implementation-started
    by: developer
    timestamp: <today>
  ```
- **Resume:** do **not** create a branch. Confirm you are on `ticket/<slug>`.
  Read `implement.md` to see what was already done; if `status: blocked`, reset
  `ticket.md status: active`. Append:
  ```yaml
  - state: implementation-in-progress
    event: implementation-resumed
    by: developer
    timestamp: <today>
  ```

## Step 3 — Apply ONLY the remaining planned changes (IM-4)

Apply each not-yet-done entry from `plan.md` "Files to change" (Edit/Write).
**Do not modify any file not on that list.** Leave the changes as **uncommitted
working-tree edits** on the `ticket/<slug>` branch — `/implement` creates **no
commit** and **never pushes** (IM-9). The single publishable commit is created
later by `/publish-pr`, the git delivery boundary (PB-8 / ADR-008).

**If implementation cannot continue** (scope creep — a needed file is not listed;
or any unsafe/unclear condition):
- Do **not** set `state: implemented`.
- Keep `state: implementation-in-progress`; set `status: blocked` (IM-10).
- Write/update `implement.md` with: **blocking reason**, **partial changes so
  far**, **recommended next action**, and **whether plan revision is required**.
- Stop and report. (Re-run `/implement` later to resume, or `/plan` to revise.)

## Step 4 — Record implement.md (IM-6)

Write/update `_specs/<slug>/implement.md` from `_specs/_templates/implement.md`:
front-matter (`ticket`, `stage: implement`, `mode`, `status` reflecting progress,
`owner: developer`, `updated: <today>`, `links`) + Changes made, Deviations from
plan, Validation run. **No commit is created at `/implement` (IM-9)** — there are
no SHAs to record; the "Changes prepared" section lists the changed files instead.

## Step 5 — Complete (TS-4 / IM-7), only if all planned work is done

Update `ticket.md`: `state: implemented`, `status: active`, `updated_at: <today>`;
append:
```yaml
- state: implemented
  event: implementation-completed
  by: developer
  timestamp: <today>
```

## Postconditions — validate AFTER

- **IM-3** initial branch from clean develop (or **IM-3a** resume used the existing
  branch, no second branch) · **IM-4** changes confined to planned files · **IM-5**
  protected paths only if in the approved plan · **IM-6** implement.md complete · **IM-9** no
  commit, no push.
- Completed: **IM-7 / TS-4 / CMD-2** state = `implemented` with all planned work
  done and validation recorded.
- Blocked: **IM-10** state = `implementation-in-progress`, `status: blocked`,
  implement.md documents reason/partial/next-action — valid but **not** complete.

## MUST NOT

- Do **not** run unless state ∈ {`approved`, `implementation-in-progress`} (IM-1).
- Do **not** create a second branch on resume (IM-3a).
- Do **not** modify files not listed in `plan.md` (IM-4 — no silent edits).
- Do **not** modify `protected_paths` unless it is listed in the approved `plan.md` (IM-5/GU-2).
- Do **not** set `implemented` unless all planned work is complete + validation
  recorded (IM-7).
- Do **not** commit or push (IM-9 — `/publish-pr` owns the single publishable
  commit); do **not** advance past `implemented` (`/verify` owns
  `implemented → verified → closed`).

## Report

State the entry path (initial/resume), the branch, the files changed (all from
`plan.md`, left **uncommitted**), and the resulting `ticket.md` state:
- completed → `implemented`; next: a reviewer runs `/verify`.
- blocked → `implementation-in-progress` + `status: blocked`; report the blocking
  reason and whether `/plan` revision is needed.

## Next step (NS-1..NS-4)

Emit the next-step block (`command-architecture.md §6`):

- **Completed → `implemented`:**
  - **Current state:** `implemented`
  - **Next command:** `/verify <slug>` (a reviewer; read-only validation)
  - **Required actions:** none — work is applied to the branch, uncommitted.
  - **Optional actions:** none (do not commit/push here; that is `/publish-pr`).
  - **Terminal?** no
- **Blocked → `implementation-in-progress` + `status: blocked` (NS-3):**
  - **Current state:** `implementation-in-progress` (`status: blocked`)
  - **Next command:** `/implement <slug>` (resume) or `/plan <slug>` (revision)
  - **Required actions:** resolve the blocking reason recorded in `implement.md`
    (and, if it requires a plan change, revise via `/plan` first).
  - **Optional actions:** none
  - **Terminal?** no
