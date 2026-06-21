# Project Agent Instructions

This project uses the Universal Development Loop from `opencode-dev-kit`.

## Universal Development Loop

Apply the same process for every task, scaled to the size and risk of the change:

1. `Intake`: clarify goal, constraints, success criteria, non-goals, and likely validation path.
2. `Evidence`: inspect source, tests, schemas, scripts, config, generated artifacts, and live command output before trusting prose.
3. `Baseline Proof`: reproduce or characterize current behavior before behavior changes when feasible.
4. `Small Slice`: choose the smallest reviewable change that proves value.
5. `Test First`: add or update a focused failing, acceptance, or characterization test before behavior-changing implementation unless infeasible.
6. `Implement`: make the smallest correct change without unrelated cleanup or speculative abstractions.
7. `Focused Validation`: run the nearest validation command first.
8. `Review Gate`: use relevant read-only reviewers only when risk justifies them.
9. `Final Validation`: broaden validation when boundaries, APIs, data, deployment, or compatibility are affected.
10. `Handoff`: for material/complex sessions, run `session-delivery-reviewer` with bundle: goal/constraints, transcript/summary plus compaction state, files/diffstat, validation, reviewer fixes, risks. Skip only for trivial/bounded work or unavailable inputs, and report why. Then report changed files, evidence, validation, residual risks, and ready-to-land status.
11. `Process Improvement`: capture current-session friction with `complain` in `docs/feedbacks/**`; convert accumulated patterns into helpers, validators, fixtures, reports, or templates.

## Project Adapter

- Keep project-specific commands in `opencode-dev-kit/adapter.json` or this repository's documented validation section.
- Technology choices change commands and constraints, not the development loop.
- If validation commands are unknown, discover them from project files and report `unknown` rather than guessing.

## Autonomy

- Continue autonomously when local evidence or a safe reversible default is enough.
- Ask the user only for real blockers: credentials, missing external systems, destructive or remote actions, owner/product/security/legal decisions, or MR/PR outcomes.
- Do not commit, push, merge, delete source artifacts, or alter remote state unless explicitly requested and allowed by repository policy.
- Preserve user and teammate changes. Never revert files you did not change unless explicitly requested.

## Process Control

- Keep clear small tasks direct and cheap.
- Use `implementation-worker` for bounded edit-mode implementation slices when the work has exact non-overlapping write scope, clear acceptance criteria, and a focused validation gate.
- When delegating to `implementation-worker`, pass `Mission`, `Read scope`, `Write scope`, `Forbidden`, `Verification`, and acceptance criteria.
- Keep implementation serial when `implementation-worker` is unavailable, scope is unclear, write targets overlap, or integration would cost more than doing the work directly.
- Use prompt-only orchestration only for broad work with independent bounded tracks where coordinated fan-out, fan-in, validation gates, or isolation is worth the overhead.
- Keep task tracking, integration, validation, reviewer gates, cleanup, and final synthesis in the main session.

## Quality

- Treat source, tests, schemas, scripts, generated artifacts, and live output as primary evidence.
- Keep TDD proportional: one smallest useful test or gate is enough unless risk requires more. If test-first work is infeasible, state why and name the closest substitute evidence.
- When Headroom MCP tools are available and a log, search result, JSON payload, validation output, or repeated tool output is likely to be reused and exceeds about 300 lines or 10 KB, call `headroom_compress`, keep the returned hash in working notes or final evidence when relevant, and call `headroom_retrieve` before exact claims.
- Do not use Headroom MCP for small outputs, exact code under active edit, short errors already visible, or safety-critical details that must be quoted exactly.
- Prefer deterministic helpers, validators, fixtures, or generated reports over repeated manual inspection.
- Reviewer agents are read-only leaf validators by default, except feedback-ledger appends under `docs/feedbacks/**` through `complain` when permission allows it.

## Feedback Ledger

- When current-session workflow friction, instruction conflict, tooling pain, missing automation, confusing handoff, validation noise, or reusable improvement opportunity appears, use the `complain` skill and append a structured entry to `docs/feedbacks/<agent-or-skill-name>.md`.
- Do not wait for proof that the issue is recurring. If recurrence is unknown, write `Recurrence: unknown`.
- OpenCode permissions enforce the feedback path boundary; `complain` is the required model contract for entry shape and privacy checks.
- Keep entries privacy-safe and focused on workflow/tooling/instructions, not personal blame. If writing is blocked, return a `Feedback Candidate`.
