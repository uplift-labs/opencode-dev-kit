# Tasks: Self-Improving Instruction Loop

## Phase 1: Deterministic Ledger And Retro Target Extension

### Test First

- [x] Add `tools/test-instruction-feedback-ledger.ts` covering: schema load, exact-match duplicate detection, status transition enforcement, decay report on empty ledger, cross-repo write refusal, unsupported input returns `unknown`.
- [x] Add `tools/test-openspec-retro-gate.ts` cases asserting that `instruction-artifact` is an accepted target, that rows with this target are actionable, that `instructionArtifactChanges` outputs bucket is parsed and rendered, and that existing targets still validate.
- [x] Add `tools/test-openspec-retro-followups.ts` cases asserting that an `instruction-artifact` finding produces a follow-up change whose `proposal.md` carries a `## Prevention` section with prevention target, recurrence path, draft rule, and replay evidence reference, whose `tasks.md` carries a `## Prevention Rule` checklist, and whose spec delta carries the `Prevention Rule Surfaces In Instruction Artifact` requirement.

### Implement

- [x] Create `tools/instruction-feedback-ledger.ts` with the JSON schema in `design.md`, deterministic duplicate detection (trim + lowercase + whitespace collapse), status transition enforcement, conflict surfacing via regex scan, decay report, and cross-repo refusal.
- [x] Extend `tools/openspec-retro-gate.ts`: add `instruction-artifact` to the `RetroProblem.target` type and to the `findingTargets` set; add `instructionArtifactChanges: string[]` to `RetroArtifact.outputs`; extend `actionableRows`, `outputChangeIds`, `renderOutputs`, and `validateArtifactSemantics` to route `instruction-artifact` through the new bucket; extend the problem-row parser to accept nine or twelve columns, requiring twelve only for `instruction-artifact` rows (new columns: `Prevention Target`, `Draft Rule`, `Replay Evidence Ref`).
- [x] Extend `tools/openspec-retro-followups.ts`: extend `proposalText` to emit a `## Prevention` section when target is `instruction-artifact`; extend `tasksText` to emit a `## Prevention Rule` checklist when target is `instruction-artifact`; extend `specText` to add the `Requirement: Prevention Rule Surfaces In Instruction Artifact` block; extend `validateFollowUpChange` to require prevention fields in the follow-up `proposal.md`/`tasks.md`; extend `updatedArtifact` to route into `instructionArtifactChanges`.
- [x] Append `&& node tools/test-instruction-feedback-ledger.ts` to the `test` script in `package.json`. Decide whether `validate-library.ts` required-scripts list should also gain `instruction:feedback`; if yes, add it in the same edit, otherwise record the decision in `design.md`.
- [x] Add `instruction:feedback` script to `package.json` wired to `tools/instruction-feedback-ledger.ts` CLI entrypoint with subcommands `--add`, `--pending`, `--decay-report`, `--check-bloat --change <id>`, `--replay-pending`.

### Validate

- [x] Run `npm test` and confirm new tests plus existing tests pass (the new test file is part of the chain via the `test` script edit above).
- [x] Run `npm run validate:strict` and resolve any new contract findings caused by the new helper file.

## Phase 2: Reviewer Prevention Feedback Contract

### Test First

- [x] Extend `agentTextContracts` in `tools/validate-library.ts` so each reviewer agent file (the 13 listed below) carries a `## Prevention Feedback` section header and the five required fields (`Recurrence Path`, `Prevention Target`, `Prevention Cost`, `Draft Rule`, `Replay Evidence`). This is the durable contract enforced on every `npm run validate` and `npm run validate:strict`.
- [x] Add a `tools/test-library.ts` fixture asserting the contract fires when the section is missing (i.e., a temporary removal is detected by `npm test`).

### Implement

- [x] Add a `## Prevention Feedback` section to every reviewer agent file under `.opencode/agents/`: `code-quality-reviewer.md`, `deployment-config-reviewer.md`, `implementation-readiness-reviewer.md`, `instruction-artifact-reviewer.md`, `legacy-client-compatibility-reviewer.md`, `legacy-evidence-reviewer.md`, `openspec-architecture-reviewer.md`, `performance-reliability-reviewer.md`, `protocol-api-reviewer.md`, `rust-concurrency-reviewer.md`, `session-delivery-reviewer.md`, `test-coverage-reviewer.md`, `wire-protocol-reviewer.md`.
- [x] Add the same section to `instructions/leaf-reviewer-agent-contract.md` as the canonical contract reference for new reviewer agents.
- [x] The `qwen-local-worker.md` and `session-observation-worker.md` worker agents are excluded by design (see `design.md` "Out-of-scope agents"); no design.md edit is triggered by Phase 2 because the exclusion is pre-documented.

### Validate

- [x] Run `npm test` and confirm the new contract assertions pass for all in-scope reviewer files.
- [x] Run `npm run validate:strict`.

## Phase 3: Routing Skill, Policy, And Replay Gate

