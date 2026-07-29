# ClickUp ⇄ Workflow Sync — Design Proposal

- **Status:** proposal (for review — nothing implemented; no ClickUp writes performed)
- **Date:** 2026-06-21
- **Author:** ai_agent
- **Relates to:** ADR-003 (state ownership), ADR-005 (read-only intake), ADR-007 (GitHub publish), ADR-008 (delivery boundary)
- **Scope of this doc:** *how* spec-write-back + status sync + sprint placement + QA handoff could be layered onto Engineering Workflow v1. Live ClickUp IDs below were pulled **read-only** with your token; **no task was created or modified.**

---

## 1. What you asked for

1. When **spec is complete**, write the spec into a ClickUp task (using the `write-task` template) — correct list, custom fields, Actor, Assignee.
2. The ClickUp **status syncs automatically** as the workflow progresses.
3. As **dev**, the task is **moved/created into the Sprint** and its status advances to match what was accomplished.
4. The **final status is `qa testing`**, the task is **auto-assigned to a QA member**, and the **PR link is added** to the task.
5. Read-only investigation now; this doc is the deliverable.

---

## 2. The core tension (must be resolved before building)

Everything you asked for is **write-back to ClickUp**. The workflow today is deliberately the opposite:

| Principle today | Source | What it says |
| --- | --- | --- |
| Ticket state has one owner | ADR-003 / TS-1 | `_specs/<ticket>/ticket.md > state` is the **only** source of truth. State is never inferred from, or owned by, an external system. |
| ClickUp is read-only | ADR-005 / CU-3 | `/start-ticket` issues **one GET**; "status sync, comment sync, ClickUp writes… bidirectional sync" are explicitly **out of scope**. |
| Delivery is one-way | ADR-007 / PB-4 | Publishing flows **workflow → GitHub** only; no external state is read back into the workflow. |

**Resolution — keep the principle, add a projection.** Treat ClickUp exactly like GitHub is treated in ADR-007: **a delivery/projection surface, never a state owner.** `ticket.md` stays canonical; each stage *pushes a one-way snapshot* into ClickUp after it has updated `ticket.md`. We never read a ClickUp status back into a workflow decision. This means:

- The sync is **push-only** (workflow → ClickUp), same direction as `/publish-pr`.
- ClickUp status is a **mirror** of `ticket.md > state`, computed by a deterministic map (§5). If they ever diverge, `ticket.md` wins and the next command re-pushes.
- This requires a **new ADR** (call it ADR-009) that *supersedes the "out of scope: status sync / writes" clause of ADR-005* — append-only, as the ADR rules require.

> If instead you want ClickUp to be able to *drive* the workflow (e.g. a human moves a ClickUp card and the workflow reacts), that breaks ADR-003 and is a much larger change. This proposal does **not** do that — and recommends against it.

---

## 3. Live ClickUp facts (pulled read-only today)

### 3.1 There are TWO status planes — this is the crux

Your workspace has two separate status sets, and your request spans both:

```
Backlog plane  (Backlog folder lists)   draft → refining → ready for sprint → blocked → complete
Sprint plane   (Sprint List folder)     to do → in progress → in review → ready for qa → qa testing → done → blocked → Closed
```

- **Backlog plane** = where a ticket is *authored and refined* (the `write-task` target). List **Product Backlog List** `901818662901`.
- **Sprint plane** = where a ticket is *worked* once a dev picks it up. Folder **Sprint List** `901814636753` (`override_statuses = true`), current list **Sprint 1 (6/15 - 6/28)** `901818794914`. The statuses you named — **`qa testing`**, plus `in progress`, `ready for qa` — live **only here**, not in the backlog list.

This confirms the model: **spec writes to the Backlog plane; the dev hand-off moves the task to the Sprint plane** and drives it to `qa testing`.

### 3.2 IDs you'll need at write time

Team **Ramaaz Co** `90182710436` · Space **TryDosProject** `901811062695`

