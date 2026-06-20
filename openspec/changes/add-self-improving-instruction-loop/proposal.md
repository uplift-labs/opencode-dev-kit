# Proposal: Self-Improving Instruction Loop

## Why

Reviewer subagents and the OpenSpec retrospective pipeline already produce evidence-backed findings with `Likely Root Cause`, `Actionable Continuation Items`, and deterministic follow-up change generation (`openspec-retro-followups.ts`). The Universal Development Loop names `Process Improvement` as phase 11, and `instruction-artifact-tuning` plus `instruction-artifact-reviewer` already support artifact edits.

The loop is open on the prevention side. Reviewers describe what is wrong with the **changed code**, but they do not state which reusable instruction artifact should have prevented the defect, nor whether the fix is cheap enough to apply instantly or expensive enough to require an OpenSpec change. As a result, the same smell recurs across sessions, each retro produces a project-local follow-up that patches code, and no instruction artifact is ever updated to remove the recurrence path. The system improves code; it does not improve itself.

## What Changes

- Add a first-class `Prevention Feedback` output section to reviewer subagents so P0/P1 findings propose the artifact that should have prevented the defect, a recurrence path, a prevention cost band, and a draft rule. The section is `none` for nit/P2 by default, so existing reviewers stay backward-compatible.
- Add a routing policy to `AGENTS.md` and a new skill `instruction-feedback-loop` that routes prevention feedback into one of three channels: cheap instant edit on a single skill/agent, OpenSpec follow-up change for anything medium/expensive or anything touching the global `AGENTS.md`, or backlog when the root cause is unknown.
- Add a deterministic ledger helper `tools/instruction-feedback-ledger.ts` that persists findings, performs exact-match duplicate detection, and records replay results. No fuzzy scoring, no probabilistic classification. Exposed as `npm run instruction:feedback`.
- Add a replay gate so that after an instant edit the same source evidence is re-run through the updated reviewer and the finding must be `resolved` before the ledger entry closes.
- Extend `openspec-retro-gate.ts` target enum and `openspec-retro-followups.ts` routing so retrospective findings can target `instruction-artifact` alongside `project-local` and `opencode-dev-kit`, with generated follow-up changes that include the prevention rule draft.
- Add explicit anti-bloat controls: instant edits are forbidden on the global `AGENTS.md`, the global `AGENTS.md` and other broad artifacts follow one-in-one-out for new rules, and a decay pass over the ledger flags rules that have not been replayed as `resolved` within a configurable window.
- Add install drift protection to the global installer so the self-improving loop is not destroyed by the next `install:global`. The installer moves from silent-overwrite-with-backup to detect-and-refuse on drift, gains `--audit`, `--pull-back`, and `--force-overwrite` modes, and gains a force-overwrite guard enforced by the library validator.

## Impact

- Skills affected: new `instruction-feedback-loop`; extended `instruction-artifact-tuning`, `root-cause-analysis`; updated `openspec-propose` Follow-Up Backlog Mode to reference prevention feedback routing.
- Agents affected: all reviewer subagents gain an optional `Prevention Feedback` output section; `instruction-artifact-reviewer` gains replay-gate and conflict checks.
- Instructions affected: `AGENTS.md`, `instructions/reusable-project-agent-instructions.md`, `instructions/global-opencode-agent-instructions.md`, `instructions/leaf-reviewer-agent-contract.md`, `instructions/instruction-artifact-audit-runbook.md`, `instructions/porting-checklist.md`, `templates/project/AGENTS.md`.
- Tooling affected: new `tools/instruction-feedback-ledger.ts` with focused tests, extended `openspec-retro-gate.ts` and `openspec-retro-followups.ts`, extended `validate-library.ts` text contracts for the new output section and ledger helper, new `package.json` script `instruction:feedback`, extended `tools/install-opencode-global.ts` with drift detection + `--audit` + `--pull-back` + `--force-overwrite` modes, optional new `tools/install-pullback.ts` reusing `openspec-retro-followups.ts` templates.
- Process affected: a new gate before archive (`npm run instruction:feedback -- --replay-pending`) confirms that prevention feedback generated during the change was routed and replayed or explicitly deferred with a reason.
- Distribution affected: the global installer's default behavior changes from silent-overwrite-with-backup to detect-and-refuse when destination artifacts differ from source. CI pipelines that rely on the legacy silent-overwrite behavior must add `--force-overwrite` or migrate to `--pull-back`. This is an intentional backward-incompatible change documented in `proposal.md` Rollout.

## Non-Goals

