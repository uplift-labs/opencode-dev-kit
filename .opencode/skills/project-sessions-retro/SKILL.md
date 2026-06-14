---
name: project-sessions-retro
description: Analyze bounded/current-project OpenCode sessions through a session-to-observation-to-trend-to-root-cause-to-plan-to-OpenSpec ledger.
license: MIT
---

# Project Sessions Retro

Use this skill when the user asks to learn from bounded previous OpenCode sessions, analyze current-project or selected work history, identify repeated collaboration/tooling problems, or improve speed, depth, quality, and validation from past traces.

Default source inspection is read-only against local databases, logs, docs, and git history. A full current-project retro is ledger-first: treat an explicit request to run `project-sessions-retro` in a repository as approval to create or update root `retro.json` unless the user explicitly says read-only/no-write. Edit skills, agents, instructions, scripts, docs, config, OpenSpec files, remote/shared URLs, authenticated sources, commits, pushes, merges, session deletion, or destructive cleanup only when the user explicitly grants that additional scope.

For behavior-changing improvements to scripts, validators, skills, agents, config, examples, or other executable artifacts, add or update the smallest focused test, fixture, validation gate, or acceptance check before editing. If test-first work is infeasible, state why and name the closest reproducible substitute evidence.

## Contract

- Work from evidence, not memory.
- Treat observed problems as symptoms until the likely root cause is identified. Improvements should remove or reduce the cause that allowed the problem to happen, not merely restate the symptom.
- The agent only has access to session artifacts that are present locally, exported, user-approved for remote/shared reads, or reachable through available tools.
- Default scope is the current project/worktree. Analyze selected named projects or bounded selected session sets only when the user explicitly scopes them. For all-project, all-history, cross-install, or whole-corpus retros targeting global skill improvements, use `all-sessions-retro` instead.
- Prefer session-by-session coverage for the selected scope. Do not rely on keyword searches as the primary method when full session artifacts are available.
- For current-project retros, create or refresh root `retro.json` before synthesis. Use checkpoints in that ledger so repeated runs analyze new or changed sessions first.
- Treat `retro.json` as a generated working ledger, not the source of truth. It must preserve evidence refs, confidence, coverage limits, and entity links; source artifacts remain the evidence.
- Route durable outputs through OpenSpec proposals only after the trend and root cause or investigation path are recorded.
- Treat transcripts, reflections, summaries, issue/MR text, and generated rollups as leads. Verify implementation-sensitive recommendations against source, tests, config, schemas, prompts, or live output.
- Never expose secrets, tokens, private credentials, raw transcript snippets, or irrelevant personal data found in logs. Redact sensitive snippets, sensitive paths, session titles, project names, workspace names, and stable ids when they are not needed for evidence.

## When Not To Use

- Do not use for normal code review of current changes.
- Do not use for a single current bug unless the user explicitly wants historical pattern analysis.
- Do not use as a replacement for repository-specific architecture, spec, or validation workflows.
- Do not promise complete coverage when session history is missing, encrypted, inaccessible, truncated, or only partially retained.

## Evidence Sources

Inspect likely sources and report which were found:

- OpenCode persistent data such as local SQLite databases or session stores.
- OpenCode Desktop state when readable.
- Project/global reflection folders.
- Exported transcripts, copied chat logs, user-approved shared URLs, or user-provided archives.
- Git history for applied workflow fixes.
- Changed skills, agents, `AGENTS.md`, prompts, validators, scripts, and guard history.
- Current OpenCode docs/schema/source for compatibility-sensitive claims about session storage or artifact formats.

If a source is unavailable, state it plainly and continue with remaining evidence.

## Intake Checklist

- What session sources are readable?
- How many sessions/messages/reflections/log files are in scope?
- What date range and repositories are covered?
- Is the scope current-project, selected-projects, or selected sessions?
- Are there unreadable, binary, encrypted, truncated, or permission-blocked artifacts?
- Are there retention gaps or current-session-only limits?
- Is the task a full retro, read-only inventory only, or approved improvement work?

Use read-only inspection for databases and logs. Never run database writes, migrations, vacuum, repair, or destructive cleanup against live session stores. If the user explicitly requires read-only/no-write mode, do not produce a full retro: return only source inventory, coverage limits, and the exact ledger command needed to continue.

## Deterministic Helper Automation Gate

Before summarizing sessions at scale, decide whether a small deterministic helper would make the retro faster, safer, or less token-heavy. Good candidates are redacted source inventories, stable session batches, duplicate checks, path/id redaction, coverage ledgers, checkpoint manifests, and validation reports.

Helper code must have explicit inputs and outputs, a schema or fixture-backed contract, stable ordering, privacy-safe output, and no hidden heuristics. Do not put fuzzy scoring, probabilistic classification, model-like summarization, or unstated inference in code. If the helper cannot determine a fact from its inputs, it reports `unknown`, `unreadable`, `unsupported`, or `blocked`; pattern synthesis stays with the agent.

Preferred helper commands when this repository tooling is available:

