# Architecture Decision Records (ADRs)

Append-only log of significant or hard-to-reverse decisions. Use
[`ADR-0000-template.md`](./ADR-0000-template.md) as the starting point and number
ADRs sequentially (`ADR-0001-...md`, `ADR-0002-...md`).

Rules:

- One decision per ADR; reference the originating ticket.
- ADRs are immutable once `accepted` — to change a decision, add a new ADR that
  supersedes the old one (mark the old one `superseded by ADR-<n>`).
- A ticket references its ADRs in the relevant stage artifact.

## Index

| ADR | Title | Status | Ticket |
|-----|-------|--------|--------|
| 001 | _(reserved — not yet written)_ | — | — |
| 002 | _(reserved — not yet written)_ | — | — |
| 003 | [Ticket state ownership](./ADR-003-ticket-state-ownership.md) | accepted | workflow-phase-5.95 |
| 005 | [ClickUp intake](./ADR-005-clickup-intake.md) | accepted | — |
| 006 | [Validation profiles](./ADR-006-validation-profiles.md) | accepted | — |
| 007 | [GitHub PR publish as a delivery-only surface](./ADR-007-github-pr-publish.md) | accepted | wf-004 |
| 008 | [Single git delivery boundary + next-step guidance](./ADR-008-delivery-commit-boundary.md) | accepted | wf-005 |
| 009 | [Elasticsearch PIT for listing pagination](./ADR-009-elasticsearch-pit-listing-pagination.md) | accepted | listing-pagination-no-dup-no-skip |
| 010 | [Price-filter Elasticsearch aggregations](./ADR-010-price-filter-aggregations.md) | accepted | price-filter-elastic-aggregations |
| 011 | [Single-owner workflow + comprehension gate](./ADR-011-single-workflow-form.md) | accepted | — (governance directive) |
| 012 | [Advisory AI review panel at /review](./ADR-012-advisory-review-panel.md) | accepted | — (governance directive) |
| 013 | [Deterministic gate notifications (Telegram hook)](./ADR-013-gate-notifications.md) | accepted | — (governance directive) |
| 014 | [Integration-aware, panel-seeded comprehension questions](./ADR-014-integration-aware-comprehension.md) | accepted | — (governance directive) |
| 015 | [Traceable open questions (`OQ-n`)](./ADR-015-traceable-open-questions.md) | accepted | — (governance directive) |

> Note: ADR-003 was assigned by the phase that created it; 001–002 are reserved
> for earlier decisions not yet retro-documented. ADR-008 extends (does not
> supersede) ADR-007. ADR-011/012/013 arrived from the upstream workflow template
> as ADR-009/010/011 and were renumbered here — those numbers were already taken
> by Trydos technical ADRs. ADR-011 supersedes the execution-mode / risk-tier /
> separation-of-duties model described in earlier ADRs and rules.
>
> ADR-014 **amends** ADR-012 (it adopts that ADR's rejected alternative #3,
> scoped to `major` findings) and ADR-011's question count (now a floor of 3, not
> a fixed 3); it supersedes neither. ADR-015 extends ADR-003 (an answer only
> exists once it is written into an artifact) and supersedes nothing.