### Test First

- [x] Add `tools/test-instruction-feedback-ledger.ts` cases for the instant-edit status path: `open -> applied -> replayed -> resolved` and the `still-failing -> new entry` transition.
- [x] Add a characterization test that synthesizes a P0 finding JSON, calls the ledger helper to add and apply, runs a stub reviewer replay that returns `resolved`, and asserts the ledger reaches `resolved`.

### Implement

- [x] Create `.opencode/skills/instruction-feedback-loop/SKILL.md` describing trigger, inputs (Prevention Feedback blocks), routing matrix from `design.md`, ledger persistence, replay gate, and OpenSpec fallback.
- [x] Update `.opencode/skills/instruction-artifact-tuning/SKILL.md` with a quick-path instant-edit mode (single skill/agent only), a mandatory `instruction-artifact-reviewer` pre-edit gate, and a replay gate step.
- [x] Update `.opencode/skills/openspec-propose/SKILL.md` Follow-Up Backlog Mode to reference `instruction-artifact` as a routing target alongside `project-local` and `opencode-dev-kit`.
- [x] Update `.opencode/skills/root-cause-analysis/SKILL.md` to accept prevention feedback with `unknown` root cause and to route investigation changes through `openspec-propose`.
- [x] Update `.opencode/agents/instruction-artifact-reviewer.md` with checks for prevention feedback routing correctness, conflict surfacing, and replay result before close.
- [x] Update `AGENTS.md` with a new `Self-Improving Instruction Loop` section: routing matrix, instant-edit prohibition on global `AGENTS.md` and on `instructions/` and `templates/`, replay gate requirement, and ledger handoff policy.
- [x] Update `instructions/reusable-project-agent-instructions.md`, `instructions/global-opencode-agent-instructions.md`, and `templates/project/AGENTS.md` with the same routing policy adapted to project scope.

### Validate

- [x] Run `npm test`, `npm run validate`, and `npm run validate:strict`.
- [x] Run a manual replay smoke check: synthesize one P0 finding, route through the instant-edit channel on a scratch copy of a skill, run replay, and confirm the ledger records `resolved`.

## Phase 4: Anti-Bloat Enforcement And Decay

### Test First

- [x] Extend `tools/test-instruction-feedback-ledger.ts` with cases for `--check-bloat`: pass when a new rule merges an existing one, fail when a rule is added without removal or exemption.
- [x] Extend the decay report test to cover entries with `status: applied` older than the window.

### Implement

- [x] Add `--check-bloat --change <id>` to `tools/instruction-feedback-ledger.ts`: inspect the change directory and any files it touches outside it for added normative rule markers (bullet normative statements and `### Requirement:` blocks) in the global `AGENTS.md`, global skills, and `instructions/` files; require a corresponding removal, merge, or an explicit exemption marker. Use `git show HEAD:<path>` for the baseline when available, otherwise the ledger's last-applied snapshot; report `unknown` and exit non-zero when the diff source cannot be resolved.
- [x] Extend `tools/validate-library.ts` with text contracts for the new `instruction-feedback-loop` skill, the ledger helper CLI surface, and the `Self-Improving Instruction Loop` section in `AGENTS.md`.
- [x] Update `openspec/project.md` with a note that the ledger pending check runs before archive when prevention feedback was produced during the change.

### Validate

- [x] Run `npm test`, `npm run validate`, and `npm run validate:strict`.
- [x] Run `npm run openspec:gate -- --operation propose --change add-self-improving-instruction-loop` and confirm `passed` or `warning`.
- [x] Run `npm run instruction:feedback -- --decay-report` on the freshly created ledger file and confirm it runs without side effects.

## Phase 5: Install Drift Protection

### Test First

- [x] Add `tools/test-install-opencode-global.ts` cases covering: (a) default install refuses to overwrite a drifted destination skill and exits non-zero with the two recovery commands; (b) default install into an empty config directory installs every artifact as before; (c) `--audit` reports drift without writing, removing, or backing up and exits zero when there is no drift; (d) `--pull-back` writes one investigation change per drifted artifact under `openspec/changes/install-pullback-<run-stamp>-<slug>/` with `proposal.md`, `tasks.md`, and `specs/<id>/spec.md`, and does NOT overwrite the destination in the same run; (e) `--pull-back` is deterministic across re-runs by reporting the previously created change id instead of duplicating; (f) `--force-overwrite` restores the legacy silent-overwrite-with-backup behavior.
- [x] Extend `tools/test-library.ts` with a contract assertion that `tools/install-opencode-global.ts` still references the default drift-detection code path and that the default is not equivalent to `--force-overwrite`.
- [x] Add a `tools/test-library.ts` (or `tools/test-validate-library.ts`) case asserting the force-overwrite guard fails when a simulated `tools/install-opencode-global.ts` bypasses drift detection by default and the change `proposal.md` lacks the exemption marker `<!-- install-force-overwrite-default-exemption: <reason> -->`, and passes when the marker is present. This is the Test-First counterpart for the spec scenario "Validator blocks re-silencing the installer".

