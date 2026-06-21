# opencode-dev-kit

Installable OpenCode development kit for reusable AI-assisted engineering workflows across projects.

## What This Is

`opencode-dev-kit` packages reusable OpenCode skills, read-only reviewer agents with a scoped feedback-ledger write exception, bounded worker agents, project templates, instruction templates, and deterministic helper tools. Its purpose is to make work in other repositories faster, cheaper in tokens, and safer without creating a different workflow for every technology stack.

The kit optimizes one process: gather evidence, prove current state, choose the smallest useful slice, work test-first when behavior changes, validate, run proportional reviewer gates, and hand off with residual risks.

## Universal Development Loop

The central contract is `instructions/universal-development-loop.md`:

```text
Intake -> Evidence -> Baseline Proof -> Small Slice -> Test First -> Implement -> Focused Validation -> Review Gate -> Final Validation -> Handoff -> Process Improvement
```

Technology adapters may change commands and constraints, but not the loop.

## Contents

- `.opencode/skills/`: reusable OpenCode skills.
- `.opencode/agents/`: reusable read-only reviewers, bounded read-only workers, and a bounded implementation worker. Reviewer/worker feedback writes are scoped to `docs/feedbacks/**` through `complain`.
- `docs/feedbacks/`: shared feedback ledger for agent and skill complaints, suggestions, and workflow-friction notes.
- `instructions/`: copyable instruction templates for global/project `AGENTS.md`, reviewer contracts, evidence discipline, and porting.
- `templates/`: project bootstrap and CI templates for applying the Universal Development Loop to another repository.
- `profiles/`: single `all` install manifest covering every reusable skill and agent in the repository.
- `tools/`: TypeScript validation, install, project bootstrap, doctor, inventory, code-quality, `instruction:feedback`, OpenSpec gates, and session-delivery support tooling for this kit.

## Prerequisites

- Node `>=24` is required because repository tooling runs TypeScript entrypoints directly.
- `npm test` uses Node's `node:sqlite` for session-delivery plugin fixtures; Node may print an `ExperimentalWarning` while the API remains experimental.

## Install

### Global Install

Install all repository skills, all repository agents, and a reusable global `AGENTS.md` block into OpenCode's global config directory:

```sh
npm run install:global
```

By default this installs into `~/.config/opencode`, syncs every repository skill to `skills/`, syncs every repository agent to `agents/`, and creates `~/.config/opencode/AGENTS.md` from `instructions/global-opencode-agent-instructions.md` only when doing so is lossless. Destination-only skill directories and agent `.md` files are kept unless `--prune` is explicit.

Default install detects source-vs-destination drift before writing. If an installed skill, agent, `AGENTS.md`, plugin, or support tool differs from source, the installer refuses to overwrite it and prints smart-merge escalation plus recovery commands. This protects local prevention-rule improvements from being silently discarded.

Useful options:

- `--dry-run` or `--what-if`: preview changes without writing files.
- `--config-dir <path>`: install into a custom OpenCode config directory.
- `--profile all`: install the full repository artifact set; this is the default.
- `--agents-md-source <path>`: install a custom source file into the global `AGENTS.md` block.
- `--skip-agents-md`: skip updating the managed `AGENTS.md` block; skills, agents, plugin, and support files still install.
- `--audit`: report drift with source and destination hashes without writing, removing, or backing up.
- `--pull-back`: generate one investigation OpenSpec change per drifted artifact under `openspec/changes/install-pullback-<run-stamp>-<slug>/` without overwriting destination files.
- `--force-overwrite`: opt into the legacy overwrite-with-backup behavior when you intentionally want to discard local destination changes.
- `--prune`: delete destination skills/agents not present in this repository.
- `--no-prune`: keep destination skills/agents not present in this repository; this is the default and remains as a compatibility no-op.
- `--no-backup`: skip backups for already-authorized `--force-overwrite` or `--prune` writes; it does not bypass default drift refusal.

Use `--agents-md-source AGENTS.md` only if you intentionally want this repository's local maintenance rules in the global `AGENTS.md` block.

Restart OpenCode after installing; config-time files are loaded at startup.

Migration note: CI or local scripts that depended on silent overwrite must add `--force-overwrite`, and scripts that depended on destination cleanup must add `--prune`. Safer automation should migrate to `--audit`/`--pull-back` and review generated investigation changes. Clean installs and identical destinations are unaffected.

