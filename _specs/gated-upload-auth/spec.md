---
ticket: gated-upload-auth
stage: spec
mode: standard          # single workflow form — no other modes (ADR-011)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-07-29
links:
  clickup:
  github:
---

# Spec — gated-upload-auth

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**

## Feature Name

Gated ticket-based upload authorization.

## Business Goal

Every upload today is authorized by one static key that the service prints into
public HTML pages, so anyone can upload any bytes into any folder, anonymously
and untraceably. That single fact blocks the service from going to production.

This ticket makes an upload prove **who** is asking. The caller presents its
market access token, the gateway says whether that account may upload, and the
service issues a short-lived, single-use, scoped permission for exactly one
upload request. Every stored object then carries the identity that put it there.
At the same time it closes the three defects that compound the problem: a folder
value that is trusted as given, an object type that is taken from the client's
filename, and one rate-limit budget shared by every caller.

The new behaviour ships **beside** the current routes, so no consumer breaks on
release day and the three of them migrate on their own schedule.

## User Story

> As a signed-in market user, I want each upload to be authorized by a
> short-lived permission tied to my identity, so that only accounts in good
> standing can upload and every stored object can be traced back to a person.

> As the operator of this service, I want the shared static key to stop being the
> only thing between the internet and the upload routes, so that the service can
> go to production.

## Functional Requirements

**Minting a permission**

- **FR-1** A caller presenting a market access token can request an upload
  permission. The service asks the gateway who owns that token and whether the
  account may upload. It never keeps its own copy of that answer between
  requests.
- **FR-2** A permission is minted only when **both** hold: the account's
  upload-allowed flag is one of the recognised true values (`true`, `1`, `"1"`,
  `"true"` — every other value, and a missing field, denies), **and** the account
  type is one of the five known types. Either one failing denies.
- **FR-3** Gateway outcomes map to: the gateway rejecting the token → the same
  rejection to the caller; the gateway failing → one retry, then a
  dependency-unavailable answer; a valid token whose account is refused → a
  forbidden answer from this service. The service never allows on error, never
  forwards the gateway's raw response, and never creates or assumes a guest when
  a token is rejected.
- **FR-4** The mint response carries the permission, its lifetime, and the
  maximum bytes the caller may send, so a client can reject an oversized file
  before sending it.
- **FR-5** The requested destination folder is validated at mint time and bound
  into the permission. A folder is a `/`-separated relative path of plain
  segments; `.`, `..`, leading or trailing separators, empty segments,
  backslashes, NUL, and any character outside letters, digits, dot, dash and
  underscore are rejected.

**The permission itself**

- **FR-6** A permission binds the account type, the account id, the folder, the
  maximum bytes, the file count, and its own unique identifier — nothing else.
  The account type and the account id always travel together as one identity.
- **FR-7** A permission is an opaque random value that the service stores
  server-side. It carries no readable claims and needs no signature.
- **FR-8** A permission is valid for 120 seconds. The deadline is checked once
  when the upload request arrives, before the body is read, and never re-checked
  while bytes are still arriving.
- **FR-9** A permission is single use. It is consumed atomically at the moment
  the upload request starts, so two concurrent requests can never both pass.
- **FR-10** The file count is the number of files in **one** request, not a
  number of redemptions. It defaults to 1 and is capped by the existing bulk file
  limit.
- **FR-11** There is no fallback permission store. When the store is unavailable,
  both minting and gated uploading answer dependency-unavailable.

**Uploading with a permission**

- **FR-12** The gated upload routes accept the permission as a request header
  only — never a cookie, and never the static API key.
- **FR-13** Every check this service performs — permission missing, expired,
  already used, folder or count mismatch — answers one uniform forbidden result
  with no sub-code. Exceeding the size limit is the single exception and answers
  a distinct too-large result.
- **FR-14** An upload streams to storage and is never held whole in memory. The
  size limit is 100 MB per request and is enforced as the bytes arrive, so an
  oversized upload is refused without being stored.