### Implement

- [x] Extend `tools/install-opencode-global.ts` with a `collectDrift` step that records drifted artifact paths and their source/destination hashes before any write decision; reuse the existing `isSameFile`/`isSameDirectory` helpers.
- [x] Change the default install path so that when drift is detected it refuses to overwrite, prints the list of drifted artifacts, prints the two recovery commands (`--pull-back`, `--force-overwrite`), and exits non-zero. Preserve current behavior when destination is missing or identical to source.
- [x] Add `--audit` mode that reports drift (source vs destination hash per artifact) without any write/remove/backup and exits zero on no drift, non-zero otherwise.
- [x] Add `--pull-back` mode that consumes the drift list and writes one investigation change per drifted artifact under `openspec/changes/install-pullback-<run-stamp>-<slug>/`, with `proposal.md` carrying destination content, source content, root cause `unknown`, the cross-repo non-goals, and the focused-validation pointer; `tasks.md` ending in `Retrospective Before Archive`; and a minimal spec delta. Reuse `openspec-retro-followups.ts` template helpers; if templates diverge materially, extend `openspec-retro-followups.ts` to expose reusable helpers and add a small `tools/install-pullback.ts` that calls them.
- [x] Add `--force-overwrite` mode that restores the legacy silent-overwrite-with-backup behavior for users who intentionally want to discard local destination changes.
- [x] Append `&& node tools/test-install-opencode-global.ts` to the `test` script in `package.json` so the installer test runs under `npm test`.
- [x] Make pull-back deterministic: detect an already-created change for the same drifted artifact in the same run-stamp directory by slug match and report the existing id instead of duplicating.
- [x] Extend `tools/validate-library.ts` with a force-overwrite guard: scan `tools/install-opencode-global.ts` for a default code path that bypasses drift detection; fail when the bypass is present and the change `proposal.md` does not include an explicit `<!-- install-force-overwrite-default-exemption: <reason> -->` marker.

### Validate

- [x] Run `npm test` (the new `test-install-opencode-global.ts` is wired into the `test` script chain in the same edit).
- [x] Run `npm run validate:strict`.
- [x] Manual smoke check: pre-populate a temp config directory with a modified destination skill; run `install:global` and confirm it refuses; run `install:global -- --pull-back` and confirm an investigation change is generated under `openspec/changes/install-pullback-<run-stamp>-<slug>/`; run `install:global -- --force-overwrite` and confirm the legacy overwrite-with-backup path.
- [x] Manual smoke check: run `install:global -- --audit` against the same temp directory and confirm it lists drift without writing anything.

## Phase 6: Documentation And README Sync

- [x] Update `README.md` so the Contents and reviewer gate map mention `instruction-feedback-loop` and the `instruction:feedback` script; add a section describing the installer drift protection, the new modes (`--audit`, `--pull-back`, `--force-overwrite`), and the migration note for CI pipelines that relied on legacy silent-overwrite.
- [x] Update `instructions/instruction-artifact-audit-runbook.md` with a step covering the new prevention feedback loop and the ledger.
- [x] Update `instructions/porting-checklist.md` with a step checking that reviewer agents ported or created locally include the `Prevention Feedback` section.
- [x] Update `README.md` install section to describe the detect-and-refuse default and the `--force-overwrite` escape hatch.
- [x] Run `npm run instruction:inventory -- --format markdown` and confirm the new skill and updated agents are listed.

## Phase 7: Acceptance

- [x] Run `npm test` end to end.
- [x] Run `npm run validate:strict`.
- [x] Run `npm run openspec:gate -- --operation review --change add-self-improving-instruction-loop`.
- [x] Run `npm run openspec:gate -- --operation acceptance --change add-self-improving-instruction-loop`.
- [x] Confirm every scenario in `specs/add-self-improving-instruction-loop/spec.md` has corresponding evidence in tasks above or in an explicit exemption.

## Retrospective Before Archive

- [x] Review the completed change context, validation, reviewer gates, blockers, repeated work, wait time, token-heavy steps, and likely root causes.
- [x] Write `openspec/changes/add-self-improving-instruction-loop/retro.md` with evidence, problems, root causes, improvements, follow-up ids, and archive gate decision.
- [x] Run the repository-configured retrospective follow-up command when available, e.g. `npm run openspec:retro-followups -- add-self-improving-instruction-loop`, so actionable retrospective findings create or update follow-up OpenSpec changes before archive.
- [x] If the helper is unavailable, manually create or update project-local OpenSpec follow-up changes for project-local findings; for reusable `opencode-dev-kit` findings, write only when the current repository owns the reusable artifact and current write scope includes it, otherwise record a local handoff and do not write cross-repo without explicit approval.
- [x] Confirm archive is allowed only after the retro gate passes or an approved skip reason is recorded in `retro.md`.
