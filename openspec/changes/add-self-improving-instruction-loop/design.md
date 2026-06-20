# Design: Self-Improving Instruction Loop

## Goals

- Close the open loop between reviewer findings and reusable instruction artifacts.
- Keep reviewer subagents read-only leaf validators with no scope creep.
- Keep deterministic helpers free of fuzzy scoring, similarity ranking, or probabilistic classification.
- Keep the global `AGENTS.md` and other broad artifacts protected from instant edits.
- Keep the change backward-compatible at every phase so partial rollout is safe.

## Non-Goals

See `proposal.md`. The design does not introduce automation that judges prevention quality; that judgment stays in the LLM layer and is reviewed by the main session.

## Architecture

### Closed loop

```text
reviewer finding (P0/P1, root cause != unknown)
  -> Prevention Feedback: { target artifact, recurrence path, cost band, draft rule }
  -> main-session routing decision (LLM judgment, not helper code)
        | cheap + single skill/agent   -> instant edit  -> instruction-artifact-reviewer gate -> replay gate
        | medium/expensive/global      -> OpenSpec change (openspec-propose Follow-Up mode)
        | unknown root cause           -> investigation change
  -> ledger entry: open -> applied -> replayed -> resolved | invalidated | duplicate-of
  -> decay pass flags rules unresolved beyond window
```

### Components

| Component | Role | New/Changed |
| --- | --- | --- |
| Reviewer subagent output contract | Adds optional `Prevention Feedback` block to P0/P1 findings | Changed |
| `instruction-feedback-loop` skill | Routes prevention feedback; owns the cheap/expensive/global decision | New |
| `instruction-artifact-tuning` skill | Adds quick-path instant-edit mode and replay gate step | Changed |
| `instruction-artifact-reviewer` agent | Adds conflict check and replay-result check | Changed |
| `tools/instruction-feedback-ledger.ts` | Persists findings, exact-match duplicate detection, conflict surfacing, replay status | New |
| `openspec-retro-gate.ts` | Adds `instruction-artifact` to target enum | Changed |
| `openspec-retro-followups.ts` | Routes `instruction-artifact` findings to follow-up changes that preserve the draft rule | Changed |
| `AGENTS.md`, `instructions/reusable-project-agent-instructions.md`, `instructions/global-opencode-agent-instructions.md`, `instructions/leaf-reviewer-agent-contract.md`, `instructions/instruction-artifact-audit-runbook.md`, `instructions/porting-checklist.md`, `templates/project/AGENTS.md` | Document the routing policy, the prevention feedback loop, and the instant-edit prohibition on the global file | Changed |
| `validate-library.ts` | Adds text contracts for the new `Prevention Feedback` section in every reviewer agent, for the new ledger helper CLI surface, for the `Self-Improving Instruction Loop` section in `AGENTS.md`, and for one-in-one-out on broad artifacts | Changed |
| `package.json` | Adds `instruction:feedback` script and appends `node tools/test-instruction-feedback-ledger.ts` to the `test` script chain | Changed |

### Out-of-scope agents

`qwen-local-worker.md` and `session-observation-worker.md` are excluded from the `Prevention Feedback` contract extension. Both are worker agents (local-model delegate and observation worker), not reviewer leaf validators, so they do not emit reviewer findings and have nothing to route. The Phase 2 contract assertion operates only on agents whose description matches a reviewer contract. If either agent later gains reviewer semantics, a follow-up change will add it to the contract set and write a separate Prevention Feedback section for it.

## Retro Schema Extension

Adding `instruction-artifact` to the `RetroProblem.target` enum is necessary but not sufficient. The existing retro pipeline assumes only two actionable target buckets, so the change must extend the chain end to end. The decisions below are normative for Phase 1 implementation.

### Target enum and validation

- `tools/openspec-retro-gate.ts`: add `instruction-artifact` to the `RetroProblem.target` type and to the `findingTargets` set.
- `instruction-artifact` is actionable: it goes into the same follow-up requirement path as `project-local` and `opencode-dev-kit`. Specifically, `actionableRows` includes it, and findings with this target require either `followUpChangeId` or `noFollowUpReason`.

### Outputs bucket

- Add a third outputs bucket `instructionArtifactChanges: string[]` to `RetroArtifact.outputs`.
- `outputChangeIds` resolves `instruction-artifact` targets against the new bucket.
- `renderOutputs` renders `- Instruction-artifact follow-up changes: <ids>.` alongside the existing two lines.
- `validateArtifactSemantics` accepts `followUpChangeId` values listed in the new bucket for `instruction-artifact` targets.

### Retro markdown carriage of prevention fields