Keep project-specific skills out of global discovery unless their descriptions explicitly scope them to that project. Global skills are visible in unrelated repositories through the skill catalog, so broad or local-product triggers add avoidable routing noise.

## Bootstrap A Project

Preview the files that would connect a target project to the Universal Development Loop:

```sh
npm run init:project -- --target <project-path>
```

Write the bootstrap files when the preview is correct:

```sh
npm run init:project -- --target <project-path> --mode write
```

The bootstrap writes a project `AGENTS.md`, optional `opencode.json`, `docs/feedbacks/README.md`, and `opencode-dev-kit/adapter.json` plus `opencode-dev-kit/validation.md`. The adapter records technology-specific commands; it does not define a separate workflow.

Check readiness after bootstrapping:

```sh
npm run doctor -- --project <project-path>
```

Before broad AI work in a target repository, gather a compact deterministic map:

```sh
npm run project:inventory -- --root <project-path> --format markdown
```

## Token Economy

- Use the Universal Development Loop instead of choosing among competing workflows.
- Use `project:inventory`, `code-quality:inventory`, `glob`, and `grep` before broad file reads.
- On native Windows, use `rtk <command>` explicitly for shell-heavy read-only commands; do not rely on hook auto-rewrite.
- Use Headroom MCP tools only on demand for large logs, search results, JSON, or tool outputs; retrieve originals before trusting exact code, errors, or safety-critical details.
- Route Headroom MCP through `tools/headroom-mcp-wrapper.ts` when OpenCode expects MCP prompts; the wrapper adds a small `headroom_usage_policy` prompt and proxies Headroom tools unchanged.
- Install the full kit by default, but load heavyweight skills/subagents only when they reduce total work.
- Delegate implementation only when the slice has exact non-overlapping write scope, clear acceptance criteria, and a focused validation gate; use `implementation-worker` for those slices.
- Run focused validation first; run broad validation when the change crosses boundaries.
- Use one relevant reviewer gate by risk instead of launching every reviewer.
- Convert repeated manual counting, drift checks, or report assembly into deterministic helpers.

Inspect this kit's instruction context cost with:

```sh
npm run instruction:inventory -- --format markdown
```

### Manual Skills

OpenCode skills are loaded from project or global skill folders. Copy selected skill folders from `.opencode/skills/` into one of these locations:

- Project: `.opencode/skills/<name>/SKILL.md`
- Global: `~/.config/opencode/skills/<name>/SKILL.md`

Alternatively, add this repository's skills path to an OpenCode config:

```json
{
  "skills": {
    "paths": ["<path-to-agents-and-skills>/.opencode/skills"]
  }
}
```

Use an absolute path or a path relative to the config file that declares it.

### Manual Agents

OpenCode agents are loaded from project or global agent folders. Copy selected files from `.opencode/agents/` into one of these locations:

- Project: `.opencode/agents/<name>.md`
- Global: `~/.config/opencode/agents/<name>.md`

Copy only the agents that are useful for the target project. They are read-only leaf validators or bounded read-only workers by default with a scoped `docs/feedbacks/**` write exception through `complain`; `implementation-worker` is intentionally broader write-capable and validation-bounded.

OpenCode permissions enforce the `docs/feedbacks/**` path boundary; `complain` is the required model contract for entry shape and privacy checks. Use a semantic plugin/tool later if hard append-only or skill-mediated enforcement is required.

Global install is enough for fresh projects: when `docs/feedbacks` is missing, agents use the scoped edit/add-file path to create `docs/feedbacks/<agent-or-skill-name>.md` on first feedback write. Project bootstrap only pre-creates a README for discoverability.

### Manual Commands

OpenCode prompt commands are configured through `opencode.json` under `command`. This repository does not currently ship project commands.

### Manual Instructions

Copy selected files from `instructions/` into a global or project `AGENTS.md` or another instruction file. Keep only rules that are durable for that scope.

## Validate

Run structural validation and fixture-based acceptance checks after changing library artifacts:

```sh
npm run validate
npm test
```

