# Repository Maintainer Instructions

This file (`REPO_AGENTS.md`) holds contributor-facing maintenance rules for the `opencode-dev-kit` library. It is not the runtime instruction file; OpenCode loads the runtime instructions from `global/AGENTS.md` once `OPENCODE_CONFIG_DIR` points at `global/`. The two files serve different audiences and live under different filenames by design.

This repository stores reusable OpenCode skills, subagents, and instruction templates.

- Keep artifacts project-neutral: do not hardcode repository names, company-internal paths, issue trackers, services, hardware, or validation commands unless the artifact is explicitly scoped to that ecosystem.
- Prefer evidence-backed workflow contracts over reminders. If a check can be automated, document the command shape or validation hook instead of adding vague prose.
- For retros, audits, reviewer gates, and follow-up backlogs, distinguish symptoms from likely root causes. Prefer fixes that remove or reduce the recurrence path; when evidence cannot identify the cause, route an investigation or instrumentation task instead of guessing.
- For behavior-changing implementation work in skills, agents, templates, tools, or examples, default to TDD: add or update the focused failing test, acceptance check, fixture, or validation scenario before implementation; if infeasible, state why and use the closest reproducible evidence.
- Keep TDD proportional: one smallest useful test/gate for the scoped behavior is enough; do not expand into unrelated coverage, broad suites, or speculative tests unless risk evidence warrants it.
- Skills and agents must be safe to reuse in unrelated repositories. Use placeholders such as `<project>`, `<change>`, `<service>`, `<legacy-source>`, and `<validation-command>` where local projects differ.
- Reviewer agents are leaf validators by default: read-only except feedback-ledger appends under `docs/feedbacks/**`, no source/config/instruction edits, no commits, no pushes, no nested agents, no user questions.
- Keep each artifact cohesive. Split artifacts when triggers, permissions, or output contracts differ materially.
- Preserve OpenCode compatibility: skill folders must match `name` in `SKILL.md`; agent files must use valid frontmatter and least-privilege permissions.

## TypeScript Development

- Use TypeScript for all repository automation and implementation code.
- Do not add or keep PowerShell, Python, or JavaScript source/tooling files; rewrite any such code to TypeScript instead.
- Run library tooling through `npm run validate`, `npm test`, and `npm run install:global -- ...`; do not introduce `.ps1`, `.py`, or `.js` entrypoints.
- JSON, Markdown, YAML, and other config/data files are allowed when they are not implementation code.

## Deterministic Helper Automation

- For repetitive, evidence-heavy, or token-heavy work, first consider whether a small deterministic helper could gather, count, validate, redact, diff, inventory, or enforce explicit rules more efficiently than manual inspection.
- When writing helper code for agent workflow, make it deterministic and contract-driven: explicit inputs, explicit outputs, schemas or fixtures, stable ordering, and privacy-safe output.
- Helper code must have no hidden heuristics: do not encode fuzzy scoring, probabilistic classification, model-like summarization, or unstated inference as evidence.
- If deterministic helper code cannot answer something from its inputs, report `unknown`, `unreadable`, `unsupported`, or `blocked` instead of guessing.
- Keep judgment-heavy synthesis in the agent/reviewer layer; use helper code to gather, count, validate, redact, diff, inventory, or enforce explicit rules.
- Deterministic helper output may support root-cause analysis with evidence and missing-data signals, but root-cause judgment remains in the agent/reviewer layer.

## Feedback Ledger

- When current-session workflow friction, instruction conflict, tooling pain, missing automation, confusing handoff, validation noise, or reusable improvement opportunity appears, use the `complain` skill and append a structured entry to `docs/feedbacks/<agent-or-skill-name>.md`.
- Do not wait for proof that the issue is recurring. If recurrence is unknown, write `Recurrence: unknown`; prefer a compact useful signal over suppressing feedback.
- Keep entries privacy-safe and focused on workflow/tooling/instructions, not personal blame. Do not include secrets, raw private prompts, or large logs.
- Reviewer agents may edit only `docs/feedbacks/**` for feedback entries; they remain read-only for source, config, instructions, specs, and task artifacts.
- OpenCode permissions enforce the feedback path boundary; `complain` is the required model contract for entry shape and privacy checks, not a hard semantic enforcement layer.
- Prevention entries that use `npm run instruction:feedback -- --add ...` close only after `applied -> replayed -> resolved`; if replay is `still-failing`, reopen and route the applied rule as a new finding.
- If explicit read-only/no-edit mode or permissions block writing, return a `Feedback Candidate` for the main session instead of dropping the signal.