To keep retro.md a stable, diff-friendly markdown table, the existing nine columns are extended to twelve by appending `Prevention Target`, `Draft Rule`, `Replay Evidence Ref`. Existing `project-local`/`opencode-dev-kit`/`none` rows leave the three new columns as `none`. The retro gate parser is updated to accept either nine or twelve columns; twelve is required only for `instruction-artifact` rows.

### Follow-up template extension

`tools/openspec-retro-followups.ts` updates:
- `proposalText` emits an extra `## Prevention` section when the source finding target is `instruction-artifact`, carrying `Prevention Target`, `Recurrence Path`, `Draft Rule`, and `Replay Evidence Ref`.
- `tasksText` emits an extra `## Prevention Rule` checklist when target is `instruction-artifact`, with items: confirm target artifact, apply draft rule or revise with reason, run replay gate, record replay result.
- `specText` adds an `ADDED Requirements` block `Requirement: Prevention Rule Surfaces In Instruction Artifact` with a scenario asserting the rule is observable in the target artifact after the follow-up lands.
- `validateFollowUpChange` extends its `fileIncludesAll` checks so `instruction-artifact` follow-ups preserve the prevention target and draft rule in `proposal.md`, and the replay evidence reference in `tasks.md`.
- `updatedArtifact` routes `instruction-artifact` changes into the new `instructionArtifactChanges` outputs bucket.
- `expectedFollowUpId` keeps the existing slug scheme; the target prefix is added only if needed to disambiguate from same-named `project-local` follow-ups within one change.

### Backward compatibility

- Existing `retro.md` files without `instruction-artifact` rows continue to validate unchanged.
- Existing `RetroArtifact.outputs` JSON without `instructionArtifactChanges` is treated as `{ instructionArtifactChanges: [] }` by readers, and re-written with the key on next write.
- The `--format json` and `--format text` CLI outputs include the new bucket in every emit; consumers that ignore unknown keys are unaffected.

## Install Drift Protection

The self-improving loop assumes the source repository is the single source of truth for reusable artifacts. The global installer today breaks that assumption by silently overwriting any destination skill or agent that differs from source, with only a timestamped backup as a recovery path. The result is that any local improvement applied to an installed copy is lost on the next `install:global`, which removes the entire self-improving loop from end-user reach.

The change extends the installer with three additive modes and one new guard. The default behavior changes from silent-overwrite-with-backup to detect-and-refuse when drift is present; this is the one intentional backward-incompatible step and it is documented in `proposal.md` Rollout.

### Modes

| Mode | Detection result | Action |
| --- | --- | --- |
| default (no flag) | no drift | install normally |
| default (no flag) | drift present | refuse to overwrite; exit non-zero; print `--pull-back` and `--force-overwrite` recovery commands |
| `--audit` | any | report drift (source vs destination hash) and exit; never write, remove, or back up |
| `--pull-back` | drift present | write one investigation OpenSpec change per drifted artifact under `openspec/changes/install-pullback-<run-stamp>-<slug>/`; do not overwrite destination in the same run |
| `--pull-back` | no drift | no-op; report clean state |
| `--force-overwrite` | any | legacy silent-overwrite-with-backup behavior; opt-in |

### Drift detection

Drift detection reuses the existing `isSameFile` and `isSameDirectory` helpers in `tools/install-opencode-global.ts`. The installer already computes SHA256 for source-vs-destination comparison; the change adds a `collectDrift` step that records drifted artifact paths and their hashes before any write decision.

### Pull-back change shape

Each pull-back investigation change has:

- `proposal.md`:
  - `## Why`: explains the artifact was found drifted during `install:global --pull-back` and the source repository must decide whether the destination change is a reusable improvement or a local-only customization.
  - `## Destination Content` (in a fenced block).
  - `## Source Content` (in a fenced block).
  - `## Root Cause`: literal `unknown`, with a note that root cause must be investigated before any source change.
  - `## Non-Goals`: no cross-repo write unless this repository owns the artifact family.
  - `## Validation`: defines focused validation in `tasks.md` before implementation.
- `tasks.md`:
  - Investigation checklist: confirm whether destination change is reusable, project-specific, or accidental.
  - Implementation decision: open a separate follow-up change if reusable; close as `approved-skip` with reason if local-only.
  - Ends with the standard `Retrospective Before Archive` section.
- `specs/<change-id>/spec.md`: minimal `ADDED Requirements` block matching the existing `openspec-retro-followups.ts` template shape, with `Root Cause: unknown` routing to investigation.

The pull-back helper reuses `openspec-retro-followups.ts` template helpers where possible. If the templates diverge materially, the change extends `openspec-retro-followups.ts` to expose reusable template helpers and writes a small `tools/install-pullback.ts` that calls them.

### Determinism

