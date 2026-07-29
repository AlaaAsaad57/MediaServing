---
name: make-feature-doc
description: Write standards-based, code-verified feature documentation for Trydos. Use when the user gives one or more feature IDs / SKUs / titles (e.g. "SD-01 to SD-05", "CH-08", "the wishlist feature") and asks to document them, add detail files, or describe what a feature does. Produces one Markdown file per feature under docs/features/<domain>/ and links it into the index. Audience is a non-technical manager; code is the source of truth — never guess.
---

# make-feature-doc

Turn a list of feature IDs/titles into professional, non-technical, **code-verified** feature
docs. This skill encodes exactly how the Trydos feature docs are written so every batch comes out
consistent.

## Golden rules (non-negotiable)

1. **Code is the source of truth. Never guess, never invent.** Every claim (limits, endpoints,
   file paths, behaviour) must come from reading the actual code. If something can't be verified
   or is genuinely unclear, **ask the user** — do not fabricate.
2. **Audience = a non-technical manager.** Plain language at the top; technical specifics pushed
   into the Data-source / Technical-reference tables lower down.
3. **One file per feature**, reusing the feature's stable ID from `docs/features/README.md`.
4. **Status reflects reality (see Status rule).** A feature that isn't fully functional is **not**
   🟢 Live.
5. **Flag security/correctness issues** you find with ⚠️, but only real ones found in code.
6. hardcoed/placeholder should consider the featture as
  partial

## Inputs

- A set of feature IDs (`SD-01 to SD-05`, `CH-08, CH-09`), SKUs, or plain titles.
- If given titles instead of IDs, map them to IDs via `docs/features/README.md` first (ask if
  ambiguous).

## Procedure

### 1. Scope from the index
Read `docs/features/README.md`. For each requested feature, note its ID, headline, one-line
description, domain, and the domain folder (e.g. domain A → `A-shopping-and-discovery`). Read one
or two existing sibling docs to match tone and structure exactly.

### 2. Investigate the code (parallel, read-only)
Dispatch **parallel `Explore` agents** (one per feature or per tight cluster of related
features). Each agent prompt MUST say: *code is the source of truth, report only what you verify,
cite exact `file:line`, do not modify files.* Ask each agent for: entry points/routes, the
components involved, verified behaviour (limits, params, debounces, page sizes), the data
source/endpoints, which store slice (if any), and **only real gaps/caveats found in code**.

Anchor hints for Trydos: routes in `app/(client)/[lang]/`; data via `serverRequests/*`,
`utils/fetchData.ts`, or `services/*`; Elasticsearch in `services/elastic/*`; endpoint constants
in `utils/endpointConfig.tsx`; one combined store in `store/*/reducer.ts`. (See `CLAUDE.md`.)

Wait for all agents. Do not write a doc from a single unverified source.

### 3. Write one file per feature
Path: `docs/features/<domain-folder>/<ID>-<kebab-slug>.md`. Use the **template** below verbatim
(section order fixed). Keep the "How it works" bullets concrete and behaviour-first. Put numbers,
endpoints and file paths in the two tables. Cross-link related IDs in `## Related features`.

### 4. Apply the Status rule (below) to set the header + index status.

### 5. Update the index
In `docs/features/README.md`: turn each documented row into a link
(`[SD-01](A-shopping-and-discovery/SD-01-....md)`), correct the status emoji if the investigation
changed it, and fix any "Status at a glance" counts/notes that are now wrong. If the
investigation contradicts the index (a feature is misfiled, a duplicate, or doesn't exist), **stop
and ask the user** how to reconcile it rather than papering over it.

**Also keep the "Not-yet-live features" rollup in sync.** The index carries a section listing
**every** feature that is not 🟢 Live (🟡 Partial and ⚪ Placeholder/Planned), split into those two
groups, with **one short row per feature** stating the single concrete thing it needs to go Live
(e.g. "send the cancel reason to the backend", "swap the dummy widget for the real RDB widget").
Whenever a feature's status changes to/from 🟢 — or its go-live requirement changes — add, move, or
remove its row so the rollup stays a truthful, complete mirror of every 🟡/⚪ status in the tables.
The requirement must be code-verified, not guessed.

### 6. Report
Summarise per feature: the one headline finding, the status, and any ⚠️ issue. Call out anything
that needs a user decision. Never commit unless asked.

## Status rule (how to pick the emoji)

Status **follows the real state of the feature**, and in practice tracks the "Known gaps"
section:

- 🟢 **Live** — fully delivers what its title/headline promises; no functional gap. (Cosmetic
  copy, minor maintenance notes, or edge-case-only issues don't disqualify it.)
- 🟡 **Partial** — works but a **core part of the promised capability is missing or
  non-functional**, or it's clearly still under active development. If a **real functional** gap is
  listed in "Known gaps", the status is Partial, not Live.
- ⚪ **Placeholder / Planned** — scaffolded in the app but not actually functional.
- 🔧 **Internal** — infra / admin / support tooling, not a normal end-user feature.

When unsure between Live and Partial, judge by: *does it fully do what its title claims?* If a
sub-capability named in the title isn't built (e.g. "Specs & **size guide**" with no size guide),
it's Partial. If the user has deliberately removed a gap note from a doc, respect that as "not a
real gap" and keep it Live.

## Feature-doc template

````markdown
# <ID> — <Feature Name>

| | |
|---|---|
| **Feature ID** | <ID> |
| **Domain** | <A · Shopping & Product Discovery> |
| **Status** | <🟢 Live / 🟡 Partial — one-line why / ⚪ Placeholder / 🔧 Internal> |
| **Last verified** | <YYYY-MM-DD> (against `develop`) |
| **Source of truth** | <the key files, comma-separated> |

---

## What it is

<2–4 plain-language sentences. No jargon.>

## Where it appears

<Which screens/URLs the shopper (or user) meets it on.>

## Who uses it

<The audience: shoppers / sellers / guests / internal, in one line.>

## How it works (verified behaviour)

- <Behaviour bullets, concrete and specific, all verified from code. Include real limits,
  debounces, page sizes, defaults, param names in prose where helpful.>

## Data source

| Item | Value |
|------|-------|
| <what> | <endpoint / server action / index / cache, verified> |

## Technical reference

| Item | Value |
|------|-------|
| <component / route / library / limit> | <exact path or value> |

## Current status & maturity

<1–3 sentences: is it stable, actively developed, partial? Match the Status emoji.>

## Known gaps / notes

- <ONLY real gaps found in code. If a gap makes the feature not fully functional, the Status must
  be 🟡/⚪. If there are no real gaps, omit this section or state "No dedicated gaps found.">

## Related features

<Cross-links to other IDs, e.g. `SD-13 (Listing engine) · CO-01 (Add to cart)`.>
````

## Conventions

- Filenames: `<ID>-<kebab-case-slug>.md`; domain folders `A-shopping-and-discovery`,
  `H-seller-dashboard`, etc. (letter + kebab name).
- Combined locale slug `{lang}` = `country-language` (e.g. `sy-en`); mention RTL for `ar`/`ku`
  where relevant.
- Reuse the exact IDs from the index; never renumber. If an ID is retired/moved, note it in the
  index and don't reuse the number.
- Keep each doc self-contained and skimmable; a manager should understand it without opening code.
- No test files, no code changes — this skill only reads code and writes docs.
