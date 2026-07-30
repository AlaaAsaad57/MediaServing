# Gate Media Uploads Behind Short-Lived Tickets

| Property | Value |
| --- | --- |
| Title | Gate Media Uploads Behind Short-Lived Tickets |
| Status | `draft` |
| Work Item Type | `Feature` |
| Backbone (module) | `Auth` |
| Actor | `Normal User`, `Seller`, `System` |
| Priority | `High` |
| Risk Level | `High` |
| Environment | `Development`, `Staging`, `Web` |
| Assignee | ⚠️ Yasser Omran (confirm) |
| Time Estimate (h) | ⚠️ 40 (estimate) |
| Sprint | — |
| User Story Relation | — |
| Business Value | Uploads can no longer be made anonymously, so the media service can go to production. |
| Dependencies | One migration task per uploading client; legacy-route cutover ticket (must land before launch). |
| Technical Notes | `POST /gated/ticket` mints; `/gated/upload`, `/gated/upload/bulk`, `/gated/upload/excel`, `/gated/chat/upload_file` spend it. Identity from the market gateway, tickets in the existing Redis. Legacy `/upload*` untouched. Client guide: `GATED_UPLOAD_MIGRATION.md`. |
| Questions | Which QA account is used for the "not allowed to upload" case? When is the legacy cutover? |

---

## User Story

As **a signed-in market user**,
I want to be able to **upload media through a permission tied to my own account**,
so that **only allowed accounts can upload and every stored file traces back to a person**.

Uploads were authorized by one shared key that the media service printed into public pages, so anyone could upload anything into any folder, anonymously. This ticket adds a protected upload family beside the existing one: the client exchanges the user's access token for a short-lived, single-use upload ticket, then spends it on exactly one upload request. In scope: the gated single / bulk / spreadsheet / chat-attachment routes, identity checks against the market gateway, per-account rate limits, and server-generated object names. Out of scope: migrating the clients and removing the old routes and the shared key — a separate cutover ticket.

---

# Acceptance Criteria

## Scope & Tenant Safety
1. The ticket is bound to the uploader's identity — account type **and** account id together.
2. The destination folder is fixed at mint time; the upload request cannot change it, and `..` or absolute paths are rejected.
3. Every gated upload stores the account type, account id, ticket id and upload time on the object; phone and email are never stored.

## Authorization
1. Minting requires the user's access token; the gateway must say the account may upload and its type must be a known one.
2. Bad token → `401`; disallowed account → `403`; gateway unreachable → one retry then "unavailable", never an allow.
3. The gated routes accept the ticket header only — the shared static key does not work on them.
4. Missing, expired, spent or mismatched ticket all return the same `403` with no sub-reason.

## General Behavior
1. Uploading is two calls: mint a ticket, then spend it on one request.
2. A ticket lives 120 seconds, checked when the upload starts, so a slow upload that began in time still completes.
3. A ticket is single-use and consumed atomically; a failed upload burns it and the retry starts from a new mint.
4. One ticket covers one request — a bulk upload of many files needs one ticket.
5. Bulk accepts images only; videos are reported as skipped and the rest still store.
6. Chat attachments have their own route, capped at 25 MB, returning a ready-to-send link.
7. The existing upload routes and all delivery links are unchanged.

## Validation & Constraints
1. Cap is 100 MB per upload (10 MB for stories); over that returns `413` and stores nothing.
2. The stored file name is generated randomly by the service and its type is read from the file's own bytes, never from the client's filename.
3. A bulk request must contain exactly the file count declared at mint time.
4. Rate limits are counted per account, and per token for minting.

## Behavior After Saving
1. The response keeps the existing shape: key, size, detected type and delivery link.
2. Video posters return immediately; heavier variants continue in the background.
3. Anything that is not a recognised safe image or video is delivered as a download, not rendered.

## UI & API Consistency
1. Every client uses the same mint-then-upload sequence and the limits it was told at mint time.
2. Errors are the same across all gated routes: `401`, `403`, `413`, `429`, `503`, with no backend or gateway wording leaked.

## Audit & Logging
1. Each gated upload logs account type, account id, ticket id, phone and email; placeholder contacts log as empty.
2. Refused mints and refused uploads are logged with their outcome.
3. Background video work carries the uploader identity onto the variants it writes.

---

# Test Cases

## Happy Path — Signed-in user uploads an image
**Given** a signed-in user allowed to upload,
**When** the client mints a ticket and immediately uploads a 3 MB image with it,
**Then** the file is stored in the folder named at mint time and the object carries the uploader's account type, account id and ticket id.

## Validation Error — File exceeds the size limit
**Given** a valid, freshly minted ticket,
**When** a file larger than 100 MB is uploaded,
**Then** the request is refused with `413`, nothing is stored, and the ticket is spent.

## Authorization Failure — Reused ticket
**Given** a ticket already spent on one upload,
**When** it is presented again,
**Then** the request is refused with `403` with no hint of whether it was expired, spent or wrong.

---

# QA Test Path (non-technical)

Scope of this run: **only the developer migration tasks that belong to this ticket** — one per app that uploads files. Ask the team for that task list plus a test account that is allowed to upload.

1. Open the migration task list for this ticket. **Expect:** one task per uploading app, each with an owner.
2. Open each task and check its status. **Expect:** the task is marked done and the developer has confirmed on it that the app now uses the new protected upload.
3. For each task marked done, sign in to that app with the test account and upload one normal photo where the app allows it. **Expect:** the photo uploads and is still there after a refresh.
4. In the same app, open a picture or video that existed before this change. **Expect:** it still displays exactly as before.
5. Record any task that is not yet done. **Expect:** you leave it as "not migrated yet" and do not test that app.

**Pass / fail:** passes when every migration task marked done also passes steps 3 and 4. If one fails, report the app, the task, the step number and what you saw instead.

---

```
Ticket Quality Checklist
- [x] Title is short and action-oriented (verb + object)
- [x] Status, Work Item Type, Backbone, Actor, Priority, Risk Level, Environment, Assignee, Time Estimate are filled
- [x] Every field value matches a label in the ClickUp field reference (no invented values)
- [x] Body contains all 3 sections: User Story, Acceptance Criteria, Test Cases
- [x] User Story uses As / I want / so that format with a real benefit
- [x] Summary paragraph includes scope, constraints, in/out of scope
- [x] Acceptance Criteria are grouped into named sub-sections
- [x] Every criterion is atomic and testable (yes/no)
- [x] Tenant safety is explicitly addressed
- [x] Authorization rules are clearly defined
- [x] Validation rules are clearly defined
- [x] Behavior After Saving is defined
- [x] UI & API consistency is defined
- [x] Audit & Logging rules are included
- [x] Test Cases cover: Happy Path, Validation Error, Authorization Failure
- [x] QA Test Path (non-technical) included with step-by-step, no-code instructions
- [x] No ambiguous words ("maybe", "etc.", "should probably")
- [ ] Related tickets referenced by ID (if applicable) — ⚠️ migration tasks and the cutover ticket have no IDs yet
```