The validator checks skill and agent frontmatter shape, skill trigger/output contracts, compact reviewer leaf contracts, README catalog/routing sync, repo/project-template autonomy and remote/destructive guards, TypeScript-only development policy, deterministic helper automation policy, reusable reviewer permission policy, OpenCode config warnings for broad mutation-capable wildcard `allow` permissions, optional project-neutral anchors passed via `--forbidden-anchor`, trailing whitespace, and warning-level TDD guard findings for Markdown artifacts with implementation-related language that do not mention test-first, TDD, before-code fixtures/gates, or equivalent validation-first language.

For code maintainability reviews in this library, gather deterministic file-size/navigation bands with:

```sh
npm run code-quality:inventory -- --format markdown
```

For instruction-artifact context-cost reviews in this kit, gather deterministic Markdown metrics with:

```sh
npm run instruction:inventory -- --format markdown
```

Route reviewer prevention feedback through the deterministic instruction-feedback ledger helper:

```sh
npm run instruction:feedback -- --add <feedback.json>
npm run instruction:feedback -- --pending
npm run instruction:feedback -- --decay-report
npm run instruction:feedback -- --check-bloat --change <change-id>
npm run instruction:feedback -- --replay-pending
```

The helper persists entries, detects exact-match duplicates, enforces replay status transitions, reports stale open/applied entries, and checks one-in-one-out evidence for broad instruction rules. It does not classify prevention cost or draft rule quality.

Use `complain` for lightweight feedback that should be captured. Entries append to `docs/feedbacks/<agent-or-skill-name>.md` and can later be grouped into OpenSpec follow-up analysis when patterns accumulate.

Validate all OpenSpec changes with the first-class package gate:

```sh
npm run openspec:validate
```

Run deterministic operation gates before sensitive OpenSpec lifecycle steps with:

```sh
npm run openspec:gate -- --operation apply --change <change-id>
npm run openspec:gate -- --operation archive --change <change-id>
npm run openspec:gate -- --operation prepush
```

Use `--persist` only when a JSON evidence artifact should be written to `openspec/changes/<change-id>/automation/operation-gates/<operation>.json` from a write-authorized main session. Default operation-gate runs are read-only.

For installer changes, also prove the no-write path before using a real config directory:

```sh
npm run install:global -- --dry-run --config-dir <temp-config-dir>
npm run install:global -- --audit --config-dir <temp-config-dir>
```

For ports from a project-local prompt set, pass anchors that must not remain in reusable Markdown:

```sh
npm run validate -- --forbidden-anchor "OldProductName" "D:/old/project/path"
```

Before pushing changes from this repository, run the pre-push gate:

```sh
npm run prepush:validate
```

The pre-push gate runs `npm run validate`, `npm run openspec:gate -- --operation prepush` when `openspec/` exists, `npm test`, and `npm run openspec:validate`.

To enable the tracked local git hook for this clone, run:

```sh
git config core.hooksPath .githooks
```

For broad instruction-artifact audits, use `instructions/instruction-artifact-audit-runbook.md` to prove repo source, installed state, runtime policy, context-cost metrics, permission semantics, reviewer gates, and non-repo changes. Capture before/after metrics such as global rules line count, top heavy skill line counts, installed-copy drift, validator test count, and reviewer findings.

## Routing Map

Routing and reviewer maps assume the default `all` install profile.