- **FR-15** The stored object's name is generated by the server from a
  cryptographically random value, and its extension and declared type come from
  the file's own leading bytes — never from the client's filename or declared
  type.
- **FR-16** Every object stored through a gated route carries the account type,
  the account id, the permission identifier and the upload time as object
  metadata. Account type and account id are both required — one without the other
  is not an identity.
- **FR-17** The upload log line carries the account type, account id, permission
  identifier, phone and email. Placeholder contacts are recorded as empty: a
  phone that is the literal `"0"` and any generated guest-domain email, as well
  as the genuine empty values the gateway returns.
- **FR-18** Phone and email are never written to object metadata and never
  travel in a background job.
- **FR-19** The background video job carries the account type, account id and
  permission identifier, and the worker stamps them on the variants it writes.
- **FR-20** The gated bulk route accepts images only. A video part is rejected
  per file, and a bad file is skipped and reported while the rest still store.
- **FR-21** The gated single-upload route supports story uploads, with the same
  story size cap, story variants and story response fields as the current route.
- **FR-22** The gated spreadsheet route returns the storage key only, with no
  public URL.
- **FR-23** Gated upload requests are rate-limited per identity pair, and mint
  requests are rate-limited per calling token. Neither shares a bucket with
  another account.

**Hardening the routes that run today**

- **FR-24** The folder guard (FR-5), the server-generated random object name and
  the byte-derived extension (FR-15) also apply to the existing upload routes.
- **FR-25** Content that is not a recognised safe image or video is served as a
  download rather than rendered inline, and a document-type file is never served
  inline on the media origin.
- **FR-26** The debug pages and the log-query proxy behind the statistics page
  are removed, along with the packaged helper whose only credential was the
  static key. After their removal the container image still builds and no
  packaged command points at a removed file.
- **FR-27** The cross-origin header allowlist accepts the permission header. The
  existing key header stays allowed while the legacy routes are still serving.
- **FR-28** The health endpoint reports whether the permission store is reachable
  without changing its own status code.

## Non-Functional Requirements

- **NFR-1** Memory use per upload does not grow with file size — a 100 MB upload
  costs no more resident memory than a small one.
- **NFR-2** A caller waits at most about four seconds for the identity answer:
  each attempt is bounded at two seconds and there is at most one retry.
- **NFR-3** The identity answer is never cached, so blocking an account or
  revoking a token takes effect on the very next request.
- **NFR-4** Failure answers give no probing oracle: a caller cannot tell an
  expired permission from a spent one, from a folder mismatch, from a denied
  account.
- **NFR-5** Nothing reaching a client names the backend technology or repeats the
  gateway's own error text.
- **NFR-6** Existing consumers of the current routes see no change in behaviour,
  request shape or response shape for the whole of this ticket.
- **NFR-7** The change is reversible: removing the new routes and reverting the
  hardening returns the service to its current behaviour, and no stored data is
  migrated or rewritten.
- **NFR-8** Rate limiting cannot be steered by a caller-supplied forwarding
  header.

## Constraints

- The gateway is the only identity authority; this service holds no user
  database and adds no permission matrix of its own.
- The account id is **not unique on its own** — the same number in different
  account types is a different person. Every record that names an uploader must
  key on the pair.
- The static key and the legacy upload routes stay live and unchanged for the
  whole of this ticket. Anonymous upload therefore remains possible until the
  separate cutover ticket lands, and that cutover must land before launch.
- The permission store is an existing runtime dependency of the service; no new
  data store is introduced.
- The identity call must not require a new third-party dependency.
- There is no test runner, linter or formatter in this repository, so acceptance
  is demonstrated by a parse check plus reproducible request-level checks.
- Runtime paths that the workflow marks protected may be changed only when the
  approved plan names them.

## Edge Cases

