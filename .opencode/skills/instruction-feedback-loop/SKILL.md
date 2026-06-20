---
name: instruction-feedback-loop
description: Route reviewer Prevention Feedback into instant instruction edits, OpenSpec follow-ups, or unknown-root-cause investigations with ledger and replay gates.
license: MIT
---

# Instruction Feedback Loop

Use this skill when reviewer output includes one or more `Prevention Feedback` blocks and the main session must route them into durable prevention work.

Do not use this skill for ordinary code fixes without prevention feedback, stylistic nits, or P2/nit findings whose `Prevention Feedback` is `none`.

## Inputs

Each routed block needs:

- `Severity`: P0 or P1.
- `Likely Root Cause`: non-`unknown` for prevention edits; `unknown` routes to investigation.
- `Recurrence Path`: which existing instruction, skill, or agent should have prevented recurrence, and why it missed.
- `Prevention Target`: `AGENTS.md`, `skill:<name>`, `agent:<name>`, or `new-skill-required`.
- `Prevention Cost`: cheap, medium, or expensive; this is main-session judgment, not helper code.
- `Draft Rule`: proposed rule text for review.
- `Replay Evidence`: exact diff, fixture, command, or session context to replay after the rule lands.

## Routing Matrix

| Condition | Channel | Gate |
| --- | --- | --- |
| Root cause is `unknown` | Investigation OpenSpec change through `root-cause-analysis` then `openspec-propose` | investigation evidence before remediation |
| `Prevention Cost: cheap` and target is one `skill:<name>` or one `agent:<name>` | Instant edit | `instruction-artifact-reviewer` pre-edit gate plus replay gate |
| Target is `AGENTS.md`, any `instructions/*`, any `templates/*`, or `new-skill-required` | OpenSpec follow-up through `openspec-propose` | OpenSpec consistency and retro gates |
| Cost is medium or expensive | OpenSpec follow-up through `openspec-propose` | OpenSpec consistency and retro gates |

Instant edits are forbidden on global `AGENTS.md`, files under `instructions/`, and files under `templates/`. If a draft rule needs those surfaces, create an OpenSpec follow-up instead.

## Workflow

1. Normalize each P0/P1 prevention block into a ledger input record. Do not ask deterministic helper code to classify cost band, target quality, or rule quality.
2. Persist it with `npm run instruction:feedback -- --add <json-file>` or `npm run instruction:feedback -- --add-json '<json>'`. The helper performs schema validation, exact-match duplicate detection, and status-transition checks.
3. If the root cause is `unknown`, run `root-cause-analysis` and create an investigation follow-up with `openspec-propose`; leave the ledger entry open or backlog with a reason.
4. If the route is instant edit, run `instruction-artifact-reviewer` first with the target file, draft rule, recurrence path, and replay evidence. Block the edit if the reviewer reports conflict, broad scope, or missing replay signal.
5. Apply the smallest instruction edit to the single skill or agent file. For behavior-changing artifact automation, keep test-first evidence or a documented infeasibility note.
6. Replay the same evidence through the same reviewer agent in a fresh subagent invocation. Update the ledger to `applied -> replayed -> resolved` only when replay returns resolved. If replay is `still-failing`, open a new ledger entry against the applied rule.
7. Before final handoff for any session that produced prevention feedback, run `npm run instruction:feedback -- --pending` and account for each open entry in `Actionable Continuation Items` or generated OpenSpec follow-ups.

## Output

Return:

- `Routed Entries`: ledger id -> prevention target -> route -> status.
- `Instant Edits`: target file, reviewer gate result, replay result, and validation.
- `OpenSpec Follow-Ups`: change ids or proposed ids with root cause and prevention target.
- `Backlog Or Investigation`: entries blocked by unknown root cause, duplicate status, cross-repo ownership, or missing evidence.
- `Validation`: `instruction:feedback` commands, reviewer gates, OpenSpec gates, or skipped reason.
- `Residual Risks`: unresolved entries, weak replay evidence, conflict risks, or `none`.