- Broad, unclear, high-risk, or process-sensitive delivery -> `adaptive-delivery`; let it choose direct execution, planning, OpenSpec, architecture, orchestration, or reviewer gates.
- Explicit planning-only work -> `deep-task-planning`; if the request is broad delivery rather than planning-only, start with `adaptive-delivery`.
- Existing OpenSpec continuation or "what next" work -> `next-step`; accepted OpenSpec implementation -> `openspec-apply-change`; new OpenSpec packages -> `openspec-propose`; consistency/archive work -> the matching OpenSpec review/archive skill.
- Several session-scoped follow-ups from an audit, reviewer gate, broad discovery, or validation failure -> group them into lightweight OpenSpec changes with `openspec-propose` when OpenSpec exists or is approved; otherwise return grouped continuation candidates.
- Initial MR/PR title/body preparation -> `merge-request-author`; existing MR/PR checks, reviewer feedback, approvals, and outcome handling -> `merge-request-review-loop`.
- Broad independent tracks -> `orchestrator` only after bounded workstreams, success criteria, and validation evidence are clear; use `implementation-worker` for bounded non-overlapping edit slices when installed. If the worker or orchestration is unavailable, keep edit-mode work serial unless equivalent scoped permissions or isolated execution are explicitly configured.
- Bounded first-pass helper work that benefits from cheap/offline local context, such as long-context retrieval, JSON extraction, scoped review, test ideas, planning, or tool-call checks -> `qwen-local-worker` when the target machine has a configured `qwen-local` provider.
- Session delivery-control review for historical/current todos, user prompts/detected candidate requirement signals/question replies, changed-file scope, transcript/summary, compaction/resume continuity, and validation output -> `session-delivery-reviewer`.
- Skills, agents, prompts, `AGENTS.md`, and other instruction artifacts -> `instruction-artifact-tuning`; current-session friction notes -> `complain`; for broad audits also use `instruction-artifact-audit-runbook.md`; use `instruction-artifact-reviewer` as the read-only post-change gate.
- Documentation review selection: use `documentation-learning-quest` for guided onboarding, `file-review-quest` for one-file block review, `documentation-hardening-loop` for non-trivial doc/spec hardening, `openspec-consistency-review` for OpenSpec synchronization, and `codebase-audit-loop` only for exhaustive codebase audits.
- Code maintainability/readability after non-trivial implementation, refactoring, large-file navigation, duplication, DRY/SOLID/YAGNI, or design-pattern trade-off work -> `code-quality-audit`; use `code-quality-reviewer` as the read-only gate.

## Reviewer Gate Map

- Instruction artifacts, skills, agents, prompts, `AGENTS.md`, and README routing -> `instruction-artifact-reviewer`.
- Code health, maintainability, readability, file navigation, duplication, boundaries, and pragmatic refactoring -> `code-quality-reviewer`.
- Implementation readiness, stable scope, blockers, validation path -> `implementation-readiness-reviewer`.
- Session delivery alignment, historical/current todos, user prompts/detected candidate requirement signals/question replies, changed-file scope, compaction continuity, proportional rigor, missed work, risks, validation/review completeness, and acceptance handoff -> `session-delivery-reviewer`.
- OpenSpec/design/architecture ownership and consistency -> `openspec-architecture-reviewer`.
- Requirements-to-tests, weak assertions, missing gates -> `test-coverage-reviewer`.
- Config, deployment, packaging, operational safety -> `deployment-config-reviewer`.
- Latency, throughput, load isolation, recovery evidence -> `performance-reliability-reviewer`.
- Rust async/concurrency/backpressure/shutdown -> `rust-concurrency-reviewer`.
- Protocol/API semantics, schema evolution, correlation, reconnect -> `protocol-api-reviewer`; byte-level fixtures, framing, golden vectors -> `wire-protocol-reviewer`.
- Legacy source evidence and compatibility behavior -> `legacy-evidence-reviewer`; legacy client/tool workflow compatibility -> `legacy-client-compatibility-reviewer`.

## OpenSpec Follow-Up Tracking

Use OpenSpec as a durable follow-up tracker when a session produces a real backlog, not for every incidental note.

This repository's OpenSpec guide starts at `openspec/project.md`; active changes live under `openspec/changes/<change-id>/`.

- Good triggers: codebase audits, instruction-artifact audits, reviewer gates, broad discovery, and validation failure triage that produce several concrete tasks outside the current approved scope.
- Bad triggers: isolated nits, speculative polish, local style preferences, duplicated final-answer bullets, or one obvious next step.
- Prefer one OpenSpec change per coherent outcome, capability, risk area, or artifact family. For lightweight backlog changes, `tasks.md` can be the primary surface; add proposal/spec/design detail only when requirements, behavior, compatibility, architecture, or acceptance criteria need it.
- Create or update OpenSpec files only when the repository already has an OpenSpec workflow or the user approved adding one; otherwise return grouped follow-up candidates as continuation items.
- Reviewer agents remain read-only for source/config/instruction/spec/task artifacts; their only default write exception is feedback-ledger entries under `docs/feedbacks/**` through `complain`. They recommend OpenSpec follow-up tracking in `Actionable Continuation Items`; the main session owns any OpenSpec writes and `next-step` continuation.

## Skill Catalog

### Planning And Workflow

