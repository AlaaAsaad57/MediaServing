---
name: migrate-trello-batch
description: Migrate a batch of Trello cards to ClickUp backlog tickets, verifying against the codebase first. Use when the user says "migrate trello", "migrate-trello-batch", "next batch of trello cards", "move trello cards to clickup", or asks to move Trello backlog into ClickUp.
---

# migrate-trello-batch — Trello → ClickUp backlog migration

Take a batch of Trello cards, check whether this repo actually implements each one,
file each as a ClickUp task, and move the source card. Default batch size is **5**.

Design record: `docs/superpowers/specs/2026-07-27-trello-to-clickup-migration-skill-design.md`.

## Constants

| Thing | Value |
| --- | --- |
| Trello board | `67616df0fcf625b9da792c4d` (trydos) |
| Source column | `staging not urgent` (`6a42c2252aef68d21ceaee5b`) |
| Card filter | member `676180a45294bb6e13395dd9` (alaaasaaddev) — **always applied** |
| Destination column | `Moved To ClickUp` (`6a38d2608989da3b937acfc4`) |
| ClickUp list | Product Backlog List `901818662901` |
| Status on creation | `draft`, always |

Credentials: `TRELLO_API_KEY` and `TRELLO_TOKEN` live in the gitignored
`.env.development`. `CLICKUP_API_TOKEN` is expected in the **environment** — same as
`clickup_intake.py` requires — and is not duplicated into the file. The scripts load
both themselves; never print a token and never write one into a ticket.

If a script exits `CUW-1 ERROR: CLICKUP_API_TOKEN is not set`, the shell is missing
that variable. Export it rather than copying the secret into `.env.development`.

## Procedure

Run these in order. All HTTP lives in the scripts — never hand-roll a request.

**1. Fetch the batch.**
```bash
python scripts/trello_fetch.py 67616df0fcf625b9da792c4d "staging not urgent" \
  --member 676180a45294bb6e13395dd9 --count 5
```
If the user named a different column or count, use theirs. The member filter is not
optional: the board mixes frontend, Laravel admin dashboard, backend and mobile work,
and without it you will verify cards against a repo that was never meant to contain them.

**There is no duplicate check.** The owner turned it off: every migrated card leaves
the source column at step 6, so a normal re-run never sees the same card twice and the
lookup only cost a full paging sweep of the ClickUp list per card. The one case it
covered — a run that created the task but died before the move — is now repaired by
hand: move that card to `Moved To ClickUp` yourself instead of re-running it, because
a second run **will** create a second task. `clickup_create_task.py --find-by-name`
still exists if you ever need to check one by hand; the procedure does not call it.

**2. CLARIFICATION GATE — ask the user one question per card in the batch, and stop
until they answer.** Trello cards carry almost no
information: 36 of the 60 eligible cards have
an empty description, and a title like "design Profile pages" cannot be turned into
testable acceptance criteria on its own. Guessing here produces a confident, wrong
ticket.

Ask via `AskUserQuestion`. That tool accepts **at most 4 questions per call**, so a
batch of 5 needs **two calls** — four questions, then one. Never silently drop the
fifth card's question to fit one call.

For each card, ask the one question whose answer most changes the ticket. Usually
that is the scope question: what exactly counted as "done" when this card was
tested. Give 2–4 concrete multiple-choice options drawn from the card's own wording
and from what the repo plausibly does — the user can always type their own answer,
but blank open questions are slow to answer and produce vaguer replies than options
do. Put the option you think most likely first.

Do this **before** the codebase search. The answer tells you what to search for, so
asking first is both cheaper and more accurate than verifying blind and re-checking
afterwards.

If the user skips a question or answers "I don't remember", that is a real answer:
write the ticket at the scope the card literally states and let the status line say
the scope was unconfirmed. Never invent detail to fill the gap.

**3. Verify against the codebase.** For each remaining card, work out what the card
is asking for, then search this repo for the routes, components, services and API
handlers involved and read the ones that matter. This is a static read — do not run
the app, do not build. Reach one of four conclusions:

| Verdict | When |
| --- | --- |
| `done` | The behaviour the card describes is present in the code. |
| `partially done` | Some of it exists; name precisely what is missing. |
| `not done` | You searched where it would live and it is not there. |
| `not verifiable` | The title is too vague to pin to code, or the work belongs to another codebase. Say which. |

Never guess a verdict to fill the field. `not verifiable` is a legitimate answer and
is far better than a confident wrong one — the user tests each ticket afterwards, and
a false `done` is what would let a real gap slip through.

**A single search pass is not enough for a cross-cutting card.** When a card spans
several surfaces (pricing, auth, i18n, caching — anything with more than one code
path), search each surface separately before concluding. This was learned the hard
way: a first pass on the pricing card concluded "this repo never computes prices",
and a more thorough second pass found that listing and search recompute prices in
`services/elastic/helpers.ts` while the detail page trusts the backend — the exact
divergence the card was about. If the first answer is "this repo doesn't do X at
all", that is a prompt to look harder, not a verdict.

