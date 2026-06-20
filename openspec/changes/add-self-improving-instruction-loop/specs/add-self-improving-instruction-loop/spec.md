# add-self-improving-instruction-loop Specification

## ADDED Requirements

### Requirement: Reviewer Prevention Feedback

Every reviewer subagent SHALL be able to emit an optional `Prevention Feedback` block for P0 and P1 findings that proposes the reusable artifact which should have prevented the defect, the recurrence path, a cost band, a draft rule, and a replay evidence reference. The block SHALL default to `none` for nit and P2 findings so existing reviewer behavior stays backward-compatible.

#### Scenario: P0 finding includes prevention feedback

- **GIVEN** a reviewer subagent returns a P0 finding with a non-`unknown` root cause
- **WHEN** the finding is delivered to the main session
- **THEN** the finding includes a `Prevention Feedback` block with `Recurrence Path`, `Prevention Target`, `Prevention Cost`, `Draft Rule`, and `Replay Evidence`
- **AND** the block identifies a target artifact among `AGENTS.md`, `skill:<name>`, `agent:<name>`, and `new-skill-required`.

#### Scenario: Nit and P2 findings omit prevention feedback by default

- **GIVEN** a reviewer subagent returns a nit or P2 finding
- **WHEN** the finding is delivered to the main session
- **THEN** the `Prevention Feedback` block is `none`
- **AND** no prevention routing is required for that finding.

#### Scenario: Unknown root cause routes to investigation

- **GIVEN** a reviewer subagent returns a finding whose root cause is `unknown`
- **WHEN** prevention routing is considered
- **THEN** the finding is routed to an investigation change through `root-cause-analysis`
- **AND** it is NOT routed to the instant-edit channel.

### Requirement: Routing Policy

The repository `AGENTS.md` SHALL document a routing policy that maps each `Prevention Feedback` block to exactly one channel: instant edit on a single skill or single agent file, OpenSpec follow-up change, or investigation change. The policy SHALL forbid instant edits on the global `AGENTS.md`, on any file under `instructions/`, and on any file under `templates/`.

#### Scenario: Cheap prevention against a single skill is routed to instant edit

- **GIVEN** a `Prevention Feedback` block with `Prevention Cost: cheap` and `Prevention Target: skill:<name>`
- **WHEN** the main session applies the routing policy
- **THEN** the block is routed to the instant-edit channel
- **AND** the instant edit is gated by `instruction-artifact-reviewer` and by the replay gate before the ledger entry is closed.

#### Scenario: Cheap prevention against the global AGENTS.md is routed to OpenSpec

- **GIVEN** a `Prevention Feedback` block with `Prevention Cost: cheap` and `Prevention Target: AGENTS.md`
- **WHEN** the main session applies the routing policy
- **THEN** the block is routed to an OpenSpec follow-up change
- **AND** the instant-edit channel is NOT used.

#### Scenario: Expensive prevention is routed to OpenSpec

- **GIVEN** a `Prevention Feedback` block with `Prevention Cost: expensive`
- **WHEN** the main session applies the routing policy
- **THEN** the block is routed to an OpenSpec follow-up change regardless of target.

#### Scenario: New skill requirement is routed to OpenSpec

- **GIVEN** a `Prevention Feedback` block with `Prevention Target: new-skill-required`
- **WHEN** the main session applies the routing policy
- **THEN** the block is routed to an OpenSpec follow-up change.

### Requirement: Prevention Feedback Ledger

The repository SHALL include a deterministic helper `tools/instruction-feedback-ledger.ts` that persists prevention feedback entries, performs exact-match duplicate detection, surfaces rule conflicts, enforces status transitions, and reports decay. The helper SHALL NOT perform fuzzy scoring, similarity ranking, probabilistic classification, or model-based summarization. Unsupported inputs SHALL produce `unknown`, `unreadable`, `unsupported`, or `blocked`.

#### Scenario: Duplicate finding is detected by exact match

- **GIVEN** the ledger already contains an entry with a normalized `findingSummary` and `targetArtifact`
- **WHEN** a new entry with the same normalized `findingSummary` and `targetArtifact` is added
- **THEN** the helper marks the new entry `duplicate-of` the existing entry
- **AND** no second prevention rule is generated from the duplicate.

#### Scenario: Unsupported classification is reported not guessed

