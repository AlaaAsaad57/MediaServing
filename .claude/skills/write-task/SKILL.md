---
name: write-task
description: Write a TryDos backlog ticket (User Story / Work Item) that fully respects the TryDos Backlog Ticket Standard. Use whenever the user says "write-task", "write a task", "write a ticket", "create a backlog ticket", or asks for a ClickUp/User-Story work item for a TryDos feature.
---

# write-task — TryDos Backlog Ticket writer

Produce a backlog ticket that fully complies with the **TryDos Backlog Ticket Standard**
(`Ticket-Guide/Backlog Ticket Standard-*.md`). Any ticket that does not follow this
standard is rejected and sent back, so respect the format exactly.

## How to use

1. Take the feature the user describes (e.g. "add a comment section for seller dashboard").
2. Fill in **every required metadata field** at the top.
3. Write the body with **exactly the 3 sections, in this order**: User Story →
   Acceptance Criteria → Test Cases.
4. After the Test Cases, append a **QA Test Path (non-technical)** section — a
   step-by-step manual test guide a non-developer QA person can follow with no
   code, tools, or repo knowledge.
5. End with the **Ticket Quality Checklist**, with every box ticked `[x]` only if the
   ticket genuinely satisfies it.
5. **Always write the finished ticket to `Tickets/<Verb-Object-Title>.md`** (repo-root
   `Tickets/` folder, kebab/Title-Case filename matching the existing convention there),
   then also output it in the chat as one markdown block the user can paste into ClickUp.

If a required metadata value is genuinely unknowable (Assignee, exact Sprint, Time
Estimate), put a sensible placeholder/estimate and flag it with `⚠️` so the user fills it,
rather than leaving it blank — a blank required field fails the standard.

> **Field values below are the LIVE ClickUp schema** of the *Product Backlog List*
> (folder **Backlog**, list id `901818662901`, team **Ramaaz Co** `90182710436`,
> space **TryDosProject** `901811062695`). Only ever use option labels listed in the
> **ClickUp field reference** at the bottom of this skill — never invent a status,
> actor, priority, type, risk, or environment value that isn't in that list.

## Required metadata (top of ticket — all required fields MUST be filled)

| Property | Required | Notes |
| --- | --- | --- |
| Title | ✔️ | Short, action-oriented: **Verb + Object** (e.g. "Create User", "Add Comment Section"). Never a vague noun ("Comments", "Users"). |
| Status | ✔️ | Start new tickets at **`draft`**. Workflow: `draft → refining → ready for sprint → blocked → complete`. Use exactly these labels (lower-case). |
| Work Item Type | ✔️ | One of: `Feature`, `Story`, `Bug`, `Improvement`, `Task`, `Epic`. |
| Backbone (module) | ✔️ | The ClickUp module folder the ticket belongs to: `Admin Dashboard`, `Seller DashBoard`, `Story`, `Chat`, `Client`, `Auth`, `MobApp`, `QA`. (Not a custom field — it is the folder; pick the closest module.) |
| Actor | ✔️ | One or more of: `System Admin`, `Account Admin`, `Seller`, `Driver`, `Normal User`, `System`. (Multi-label field — pick the real actor(s).) |
| Priority | ✔️ | `low`, `Medium`, or `High`. |
| Risk Level | ✔️ | `Low`, `Medium`, or `High`. |
| Environment | ✔️ | One or more of: `Web`, `Staging`, `Production`, `Development`, `Laravel Admin Dashboard`, `Go-Inventory`. |
| Assignee | ✔️ | Person responsible (placeholder + ⚠️ if unknown). |
| Time Estimate (h) | ✔️ | Hours, numeric (give a real estimate, flag ⚠️ if guessed). |
| Sprint | ⬜ | Sprint relation (e.g. `Sprint 1 (6/15 - 6/28)`). Leave blank for backlog items. |
| User Story Relation | ⬜ | Link parent Epic/Story task by ID. |
| Business Value | ⬜ | One-line value statement (mirrors the User Story `so that`). |
| Dependencies | ⬜ | Blocking tickets/work, by ID. |
| Technical Notes | ⬜ | Short implementation pointers (files, endpoints) for the dev. |
| Questions | ⬜ | Open questions for the reviewer/EM. |

## Body — exactly 3 sections, in order

### 1) User Story
```
## User Story
As **a [Actor / role]**,
I want to be able to **[action / capability]**,
so that **[business value / benefit]**.

[One short paragraph: scope, key constraints, what is in/out of scope,
references to related stories by ID.]
```
Rules: must use **As / I want / so that**; `so that` must state a real benefit, not
repeat the action. The summary paragraph must state scope + constraints + in/out of scope.

### 2) Acceptance Criteria
Grouped into **named sub-sections**, each a **numbered list** of atomic, testable (yes/no)
statements. Use these sub-sections (drop any that truly don't apply, but cover the safety
ones):
- `## Scope & Tenant Safety` — tenant isolation explicitly addressed
- `## Authorization` — who may act; unauthorized → 403 (API) / control hidden (UI)
- `## General Behavior`
- `## Form Fields` → `### Required Fields`, `### Optional Fields`, plus `Rules:`
- `## Behavior After Saving`
- `## Validation & Constraints`
- `## UI & API Consistency` — UI and API enforce identical rules; structured errors
- `## Audit & Logging` — what is logged on success and on failure