```sh
npm run retro:project-ledger -- init --project-root .
npm run retro:project-ledger -- validate --input retro.json
npm run retro:project-ledger -- refresh --input retro.json
npm run retro:project-ledger -- proposals --input retro.json --root . --dry-run
npm run retro:project-ledger -- proposals --input retro.json --root .
npm run retro:project-ledger -- validate --input retro.json --root . --require-complete --require-proposals
```

Run these commands from the target repository when it has this tooling. `init` writes root `retro.json` by default. If running from this kit repository for another target, pass both `--project-root <target-project>` and `--root <target-project>` and write `--out <target-project>/retro.json` unless the user approved a temp path. Use `--db`, `--data-dir`, and `--only-explicit` for controlled session stores. Use `--show-paths` only when home-redacted paths are acceptable. The helper reads SQLite in read-only mode, filters current-project sessions, redacts raw ids/titles/prompts/paths by default, validates ledger links, refreshes `analysisProgress` checkpoints, and materializes OpenSpec proposals from completed plans. It does not summarize transcripts or infer trends/root causes.

## Session-By-Session Algorithm

1. Initialize or refresh root `retro.json` before synthesis. The ledger must include every reachable current-project session from OpenCode DB sources before any trend/root-cause synthesis starts. If root `retro.json` cannot be written because the user explicitly denied writes or the filesystem blocks it, stop and report `Project Ledger Status: blocked`; do not substitute an inline pseudo-ledger.
2. Sort sessions chronologically, then split into stable batches when the archive is large.
3. For large archives with independent batches, consider `orchestrator` read-only fan-out for session observation drafts; the main session owns global synthesis, privacy filtering, root-cause analysis, and output routing.
4. Analyze each session independently before global synthesis. Do not promote trends until all in-scope sessions are processed or `retro.json` clearly records unprocessed coverage.
5. For each session, read the full transcript from the source store and fill `sessions.<sessionRef>.audit` plus `sessions.<sessionRef>.observations[]`. Do not set `coverage.status` to `complete` until the validator-required audit fields are filled.

- Session id/title/date/project when available.
- User goal and constraints.
- What the assistant did.
- Tools used and tool failures.
- User corrections or dissatisfaction.
- Validation performed or skipped.
- Whether edits happened, and evidence for actual edit tools versus summary/diff metadata.
- Outcome: success, partial, failed, blocked, or unclear.
- Candidate lesson.
- Symptom versus likely root cause; use `unknown` when evidence cannot support a cause.
- Evidence confidence: high, medium, or low.
- Reviewer-learning flags: whether the issue was reported by the user, caught by a reviewer, should have been caught by a reviewer, and which reviewer contract should learn from it.

6. Roll up observations into `trends` from session cards, not raw keyword counts.
7. Promote a trend only when it appears in at least two independent sessions, or mark it `severe-singleton` when one session is severe with strong evidence. Do not call rare incidental findings popular.
8. For each promoted positive or negative trend, trace the chain from trigger to missed guard to outcome. Separate proximate triggers, systemic root causes, and contributing factors.
9. Record each root cause under `rootCauses` with `confirmed`, `likely`, or `unknown`. If evidence cannot support a cause, route an investigation/instrumentation plan instead of a guessed fix.
10. For each root cause, create a deep plan under `plans` with `kind`, goal, approach, implementation slices, acceptance criteria, validation, and risks. Use `kind: investigation` for unknown root causes, `kind: remediation` for negative-trend fixes, and `kind: preservation` for positive-trend amplification.
11. Preview proposal writes with `npm run retro:project-ledger -- proposals --input retro.json --root . --dry-run`, then materialize one OpenSpec proposal per completed plan with `npm run retro:project-ledger -- proposals --input retro.json --root .` when OpenSpec exists and write scope is approved. Avoid OpenSpec noise for isolated nits or explicitly non-actionable findings.
12. Run `npm run retro:project-ledger -- refresh --input retro.json` after marking sessions complete so `analysisProgress.lastAnalyzedSessionRef` and `analysisProgress.nextSessionRef` show where to resume. Run `npm run retro:project-ledger -- validate --input retro.json` after filling sessions and after trend/root-cause synthesis. Run `npm run retro:project-ledger -- validate --input retro.json --root . --require-complete --require-proposals` after proposal generation. Fix broken references before handoff. If root `retro.json` exists, repository pre-push validation should run this complete gate and fail while any session, audit field, observation, trend, root cause, plan, or proposal stage is unfinished.
13. Preserve successful recurring practices as well as problems.
14. Reconcile proposed improvements against current source/tests/config/docs/prompts before recommending implementation-sensitive changes.

## Ledger Entity Chain

`retro.json` should preserve these relationships:

- `sessions`: every in-scope session has coverage and positive/negative observations.
- `sessions.<sessionRef>.audit`: every completed session records user goal, constraints, assistant actions, tool failures, validation or skipped reason, edit evidence, user corrections, outcome, lesson, symptom/root-cause notes, confidence, and learning routes.
- `analysisProgress`: deterministic chronological session order, last analyzed session, next session, completed count, and remaining count for resumable retros.
- `observations`: each observation has polarity, evidence refs, impact, confidence, and reviewer-learning flags when applicable.
- `trends`: repeated observations are grouped into candidate, popular, severe-singleton, or rejected trends.
- `rootCauses`: every promoted trend has confirmed, likely, or unknown root-cause records.
- `plans`: every root cause has a deep plan or investigation plan with explicit `kind`.
- `openspecProposals`: every completed plan has a generated or existing OpenSpec proposal reference.