| Thing | ID |
| --- | --- |
| Backlog folder | `901814525511` |
| Product Backlog List (spec target) | `901818662901` |
| Sprint List folder | `901814636753` |
| Sprint 1 list (current sprint target) | `901818794914` |
| Module "Development" lists (alt. dev target) | per module folder, e.g. Seller `901818623260`, Client `901818623267`, Auth `901818623270`, Story `901818623262`, Chat `901818623261`, Admin `901818623280`, MobApp `901818623275`, QA `901818623272` |

### 3.3 Custom field IDs (Product Backlog List)

| Field | ID | Type | Filled from |
| --- | --- | --- | --- |
| Work Item Type | `a14bd4d7-7f01-45b6-a1ef-d87b9e8dcf57` | drop_down | spec/intake |
| Actor | `96aa4156-7b8f-47ac-807c-293fc1aa0713` | labels (multi) | spec |
| Priority | `019a8d4e-54f7-4290-bac5-70e07218eb39` | drop_down | intake |
| Risk Level | `8bd43b3a-be78-48ce-b223-e780669beb34` | drop_down | `ticket.md > mode` (standard→Low/Med, high_risk→High) |
| Environment | `1eca0c20-ad45-44f9-9625-a1abfdc52275` | drop_down | spec |
| Time Estimate (h) | `b6b5a360-b19c-492e-b044-2f4103ab789f` | number | plan |
| Sprint | `8a15fd34-ef53-44d8-84a8-381c6120f1ec` | list_relationship | dev hand-off |
| User Story Relation | `d500921d-1513-4631-8973-ca9e8a05b8be` | tasks | spec |
| Business Value | `e06d6a57-00e7-44eb-b9b2-706db9e06598` | short_text | spec |
| Dependencies | `9c8847cc-8d71-441e-8095-7fa970160e3c` | short_text | research/plan |
| Technical Notes | `2a63cd17-7f2e-4a7d-ad5a-23f554594e5c` | text | plan |
| Questions | `b28fc062-b7e1-4aa3-871e-b22ab75ac53e` | text | research |
| Acceptance Criteria | `c5a01c64-553a-4c18-a418-ac7ee5077c74` | short_text | spec (canonical AC lives in task body) |

> Option labels per field are the ones already documented in the `write-task` skill. **Option *IDs*** (needed for drop_down/labels writes) must be pulled at write time from `GET /list/901818662901/field` — they are not hardcoded here on purpose, so the helper always uses live values.

### 3.4 QA members (for auto-assignment)

Two accounts are unambiguously QA (by email/username):

| Name | User ID | Email |
| --- | --- | --- |
| ali sulaiman | `113547923` | ali.sliman.qa@ramaaz.com |
| bilal QA | `113547921` | bilal.omran@ramaaz.com |

→ **QA pool = `[113547923, 113547921]`.** Auto-assign strategy is an open decision (§9, Q2).

---

## 4. Architecture — mirror the patterns you already trust

Reuse the established shape exactly. All ClickUp HTTP lives in **one isolated helper**; commands stay thin (the ADR-005 rule for intake, and the ADR-007 rule that all `git`/`gh` logic lives only in `scripts/github_publish.py`).

```
scripts/
  clickup_intake.py     # EXISTS — read-only GET (ADR-005). Unchanged.
  clickup_sync.py       # NEW    — write-back projection (this proposal).
  github_publish.py     # EXISTS — git/gh delivery (ADR-007).
```

**`scripts/clickup_sync.py`** — a single, idempotent, subcommand-style helper:

```
clickup_sync.py upsert-backlog  <ticket_dir>        # create-or-update the Backlog task from spec.md + ticket.md
clickup_sync.py set-status      <task_id> <status>  # push one status (validated against the list's live statuses)
clickup_sync.py move-to-sprint  <task_id> <list_id> # add to Sprint list + set Sprint relation field
clickup_sync.py qa-handoff      <task_id> <pr_url>  # status=qa testing, assign QA member, append PR link to description
```