- The gateway returns a valid identity whose upload flag is the **string**
  `"false"` — a truthiness test would read that as permission. It must deny.
- The gateway adds a sixth account type later. It is unrecognised, so it is
  denied here until the known list is updated — a visible failure, deliberately.
- Sellers cannot obtain tokens yet and admins get rejected when the gateway's
  admin client is misconfigured. Both surface here as a plain rejection with no
  hint of the cause; both are gateway-side configuration.
- A permission is minted and the user never presses send: it simply expires.
- A slow upload is still sending bytes when 120 seconds have passed: it must
  succeed, because the deadline is a start deadline.
- Two requests present the same permission at the same instant: exactly one
  proceeds.
- An upload is exactly at the size limit (accepted) and one byte over (refused
  without being stored).
- A file whose leading bytes match nothing recognised: it stores, and it is
  served as a download rather than rendered.
- A bulk request where one file of fifty is bad: that one is reported and the
  other forty-nine still store.
- A background video job created by the delivery path carries no permission, so
  it has no attribution to stamp — it must still run.
- The permission store goes down between minting and uploading: the upload
  answers dependency-unavailable, and the health endpoint still answers.
- A video is uploaded that is longer than the old duration limit: it stores and
  plays. See OQ-7.

## Research Questions Resolved

> Required (SP-9). One row per `OQ-n` in `research.md` — none may be skipped.
> **Answered:** write the answer and where it lands (a requirement, an `AC-n`, a
> constraint, or Out of Scope). **Deferred:** the answer needs the approach, so
> `/plan` answers it (PL-12) — repeat it under Open Questions with the same ID.

| OQ | Answer | Lands in |
|------|--------|----------|
| OQ-1 | **Answered — out of scope.** The cutover (retiring the static key, the legacy upload routes and the public spreadsheet download) is a separate ticket, as `intake.md` records and the design's sequencing marks. This ticket delivers the hardening and the gated flow only, so it can be verified and closed without waiting on the three consumers. | Out of Scope; Constraints |
| OQ-2 | **Answered — in scope.** Removing the debug pages must not break the container image build. The requirement is stated as an outcome; the approved plan names the file that carries it, which is a protected path. | FR-26, AC-21 |
| OQ-3 | **Answered — in scope.** After the packaged helper is deleted, no packaged command may still point at it. | FR-26, AC-21 |
| OQ-4 | **Answered — out of scope.** The three guide documents are not updated in this ticket. They describe the legacy routes, which stay live and accurate until the cutover; the cutover ticket updates them. Consumers migrate against the design document in the meantime. | Out of Scope |
| OQ-5 | **Answered — both headers.** The permission header is **added** to the cross-origin allowlist; the existing key header is **not** removed while the legacy routes are still serving. Removing it now would break browser callers of routes this ticket deliberately keeps working. | FR-27, NFR-6, AC-22 |
| OQ-6 | **Deferred to `/plan`.** Whether the leading-byte check is written here or comes from a new dependency is an approach decision. The spec requires only that the stored type is derived from the bytes, and the constraint that the identity call adds no third-party dependency does not by itself settle this one. | Open Questions |
| OQ-7 | **Answered — the duration limit is dropped on the gated path.** Size is enforced as bytes stream (100 MB → too-large, nothing stored), which needs no buffering. Duration cannot be known without the whole file, so it is no longer a gate: an over-long video stores, plays, and gets its variants. The size cap becomes the only bound on video length. The existing routes keep their current duration check, since they are untouched. | FR-14, Edge Cases, AC-8 |
| OQ-8 | **Answered — in scope.** The gated single-upload route supports story uploads at parity with the current route: same story size cap, same story variants, same response fields. | FR-21, AC-16 |
| OQ-9 | **Deferred to `/plan`.** The spec requires atomic single-use consumption (FR-9); which store command achieves it, and what to do if the deployed store version lacks the direct one, is an approach decision. | FR-9; Open Questions |
| OQ-10 | **Answered — status code unchanged.** The health endpoint reports whether the permission store is reachable, but keeps returning success. It is the container's liveness probe, and a store outage must not cause a restart. Uploads fail on their own routes instead. | FR-28, AC-20 |
| OQ-11 | **Deferred to `/plan`.** The spec requires that a caller cannot steer its own rate-limit bucket through a forwarding header (NFR-8). The actual hop count depends on the deployment topology and is settled with the approach. | NFR-8; Open Questions |
| OQ-12 | **Answered — accepted, no replacement.** The statistics dashboard and its log-query proxy are removed with nothing built in their place. Log inspection moves to the existing log stack. | FR-26; Out of Scope |
| OQ-13 | **Answered — identical shapes.** The gated routes return the same response shapes as the routes they mirror, including the bare-path form used for the profile folder and the basename-only list returned by bulk. The spreadsheet route is the deliberate exception (FR-22). | FR-22, NFR-6, AC-17 |
| OQ-14 | **Answered in part.** Mint requests are bucketed per calling token and gated uploads per identity pair (FR-23); no gated caller may fall back to a shared bucket. **Deferred to `/plan`:** how a per-route bucket is expressed given the existing global rule. | FR-23; Open Questions |
| OQ-15 | **Answered — in scope, and first.** The folder guard, the random object name and the byte-derived extension are applied to the existing upload routes as well. This is the only part of the work that closes a real hole on the routes running today and it depends on nothing external. | FR-24, AC-18 |

