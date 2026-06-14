---
name: project-sessions-retro
description: Analyze bounded/current-project OpenCode sessions with phase-routed skills, orchestrated batches, token-efficiency review, and root-cause-backed ledger improvements.
license: MIT
---

# Project Sessions Retro

Use this skill when the user asks to learn from bounded previous OpenCode sessions, analyze current-project or selected work history, identify repeated collaboration/tooling problems, or improve speed, depth, quality, and validation from past traces.

Default source inspection is read-only against local databases, logs, docs, and git history. A full current-project retro is ledger-first: treat an explicit request to run `project-sessions-retro` in a repository as user approval to write a redacted generated ledger at root `retro/` unless the user explicitly says read-only/no-write. Edit skills, agents, instructions, scripts, docs, config, OpenSpec files, remote/shared URLs, authenticated sources, commits, pushes, merges, session deletion, or destructive cleanup only when the user explicitly grants that additional scope.

For behavior-changing improvements to scripts, validators, skills, agents, config, examples, or other executable artifacts, add or update the smallest focused test, fixture, validation gate, or acceptance check before editing. If test-first work is infeasible, state why and name the closest reproducible substitute evidence.

## Contract

- Work from evidence, not memory.
- Treat observed problems as symptoms until the likely root cause is identified. Improvements should remove or reduce the cause that allowed the problem to happen, not merely restate the symptom.
- Treat time, token use, and tool-chain efficiency as first-class retro dimensions alongside quality, validation, and collaboration. Look for avoidable token spend, slow operation chains, redundant reads/searches, missed parallelization, missed deterministic helpers, over-delegation, under-delegation, unnecessary summaries/plans/questions, repeated failed commands, and manual work that a safer faster command could have replaced.
- For each efficiency issue, evaluate whether the same or better quality could have been achieved faster or with fewer tokens. Prefer fixes that improve quality, speed, and token economy together; do not recommend shortcuts that weaken evidence, validation, safety, or user outcomes.
- The agent only has access to session artifacts that are present locally, exported, user-approved for remote/shared reads, or reachable through available tools.
- Default scope is the current project/worktree. Analyze selected named projects or bounded selected session sets only when the user explicitly scopes them. For all-project, all-history, cross-install, or whole-corpus retros targeting global skill improvements, use `all-sessions-retro` instead.
- Prefer session-by-session coverage for the selected scope. Do not rely on keyword searches as the primary method when full session artifacts are available.
- For current-project retros, create root `retro/` before synthesis. Use `status` and `refresh` checkpoints in that ledger so repeated runs resume at the next incomplete session instead of restarting.
- When a full current-project retro has many sessions, do not ask whether to process in batches. Treat batching, resumable checkpoints, orchestrator-guided parallel worker batches, and read-only fan-out as required execution mechanics unless the user explicitly says read-only, no-batch, no-orchestrator, or stop.
- Do not stop after a successful batch during a full retro. A successful batch is only a checkpoint; immediately run `status`, dispatch the next parallel worker batches, and continue until every in-scope session is complete or a real blocker appears. User-visible partial handoff is allowed only for explicit read-only/no-write mode, explicit stop/no-batch/no-orchestrator constraints, unavailable required local sources/tooling, permission/filesystem blockers, or hard context/tool limits. A small completed sample is not a blocker.
- Treat `retro/` as a generated working ledger, not the source of truth. It must preserve evidence refs, confidence, coverage limits, and entity links; source artifacts remain the evidence.
- Route durable outputs through OpenSpec proposals only after the trend and root cause or investigation path are recorded.
- Treat transcripts, reflections, summaries, issue/MR text, and generated rollups as leads. Verify implementation-sensitive recommendations against source, tests, config, schemas, prompts, or live output.
- Never expose secrets, tokens, private credentials, raw transcript snippets, or irrelevant personal data found in logs. Redact sensitive snippets, sensitive paths, session titles, project names, workspace names, and stable ids when they are not needed for evidence.

## Phase Skill Routing

For full current-project retros, use phase-specific skills, agents, and helpers by default unless the user explicitly sets read-only/no-write/no-orchestrator/no-agent constraints, the artifact is unavailable, or the phase is not reached. Do not preload every skill at startup; load each one when its phase begins so context stays focused.

