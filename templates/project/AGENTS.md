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
11. `Process Improvement`: convert repeated friction into helpers, validators, fixtures, reports, or templates.

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
- Use prompt-only orchestration only for broad work with independent bounded tracks where coordinated fan-out, fan-in, validation gates, or isolation is worth the overhead.
- Keep task tracking, integration, validation, reviewer gates, cleanup, and final synthesis in the main session.

## Quality

- Treat source, tests, schemas, scripts, generated artifacts, and live output as primary evidence.
- Keep TDD proportional: one smallest useful test or gate is enough unless risk requires more. If test-first work is infeasible, state why and name the closest substitute evidence.
- When Headroom MCP tools are available and a log, search result, JSON payload, validation output, or repeated tool output is likely to be reused and exceeds about 300 lines or 10 KB, call `headroom_compress`, keep the returned hash in working notes or final evidence when relevant, and call `headroom_retrieve` before exact claims.
- Do not use Headroom MCP for small outputs, exact code under active edit, short errors already visible, or safety-critical details that must be quoted exactly.
- Prefer deterministic helpers, validators, fixtures, or generated reports over repeated manual inspection.
- Reviewer agents are read-only leaf validators by default.

## Self-Improving Instruction Loop

- If reviewer output includes `Prevention Feedback`, route it to exactly one channel: cheap single skill/agent instant edit, OpenSpec follow-up, or unknown-root-cause investigation.
- Do not instantly edit global `AGENTS.md`, `instructions/`, `templates/`, `new-skill-required`, medium/expensive feedback, unknown root cause, or cross-repo artifacts.
- Instant prevention edits require a ledger entry, `instruction-artifact-reviewer` before edit, replay of the same evidence after edit, and closure only after `applied -> replayed -> resolved`.
- Deterministic helpers must not classify cost bands or draft rules; they persist evidence, deduplicate exact matches, enforce transitions, and report `unknown` or `blocked`.