Rules the helper obeys (mirrors CU-1..CU-5 / PB-5..PB-7):
- Auth via `CLICKUP_API_TOKEN` env only; never committed.
- **Idempotent:** records the created task id in `ticket.md > links.clickup`; re-runs **update** instead of creating duplicates.
- **Atomic:** any non-zero exit ⇒ command writes nothing new to `ticket.md` and reports the failure.
- **Fail-safe:** token missing / network error ⇒ abort cleanly; the workflow stage still succeeds locally (ClickUp sync is a *projection*, so a sync failure must not block local progress — it is surfaced and retried on the next command).
- Validates every status string against the **live** statuses of the target list before PUT (so a renamed ClickUp status fails loud, never silently writes garbage).

---

## 5. The mapping — workflow state → ClickUp (the heart of it)

After each command updates `ticket.md`, it calls the helper to push this projection:

| Workflow stage / `ticket.md state` | Plane | ClickUp action | Status pushed |
| --- | --- | --- | --- |
| `/start-ticket` (state `draft`) | Backlog | *(optional)* link existing task, or none yet | `draft` |
| `/research` → `ready-for-research` | Backlog | update body "Questions"/"Dependencies" fields | `refining` |
| `/spec` → `research-complete` | **Backlog** | **`upsert-backlog`**: create-or-update the task **from the `write-task` template** — Title, User Story, AC, Test Cases in the body; set Actor, Work Item Type, Environment, Business Value, Risk Level, AC fields | `refining` |
| `/plan` → `spec-complete` | Backlog | fill Time Estimate, Technical Notes, Dependencies | `refining` |
| `/review` APPROVED → `approved` | Backlog | mark refined & sprint-ready | `ready for sprint` |
| `/implement` (initial) → `implementation-in-progress` | **Sprint** | **`move-to-sprint`** (add task to Sprint 1 + set Sprint relation), then `set-status` | `in progress` |
| `/implement` complete → `implemented` | Sprint | `set-status` | `in review` |
| `/verify` PASSED → `verified`/`closed` | Sprint | `set-status` | `ready for qa` → then `qa testing` at PR publish |
| `/publish-pr` (PR opened) | Sprint | **`qa-handoff`**: status `qa testing`, **assign QA member**, **append PR link** to description | `qa testing` |
| `/review` REJECTED → `closed` | Backlog | `set-status` | `blocked` (or `Closed`) |

Notes:
- **`qa testing` + QA assignee + PR link** all land at the **delivery boundary** (`/publish-pr`), which is exactly where the PR URL first exists (PB-8). That keeps a clean rule: *the QA hand-off is part of publishing, not a separate manual step.* (Alternative: split — `/verify` PASSED sets `ready for qa`, `/publish-pr` sets `qa testing`. Decision Q3.)
- `blocked` (Sprint) / `blocked` (Backlog) mirror `ticket.md > status: blocked` whenever a stage blocks.
- The **Sprint relation custom field** (`8a15fd34-…`) is set at the same time as adding the task to the Sprint list, so the card shows its sprint in both places.

---

## 6. Where each artifact's content maps into the task

`upsert-backlog` builds the task body straight from the `write-task` standard, sourced from workflow artifacts:

| `write-task` section | Sourced from |
| --- | --- |
| Title (Verb + Object) | `ticket.md > title` |
| User Story (As/I want/so that) | `spec.md` Business Goal + User Story |
| Acceptance Criteria (grouped, AC-n) | `spec.md` acceptance criteria (IDs preserved for traceability) |
| Test Cases (Given/When/Then) | `spec.md` test cases |
| Actor / Environment / Work Item Type | `spec.md` + intake metadata |
| Technical Notes / Files | `plan.md` |
| Business Value | `spec.md` |
| Risk Level | derived from `ticket.md > mode` |

The PR link appended at QA hand-off is a one-line addition to the **description** (and mirrored to `ticket.md > links.github`, which `/publish-pr` already writes — PB-3).

---

## 7. New command surface

Two viable shapes; recommend **B**.

**A. New explicit command `/sync-clickup`** — operator runs it after each stage. Simple, fully manual, zero coupling, but easy to forget → drift.

**B. Fold the push into existing commands (recommended).** Each command, *after* its atomic `ticket.md` write, makes a best-effort `clickup_sync.py` call for its row in §5. Gated behind `features.clickup: true` (already in `project-config.yaml`) plus a new `features.clickup_sync` flag so it's opt-in and reversible. A standalone `/sync-clickup --repair` re-pushes the current state for recovery.