| Retro phase | Default route | Purpose |
| --- | --- | --- |
| Scope and source inventory | `project-sessions-retro` plus `retro:project-ledger init/status`; route all-history/cross-install scope to `all-sessions-retro` | Establish readable evidence, generated root `retro/`, coverage counts, and resume point. |
| Batch decomposition | `orchestrator` | Split large archives into bounded read-only worker batches, reconcile reports, and keep the main session as sole ledger writer. |
| Per-session observation | `session-observation-worker` through `task`; optional `qwen-local-worker` for cheap first-pass extraction when configured | Review full transcript JSON per session, draft sanitized audits/observations, and surface efficiency signals without global synthesis. |
| Trend synthesis | `project-sessions-retro` main session | Promote repeated or severe-singleton observations only after coverage is complete or explicitly partial. |
| Root-cause analysis | `root-cause-analysis` | Convert promoted trends into confirmed/likely/unknown causes with recurrence paths and investigation routes. |
| Plan design | `deep-task-planning` | Turn each root cause into remediation, preservation, or investigation plans with slices, acceptance criteria, validation, risks, and stop lines. |
| OpenSpec follow-up routing | `openspec-propose` plus `retro:project-ledger proposals` | Group durable follow-ups and materialize proposal files only after root causes and plans are recorded. |
| Instruction artifact changes | `instruction-artifact-tuning`; post-change `instruction-artifact-reviewer` | Tune skills, agents, prompts, README routing, or instruction templates and review discoverability/safety. |
| Code/test/tooling changes | Relevant domain skill plus `code-quality-audit`, `code-quality-reviewer`, or `test-coverage-reviewer` when material | Keep implementation fixes test-first and reviewer-gated when retro follow-ups change executable behavior. |
| Final delivery control | `session-delivery-reviewer` | Check goal alignment, proportional rigor, coverage, validation, reviewer handling, residual risks, and handoff readiness. |

If a routed skill or agent is unavailable, use the closest installed contract, record the missing artifact as a residual risk or continuation item, and lower confidence instead of blocking solely on availability.

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
- Which sessions show evidence of high tool counts, repeated reads/searches, long serial chains, avoidable transcript dumps, oversized context, missed batching/parallelization, missed helper usage, or slow validation loops?
- Where is there a faster equivalent path that would preserve or improve quality, evidence, safety, and validation?

Use read-only inspection for databases and logs. Never run database writes, migrations, vacuum, repair, or destructive cleanup against live session stores. If the user explicitly requires read-only/no-write mode, do not produce a full retro: return only source inventory, coverage limits, and the exact ledger command needed to continue.

## Deterministic Helper Automation Gate

Before summarizing sessions at scale, decide whether a small deterministic helper would make the retro faster, safer, or less token-heavy. Good candidates are redacted source inventories, stable session batches, duplicate checks, path/id redaction, coverage ledgers, checkpoint manifests, and validation reports.

Helper code must have explicit inputs and outputs, a schema or fixture-backed contract, stable ordering, privacy-safe output, and no hidden heuristics. Do not put fuzzy scoring, probabilistic classification, model-like summarization, or unstated inference in code. If the helper cannot determine a fact from its inputs, it reports `unknown`, `unreadable`, `unsupported`, or `blocked`; pattern synthesis stays with the agent.

Preferred helper commands when this repository tooling is available:

```sh
npm run retro:project-ledger -- init --project-root .
npm run retro:project-ledger -- status --input retro --limit 50 --format json
npm run retro:project-ledger -- transcript --input retro --session <session-ref> --include-content --format json --out <repo-local-ignored-scratch-transcript.json> --overwrite
npm run retro:project-ledger -- patch-sessions --input retro --patch <batch-audit.json>
npm run retro:project-ledger -- validate --input retro
npm run retro:project-ledger -- refresh --input retro
npm run retro:project-ledger -- proposals --input retro --root . --dry-run
npm run retro:project-ledger -- proposals --input retro --root .
npm run retro:project-ledger -- validate --input retro --root . --require-complete --require-proposals
npm run retro:project-ledger -- split --input retro.json --out retro
npm run retro:project-ledger -- assemble --input retro --out assembled-retro.json
```