- Do not auto-edit global `AGENTS.md` or any artifact outside the current repository without an OpenSpec change; the global file is touched only through the `openspec-apply-change` skill flow.
- Do not introduce fuzzy scoring, similarity ranking, probabilistic classification, or model-based summarization inside the deterministic ledger. Cost band classification and rule drafting stay in the LLM/judgment layer.
- Do not replace the existing retro pipeline. The new target `instruction-artifact` extends the existing enum; it does not fork the flow.
- Do not invent new validation commands beyond TypeScript helpers exposed via `package.json`; no `.ps1`, `.py`, or `.js` entrypoints.
- Do not extend reviewer permissions. Reviewer subagents remain read-only leaf validators; they only return a new optional output field.
- Do not block on replay for findings whose root cause is `unknown`. Those route to investigation changes, not to prevention rules.
- Do not add cross-repository writes. Project-local findings stay project-local; reusable-kit findings only update artifacts owned by the current repository.
- Do not make the global installer bidirectional or perform automatic merge. The `--pull-back` mode only generates investigation changes with root cause `unknown`; severity assessment, classification, and rule extraction stay in the LLM triage layer when those changes are later applied.

## Risks

- Instruction bloat: new rules accumulate without removal. Mitigated by one-in-one-out for broad artifacts and the decay pass.
- Blast radius of instant edits: a small edit can break routing for all future sessions. Mitigated by forbidding instant edits on the global `AGENTS.md` and by a mandatory `instruction-artifact-reviewer` gate before any instant edit lands.
- Circular flagpoling: a rule is added, then removed, then re-added. Mitigated by the ledger keeping `invalidated` entries with reasons; re-adding requires justifying why the prior invalidation was wrong.
- Wrong-target prevention: the reviewer proposes a rule for a symptom rather than the root cause. Mitigated by routing only findings with a non-`unknown` root cause into the instant-edit channel; `unknown` root cause routes to investigation.
- Anecdotal generalization: one observation becomes an over-broad rule. Mitigated by allowing the instant-edit channel only for P0/P1 findings with a confirmed root cause; everything else goes through OpenSpec and the existing `openspec-consistency-review`.
- Hidden heuristics in helper code: the ledger could drift toward similarity scoring. Mitigated by the existing `Deterministic Helper Automation` rules in `AGENTS.md` and by tests that assert exact-match-only duplicate detection and explicit conflict surfacing.
- Cross-repo pollution: project-local findings leak into reusable artifacts. Mitigated by the existing scope rule and by ledger entries recording the owning repository so routing can refuse cross-repo writes without explicit approval.
- Install destroys improvements: the legacy silent-overwrite-with-backup behavior in `tools/install-opencode-global.ts` discards any locally applied prevention rule on the next `install:global`. Mitigated by moving the default to detect-and-refuse, by the `--pull-back` channel that turns drift into investigation changes, and by the library validator guard that blocks re-silencing the installer without an explicit policy exemption.
- Migration friction: CI pipelines that depend on legacy silent-overwrite will fail on first run after upgrade. Mitigated by `--force-overwrite` for opt-in legacy behavior, by `--audit` for read-only drift reporting, and by the migration note in `proposal.md` Rollout.

## Rollout

- Phase 1: deterministic ledger helper with focused tests, plus the new `instruction-artifact` target in retro gate and follow-up helper. Backward compatible; no reviewer changes yet.
- Phase 2: `Prevention Feedback` output section added to all reviewer subagents. Default `none` keeps existing behavior unchanged.
- Phase 3: routing skill `instruction-feedback-loop`, `AGENTS.md` policy, and replay gate. Instant-edit channel goes live.
- Phase 4: anti-bloat decay pass and one-in-one-out enforcement in `validate-library.ts`.
- Phase 5: install drift protection. The default installer behavior changes from silent-overwrite-with-backup to detect-and-refuse when drift is present. New modes `--audit`, `--pull-back`, `--force-overwrite`. Library validator gains a force-overwrite guard.
- Phase 6: documentation and README sync.
- Phase 7: acceptance.
- Each phase ships as a task slice in `tasks.md` that is independently validatable. Phase 5 is the only backward-incompatible slice; it ships with explicit migration notes.

## Validation

- Focused tests for `tools/instruction-feedback-ledger.ts` (duplicate detection, replay status transitions, conflict surfacing, unknown-root-cause routing).
- Focused tests for the extended `openspec-retro-gate.ts` target enum and the extended `openspec-retro-followups.ts` routing.
- `npm run validate` and `npm run validate:strict` after each phase.
- `npm test` covers all library, validation-script, and helper tests.
- `npm run openspec:gate -- --operation propose --change add-self-improving-instruction-loop` passes.
- Focused tests for the installer drift detection, audit mode, pull-back determinism, and force-overwrite guard.
- Manual smoke check: pre-populate a temp config directory with a modified destination skill, run `install:global` and confirm it refuses with non-zero exit; run `install:global -- --pull-back` and confirm an investigation change is generated; run `install:global -- --force-overwrite` and confirm the legacy overwrite-with-backup path.
- Manual replay smoke check: synthesize one P0 finding, route through the instant-edit channel, re-run the same finding through the reviewer contract, and confirm the ledger records `resolved`.
