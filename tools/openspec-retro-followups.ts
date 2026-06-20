#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedFollowUpId, readRetroArtifact, writeRetroArtifact } from "./openspec-retro-gate.ts";
import type { RetroArtifact, RetroProblem } from "./openspec-retro-gate.ts";

export type RetroFindingTarget = "project-local" | "opencode-dev-kit" | "instruction-artifact" | "none";

export type RetroFinding = RetroProblem;

export type RetroFollowUpChange = {
  id: string;
  target: RetroFindingTarget;
  status: "created" | "existing" | "skipped";
  path: string;
  problem: string;
  findingIndex: number;
};

export type RetroFollowUpResult = {
  changeId: string;
  changes: RetroFollowUpChange[];
  retrospectiveUpdated: boolean;
};

type CliOptions = {
  root: string;
  changeId?: string;
  format: "json" | "text";
  dryRun: boolean;
};

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function safeChangeId(changeId: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(changeId) && !changeId.includes("..") && !changeId.includes("/") && !changeId.includes("\\");
}

function normalizedCell(value: string): string {
  return value.trim().toLowerCase().replace(/[.。]+$/, "");
}

function isUnknownRootCause(value: string): boolean {
  return normalizedCell(value) === "unknown";
}

function taskTail(sourceChangeId: string): string {
  return `## Retrospective Before Archive

- [ ] Review the completed change context, validation, reviewer gates, blockers, repeated work, wait time, token-heavy steps, and likely root causes.
- [ ] Write \`openspec/changes/${sourceChangeId}/retro.md\` with evidence, problems, root causes, improvements, follow-up ids, and archive gate decision.
- [ ] Run \`npm run openspec:retro-followups -- ${sourceChangeId}\` when available so actionable retrospective findings create or update follow-up OpenSpec changes before archive.
- [ ] If the helper is unavailable, manually create or update project-local OpenSpec follow-up changes for project-local findings; for reusable \`opencode-dev-kit\` findings, write only when the current repository owns the reusable artifact and current write scope includes it, otherwise record a local handoff and do not write cross-repo without explicit approval.
- [ ] Confirm archive is allowed only after the retro gate passes or an approved skip reason is recorded in \`retro.md\`.
`;
}

function proposalText(sourceChangeId: string, finding: RetroFinding): string {
  const action = isUnknownRootCause(finding.rootCause)
    ? `Investigate the unknown root cause before implementing or documenting: ${finding.recommendation}`
    : `Address the root cause by implementing or documenting: ${finding.recommendation}`;
  const prevention = finding.target === "instruction-artifact"
    ? `
## Prevention

- Prevention Target: ${finding.preventionTarget ?? "unknown"}
- Recurrence Path: ${finding.rootCause}
- Draft Rule: ${finding.draftRule ?? "unknown"}
- Replay Evidence Ref: ${finding.replayEvidenceRef ?? "unknown"}
`
    : "";
  return `# Proposal: ${finding.problem}

## Why

This follow-up was generated from \`${sourceChangeId}\` \`retro.md\` retrospective evidence.

- Problem: ${finding.problem}
- Evidence: ${finding.evidence}
- Impact: ${finding.impact}
- Root cause: ${finding.rootCause}
- Confidence: ${finding.confidence}
- Target: ${finding.target}

## What Changes

- ${action}
- Preserve the source retrospective link so archive review can trace why this follow-up exists.

## Non-Goals

- Do not expand beyond the retrospective finding without a separate OpenSpec decision.
- Do not write cross-repo artifacts unless this repository owns the reusable artifact or the user explicitly approves that scope.

${prevention}
## Validation

- Define focused validation in \`tasks.md\` before implementation.
`;
}

function tasksText(sourceChangeId: string, finding: RetroFinding): string {
  const rootCauseTask = isUnknownRootCause(finding.rootCause)
    ? `Investigate and document the root cause before designing the fix: ${finding.recommendation}`
    : `Confirm the retrospective root cause is still correct or update it before designing the fix: ${finding.rootCause}`;
  const prevention = finding.target === "instruction-artifact"
    ? `
## Prevention Rule

- [ ] Confirm target artifact: ${finding.preventionTarget ?? "unknown"}
- [ ] Apply draft rule or revise with reason: ${finding.draftRule ?? "unknown"}
- [ ] run replay gate using: ${finding.replayEvidenceRef ?? "unknown"}
- [ ] Record replay result before archive.
`
    : "";
  return `# Tasks: ${finding.problem}

## Follow-Up Scope

- [ ] Confirm the retrospective finding from \`${sourceChangeId}\` is still current.
- [ ] ${rootCauseTask}
- [ ] Define the smallest implementation or documentation slice for: ${finding.recommendation}
- [ ] Add or update the focused test, fixture, validator, or review evidence needed for this finding.
- [ ] Implement the minimal change and update docs/specs if behavior changes.

## Validation

- [ ] Run the focused validation command for this change.
- [ ] Run \`openspec validate --all\`.

${prevention}
${taskTail(sourceChangeId)}`;
}

