---
description: Bootstrap a workflow ticket workspace (ticket.md + intake.md) per Engineering Workflow v1.
argument-hint: <slug> "<title>" [owner=...] [clickup_id=...]
allowed-tools: Read, Write, Glob, Bash
---

# /start-ticket

Bootstrap a new ticket workspace under `_specs/<slug>/`. You create **exactly two
files** — the canonical state record `ticket.md` and the `intake.md` artifact —
and nothing else.

Authoritative references (do not duplicate or reinvent their rules):
- State machine, the single workflow form, closure: `.claude/project-config.yaml`
- Stage gates / state ownership: `.claude/rules/workflow-rules.md`
- Command contract: `.claude/docs/command-architecture.md` (`/start-ticket`)
- **Validation: `.claude/rules/validation-model.md` — apply its rule codes; do
  NOT write any custom validation logic.**

## Inputs

Parsed from `$ARGUMENTS`:
- `slug` (required) — ticket id/slug.
- `title` (required) — quoted human title.
- `mode` — **not an input.** There are no modes and no risk tiers (ADR-011);
  `ticket.md` is always written with the single legal value `mode: standard`.
- `owner` (optional, default `developer`).
- `links` (optional) — clickup/github URLs.
- `clickup_id` (optional) — a ClickUp task id to seed the ticket from
  (read-only). See "ClickUp intake" below.

**Slug rule:** a user-provided `slug` is always primary. Only when `clickup_id`
is given **and** no `slug` is supplied, default the slug to `cu-<clickup_id>`.

If `title` is missing and no `clickup_id` is given, ask the user once. (With
`clickup_id`, the title is fetched from ClickUp.)

## ClickUp intake (optional, read-only)

If `clickup_id` is provided, seed the workspace from the ClickUp task **before**
writing files. The HTTP logic lives **only** in `scripts/clickup_intake.py` —
this command does not embed any HTTP/curl logic; it just invokes the helper:

```
python scripts/clickup_intake.py <clickup_id>
```

The helper performs a single read-only `GET` and returns
`{title, description, url}`. Map: `title` → ticket title; `description` →
intake `Ticket Summary`; `url` → `links.clickup`. **Read-only: never write to
ClickUp; never derive workflow state from ClickUp** (`ticket.md` stays canonical).

## Preconditions — validate BEFORE writing (abort on any ERROR)

Apply these `validation-model.md` rules:
- **FM-3** — `mode` is the single legal value `standard`. Reject any other value
  (e.g. `high_risk`/`fast`): `FM-3 ERROR: <value> is not a valid mode — the
  workflow has a single form (ADR-011)`.
- **FM-5** — `slug` matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
- **CMD-3** — `_specs/<slug>/` must not already exist (use Glob to check). If it
  exists, abort: report `CMD-3 ERROR: workspace already exists`.
- **MO-1** — `intake` is a valid stage of the single workflow form (it always is).
- **CU-1 / CU-2** (only if `clickup_id` given) — `CLICKUP_API_TOKEN` is set
  (CU-1) and the helper fetch succeeds (CU-2). If the helper exits non-zero,
  abort — create nothing (CU-4, atomic).

If any ERROR fires, stop and report the rule code + message. Create nothing.

## Actions (only on all-clear)

Use today's date (`YYYY-MM-DD`) for `created_at` / `updated_at` / `updated`.
If `clickup_id` was given, use the helper's `title` for `<title>`, its
`description` for the intake `Ticket Summary`, its `url` for `links.clickup`, and
default `<slug>` to `cu-<clickup_id>` when no slug was supplied.

1. Read `_specs/_templates/ticket.md`. Write `_specs/<slug>/ticket.md` with
   front-matter filled:
   - `ticket: <slug>`, `title: <title>`, `mode: standard`,
   - `state: draft`  ← authoritative initial state,
   - `status: active`, `owner: <owner>`,
   - `created_at: <today>`, `updated_at: <today>`.
   Keep the field-reference body intact, and write the **initial state-history
   entry** in the "State history" section:
   ```yaml
   - state: draft
     event: ticket-created
     by: ai_agent
     timestamp: <today>
   ```
2. Read `_specs/_templates/intake.md`. Write `_specs/<slug>/intake.md` with
   front-matter: `ticket: <slug>`, `stage: intake`, `mode: standard`,
   `status: in_progress`, `owner: <owner>`, `updated: <today>`, and `links`
   (clickup/github if provided, else empty). Fill `Ticket Reference`,
   `Ticket Summary`, and metadata from the inputs; leave the readiness checks for
   the user.

## Postconditions — validate AFTER writing

- **TS-2 / TS-3** — `ticket.md` exists with all required fields; `state: draft`
  ∈ canonical states; `status: active`.
- **TS-4** — `ticket.md` is the single state record written, including the
  initial `ticket-created` state-history entry.
- **FM-1..FM-8** — both files' front-matter are valid and `mode` agrees.
- **ST-1** — current state (`ticket.md > state`) is `draft`.
- **CMD-2** — postcondition state is `draft`.

## MUST NOT (out of scope for this command)

- Do **not** create a git branch. Per the branch strategy
  (`command-architecture.md §3`), branches are created only after review-gate approval, by
  the implementation-entry command — never at start-ticket, and never for a
  not-yet-approved ticket (GU-4).
- Do **not** create `research.md`, `spec.md`, `plan.md`, `review.md`,
  `implement.md`, or `verify.md`.
- Do **not** modify source code or any `protected_paths` runtime file.
- Do **not** advance state beyond `draft` (the `draft → ready-for-research`
  transition happens later, once intake is marked `READY`).

## Report

State what was created (`_specs/<slug>/ticket.md`, `_specs/<slug>/intake.md`),
the initial `state: draft`, and the next step: fill `intake.md`, mark it
`READY`, then run `/research`.

## Next step (NS-1..NS-4)

Emit the next-step block (`command-architecture.md §6`):

- **Current state:** `draft`
- **Next command:** `/research <slug>`
- **Required actions:** fill `intake.md` and set its Readiness Status to `READY`
  (the `draft → ready-for-research` transition requires it — RS-7).
- **Optional actions:** none
- **Terminal?** no