Run these commands from the target repository when it has this tooling. `init` writes root `retro/` by default. `status` gives coverage counts and next session refs without manually reading huge ledgers. `transcript` reads OpenCode SQLite in read-only mode and returns full ordered transcript envelopes for the requested redacted session refs or raw session ids; default output redacts content, and `--include-content` is for local analysis only and must not be pasted into user-facing output. For worker batches, write transcript exports to a repo-local ignored scratch directory that `session-observation-worker` can read without `external_directory` permission; use OS temp only for main-session-only analysis or for a worker surface with explicit external-read permission. `patch-sessions` merges a small batch JSON containing `sessions.<sessionRef>.audit`, `coverage`, and `observations`, refreshes `analysisProgress`, validates before writing, and refuses invalid patches. If running from this kit repository for another target, pass `--project-root <target-project>` and write `--out <target-project>/retro` for `init`, then pass `--root <target-project>` on `proposals` and strict `validate`. Use `--db`, `--data-dir`, and `--only-explicit` for controlled session stores. Use `--show-paths` only when home-redacted paths are acceptable. The helper reads SQLite in read-only mode, filters current-project sessions, redacts raw ids/titles/prompts/paths by default, validates ledger links, refreshes `analysisProgress` checkpoints, and materializes OpenSpec proposals from completed plans. It does not infer observations, trends, or root causes. Use `split` and `assemble` only for legacy single-file migration or compatibility exports.

Use helper commands before manual database exploration. Do not spend retro time rediscovering the OpenCode schema or hand-editing large legacy `retro.json` files unless the helper is missing, fails, or reports `unsupported`; if that happens, record the helper gap as a tooling observation and continue with the smallest safe fallback.

## Orchestrated Batch Execution

Use the `orchestrator` skill for full current-project retros when there are enough remaining sessions for independent workstreams. Load it after `status` confirms the scope, then run the retro as a master session with read-only worker batches.

- Default trigger: remaining sessions are more than one practical batch, transcript/event volume is large, or `status` reports enough sessions that serial review would be slow. Prefer orchestration for 20+ remaining sessions unless the user explicitly forbids it or the `task` tool is unavailable.
- Main session owns `retro/` writes, `patch-sessions`, validation, trend/root-cause synthesis, OpenSpec proposal generation, privacy filtering, and final handoff. Workers never write `retro/`, create OpenSpec files, commit, push, delete sessions, or expose raw transcript snippets.
- Use `status --input retro --limit <n> --format json` as the deterministic batch manifest. It returns bounded `nextSessions` metadata with redacted refs, row counts, tool names, mechanical signals, token rows, and date ranges, without raw prompts or paths. Do not manually read a huge ledger to size batches unless the helper is unavailable or reports `unsupported`.
- Split `nextSessions` into stable parallel worker batches by chronological order and row/token volume. Default to 10-25 normal sessions per worker, or fewer very large sessions when event counts are high. A batch size of 1-5 sessions is a debugging fallback, not normal throughput.
- Export each worker batch with `transcript --input retro --session <ref> ... --include-content --format json --out <repo-local-ignored-scratch-transcript-batch.json> --overwrite`. Write worker-readable raw transcript exports only under a repo-local ignored scratch directory, never in tracked or normal repo paths. Use OS temp only for main-session-only analysis or for a worker surface with explicit external-read permission. Delete only files created by the current retro run after their patch is applied unless needed for immediate rework; if cleanup is blocked, report exact paths in `Privacy Notes`.
- Launch 2-6 read-only workers concurrently through `task` when independent batches exist. Use `session-observation-worker` when installed; otherwise embed the same worker contract in a generic read-only task prompt and report the fallback. Each worker reads only its assigned transcript file(s), reviews every session in the batch, and returns a sanitized batch patch draft with `sessions.<sessionRef>.audit`, `coverage`, and `observations`; it must not ask the user questions.
- Use parallel worker batches; do not process a large archive serially from the main session except for setup, integration, validation, and final synthesis.
- The main session reconciles worker reports, fixes schema issues, writes one or more batch patch JSON files, applies them with `patch-sessions`, runs `validate`, runs `status`, and immediately dispatches the next wave while sessions remain.
- If a worker report is incomplete, malformed, too vague, contains raw secrets, or promotes global trends/root causes/plans, send a focused rework task or mark only the affected sessions partial/blocked with evidence. Do not mark a session complete from worker summary alone unless the worker explicitly reviewed the full transcript and filled validator-required audit fields.

## Session Observation Worker Contract

When `session-observation-worker` is unavailable, every fallback worker prompt must preserve this minimum contract:

- Mode is read-only. No ledger writes, OpenSpec files, commits, pushes, deletion, user questions, nested agents, or global synthesis.
- Inputs are assigned session refs, exported transcript JSON paths, expected ledger patch shape, and privacy constraints.
- Output is one `SESSION_OBSERVATION_WORKER_REPORT` with coverage per session, sanitized `Batch Patch Draft`, worker-level findings, privacy notes, residual risks, and actionable continuation items.
- Workers review every assigned transcript fully enough to populate audit fields and observations; incomplete evidence stays partial/blocked.
- Workers may record candidate symptom/root-cause notes but must not promote trends, root causes, or plans.

## Session-By-Session Algorithm

1. Initialize root `retro/` before synthesis, or reuse an existing root ledger only after `status` confirms the expected scope and next incomplete session. The ledger must include every reachable current-project session from OpenCode DB sources before any trend/root-cause synthesis starts. If root `retro/` cannot be written because the user explicitly denied writes or the filesystem blocks it, stop and report `Project Ledger Status: blocked`; do not substitute an inline pseudo-ledger.
2. Run `status --input retro --limit <n> --format json` to get the next incomplete refs and redacted `nextSessions` batch metadata. Split them into stable batches when the archive is large. For large archives, load `orchestrator` and enter the Orchestrated Batch Execution workflow.
3. For each batch, use `transcript --input retro --session <ref> --include-content --format json --out <repo-local-ignored-scratch-transcript.json> --overwrite` or repeat `--session` for several refs instead of manually probing SQLite. Keep worker-readable transcript files in a repo-local ignored scratch directory, not tracked or normal repo paths, and do not paste raw content into user-facing output.
4. For large archives with independent batches, use read-only fan-out for session observation drafts without asking whether batching is desired. Prefer `session-observation-worker` for each batch, and use `qwen-local-worker` only as an optional first-pass extraction helper when configured and bounded. The main session owns global synthesis, privacy filtering, root-cause analysis, and output routing.
5. Analyze each session independently before global synthesis. Do not promote trends until all in-scope sessions are processed or `retro/` clearly records unprocessed coverage.
6. For each session, read the full transcript from the helper output and prepare a batch patch that fills `sessions.<sessionRef>.audit` plus `sessions.<sessionRef>.observations[]`. Apply it with `patch-sessions`. Do not set `coverage.status` to `complete` until the validator-required audit fields are filled.

- Session id/title/date/project when available.
- User goal and constraints.
- What the assistant did.
- Tools used and tool failures.
- Tool-chain efficiency: redundant tool calls, avoidable serial work, missed parallelization, missed deterministic helper, unnecessary broad reads, repeated failed commands, overlarge context, or needless agent/reviewer fan-out.
- Faster-equivalent path: what could have reached equal or better quality sooner with fewer tokens, or `none/unknown` when evidence does not support a better path.
- Record efficiency findings as normal observations with evidence refs and candidate lessons. If the ledger schema has no dedicated field, use existing audit lesson/symptom/root-cause notes rather than inventing unvalidated fields.
- User corrections or dissatisfaction.
- Validation performed or skipped.
- Whether edits happened, and evidence for actual edit tools versus summary/diff metadata.
- Outcome: success, partial, failed, blocked, or unclear.
- Candidate lesson.
- Symptom versus likely root cause; use `unknown` when evidence cannot support a cause.
- Evidence confidence: high, medium, or low.
- Reviewer-learning flags: whether the issue was reported by the user, caught by a reviewer, should have been caught by a reviewer, and which reviewer contract should learn from it.