function specText(changeId: string, sourceChangeId: string, finding: RetroFinding): string {
  const rootCauseRequirement = isUnknownRootCause(finding.rootCause)
    ? "the investigation records the discovered root cause before remediation"
    : `the follow-up preserves root cause: ${finding.rootCause}`;
  const prevention = finding.target === "instruction-artifact"
    ? `
### Requirement: Prevention Rule Surfaces In Instruction Artifact

The follow-up SHALL make the prevention rule observable in the selected instruction artifact or record evidence-backed rejection before archive.

#### Scenario: Prevention rule is observable after follow-up

- **GIVEN** this follow-up targets ${finding.preventionTarget ?? "an instruction artifact"}
- **WHEN** the follow-up lands
- **THEN** the instruction artifact includes or intentionally rejects the draft rule: ${finding.draftRule ?? "unknown"}
- **AND** replay evidence is recorded from: ${finding.replayEvidenceRef ?? "unknown"}.
`
    : "";
  return `# ${changeId} Specification

## ADDED Requirements

### Requirement: Retrospective Finding Follow-Up Is Scoped

This follow-up SHALL resolve, validate, or explicitly reject the retrospective finding generated from \`${sourceChangeId}\` without expanding beyond the recorded root cause and recommendation unless a separate OpenSpec decision broadens scope.

#### Scenario: Finding is reassessed before implementation

- **GIVEN** the follow-up change is selected for implementation
- **WHEN** the implementer starts work on the generated finding
- **THEN** they review the original problem, evidence, impact, root cause, recommendation, confidence, and target
- **AND** ${rootCauseRequirement}
- **AND** they either implement the smallest valid slice for: ${finding.recommendation}
- **OR** record evidence that the finding is no longer current before closing the change.
${prevention}
`;
}

function followUpId(sourceChangeId: string, finding: RetroFinding, index: number): string {
  return finding.followUpChangeId ?? expectedFollowUpId(sourceChangeId, finding, index);
}

function fileNeedsWrite(filePath: string, requiredFragments: string[]): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return true;
  }
  const current = normalizeText(fs.readFileSync(filePath, "utf8"));
  return requiredFragments.some((fragment) => !current.includes(fragment));
}

function existingFileMissingFragments(filePath: string, requiredFragments: string[]): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  const current = normalizeText(fs.readFileSync(filePath, "utf8"));
  return requiredFragments.some((fragment) => !current.includes(fragment));
}

function isMeaningful(value: string | null | undefined): boolean {
  if (value == null) {
    return false;
  }
  const normalized = value.trim().toLowerCase().replace(/[.。]+$/, "");
  return !["", "none", "n/a", "na", "unknown", "unavailable", "-"].includes(normalized);
}