### 3) Test Cases
At minimum these three, all in **Given / When / Then** format:
- `## Happy Path — [scenario name]`
- `## Validation Error — [scenario name]`
- `## Authorization Failure — [scenario name]`

### 4) QA Test Path (non-technical) — REQUIRED
A `# QA Test Path (non-technical)` section, placed **after** the Test Cases and
**before** the checklist (so the 3 canonical sections stay contiguous), written
for a QA tester with **no coding, no dev tools, and no repo access**. Rules:
- Numbered, click-by-click steps in plain language ("Open…", "Tap…", "Type…").
- Every action step states **what the tester should see** ("**Expect:** …").
- Name **where** to test (which page/route) and **what data/precondition** to set
  up first; cover the main happy flow **and** the key edge/empty/error cases.
- If behaviour varies by surface (routes, locales/RTL, roles, screen sizes),
  tell the tester to repeat the relevant steps on each, and mark which steps.
- End with an explicit **pass/fail criterion** and how to report a failure
  (page + step number + what was seen).
- No file paths, code, API names, or store/flag names — keep it business-language.

## Hard rules (auto-reject if violated)
- Title is Verb + Object, not a vague noun.
- All required metadata filled.
- Body has all 3 sections in order, nothing else inserted between them.
- AC is grouped, numbered, atomic, testable — never one long paragraph.
- Tenant safety + Authorization + Validation explicitly covered.
- Test cases cover Happy Path, Validation Error, Authorization Failure in Given/When/Then.
- A **QA Test Path (non-technical)** section follows the Test Cases: numbered, no-code, plain-language steps, each action with an **Expect:**, plus a pass/fail criterion. No file paths/code/API names.
- **No ambiguous words**: "maybe", "etc.", "should probably", "TBD" (unless an explicit ⚠️ placeholder).
- Related tickets referenced by ID when applicable.

## Finish with the checklist
Append this and tick honestly:
```
Ticket Quality Checklist
- [ ] Title is short and action-oriented (verb + object)
- [ ] Status, Work Item Type, Backbone, Actor, Priority, Risk Level, Environment, Assignee, Time Estimate are filled
- [ ] Every field value matches a label in the ClickUp field reference (no invented values)
- [ ] Body contains all 3 sections: User Story, Acceptance Criteria, Test Cases
- [ ] User Story uses As / I want / so that format with a real benefit
- [ ] Summary paragraph includes scope, constraints, in/out of scope
- [ ] Acceptance Criteria are grouped into named sub-sections
- [ ] Every criterion is atomic and testable (yes/no)
- [ ] Tenant safety is explicitly addressed
- [ ] Authorization rules are clearly defined
- [ ] Validation rules are clearly defined
- [ ] Behavior After Saving is defined
- [ ] UI & API consistency is defined
- [ ] Audit & Logging rules are included
- [ ] Test Cases cover: Happy Path, Validation Error, Authorization Failure
- [ ] QA Test Path (non-technical) included with step-by-step, no-code instructions
- [ ] No ambiguous words ("maybe", "etc.", "should probably")
- [ ] Related tickets referenced by ID (if applicable)
```

## ClickUp field reference (live values — source of truth)

Pulled from the live **Product Backlog List** (`901818662901`). When ClickUp changes,
re-pull and update this section (see "Refreshing this reference" below). These are the
**only** legal option labels.

### Statuses (workflow order)
`draft` (open) → `refining` → `ready for sprint` → `blocked` → `complete` (closed).
New tickets start at `draft`.

### Custom field options
| Field | Type | Allowed values |
| --- | --- | --- |
| Work Item Type | drop_down | `Feature`, `Story`, `Bug`, `Improvement`, `Task`, `Epic` |
| Actor | labels (multi) | `System Admin`, `Account Admin`, `Seller`, `Driver`, `Normal User`, `System` |
| Priority | drop_down | `low`, `Medium`, `High` |
| Risk Level | drop_down | `Low`, `Medium`, `High` |
| Environment | drop_down (multi) | `Web`, `Staging`, `Production`, `Development`, `Laravel Admin Dashboard`, `Go-Inventory` |
| Time Estimate (h) | number | hours (numeric) |
| Sprint | list_relationship | current: `Sprint 1 (6/15 - 6/28)` |
| User Story Relation | tasks | parent Epic/Story task id(s) |
| Business Value | short_text | free text |
| Dependencies | short_text | free text |
| Technical Notes | text | free text |
| Questions | text | free text |
| Acceptance Criteria | short_text | free text (the body's AC section is canonical) |

### Backbone → ClickUp module folders
`Admin Dashboard`, `Seller DashBoard`, `Story`, `Chat`, `Client`, `Auth`, `MobApp`, `QA`
(all under space **TryDosProject**). Lists also exist for `Bugs` and `Fixes & Technical Debt`
in the **Backlog** folder — same status set as above.

### Refreshing this reference
Token is in env (`CLICKUP_API_TOKEN`). Re-pull with:
```bash
# statuses
curl -s -H "Authorization: $CLICKUP_API_TOKEN" \
  "https://api.clickup.com/api/v2/list/901818662901" | python -m json.tool
# custom fields + options
curl -s -H "Authorization: $CLICKUP_API_TOKEN" \
  "https://api.clickup.com/api/v2/list/901818662901/field" | python -m json.tool
```