7. Roll up observations into `trends` from session cards, not raw keyword counts.
8. Promote a trend only when it appears in at least two independent sessions, or mark it `severe-singleton` when one session is severe with strong evidence. Do not call rare incidental findings popular.
9. For each promoted positive or negative trend, load `root-cause-analysis`, trace the chain from trigger to missed guard to outcome, and separate proximate triggers, systemic root causes, contributing factors, and unknowns.
10. Record each root cause under `rootCauses` with `confirmed`, `likely`, or `unknown`. If evidence cannot support a cause, route an investigation/instrumentation plan instead of a guessed fix.
11. For each root cause, load `deep-task-planning` and create a deep plan under `plans` with `kind`, goal, approach, implementation slices, acceptance criteria, validation, risks, and stop line. Use `kind: investigation` for unknown root causes, `kind: remediation` for negative-trend fixes, and `kind: preservation` for positive-trend amplification.
12. Load `openspec-propose` when grouping or writing durable retro-derived follow-ups. Preview proposal writes with `npm run retro:project-ledger -- proposals --input retro --root . --dry-run`, then materialize one OpenSpec proposal per completed plan with `npm run retro:project-ledger -- proposals --input retro --root .` when OpenSpec exists and write scope is approved. Avoid OpenSpec noise for isolated nits or explicitly non-actionable findings.
13. Run `npm run retro:project-ledger -- refresh --input retro` after marking sessions complete so `analysisProgress.lastAnalyzedSessionRef` and `analysisProgress.nextSessionRef` show where to resume. Run `npm run retro:project-ledger -- validate --input retro` after filling sessions and after trend/root-cause synthesis. Run `npm run retro:project-ledger -- validate --input retro --root . --require-complete --require-proposals` after proposal generation. Run `session-delivery-reviewer` for material/complex final handoff, and run `instruction-artifact-reviewer` when skills, agents, prompts, README routing, or instruction templates changed. Fix broken references before handoff. If root `retro/` exists, repository pre-push validation should run this complete gate and fail while any session, audit field, observation, trend, root cause, plan, or proposal stage is unfinished.
14. Preserve successful recurring practices as well as problems.
15. Reconcile proposed improvements against current source/tests/config/docs/prompts before recommending implementation-sensitive changes.
16. Do not stop after a successful batch. Continue waves from `analysisProgress.nextSessionRef` until `remainingSessionCount` is `0`, then synthesize trends, root causes, plans, proposals, and final validation. If forced to stop by a real blocker, report only `Partial Inventory` or `Partial Session Sample` and put the exact resume command first.

## Ledger Entity Chain

`retro/` should preserve these relationships:

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
- Do not return `Findings`, `Efficiency And Token Economy`, `Recurring Patterns`, `Root-Cause Analysis`, `Improvement Backlog`, or `ready-to-land` language for a full retro until root `retro/` exists and records coverage for every reachable current-project session.
- Do not present a successful first batch, sample batch, or checkpoint as a natural stopping point. For full retros, the next action after `patch-sessions` and `validate` is another `status` call and the next parallel worker wave until complete.
- If only partial work is possible, title the result `Partial Inventory` or `Partial Session Sample`, include `Project Ledger Status: blocked/partial`, and make the first continuation item the exact `retro/` creation or resume command.
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
- Excess token spend, overlarge context, repeated reads, or transcript dumps without a reusable evidence need.
- Inefficient operation chains: avoidable serial tool calls, duplicate searches, repeated failed commands, missed batching, or missed deterministic helper opportunities.
- Faster-equivalent paths that would improve quality, speed, and token economy together.
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
- `Coverage Ledger`: root `retro/` path for full retros; concise inline table only for explicitly partial/read-only inventory.
- `Project Ledger Status`: whether sessions, observations, trends, root causes, plans, and OpenSpec proposals are complete, partial, blocked, or not created.
- `Coverage Limits`: missing/inaccessible/truncated sources and confidence impact.
- `Phase Skill Usage`: phase -> skill/agent/helper used -> fallback or skipped reason.
- `Session Rollup`: concise batch/global summary.
- `Findings`: severity, evidence, evidence type, impact, likely root cause, recommendation, confidence.
- `Efficiency And Token Economy`: repeated avoidable time/token sinks, inefficient tool chains, missed faster-equivalent paths, expected quality impact of proposed improvements, and risks where faster work could reduce evidence quality.
- `Recurring Patterns`: repeated problems and success patterns with representative session ids or artifacts.
- `Root-Cause Analysis`: symptom -> likely root cause -> contributing factors -> recurrence path -> confidence.
- `Improvement Backlog`: automation, instructions, skills, agents, prompts, docs, or validation changes, each naming the root cause it removes or the investigation needed to find it.
- `Applied Changes`: changed files or `none`.
- `Validation`: checks run or skipped with reason.
- `Privacy Notes`: redactions or sensitive-source handling.
- `OpenSpec Follow-Up Backlog`: change groups created or recommended, or `none`.
- `Actionable Continuation Items`: concrete next tasks, including OpenSpec follow-up candidates when several session-scoped items remain, or `none`.