function relativePosix(root: string, target: string): string {
  return path.relative(root, target).replaceAll("\\", "/");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function updatedArtifact(artifact: RetroArtifact, changes: RetroFollowUpChange[]): RetroArtifact {
  const routedChanges = changes.filter((change) => change.status !== "skipped");
  if (routedChanges.length === 0) {
    return artifact;
  }
  const byIndex = new Map(routedChanges.map((change) => [change.findingIndex, change]));
  const problems = artifact.problems.map((problem, index) => {
    const change = byIndex.get(index);
    if (change == null) {
      return problem;
    }
    return { ...problem, followUpChangeId: change.id, noFollowUpReason: null };
  });
  return {
    ...artifact,
    problems,
    outputs: {
      projectFollowUpChanges: unique([...artifact.outputs.projectFollowUpChanges, ...routedChanges.filter((change) => change.target === "project-local").map((change) => change.id)]),
      opencodeDevKitChanges: unique([...artifact.outputs.opencodeDevKitChanges, ...routedChanges.filter((change) => change.target === "opencode-dev-kit").map((change) => change.id)]),
      instructionArtifactChanges: unique([...(artifact.outputs.instructionArtifactChanges ?? []), ...routedChanges.filter((change) => change.target === "instruction-artifact").map((change) => change.id)]),
      noFindingsReason: null,
    },
  };
}

export function createRetroFollowUps(root: string, changeId: string, options: { dryRun?: boolean } = {}): RetroFollowUpResult {
  if (!safeChangeId(changeId)) {
    throw new Error(`Invalid change id '${changeId}'.`);
  }
  const artifact = readRetroArtifact(root, changeId);
  const actionableFindings = artifact.problems
    .map((finding, findingIndex) => ({ finding, findingIndex }))
    .filter((entry) => entry.finding.target !== "none" && !isMeaningful(entry.finding.noFollowUpReason));
  const prepared = actionableFindings.map(({ finding, findingIndex }, index) => {
    const id = followUpId(changeId, finding, index);
    if (!safeChangeId(id)) {
      throw new Error(`Unsafe follow-up change id '${id}' for retrospective finding '${finding.problem}'.`);
    }
    const followUpRoot = path.join(root, "openspec", "changes", id);
    const proposalPath = path.join(followUpRoot, "proposal.md");
    const tasksPath = path.join(followUpRoot, "tasks.md");
    const specPath = path.join(followUpRoot, "specs", id, "spec.md");
    const proposal = proposalText(changeId, finding);
    const tasks = tasksText(changeId, finding);
    const spec = specText(id, changeId, finding);
    const taskRootCauseFragment = isUnknownRootCause(finding.rootCause) ? "Investigate and document the root cause" : finding.rootCause;
    const specRootCauseFragment = isUnknownRootCause(finding.rootCause) ? "discovered root cause" : finding.rootCause;
    const proposalFragments = finding.target === "instruction-artifact"
      ? [finding.problem, finding.evidence, finding.impact, finding.rootCause, finding.recommendation, "## Prevention", finding.preventionTarget ?? "unknown", finding.draftRule ?? "unknown"]
      : [finding.problem, finding.evidence, finding.impact, finding.rootCause, finding.recommendation];
    const taskFragments = finding.target === "instruction-artifact"
      ? [taskRootCauseFragment, finding.recommendation, "## Prevention Rule", finding.replayEvidenceRef ?? "unknown"]
      : [taskRootCauseFragment, finding.recommendation];
    const specFragments = finding.target === "instruction-artifact"
      ? ["## ADDED Requirements", "#### Scenario:", specRootCauseFragment, finding.recommendation, "Requirement: Prevention Rule Surfaces In Instruction Artifact"]
      : ["## ADDED Requirements", "#### Scenario:", specRootCauseFragment, finding.recommendation];
    const hasPartialExistingFile = existingFileMissingFragments(proposalPath, proposalFragments) || existingFileMissingFragments(tasksPath, taskFragments) || existingFileMissingFragments(specPath, specFragments);
    if (hasPartialExistingFile) {
      return {
        change: { id, target: finding.target, status: "skipped" as const, path: relativePosix(root, followUpRoot), problem: finding.problem, findingIndex },
        proposalPath,
        tasksPath,
        specPath,
        proposal,
        tasks,
        spec,
        proposalNeedsWrite: false,
        tasksNeedsWrite: false,
        specNeedsWrite: false,
      };
    }
    const proposalNeedsWrite = fileNeedsWrite(proposalPath, proposalFragments);
    const tasksNeedsWrite = fileNeedsWrite(tasksPath, taskFragments);
    const specNeedsWrite = fileNeedsWrite(specPath, specFragments);
    const needsWrite = proposalNeedsWrite || tasksNeedsWrite || specNeedsWrite;
    return {
      change: { id, target: finding.target, status: needsWrite ? "created" as const : "existing" as const, path: relativePosix(root, followUpRoot), problem: finding.problem, findingIndex },
      proposalPath,
      tasksPath,
      specPath,
      proposal,
      tasks,
      spec,
      proposalNeedsWrite,
      tasksNeedsWrite,
      specNeedsWrite,
    };
  });
  const changes = prepared.map((item) => item.change);

  for (const item of prepared) {
    const needsWrite = item.proposalNeedsWrite || item.tasksNeedsWrite || item.specNeedsWrite;
    if (needsWrite && options.dryRun !== true) {
      fs.mkdirSync(path.dirname(item.proposalPath), { recursive: true });
      if (item.proposalNeedsWrite) {
        fs.writeFileSync(item.proposalPath, item.proposal, "utf8");
      }
      if (item.tasksNeedsWrite) {
        fs.writeFileSync(item.tasksPath, item.tasks, "utf8");
      }
      if (item.specNeedsWrite) {
        fs.mkdirSync(path.dirname(item.specPath), { recursive: true });
        fs.writeFileSync(item.specPath, item.spec, "utf8");
      }
    }
  }

  const nextArtifact = updatedArtifact(artifact, changes);
  const retrospectiveUpdated = JSON.stringify(nextArtifact) !== JSON.stringify(artifact);
  if (retrospectiveUpdated && options.dryRun !== true) {
    writeRetroArtifact(root, nextArtifact);
  }
  return { changeId, changes, retrospectiveUpdated };
}

function defaultRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { root: process.cwd(), format: "json", dryRun: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --root.");
      }
      options.root = path.resolve(value);
      index++;
    } else if (arg === "--format") {
      const value = args[index + 1];
      if (value !== "json" && value !== "text") {
        throw new Error("--format must be json or text.");
      }
      options.format = value;
      index++;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.changeId == null) {
      options.changeId = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

function renderText(result: RetroFollowUpResult): string {
  const lines = [`changeId: ${result.changeId}`, `retroMdUpdated: ${String(result.retrospectiveUpdated)}`];
  for (const change of result.changes) {
    lines.push(`${change.status}: ${change.id} (${change.target})`);
  }
  return `${lines.join("\n")}\n`;
}

function runCli(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.changeId == null) {
      throw new Error("Usage: node tools/openspec-retro-followups.ts <change-id> [--root <repo>] [--format json|text] [--dry-run]");
    }
    const result = createRetroFollowUps(options.root || defaultRoot(), options.changeId, { dryRun: options.dryRun });
    process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderText(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
