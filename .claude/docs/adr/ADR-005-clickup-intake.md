# ADR 005: Read-only ClickUp intake for /start-ticket

- **Status:** accepted
- **Date:** 2026-06-14
- **Ticket:** wf-pilot-002
- **Deciders:** reviewer (EM gate), developer

## Context

Tickets are often tracked in ClickUp first. Re-typing a task's title/description
into `/start-ticket` is wasteful and loses traceability to the source task. We
want the minimal integration that seeds a workflow workspace from an existing
ClickUp task, without coupling the workflow to ClickUp.

## Problem

How to ingest a ClickUp task into the workflow (a) read-only, (b) without making
`/start-ticket` a curl/HTTP wrapper, (c) without ceding state ownership to
ClickUp, and (d) with minimal infrastructure (no MCP for one read endpoint)?

## Decision

Add an **optional** `clickup_id` to `/start-ticket`. When supplied, the command
**orchestrates** an isolated helper, `scripts/clickup_intake.py`, which performs a
single **read-only** `GET /api/v2/task/{id}` (Python stdlib `urllib`, token from
`CLICKUP_API_TOKEN`) and returns `{title, description, url}`. The command maps
those into `ticket.md`/`intake.md` (`url` → `links.clickup`).

- **Direction:** one-way, read-only (Option C — direct REST, no MCP).
- **Boundary:** all ClickUp HTTP logic lives **only** in the helper; the command
  contains none — keeping it thin, testable, and swappable (e.g. for an MCP).
- **Slug:** user-provided slug is primary; `cu-<id>` is only a fallback default.
- **State ownership:** unchanged — `ticket.md` remains canonical (ADR-003); no
  workflow state is derived from ClickUp.
- **Credentials:** `CLICKUP_API_TOKEN` via environment only; never committed (no
  `.gitignore` change needed — there is no token file).

## Consequences

- **Positive:** fast intake from ClickUp; traceability via `links.clickup`;
  integration isolated to one module; no new infrastructure; fully reversible.
- **Negative / cost:** an external network dependency at intake (handled
  atomically — failure creates nothing); a token must be provisioned; only a
  single task endpoint is supported.

## Alternatives considered

- **MCP server (existing or custom)** — more than needed for one read endpoint;
  revisit when scope grows (status sync, comments, write-back).
- **Embed curl/HTTP in `/start-ticket`** — rejected: turns the command into a
  network wrapper, hard to test/maintain.

## Out of scope

Status sync, comment sync, ClickUp writes, task creation/closure, bidirectional
sync, and workflow-state mapping.