- `adaptive-delivery`: adaptive entrypoint for broad, unclear, high-risk, or process-sensitive work; chooses the smallest useful lane across direct execution, planning, OpenSpec, architecture, orchestration, and reviewer gates.
- `deep-task-planning`: execution-grade plans for complex work.
- `next-step`: discover OpenSpec-backed workstreams, choose one serial next step, or hand bounded independent streams to `orchestrator` when safe.
- `merge-request-author`: reviewer-friendly PR/MR title/body/validation/risk authoring.
- `merge-request-review-loop`: autonomous MR/PR review follow-up for status checks, reviewer feedback, local fixes, revalidation, outcome handoff, and remote-action gates.
- `instruction-artifact-tuning`: review/tune skills, agents, prompts, and `AGENTS.md`.
- `orchestrator`: prompt-only master coordination for broad independent work, using bounded task fan-out, readable worker reports, report reconciliation, tests/review gates, and isolation only when worth the overhead.
- `root-cause-analysis`: evidence-backed 5 Whys/causal-chain analysis for symptoms, recurrence paths, unknown-cause investigations, and remediation-ready cause records.
- `complain`: record current-session workflow friction, instruction conflicts, tooling pain, validation noise, or reusable improvement opportunities in `docs/feedbacks/**`.

### Review And Learning

- `file-review-quest`: block-by-block file review with coverage.
- `documentation-learning-quest`: guided docs onboarding and lightweight review.

### Documentation And Audit

- `code-quality-audit`: pragmatic code-health review after non-trivial code changes, focusing on maintainability, readability, file navigation, duplication, overengineering, code smells, and minimal refactoring remedies.
- `documentation-hardening-loop`: docs/spec review-fix-validate loop.
- `documentation-block-ledger`: helper ledger for full docs block coverage.
- `codebase-audit-loop`: exhaustive audit workflow for bugs, project-structure ergonomics, redundancy, test gaps, performance, and maintainability.
- `codebase-audit-ledger`: helper ledger for exhaustive audit coverage.

### OpenSpec

- `openspec-explore`: explore requirements/options before a change.
- `openspec-propose`: draft proposal/design/spec/tasks, including lightweight follow-up backlog changes from audit/reviewer/validation evidence.
- `openspec-apply-change`: implement accepted OpenSpec changes with TDD-first task execution.
- `openspec-consistency-review`: review proposal/design/spec/tasks/docs/tests sync.
- `openspec-archive-change`: archive completed changes after task/spec/test/validation and reviewer evidence gates.
- `production-service-openspec`: production-oriented service baseline change authoring.

### Technical Domains

- `config-schema-validation`: config schema/defaults/limits/reload diagnostics.
- `rust-workspace-bootstrap`: Rust workspace and crate bootstrap.
- `windows-service-packaging`: Windows service/tray/installer lifecycle.
- `operation-scheduler-recovery`: queues, admission, ownership, cancellation, recovery.
- `latency-benchmark-pack`: latency/load/SLO benchmark evidence.
- `legacy-contract-extract`: extract contracts from legacy sources.
- `external-service-simulator-harness`: deterministic fake external services for tests.
- `framed-protocol-implementation`: framed protocol/schema/session implementation.
- `wire-protocol-golden-tests`: golden byte/vector tests for protocols.
- `service-architecture-design`: service architecture gate.
- `com-activex-adapter-implementation`: COM/ActiveX adapter compatibility workflow.

## Agent Catalog

- `code-quality-reviewer`: maintainability/readability reviewer for code smells, file bloat, duplication, boundaries, overengineering, and pragmatic refactoring gates.
- `test-coverage-reviewer`: task/repro/runtime-envelope coverage, requirement-to-test matrix, missing tests, weak assertions.
- `implementation-readiness-reviewer`: stable scope, decisions, blockers, validation readiness.
- `openspec-architecture-reviewer`: architecture/OpenSpec consistency and ownership risks.
- `rust-concurrency-reviewer`: Rust async/concurrency/backpressure/shutdown risks.
- `performance-reliability-reviewer`: latency, throughput, starvation, overload, recovery evidence.
- `deployment-config-reviewer`: config/deployment readiness and operational safety.
- `protocol-api-reviewer`: framed/client API, schema evolution, correlation, reconnect.
- `implementation-worker`: write-capable worker for one bounded non-overlapping implementation slice with scoped edits, TDD/test-first when behavior changes, focused validation, and report-only handoff.
- `qwen-local-worker`: optional local Qwen3.6 first-pass helper for bounded long-context retrieval, JSON extraction, scoped review, test ideas, planning, and tool-call checks; requires a configured `qwen-local` OpenAI-compatible provider.
- `wire-protocol-reviewer`: byte-level protocol/transport review.
- `legacy-evidence-reviewer`: requirement/design verification against legacy evidence.
- `legacy-client-compatibility-reviewer`: compatibility with legacy clients/tools/workflows.
- `session-delivery-reviewer`: session delivery-control reviewer that calls `session_delivery_context` for historical/current todos, user prompts, detected candidate requirement signals, question replies, and permission replies, then checks semantic goal alignment, changed-file scope, continuity, proportional rigor, missed work, risks, validation/review completeness, and acceptance handoff.
- `instruction-artifact-reviewer`: read-only review of skills, agents, prompts, `AGENTS.md`, README routing, autonomy handoff, and safety boundaries.