- Pull-back run-stamp is derived from the invocation ISO timestamp exactly as the existing backup run-stamp is, so two runs cannot collide unless invoked within the same millisecond.
- Pull-back detects an already-created change for the same drifted artifact in the same run-stamp directory by slug match; if found, it reports the existing change id instead of duplicating.
- Pull-back never classifies drift severity or applies rules. Severity, classification, and rule drafting stay in the main-session LLM layer when the generated investigation change is later triaged.

### Force-overwrite guard

The library validator gains a check that scans `tools/install-opencode-global.ts` for a default code path that bypasses drift detection. The check fails when the bypass is present and the change `proposal.md` does not include an explicit exemption marker `<!-- install-force-overwrite-default-exemption: <reason> -->`.

The exact textual signature the guard scans for, picked to keep the helper deterministic and free of fuzzy matching:

- The guard scans `tools/install-opencode-global.ts` for the literal `options.forceOverwrite = true` (or equivalent default assignment that sets force-overwrite on unconditionally) in the `parseArgs` defaults or in the `run()` entrypoint before the `collectDrift` call; OR
- the absence of a literal `collectDrift(` call between the `parseArgs` return and the first `installFile(`, `installDirectory(`, or `installAgentsMd(` call in the `run()` body.

Either condition trips the guard. The exemption marker is matched literally and case-sensitively. No similarity scoring, no AST analysis, no probabilistic classification. The check is intentionally textual to comply with the deterministic-helper rule.

### Migration

- First run after upgrade may detect drift that was previously silently overwritten. The installer prints a focused message naming each drifted artifact and the two recovery commands. Users who intentionally want the legacy behavior run `--force-overwrite`.
- Existing CI scripts that run `install:global` against a clean config directory are unaffected because no drift exists.
- Existing CI scripts that run `install:global` against a pre-populated directory must add `--force-overwrite` to preserve legacy behavior, or migrate to `--pull-back` + commit generated changes. This is the intended behavior change.

### Prevention Feedback contract

Returned by every reviewer subagent. Backward-compatible because the default is `none`.

```text
Prevention Feedback:
  - Severity: P0 | P1 (lower severities use none)
  - Recurrence Path: <which existing instruction/skill/agent should have prevented this, and why it did not>
  - Prevention Target: AGENTS.md | skill:<name> | agent:<name> | new-skill-required
  - Prevention Cost: cheap | medium | expensive
  - Draft Rule: <proposed rule text; a proposal, not a finalized instruction>
  - Replay Evidence: <exact diff, fixture, or session context that should fail to reproduce the finding after the rule is applied>
```

### Routing matrix

| Cost | Target | Channel | Pre-edit gate | Post-edit gate |
| --- | --- | --- | --- | --- |
| cheap | single skill or single agent file | instant edit | `instruction-artifact-reviewer` conflict + cohesion check | replay gate |
| cheap | global `AGENTS.md` or any `instructions/*` template | OpenSpec change | `openspec-consistency-review` | retro gate |
| medium | any | OpenSpec change | `openspec-consistency-review` | retro gate |
| expensive | any | OpenSpec change | `openspec-consistency-review` | retro gate |
| any | `new-skill-required` | OpenSpec change | `openspec-consistency-review` | retro gate |
| any | unknown root cause | investigation change | `root-cause-analysis` | retro gate |

The cost band and target decision is made by the main session using LLM judgment. The ledger helper does not classify; it only persists, deduplicates, and surfaces conflicts.

### Ledger schema

`openspec/instruction-feedback-ledger.json` (project-local) or `<repo>/.opencode/state/instruction-feedback-ledger.json` (reusable-kit local). Schema, versioned:

```jsonc
{
  "schemaVersion": 1,
  "entries": [
    {
      "id": "<stable-id>",
      "sourceRef": "<session-id | openspec-change-id | reviewer-run-id>",
      "sourceArtifact": "<reviewer-agent-name>",
      "findingSummary": "<short text>",
      "rootCause": "<text | unknown>",
      "targetArtifact": "<AGENTS.md | skill:<name> | agent:<name> | new-skill-required>",
      "costBand": "cheap | medium | expensive",
      "draftRule": "<text>",
      "replayEvidenceRef": "<diff/fixture/context ref>",
      "route": "instant | openspec | backlog | invalid",
      "routeReason": "<text>",
      "status": "open | applied | replayed | resolved | invalidated | duplicate-of",
      "duplicateOf": "<entry-id | null>",
      "appliedRef": "<commit | openspec-id | null>",
      "replayedAfter": "<iso-date | null>",
      "replayResult": "resolved | still-failing | not-applicable | pending",
      "owner": "<this-repo | other-repo>",
      "createdAt": "<iso-date>",
      "updatedAt": "<iso-date>"
    }
  ]
}
```

