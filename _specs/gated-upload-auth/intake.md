---
ticket: gated-upload-auth
stage: intake
mode: standard          # single workflow form — no other modes (ADR-011)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-07-29
links:
  clickup:
  github:
---

# Intake — gated-upload-auth

> First stage. Qualify the request only. **No technical planning allowed.**

## Ticket Reference

`gated-upload-auth` — source document: `2026-07-29-media-upload-authorization-design.md`
(in this repository). Gateway contract it depends on: `GO-ME-API-CONTRACT.md`
(same repository). No ClickUp task or GitHub issue is linked.

## Ticket Summary

Today every upload is authorized by one static `API_KEY` that is printed into
public HTML pages, so anyone can upload any bytes into any folder anonymously.
The request is to add a two-stage upload flow: the caller proves who it is with
its market access token, gets a short-lived single-use scoped ticket, and that
ticket is the only thing that authorizes the upload. The new routes ship beside
the current ones under a `/gated/*` prefix, together with the hardening the same
document specifies (folder validation, server-generated keys from sniffed bytes,
safe content disposition, removal of the debug pages, per-user rate limits and
upload attribution).

The design document records the decisions as agreed (D1–D30) and states nothing
is open. Its §8 sequencing marks step 4 — the cutover that deletes `API_KEY`,
the legacy upload routes and `GET /file/upload/*` — as `SEPERATE-TASK`, so this
ticket is intended to cover steps 1 and 2 only.

## Ticket Metadata

- id / slug: `gated-upload-auth`
- title: Gated ticket-based upload authorization
- owner: developer
- created: 2026-07-29
- links: none (design doc and gateway contract are files in this repository)

## User Story

> As a signed-in market user, I want to upload media with a short-lived ticket
> that is tied to my identity, so that every upload is authorized per person and
> stays attributable — instead of being authorized by one shared static key that
> anyone can read from a public page.

A second reader matters here: as the operator of this service, I want the shared
`API_KEY` to stop being the only thing standing between the internet and the
upload routes, so that the service can go to production.

## Acceptance Criteria Presence Check

- Present? **no**
- Notes: the source document records agreed *decisions* (D1–D30) and their
  rationale, not acceptance criteria. It is a design, not a spec. Writing
  testable `AC-n` criteria is the `/spec` stage's job, and the decisions give it
  enough material to work from — each one states an observable behaviour (for
  example D6's status-code mapping, D7's single 403, D10's 100 MB → 413, D13's
  single use, D16's 120 s start deadline). Their absence here is expected at
  intake and does not block the ticket.

## Test Cases Presence Check

- Present? **no**
- Notes: same reason — test cases follow the acceptance criteria at `/spec`.
  Worth flagging for later stages: this repository has **no test runner, linter
  or formatter** (`CLAUDE.md`), so verification will have to rely on commands
  that already exist plus manual request-level checks. `/research` should list
  what is actually available; `/spec` should not assume a test framework.

## Missing Information

- **The ticket boundary must be confirmed.** The design's §8 sequencing marks
  step 4 — the cutover that deletes `API_KEY`, the legacy upload routes and
  `GET /file/upload/*` — as `SEPERATE-TASK`, and its §5 note says the same three
  "then, at the cutover" items are the natural seam for a second ticket. This
  ticket is therefore taken as steps 1–2 only (hardening + debug-page removal,
  then the ticket service and the `/gated/*` routes). Everything the cutover
  covers is out of scope and must be stated as such at `/spec`.
- Nothing else is missing. The design states all decisions are agreed with
  nothing open, and the gateway it depends on is delivered, live, and has an
  agreed contract in this repository (`GO-ME-API-CONTRACT.md`) — so the ticket is
  not waiting on another team.

## Readiness Status

`READY`

- Justification: the request has a clear goal, a named source document whose
  decisions are all agreed, and a live dependency with a written contract. The
  scope boundary is stated above (steps 1–2; the cutover is a separate ticket),
  so what "done" covers is bounded even before `/spec` writes the criteria.
  Missing acceptance criteria and test cases are not a readiness problem — they
  are the deliverables of the `spec` stage, which comes next.
- Set by: the ticket owner, on the instruction to fill the intake (2026-07-29).
  If the scope boundary above is wrong — that is, if the cutover belongs in this
  ticket after all — correct it here before `/research`, because it changes what
  the acceptance criteria may claim.