Either way, **the git/HTTP logic lives only in `scripts/clickup_sync.py`** — commands orchestrate, never embed (ADR-005/ADR-007 boundary rule).

---

## 8. Validation rules to add (extends `validation-model.md`)

A new rule block, e.g. **CS — ClickUp sync (write-back)**:

| Code | Severity | Condition |
| --- | --- | --- |
| CS-1 | ERROR | `CLICKUP_API_TOKEN` set and `features.clickup_sync: true` before any write. |
| CS-2 | ERROR | The sync is **push-only**: no ClickUp field is ever read back into a workflow-state decision (preserves ADR-003 / extends CU-3, PB-4). |
| CS-3 | ERROR | `ticket.md` is updated **before** the ClickUp push; the push reads the just-written canonical state. |
| CS-4 | ERROR | Idempotent: with `links.clickup` set, the helper **updates** the existing task; it never creates a duplicate. |
| CS-5 | ERROR | Every status string is validated against the **live** statuses of the target list before PUT. |
| CS-6 | ERROR | Helper failure is **non-blocking** for local workflow progress but **must be surfaced** (WARN to operator) and is retried by the next command / `--repair`. |
| CS-7 | ERROR | All ClickUp write HTTP lives only in `scripts/clickup_sync.py`; commands embed none. |
| CS-8 | ERROR | QA hand-off assigns from the configured QA pool only; PR link is appended, never overwriting the body. |

Plus a new **ADR-009** ("Push-only ClickUp projection") that supersedes the read-only-only clause of ADR-005, and a `clickup_sync:` config block in `project-config.yaml` (status map, QA pool, list IDs, field IDs) so the map is config-driven, not hardcoded in the helper — same separation `validation_profiles` already uses.

---

## 9. Open decisions (need your call before building)

1. **Direction.** Confirm push-only (workflow → ClickUp). Recommended. (Two-way, ClickUp-drives-workflow, is rejected here — breaks ADR-003.)
2. **QA assignee strategy.** QA pool = `ali sulaiman (113547923)`, `bilal QA (113547921)`. Pick: (a) always one named person, (b) round-robin, (c) assign both. Round-robin needs persisted state (e.g. a counter in config) since `Math.random`/time aren't available deterministically.
3. **When `qa testing` fires.** (a) only at `/publish-pr` (recommended — PR link exists then), or (b) `ready for qa` at `/verify` PASSED, `qa testing` at publish.
4. **Sprint target.** Always current Sprint list (`Sprint 1`), or the module "Development" list per Backbone? Your wording ("move/create the task in sprint") ⇒ current Sprint. The current-sprint list id will change each sprint → must be a config value, refreshed per sprint.
5. **Trigger model.** Folded into commands (recommended, §7-B) vs explicit `/sync-clickup`.
6. **Does spec *create* the task, or update an existing one** seeded by `/start-ticket --clickup-id`? Recommended: if `links.clickup` exists, update; else create at `/spec`.

---

## 10. Out of scope / phasing

- **Phase 1:** `upsert-backlog` at `/spec` + status push through the backlog plane.
- **Phase 2:** `move-to-sprint` + status sync on the sprint plane (`/implement`, `/verify`).
- **Phase 3:** `qa-handoff` at `/publish-pr` (status `qa testing` + QA assignee + PR link).
- **Never (this proposal):** reading ClickUp state into workflow decisions; ClickUp-initiated transitions; comment sync; closing/deleting tasks from the workflow.

---

## 11. What was done to produce this doc

Read-only `GET`s only (no writes), with your `CLICKUP_API_TOKEN`:
- `GET /team` — members / QA discovery
- `GET /list/901818662901/field` — backlog custom-field IDs
- `GET /space/901811062695/folder` — folder/list inventory (found the Sprint List plane)
- `GET /list/901818794914`, `GET /folder/901814636753` — Sprint statuses (`qa testing` confirmed)
- `GET /list/901818623272`, `GET /list/901818623260` — module list statuses

No task was created, updated, moved, assigned, or commented on.