## Open Questions

- **OQ-6** — is the leading-byte type check implemented within this codebase or
  taken from a new dependency? `/plan` decides and records it.
- **OQ-9** — which store command gives atomic single-use consumption, and what is
  the equivalent if the deployed store version does not offer it? `/plan` decides.
- **OQ-11** — what is the real number of trusted proxy hops in the deployment,
  and is narrowing it for every route (not only the new ones) accepted? `/plan`
  decides and records the value.
- **OQ-14** (remainder) — how is a per-route rate-limit bucket expressed
  alongside the existing global rule, so that no gated caller falls back to a
  shared bucket? `/plan` decides.

## Acceptance Criteria Mapping

> Give each criterion a stable ID (AC-1, AC-2, …); `verify.md` references these.

| ID | Acceptance criterion | Maps to requirement |
|------|----------------------|---------------------|
| AC-1 | A request with a valid token for an account whose upload flag is true and whose type is one of the five known types receives a permission, its lifetime, and the maximum bytes. | FR-1, FR-4 |
| AC-2 | A valid token whose upload flag is any value other than the four recognised true values — including the string `"false"`, a null, or a missing field — is refused with the forbidden result, and no permission is created. | FR-2 |
| AC-3 | A valid token whose account type is not one of the five known types is refused with the forbidden result. | FR-2 |
| AC-4 | A missing, malformed, expired or revoked token is answered as not signed in; a gateway failure is retried once and then answered as dependency-unavailable; neither ever results in a permission, a guest identity, or the gateway's own text reaching the caller. | FR-3, NFR-2, NFR-5 |
| AC-5 | A folder containing a traversal segment, a leading or trailing separator, an empty segment, a backslash, a NUL, or any character outside the permitted set is refused at mint time; a plain multi-segment relative path is accepted and bound to the permission. | FR-5, FR-6 |
| AC-6 | A permission presented more than 120 seconds after minting is refused; an upload that begins inside the window succeeds even though it is still sending bytes well past it. | FR-8 |
| AC-7 | The same permission presented twice succeeds exactly once; two requests presenting it simultaneously result in exactly one success and one forbidden result. | FR-9 |
| AC-8 | An upload of 100 MB is accepted and an upload over it is refused with the too-large result while nothing is stored; resident memory during a 100 MB upload does not grow with the file. | FR-14, NFR-1 |
| AC-9 | Every locally detected failure — permission missing, expired, spent, folder or count mismatch — returns the same forbidden result with no distinguishing detail; only the size failure differs. | FR-13, NFR-4 |
| AC-10 | A gated route rejects a request carrying the static API key and no permission, and rejects a permission sent as a cookie. | FR-12 |
| AC-11 | Bytes named as one type but whose leading bytes say another are stored with the extension and declared type taken from the bytes; the stored object name is server-generated and random, and two uploads in the same millisecond never collide. | FR-15 |
| AC-12 | Every object stored through a gated route carries account type, account id, permission identifier and upload time in its metadata, and carries no phone or email. | FR-16, FR-18 |
| AC-13 | The upload log line carries account type, account id, permission identifier, phone and email, with a `"0"` phone and a generated guest-domain email recorded as empty. | FR-17 |
| AC-14 | A video uploaded through a gated route produces a background job carrying the account type, account id and permission identifier, and the variants it writes carry the same attribution; a job created by the delivery path, which has no permission, still runs. | FR-19 |
| AC-15 | A gated bulk request containing a video part reports that part as rejected and stores the remaining image parts; one bad file among many does not fail the request. | FR-20 |
| AC-16 | A gated story upload applies the story size cap, produces the story variants, and returns the story fields exactly as the current route does. | FR-21 |
| AC-17 | Gated single and bulk responses match the shapes of the routes they mirror, including the bare-path form for the profile folder and the basename-only bulk list; the gated spreadsheet response contains the storage key and no public URL. | FR-22, OQ-13, NFR-6 |
| AC-18 | The existing upload routes reject a traversing folder, name stored objects with a server-generated random value, and derive the stored extension from the bytes — with their request and response shapes otherwise unchanged. | FR-24, NFR-6 |
| AC-19 | A stored file that is not a recognised safe image or video is served as a download, and a document-type file is never rendered inline on the media origin. | FR-25 |
| AC-20 | With the permission store unreachable, minting and gated uploading both answer dependency-unavailable, while the health endpoint still answers successfully and reports the store as unreachable. | FR-11, FR-28 |
| AC-21 | The debug pages, the log-query proxy and the key-carrying helper are gone; no page serves the static key to an unauthenticated visitor; the container image still builds and every packaged command still resolves. | FR-26 |
| AC-22 | A cross-origin request may send the permission header, and a cross-origin request to a legacy route may still send the key header. | FR-27, NFR-6 |
| AC-23 | Two accounts with the same id but different account types consume separate rate-limit budgets, and a caller cannot move itself to another bucket by supplying a forwarding header. | FR-23, NFR-8 |
| AC-24 | Every source file parses cleanly, and reverting this ticket's changes restores the current behaviour with no stored data migrated or rewritten. | NFR-7 |

## Out of Scope

- **The cutover** (OQ-1): retiring the static key, deleting the legacy upload
  routes, removing the public spreadsheet download, and rotating the key. That is
  a separate ticket, gated on the three consumers confirming they have migrated.
- **The guide documents** (OQ-4): they continue to describe the legacy routes,
  which remain live and accurate. The cutover ticket updates them.
- **A replacement statistics dashboard** (OQ-12): the page and its query proxy
  are removed with nothing built in their place.
- **Consumer changes**: the web, dashboard and mobile clients migrate in their
  own repositories on their own schedule.
- **A permission matrix**: the gateway's flag decides *who* may upload, never
  *what* they may upload. Any permitted caller may upload any file type into any
  valid folder.
- **Byte quotas and per-upload accounting**: the per-identity rate limit is the
  only bound. Accepted while the service is in development.
- **Backfilling attribution** onto objects uploaded before this ticket: the
  information does not exist anywhere.
- **Restricting the metrics endpoint and log access** at the network layer:
  operational items for launch, not code in this ticket.
- **The duration limit on the gated path** (OQ-7): no longer enforced; the size
  cap is the only bound on video length there.