## Token Efficiency

- Keep responses compact by default: outcome, changed files, validation, blockers, and only necessary rationale.
- Remove filler and repeated caveats from responses, but preserve exact commands, paths, errors, code, safety warnings, and user-facing decisions.
- Prefer targeted searches, symbols, and bounded file reads over broad file or log dumps.
- On native Windows, `rtk` filters work only when invoked explicitly; use `rtk <command>` for shell-heavy read-only commands instead of relying on hook auto-rewrite.
- When Headroom MCP tools are available and a log, search result, JSON payload, validation output, or repeated tool output is likely to be reused and exceeds about 300 lines or 10 KB, call `headroom_compress`, keep the returned hash in working notes or final evidence when relevant, and call `headroom_retrieve` before exact claims.
- Do not use Headroom MCP for small outputs, exact code under active edit, short errors already visible, or safety-critical details that must be quoted exactly.
- For validation output, report summaries and failures first; read full saved tool output only when the preview lacks the cause.
- Preserve exact code, commands, paths, errors, protocol terms, and safety warnings; do not compress away meaning.

## Autonomous Work Contract

- The main session owns skill selection, decomposition, validation, reviewer gates, MR/PR-ready handoff, and final synthesis.
- Ask the user only for real blockers: scope or risk decisions, credentials/provider access, missing owner/product/security/legal decisions, destructive operations, remote-state actions, and MR/PR review outcomes.
- Continue autonomously when local evidence, repository policy, or a safe reversible default is enough; do not ask routine preference or progress questions.
- Subagents and read-only reviewer gates never ask the user directly; they return `Actionable Continuation Items` or `Suggested Next Options` for the main session.
- Before final handoff for material/complex sessions, run `session-delivery-reviewer` with bundle: goal/constraints, transcript/summary plus compaction state, files/diffstat, validation, reviewer fixes, risks; skip only for trivial/bounded work or unavailable inputs, and report why.
- Treat session-delivery-reviewer blocking output as binding: if it returns `Blocking for Acceptance: yes`, `Verdict: blocked`, any `P0 blocker`, or non-empty `Required Next Actions`, do not present the session as complete or ready-to-land. Continue autonomous work when safe, or ask/escalate only the exact user-owned blocker; partial slice handoff must not end an unfinished root goal.

## Delegation ROI

- Use `implementation-worker` for bounded edit-mode implementation slices when the work has exact non-overlapping write scope, clear acceptance criteria, and a focused validation gate.
- When delegating to `implementation-worker`, pass `Mission`, `Read scope`, `Write scope`, `Forbidden`, `Verification`, and acceptance criteria.
- Keep implementation serial when `implementation-worker` is unavailable, scope is unclear, write targets overlap, or integration would cost more than doing the work directly.
- The main session owns decomposition, worker prompts, integration, validation, reviewer gates, and final synthesis; workers return reports and never ask the user directly.

## Completion Handoff

- When a real blocker or user-owned decision remains, the main session offers 2-4 self-contained next actions via `question` when available.
- Put the recommended option first and end its label with `(Recommended)`.
- In read-only, no-question, reviewer-agent, or subagent contexts, do not ask the user directly; return `Suggested Next Options` or `Actionable Continuation Items` for the main session instead.
- When an audit, retro, reviewer gate, broad discovery, or validation failure produces several concrete tasks related to the current session but outside its approved scope, prefer grouping them into OpenSpec follow-up changes when the repository already uses OpenSpec or the user approved adding it; otherwise return grouped candidates instead of leaving a loose final-message backlog. Do not create OpenSpec ceremony for isolated nits, speculative polish, or one obvious next step.
- If the user selects an actionable option, continue immediately in the current context instead of asking them to restate the task.
- If no real blocker remains, report the completed work, validation, residual risks, and ready-to-land status without an interactive handoff.

After changing skills or agents, review `README.md` and the relevant artifact frontmatter so the library remains discoverable.