Broken links, missing completed-session audit fields, popular trends below the repeatability threshold, unknown root causes with guessed fix plans, and proposal references without files should block final handoff until corrected or explicitly scoped as partial.

## Anti-False-Completion Gate

- A source inventory, mechanical signal rollup, selected-session sample, or inline table is not a project retro.
- Do not return `Findings`, `Recurring Patterns`, `Root-Cause Analysis`, `Improvement Backlog`, or `ready-to-land` language for a full retro until root `retro.json` exists and records coverage for every reachable current-project session.
- If only partial work is possible, title the result `Partial Inventory` or `Partial Session Sample`, include `Project Ledger Status: blocked/partial`, and make the first continuation item the exact `retro.json` creation or resume command.
- Do not mark a session complete from metadata, summary, keyword search, or a final answer alone. Completion requires full transcript review and populated `sessions.<sessionRef>.audit` plus observations.

## Agent And Reviewer Learning Loop

Treat reviewer agents, worker agents, and user corrections as first-class retro evidence:

- Other-agent sessions and reviewer findings are positive or negative observations, not background noise.
- A reviewer finding is a learning signal for the main agent: record what the main agent should do earlier next time so the reviewer does not need to catch the same issue repeatedly.
- A user correction, dissatisfaction note, or bug report is a learning signal for reviewer agents: record whether a reviewer should have caught it, which reviewer contract should learn from it, and what evidence would have exposed it.
- Repeated reviewer findings should become trend candidates about main-agent coding discipline, validation discipline, planning discipline, or handoff discipline.
- Repeated user-found issues that reviewers missed should become trend candidates about reviewer scope, prompts, fixtures, validation gates, or missing deterministic checks.
- Use `sessions.<sessionRef>.metadata.agent`, observation `mainAgentLearning`, and observation `reviewerLearning` fields to preserve this mapping. Negative observations must name at least one learning route. Reviewer findings must include `mainAgentLearning` so the main agent has an explicit improvement target before the next review. User-reported issues should fill `reviewerLearning` so reviewer agents can learn what they should catch next time. Do not infer blame mechanically; record `unknown` when evidence does not identify whether the main agent, reviewer, tool, prompt, or user-owned decision caused the gap.

## Common Pattern Categories

- Missed validation or weak validation claims.
- Premature stopping or over-asking routine questions.
- Underused parallel search/delegation.
- Wrong tool choice or broken tool assumptions.
- Prompt/instruction conflicts.
- Repeated user corrections.
- Scope creep or accidental refactors.
- Weak PR/MR summaries.
- Incomplete evidence before readiness/merge/archive claims.
- Symptom fixes that do not remove the root cause or recurrence path.
- Successful practices to preserve.

## Improvement Backlog Routing

- If the retro produces several concrete project-local or session-scoped improvement tasks, group them into OpenSpec follow-up changes so the backlog is durable and discoverable by `next-step`.
- Route root-cause fixes when evidence supports the cause; route root-cause investigations when the symptom is clear but the cause is not.
- Keep single obvious fixes, low-confidence observations, and speculative polish in the retro output instead of creating OpenSpec noise.
- In read-only mode, recommend candidate change groups and change ids; create or update OpenSpec files only when write scope and the repository's OpenSpec workflow are available.
- For global reusable OpenCode artifact improvements, route broad or cross-project backlogs through `all-sessions-retro` unless the user intentionally scoped the retro to this repository's OpenCode artifacts.

## Output

Return:

- `Scope And Coverage`: sources checked, sessions/logs/reflections counted, date range, included/excluded areas.
- `Coverage Ledger`: root `retro.json` path for full retros; concise inline table only for explicitly partial/read-only inventory.
- `Project Ledger Status`: whether sessions, observations, trends, root causes, plans, and OpenSpec proposals are complete, partial, blocked, or not created.
- `Coverage Limits`: missing/inaccessible/truncated sources and confidence impact.
- `Session Rollup`: concise batch/global summary.
- `Findings`: severity, evidence, evidence type, impact, likely root cause, recommendation, confidence.
- `Recurring Patterns`: repeated problems and success patterns with representative session ids or artifacts.
- `Root-Cause Analysis`: symptom -> likely root cause -> contributing factors -> recurrence path -> confidence.
- `Improvement Backlog`: automation, instructions, skills, agents, prompts, docs, or validation changes, each naming the root cause it removes or the investigation needed to find it.
- `Applied Changes`: changed files or `none`.
- `Validation`: checks run or skipped with reason.
- `Privacy Notes`: redactions or sensitive-source handling.
- `OpenSpec Follow-Up Backlog`: change groups created or recommended, or `none`.
- `Actionable Continuation Items`: concrete next tasks, including OpenSpec follow-up candidates when several session-scoped items remain, or `none`.