- **GIVEN** the helper is asked to classify a cost band or to judge rule quality
- **WHEN** the helper has no deterministic rule for the input
- **THEN** the helper returns `unknown`, `unreadable`, `unsupported`, or `blocked`
- **AND** the decision is deferred to the main session without inferring a result.

#### Scenario: Status transitions are enforced

- **GIVEN** a ledger entry in status `applied`
- **WHEN** the entry is advanced without a `replayEvidenceRef`
- **THEN** the helper refuses the transition to `replayed`
- **AND** reports the missing reference.

#### Scenario: Decay report flags stale entries

- **GIVEN** the ledger contains entries whose `status` is `applied` or older for longer than the configured window
- **WHEN** the helper runs the decay report
- **THEN** the report lists those entries as candidates for review
- **AND** the report does not delete or modify any entry.

#### Scenario: Cross-repository writes are refused

- **GIVEN** a ledger entry whose `owner` is `other-repo`
- **WHEN** the helper is asked to write a rule into an artifact owned by `this-repo`
- **THEN** the helper refuses the write with reason `cross-repo`
- **AND** records a local handoff instead.

### Requirement: Replay Gate

The instant-edit channel SHALL require a replay gate that re-runs the same source evidence through the same reviewer subagent after the edit lands. The ledger entry SHALL NOT transition to `resolved` while `replayResult` is `pending` or `still-failing`. A `still-failing` result SHALL open a new ledger entry against the applied rule itself.

#### Scenario: Replay resolves the finding

- **GIVEN** an instant edit was applied to `skill:<name>` for a prevention feedback entry
- **WHEN** the replay gate re-runs the original `Replay Evidence` through the same reviewer subagent
- **THEN** the reviewer no longer emits the original finding
- **AND** the ledger entry transitions to `resolved`.

#### Scenario: Replay still fails opens a new entry against the rule

- **GIVEN** an instant edit was applied but the original finding still reproduces
- **WHEN** the replay gate runs
- **THEN** `replayResult` is `still-failing`
- **AND** a new ledger entry is opened with `targetArtifact` pointing at the just-applied rule
- **AND** the original entry is NOT marked `resolved`.

### Requirement: Retro Target Extension

The retrospective gate helper SHALL accept `instruction-artifact` as a finding target alongside `project-local`, `opencode-dev-kit`, and `none`. The retrospective follow-up helper SHALL generate follow-up changes for `instruction-artifact` findings that preserve the prevention target, recurrence path, draft rule, and replay evidence reference.

#### Scenario: Retrospective finding targets an instruction artifact

- **GIVEN** a `retro.md` problem row with `Target` set to `instruction-artifact`
- **WHEN** `npm run openspec:retro-gate -- <change-id>` runs
- **THEN** the gate accepts the target value
- **AND** the gate requires a follow-up change or a no-follow-up reason following the same rules as the existing actionable targets.

#### Scenario: Retrospective follow-up carries the draft rule

- **GIVEN** a `retro.md` problem row with `Target` set to `instruction-artifact`
- **WHEN** `npm run openspec:retro-followups -- <change-id>` runs
- **THEN** the generated follow-up change includes the prevention target, recurrence path, draft rule, and replay evidence reference
- **AND** the generated `tasks.md` ends with the `Retrospective Before Archive` section.

### Requirement: Anti-Bloat Enforcement

The library validator SHALL enforce one-in-one-out for new rules added to the global `AGENTS.md`, to global skills, and to files under `instructions/` when `npm run instruction:feedback -- --check-bloat --change <id>` is invoked against a change. A change that adds a rule without removing or merging an existing rule SHALL fail validation unless the change records an explicit one-in-one-out exemption with a reason.

#### Scenario: New rule without removal fails bloat check

- **GIVEN** a change adds a new normative rule to the global `AGENTS.md`
- **WHEN** `npm run instruction:feedback -- --check-bloat --change <id>` runs against the change
- **THEN** validation fails
- **AND** the failure message requests removal or merge of an existing rule or an explicit exemption.

#### Scenario: New rule with merged predecessor passes bloat check

- **GIVEN** a change adds a new normative rule and merges two existing rules into one
- **WHEN** `npm run instruction:feedback -- --check-bloat --change <id>` runs against the change
- **THEN** validation passes.

### Requirement: Install Drift Detection

The global installer SHALL detect destination artifacts that differ from their source counterpart and SHALL refuse to overwrite them by default. When drift is detected, the installer SHALL exit non-zero with a list of drifted artifacts and the exact commands to either pull them back as investigation changes or explicitly discard them. The installer SHALL still create timestamped backups whenever it does overwrite. The installer SHALL preserve the existing behavior for destination paths that do not exist or that are identical to source.