**4. Write the ticket file** to `Tickets/Trello-<Verb-Object-Title>.md`, incorporating
the user's answer from step 2. See "Ticket file" below for the naming rule — the
filename must **not** contain a literal `:`.

This one file is both the local record and the ClickUp body, so it is written once
and passed straight to the next step. Never retype the body into the API call: it is
multi-line markdown with non-ASCII text and shell quoting corrupts it.

**5. Create the task**, using the file written in step 4 as the description.
```bash
python scripts/clickup_create_task.py --list 901818662901 \
  --name "Trello: <Verb Object>" \
  --description-file "Tickets/Trello-<Verb-Object-Title>.md" --status draft
```

**6. Move the card to `Moved To ClickUp` — only after step 5 returns an id.** Every
card in the batch is moved; a migrated card never stays in the source column.
```bash
python scripts/trello_move_card.py <card_id> --to-list 6a38d2608989da3b937acfc4
```

This ordering is load-bearing. Create-then-move means a ClickUp failure leaves the
card in place and the run repeatable. Move-then-create would strand cards that were
never migrated with nothing left to find them by. **Never reverse it.**

## Ticket file

Every migrated card leaves a markdown file in the repo-root `Tickets/` folder,
alongside the tickets already there.

**Filename:** `Tickets/Trello-<Verb-Object-Title>.md` — e.g.
`Tickets/Trello-Fix-Cart-Price-Wrapping.md`. Title-Case words joined by hyphens,
matching the existing files in that folder.

**The filename uses a hyphen after `Trello`, never a colon.** Windows forbids `:` in
filenames. Git Bash will appear to accept one, but it silently substitutes the
private-use character `U+F03A` (code 61498), producing a name that only looks like it
has a colon — it will not match a search for `Trello:`, and Windows tools disagree
with Git Bash about what the file is called. The **ClickUp task title keeps the real
colon** (`Trello: Fix Cart Price Wrapping`); only the filename is sanitised.

`Tickets/` is gitignored (`.gitignore:75`), so these files stay local to the machine
that ran the migration. ClickUp is the shared record; the file is the working copy.

## Ticket format

Title: `Trello: ` + a **Verb + Object** title (`Trello: Fix Cart Price Wrapping`).
Rewrite vague noun titles into verb form. Translate Arabic titles to English.

Body — exactly this, nothing else:

```markdown
**Implementation status:** <verdict> — <one sentence naming what was found or is missing>

## User Story
As **a [actor]**,
I want to be able to **[capability]**,
so that **[benefit]**.

## Acceptance Criteria
1. [atomic, testable statement written from the code]
   ... about six, never one long paragraph ...

# QA Test Path (non-technical)
1. [click-by-click step in plain language]
   **Expect:** [what the tester should see]
   ... cover the happy path and the key edge/empty/error case ...

Pass/fail: [explicit criterion]. If it fails, report the page, the step number, and what you saw.

---
Migrated from Trello: <card url>
```

Rules for the body:
- No metadata table, no Test Cases section, no quality checklist. Three sections only.
- Acceptance criteria come from **the user's answer at the clarification gate plus the
  code you read** — not from the Trello text, since 36 of the 60 eligible cards have
  no description at all. Where the user's answer defined the scope, the criteria must
  reflect it; that answer is the most authoritative input you have.
- If the user's answer contradicts what the code shows, say so plainly in the status
  line rather than quietly siding with one. That disagreement is the single most
  useful thing the ticket can tell them.
- The QA Test Path is for a non-developer: no file paths, code, API names, store or
  flag names. Name the page or route in business language.
- Bug-shaped cards use the same template, phrased as a story about the corrected
  behaviour. Nothing is routed to the Bugs list.
- If the card was Arabic, append the original text verbatim under the Trello link so
  nothing is lost in translation.
- Set no custom fields. Work Item Type, Actor, Priority, Risk Level, Environment and
  Time Estimate are left empty for the user to fill when they promote the ticket.

## Dry run

If the user says "dry run", do steps 1–4 — including the clarification gate and the
`Tickets/` file — then print what would be created and moved. Issue no POST and no
PUT. The written files are the deliverable, so the user can read the real tickets
before anything reaches ClickUp or Trello.

## Report at the end

One table, one row per card: card title, verdict, ClickUp URL (or why it was
skipped), and whether the Trello card moved. List the `Tickets/` files written. Then
state how many eligible cards remain in the source column, so the user knows how many
runs are left.

Name every failure explicitly. A card that errored is not a card that was skipped.

## Hard rules

- Never create a task at any status other than `draft`.
- Never move a card before its ClickUp task exists.
- Never re-run a batch over cards that are still in the source column after a partial
  failure — with no duplicate check, that creates a second task. Move those cards by hand.
- **Never create a ticket without running the clarification gate first.** If the user
  has not answered for a card, that card is not ready — leave it in Trello and say so.
- Never put a literal `:` in a filename. `Trello-`, not `Trello:`.
- Never modify `scripts/clickup_intake.py` — it is read-only by rule CU-3.
- Never edit a Trello card's name, description, members or labels. Column only.
- Never invent a verdict, and never claim to have tested the running app.