The helper performs only deterministic operations:
- Exact-match duplicate detection: same `findingSummary` (normalized: trim, lowercase, collapse whitespace) AND same `targetArtifact`.
- Conflict surfacing: regex scan of active rules in the target artifact for a rule that contradicts the `draftRule` (simple negation/forbid/allow patterns). When in doubt, the helper reports `unknown` and routes the decision to the main session.
- Status transition enforcement: `applied -> replayed` only when `replayEvidenceRef` is non-empty; `replayed -> resolved` only when `replayResult == resolved`.
- Decay detection: entries whose `status` is `applied` or older and whose `updatedAt` is older than the configured window are flagged in `--decay-report`.

### Replay gate

After any instant edit, the same `replayEvidenceRef` is re-run through the same reviewer subagent in a fresh subagent invocation. The ledger records `replayResult`. If `still-failing`, the entry transitions to `open` with a new finding against the applied rule itself, preventing self-congratulation.

### Anti-bloat controls

- One-in-one-out: a new rule in the global `AGENTS.md`, a global skill, or a global instruction template requires the same PR to remove or merge an existing rule. Enforced by `validate-library.ts` diff inspection when `instruction:feedback --check-bloat --change <change-id>` is invoked. The diff source is the change directory `openspec/changes/<change-id>/` plus any files it touches outside that directory; the helper walks the change directory for normative rule markers (`^- ` bullet normative statements and `### Requirement:` blocks) in the affected artifact paths listed in the change `proposal.md` "What Changes" section, and compares counts against the pre-change baseline read from `git show HEAD:<path>` when available, otherwise from the ledger's last-applied snapshot. When the diff source cannot be resolved, the helper reports `unknown` and exits non-zero with a request for explicit evidence.
- Decay pass: `instruction:feedback --decay-report` lists rules whose source ledger entries are still `open` beyond the window or `applied` without replay for longer than the window. Output is a candidate list; deletion still goes through an OpenSpec change.
- Conflict surfacing as above.

## Compatibility

- Reviewer output additions are optional and default to `none`, so existing flows do not break.
- The retro gate target enum extension is additive. Existing `retro.md` files without `instruction-artifact` targets remain valid.
- The ledger helper is new and additive; it does not change existing tools.
- The global `AGENTS.md` block in `instructions/global-opencode-agent-instructions.md` is updated through the install flow; existing installs are upgraded by re-running `npm run install:global`.

## Decisions And Alternatives

- Decision: keep cost-band classification in the LLM layer. Alternative considered: heuristic keyword classifier. Rejected because it would violate the existing `Deterministic Helper Automation` rule against fuzzy scoring.
- Decision: forbid instant edits on the global `AGENTS.md`. Alternative considered: allow instant edits with a heavier pre-edit gate. Rejected because the blast radius covers every future session in every consuming repository.
- Decision: keep the ledger as JSON under `openspec/` or `.opencode/state/`. Alternative considered: SQLite (as in retro tooling). Rejected for this phase because the entry volume is low and JSON is easier to diff in reviews; SQLite can be revisited if the ledger grows past a few thousand entries.
- Decision: extend the existing retro target enum instead of forking a new pipeline. Alternative considered: a parallel "instruction-only" retro. Rejected because it would duplicate the archive gate, follow-up generation, and consistency review.
- Decision: replay gate runs the same reviewer subagent. Alternative considered: a new replay-only reviewer. Rejected to avoid divergence between "real" review and "replay" review.

## Operational Model

- Reviewer subagent emits `Prevention Feedback`. No file changes by the reviewer.
- Main session persists the entry to the ledger through `npm run instruction:feedback -- --add ...` (or by writing the JSON directly when the helper is not on PATH).
- Main session routes per the matrix above.
- For instant edit: main session invokes `instruction-artifact-tuning` quick-path, runs `instruction-artifact-reviewer`, applies the edit, runs the replay gate, updates the ledger.
- For OpenSpec change: main session invokes `openspec-propose` Follow-Up mode and the change flows through the normal apply/archive gates.
- For unknown root cause: main session invokes `root-cause-analysis` and opens an investigation change.
- Before final handoff of any material session that produced `Prevention Feedback`, the main session runs `npm run instruction:feedback -- --pending` and accounts for every open entry in `Actionable Continuation Items`.

## Test Strategy

- Unit tests for ledger duplicate detection, conflict surfacing, status transitions, decay report, owner/cross-repo refusal.
- Unit tests for the extended retro gate target enum and follow-up routing.
- Characterization test that synthesizes a P0 finding, runs it through the instant-edit channel, and asserts the ledger reaches `resolved`.
- Contract test in `validate-library.ts` that every reviewer agent file contains the `Prevention Feedback` section header after Phase 2 lands.
- Smoke test that `instruction:feedback --decay-report` runs without side effects on an empty ledger.