#### Scenario: Drifted destination is not silently overwritten

- **GIVEN** a destination skill or agent file whose SHA256 differs from the source file
- **WHEN** `npm run install:global` is invoked without `--force-overwrite`
- **THEN** the installer does NOT overwrite the file
- **AND** the installer exits non-zero
- **AND** the installer lists the drifted file and the two recovery commands `--pull-back` and `--force-overwrite`.

#### Scenario: Identical or missing destination installs as before

- **GIVEN** a destination artifact that does not exist or whose SHA256 matches source
- **WHEN** `npm run install:global` is invoked
- **THEN** the installer installs the artifact as it does today
- **AND** no drift error is raised.

#### Scenario: Clean install into an empty config directory is unaffected

- **GIVEN** the destination config directory has no pre-existing skills or agents
- **WHEN** `npm run install:global` is invoked
- **THEN** every artifact is installed normally
- **AND** no drift error is raised.

#### Scenario: Audit mode reports drift without modifying files

- **GIVEN** one or more destination artifacts differ from source
- **WHEN** `npm run install:global -- --audit` is invoked
- **THEN** the installer lists every drifted artifact with its source and destination hash
- **AND** the installer exits zero when there is no drift and non-zero otherwise
- **AND** no file is written, removed, or backed up.

### Requirement: Pull-Back Channel

The global installer SHALL provide a `--pull-back` mode that consumes detected drift and writes one investigation OpenSpec change per drifted artifact under `openspec/changes/install-pullback-<run-stamp>-<slug>/`. Each generated change SHALL include a `proposal.md` carrying the destination content, the source content, a placeholder root cause equal to `unknown`, and an explicit instruction that the finding requires investigation before any rule is added to the source repository. The pull-back mode SHALL NOT perform merge, classification, or rule extraction; those remain main-session LLM work in a later apply step.

#### Scenario: Pull-back generates one investigation change per drifted artifact

- **GIVEN** the installer has detected drift in two destination skill directories
- **WHEN** `npm run install:global -- --pull-back` is invoked
- **THEN** two investigation changes are created under `openspec/changes/install-pullback-<run-stamp>-<slug>/`
- **AND** each `proposal.md` records destination content, source content, and root cause `unknown`
- **AND** each `tasks.md` ends with the `Retrospective Before Archive` section
- **AND** no destination file is overwritten in this run.

#### Scenario: Pull-back refuses cross-repo writes

- **GIVEN** a pull-back run is executed in a repository that does not own the source artifact family
- **WHEN** the generated change would mutate a reusable kit artifact
- **THEN** the change is created with `proposal.md` Non-Goals explicitly forbidding the write
- **AND** the tasks direct the implementer to forward the finding to the owning repository instead.

#### Scenario: Pull-back is deterministic across re-runs

- **GIVEN** the same drift is presented to two consecutive `--pull-back` runs without any change in source or destination
- **WHEN** the second run executes
- **THEN** the second run does NOT create duplicate changes for the same drifted artifact
- **AND** the second run reports the previously created change id.

### Requirement: Force-Overwrite Guard

The global installer SHALL provide a `--force-overwrite` mode that restores the legacy silent-overwrite-with-backup behavior for users who intentionally want to discard local destination changes. The default install mode SHALL NOT be equivalent to `--force-overwrite`. The library validator SHALL fail when a change attempts to make `--force-overwrite` the default behavior again without an explicit policy exemption recorded in `proposal.md`.

#### Scenario: Force-overwrite discards drift with backup

- **GIVEN** a destination artifact that differs from source
- **WHEN** `npm run install:global -- --force-overwrite` is invoked
- **THEN** the installer creates a timestamped backup of the destination
- **AND** the installer overwrites the destination with source
- **AND** the installer does NOT require a pull-back step.

#### Scenario: Default install is not equivalent to force-overwrite

- **GIVEN** the installer's default code path
- **WHEN** drift is present
- **THEN** the behavior matches `Install Drift Detection` and does NOT match `--force-overwrite`.

#### Scenario: Validator blocks re-silencing the installer

- **GIVEN** a change modifies `tools/install-opencode-global.ts` to skip drift detection by default
- **WHEN** `npm run validate:strict` runs
- **THEN** validation fails with a message requiring an explicit policy exemption in the change `proposal.md`.