Project plugin behavior:

- `.opencode/plugin/session-env.ts` registers the `session_delivery_context` custom tool for current-session delivery evidence, including `todowrite` history and candidate requirement signals reconstructed from transcript parts, and injects `OPENCODE_SESSION_ID` into shell commands for manual CLI use. `session-delivery-reviewer` uses normal OpenCode model selection. `install:global` installs this plugin plus its `opencode-dev-kit/tools/session-delivery-context.ts` support file under the target OpenCode config directory without pruning unrelated user plugins.

## Instruction Templates

- `global-opencode-agent-instructions.md`: generic global `~/.config/opencode/AGENTS.md` baseline.
- `universal-development-loop.md`: one canonical AI-assisted engineering loop for every target project.
- `reusable-project-agent-instructions.md`: project-level `AGENTS.md` baseline.
- `leaf-reviewer-agent-contract.md`: reusable read-only reviewer subagent contract.
- `evidence-and-validation.md`: evidence hierarchy and validation discipline.
- `instruction-artifact-audit-runbook.md`: reproducible audit contract for skills, agents, installed state, runtime policy, context cost, permissions, and non-repo changes.
- `porting-checklist.md`: checklist for turning project-local prompts into reusable artifacts.

## Porting Notes

These artifacts were generalized from project-local workflows. Project-specific anchors were removed or renamed into domain-neutral forms:

- Product architecture -> `service-architecture-design`.
- Product protocol implementation -> `framed-protocol-implementation` and `protocol-api-reviewer`.
- Product wire-format review -> `wire-protocol-golden-tests` and `wire-protocol-reviewer`.
- Device/upstream simulator -> `external-service-simulator-harness`.
- Legacy UI/tool compatibility -> `legacy-client-compatibility-reviewer` and `legacy-evidence-reviewer`.
- Production baseline spec authoring -> `production-service-openspec`.

Overly narrow future-scope behavior that depended on one product domain was intentionally not ported.

## Curation Rules

- Keep artifacts project-neutral unless the artifact name explicitly scopes a reusable domain.
- Prefer concrete evidence, validation, permissions, and output schemas over vague instructions.
- For repetitive, evidence-heavy, or token-heavy workflows, consider a small deterministic helper before adding more prose process.
- When several session-scoped follow-ups appear outside approved scope, prefer grouping them into OpenSpec changes when OpenSpec exists or is approved instead of leaving an untracked final-message backlog; avoid OpenSpec ceremony for isolated nits or one obvious next step.
- Helper automation in skills or agents must be deterministic and contract-driven: explicit inputs/outputs, fixtures or schemas, stable ordering, privacy-safe output, and no hidden heuristics.
- Implementation-capable artifacts should require TDD/test-first by default for behavior changes, or require an explicit infeasibility note plus the closest reproducible validation evidence.
- Keep TDD proportional: require the smallest useful test/gate for the scoped behavior, not unrelated coverage expansion or speculative test suites.
- Reviewer agents should keep the compact `Leaf Contract`, ordered findings, residual risks, and `Actionable Continuation Items`; mutation-capable tools stay denied except scoped `docs/feedbacks/**` appends through `complain` and explicitly validated bounded worker exceptions such as `implementation-worker`.
- Avoid hardcoded commands and paths. Use placeholders or say to use the repository's configured validation command.
- If a target repository has stricter local instructions, local instructions win.
