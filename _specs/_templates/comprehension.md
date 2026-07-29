---
ticket: <ticket-id>
stage: <review | verify>   # the gate that last updated this record
mode: standard          # single workflow form — no other modes (ADR-011)
status: complete        # not_started | in_progress | complete
owner: developer        # the ticket owner (self-review)
updated: <YYYY-MM-DD>
result: <passed | failed>  # quiz outcome — were ALL answers correct? (CG-4)
score: <n/n>               # correct / total, e.g. 3/3
decision: <APPROVED | CHANGES_REQUESTED | REJECTED | PASSED | FAILED | none>  # gate decision; `none` when the quiz failed (the notification hook reads these — ADR-013)
missed:                    # on a failed quiz: the missed questions + axis, e.g. `Q3 (integration), Q4 (rollback)`; empty when passed
links:
  clickup:
  github:
---

# Comprehension — <ticket>

> Single-owner gate control (ADR-011 / ADR-014 / CG-1..CG-6). At each gate the
> owner answers multiple-choice questions (**≥4 options each**) generated **from
> the artifact under review**. One section per gate — never overwrite another
> gate's section. The gate records its decision **only if 100% of answers are
> correct** (CG-4); any wrong answer blocks it. Each question's options are listed
> **alphabetically** — the correct answer's position must carry no signal.
>
> **English only.** Questions, options, answers, and every other word in this file
> are written in English — whatever language the conversation used (CLAUDE.md).
>
> **Three rows is the floor, not the form** (CG-1): add rows freely. Every gate
> carries **≥1 integration / cross-flow question** (CG-5), and `/review` adds
> **one row per `major` panel finding** on top of the floor (CG-6).

## Review gate

> Questions derived from `plan.md` + `spec.md` (CG-2), incl. `plan.md >
> Integration surface` and the Step 1a panel findings. Answered before recording
> the `/review` decision.

| # | Question (from the artifact) | Source (plan §/AC-n/panel:lens) | Axis | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|------|---------------------------------|----------------|----------|
| 1 |                              |                                 |      |                                 |                |          |
| 2 |                              |                                 |      |                                 |                |          |
| 3 |                              |                                 | integration (CG-5) |                     |                |          |

<!-- add a row per extra question; one per `major` panel finding (CG-6) -->

- Score (optional, only if `comprehension_gates.ai_graded`): <0.0–1.0, or n/a>

## Verify gate

> Questions derived from `implement.md` + `spec.md` (CG-2), incl. whether the
> plan's declared Integration surface held. Answered before recording PASSED at
> `/verify`. No panel here (ADR-012) — CG-6 does not apply.

| # | Question (from the artifact) | Source (implement.md/AC-n/plan §) | Axis | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|-----------------------------------|------|---------------------------------|----------------|----------|
| 1 |                              |                                   |      |                                 |                |          |
| 2 |                              |                                   |      |                                 |                |          |
| 3 |                              |                                   | integration (CG-5) |                   |                |          |

<!-- add a row per extra question -->

- Score (optional, only if `comprehension_gates.ai_graded`): <0.0–1.0, or n/a>
