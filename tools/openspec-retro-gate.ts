#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RetroGateResult = {
  valid: boolean;
  changeId: string;
  errors: string[];
  warnings: string[];
  archiveAllowed: boolean;
};

export type RetroEvidence = {
  kind: "command" | "file" | "review" | "tool-output" | "manual-gate" | "unknown";
  source: string;
  status: "passed" | "failed" | "blocked" | "unknown" | "not-applicable";
  summary: string;
};

export type RetroProblem = {
  problem: string;
  evidence: string;
  impact: string;
  rootCause: string;
  recommendation: string;
  confidence: "low" | "medium" | "high";
  target: "project-local" | "opencode-dev-kit" | "instruction-artifact" | "none";
  followUpChangeId: string | null;
  noFollowUpReason: string | null;
  preventionTarget: string | null;
  draftRule: string | null;
  replayEvidenceRef: string | null;
};

export type RetroArtifact = {
  changeId: string;
  evidenceReviewed: RetroEvidence[];
  problems: RetroProblem[];
  outputs: {
    projectFollowUpChanges: string[];
    opencodeDevKitChanges: string[];
    instructionArtifactChanges: string[];
    noFindingsReason: string | null;
  };
  archiveGate: {
    decision: "passed" | "blocked" | "approved-skip";
    reason: string;
    approver: string | null;
  };
};

type ProblemRow = {
  problem: string;
  evidence: string;
  impact: string;
  rootCause: string;
  recommendation: string;
  confidence: string;
  target: string;
  followUpChangeId: string | null;
  noFollowUpReason: string | null;
  preventionTarget: string | null;
  draftRule: string | null;
  replayEvidenceRef: string | null;
};

type CliOptions = {
  root: string;
  format: "json" | "text";
  changeId?: string;
};

const decisionValues = new Set(["passed", "blocked", "approved-skip"]);
const confidenceValues = new Set(["low", "medium", "high"]);
const findingTargets = new Set(["project-local", "opencode-dev-kit", "instruction-artifact", "none"]);
const emptyValues = new Set(["", "none", "n/a", "na", "unknown", "unavailable", "-"]);
const unknownRootCauseValues = new Set(["unknown"]);

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function isMeaningful(value: string | null | undefined): boolean {
  return value != null && !emptyValues.has(value.trim().toLowerCase().replace(/[.。]+$/, ""));
}

function normalizedCell(value: string | undefined | null): string {
  return value?.trim().toLowerCase().replace(/[.。]+$/, "") ?? "";
}

function isUnknownRootCause(value: string | undefined | null): boolean {
  return unknownRootCauseValues.has(normalizedCell(value));
}

function routesUnknownRootCauseInvestigation(row: Pick<RetroProblem | ProblemRow, "recommendation">): boolean {
  return /\b(investigat\w*|instrument\w*|diagnos\w*|gather evidence|collect evidence)\b/i.test(row.recommendation);
}

function safeChangeId(changeId: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(changeId) && !changeId.includes("..") && !changeId.includes("/") && !changeId.includes("\\");
}

function slug(value: string): string {
  const slugged = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slugged.length > 0 ? slugged.slice(0, 48).replace(/-+$/g, "") : "finding";
}

export function expectedFollowUpId(sourceChangeId: string, finding: Pick<RetroProblem | ProblemRow, "problem">, actionableIndex: number): string {
  return `retro-${slug(sourceChangeId)}-${String(actionableIndex + 1).padStart(2, "0")}-${slug(finding.problem)}`.slice(0, 96).replace(/-+$/g, "");
}

function fileText(filePath: string): string | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  return normalizeText(fs.readFileSync(filePath, "utf8"));
}

function section(text: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^##\\s+${escaped}\\s*$\\n(?<body>[\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "m"));
  return match?.groups?.body ?? null;
}

function replaceSection(text: string, heading: string, body: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const replacement = `## ${heading}\n\n${body.trimEnd()}\n\n`;
  const pattern = new RegExp(`^##\\s+${escaped}\\s*$\\n[\\s\\S]*?(?=^##\\s+|(?![\\s\\S]))`, "m");
  if (!pattern.test(text)) {
    return `${text.trimEnd()}\n\n${replacement}`;
  }
  return text.replace(pattern, () => replacement);
}

function hasFinalRetroSection(tasks: string): boolean {
  const headings = Array.from(tasks.matchAll(/^##\s+(.+?)\s*$/gm), (match) => match[1].trim());
  return headings.length > 0 && headings[headings.length - 1] === "Retrospective Before Archive";
}

function lineValue(body: string, marker: string): string | undefined {
  const line = body.split("\n").find((candidate) => candidate.toLowerCase().includes(marker.toLowerCase()));
  if (line == null) {
    return undefined;
  }
  const colonIndex = line.indexOf(":");
  return colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : undefined;
}

function nullableLineValue(body: string, marker: string): string | null {
  const value = lineValue(body, marker);
  return isMeaningful(value) ? value?.replace(/[.。]+$/, "") ?? null : null;
}

function parseDecision(decisionSection: string): string | undefined {
  const value = lineValue(decisionSection, "Decision");
  return value?.trim().toLowerCase();
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") && trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed;
  const cells: string[] = [];
  let current = "";
  let escaping = false;
  for (const char of inner) {
    if (escaping) {
      current += char === "|" ? "|" : `\\${char}`;
      escaping = false;
    } else if (char === "\\") {
      escaping = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (escaping) {
    current += "\\";
  }
  cells.push(current.trim());
  return cells;
}

function markdownTextCell(value: string): string | null {
  const trimmed = value.trim();
  return isMeaningful(trimmed) ? trimmed : null;
}

function markdownIdCell(value: string): string | null {
  const match = value.match(/`([^`]+)`/);
  const candidate = (match?.[1] ?? value.replace(/^`|`$/g, "")).trim().replace(/[.。]+$/, "");
  return isMeaningful(candidate) ? candidate : null;
}

function parseProblemRows(problemSection: string | null): { rows: ProblemRow[]; malformedRows: number } {
  if (problemSection == null) {
    return { rows: [], malformedRows: 0 };
  }
  let malformedRows = 0;
  const contentLines = problemSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => isMeaningful(line));
  const tableLines = contentLines.filter((line) => line.startsWith("|") && line.endsWith("|"));
  malformedRows += contentLines.length - tableLines.length;
  const hasHeader = tableLines.some((line) => /^\|\s*Problem\s*\|/i.test(line) && /\|\s*Follow-up Change\s*\|/i.test(line) && /\|\s*No Follow-up Reason\s*\|/i.test(line));
  const hasSeparator = tableLines.some((line) => /^\|\s*:?-+\s*\|/.test(line));
  if (!hasHeader || !hasSeparator) {
    malformedRows++;
  }
  const rows = tableLines
    .filter((line) => !/^\|\s*:?-+\s*\|/.test(line) && !/^\|\s*Problem\s*\|/i.test(line))
    .flatMap((line): ProblemRow[] => {
      const cells = splitMarkdownRow(line);
      if (cells.length !== 9 && cells.length !== 12) {
        malformedRows++;
        return [];
      }
      return [{
        problem: cells[0],
        evidence: cells[1],
        impact: cells[2],
        rootCause: cells[3],
        recommendation: cells[4],
        confidence: cells[5].trim().toLowerCase(),
        target: cells[6].trim(),
        followUpChangeId: markdownIdCell(cells[7]),
        noFollowUpReason: markdownTextCell(cells[8]),
        preventionTarget: cells.length === 12 ? markdownTextCell(cells[9]) : null,
        draftRule: cells.length === 12 ? markdownTextCell(cells[10]) : null,
        replayEvidenceRef: cells.length === 12 ? markdownTextCell(cells[11]) : null,
      }];
    });
  return { rows, malformedRows };
}

function outputChangeIds(outputs: string | null, marker: string): string[] {
  if (outputs == null) {
    return [];
  }
  const escaped = marker === "opencode-dev-kit"
    ? "`?opencode-dev-kit`?\\s+proposals/changes"
    : marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = outputs.match(new RegExp(`^[-*]\\s+${escaped}\\s*:\\s*(?<value>.*)$`, "im"));
  const value = match?.groups?.value;
  if (!isMeaningful(value)) {
    return [];
  }
  return Array.from(value.matchAll(/`([^`]+)`/g), (match) => match[1].trim()).filter((id) => id.length > 0);
}

function outputTextValue(outputs: string | null, label: string): string | null {
  if (outputs == null) {
    return null;
  }
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = outputs.match(new RegExp(`^[-*]\\s+${escaped}\\s*:\\s*(?<value>.*)$`, "im"));
  const value = match?.groups?.value;
  return isMeaningful(value) ? value?.replace(/[.。]+$/, "") ?? null : null;
}

function parseEvidence(evidenceSection: string | null): RetroEvidence[] {
  if (evidenceSection == null) {
    return [];
  }
  return evidenceSection
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => isMeaningful(line))
    .map((line) => ({ kind: "unknown", source: line, status: "unknown", summary: line }));
}

function fileIncludesAll(filePath: string, values: string[]): boolean {
  const text = fileText(filePath);
  return text != null && values.every((value) => text.includes(value));
}

function validateFollowUpChange(root: string, changeId: string, finding: Pick<RetroProblem | ProblemRow, "problem" | "evidence" | "impact" | "rootCause" | "recommendation" | "target" | "preventionTarget" | "draftRule" | "replayEvidenceRef">): string[] {
  if (!safeChangeId(changeId)) {
    return [`${changeId} is not a safe follow-up change id.`];
  }
  const changeRoot = path.join(root, "openspec", "changes", changeId);
  const proposalPath = path.join(changeRoot, "proposal.md");
  const tasksPath = path.join(changeRoot, "tasks.md");
  const specPath = path.join(changeRoot, "specs", changeId, "spec.md");
  const errors: string[] = [];
  if (!fs.existsSync(proposalPath) || !fs.existsSync(tasksPath) || !fs.existsSync(specPath)) {
    errors.push(`${changeId} must exist with proposal.md, tasks.md, and a spec delta before archive.`);
    return errors;
  }
  if (!fileIncludesAll(proposalPath, [finding.problem, finding.evidence, finding.impact, finding.rootCause, finding.recommendation])) {
    errors.push(`${changeId} proposal.md must preserve the retrospective problem, evidence, impact, root cause, and recommendation.`);
  }
  const taskRootCauseFragment = isUnknownRootCause(finding.rootCause) ? "Investigate and document the root cause" : finding.rootCause;
  const specRootCauseFragment = isUnknownRootCause(finding.rootCause) ? "discovered root cause" : finding.rootCause;
  if (!fileIncludesAll(tasksPath, [taskRootCauseFragment, finding.recommendation])) {
    errors.push(`${changeId} tasks.md must preserve the retrospective root cause and recommendation.`);
  }
  if (!fileIncludesAll(specPath, ["## ADDED Requirements", "#### Scenario:", specRootCauseFragment, finding.recommendation])) {
    errors.push(`${changeId} spec delta must preserve the retrospective root cause.`);
  }
  if (finding.target === "instruction-artifact") {
    const preventionTarget = finding.preventionTarget ?? "";
    const draftRule = finding.draftRule ?? "";
    const replayEvidenceRef = finding.replayEvidenceRef ?? "";
    if (!fileIncludesAll(proposalPath, ["## Prevention", preventionTarget, draftRule])) {
      errors.push(`${changeId} proposal.md must preserve the prevention target and draft rule.`);
    }
    if (!fileIncludesAll(tasksPath, ["## Prevention Rule", replayEvidenceRef])) {
      errors.push(`${changeId} tasks.md must preserve the replay evidence reference.`);
    }
    if (!fileIncludesAll(specPath, ["Requirement: Prevention Rule Surfaces In Instruction Artifact"])) {
      errors.push(`${changeId} spec delta must require the prevention rule to surface in the instruction artifact.`);
    }
  }
  return errors;
}

function defaultRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function rowsToProblems(changeId: string, rows: ProblemRow[], outputs: string | null, errors: string[]): RetroProblem[] {
  const actionableRows = rows.filter((row) => row.target === "project-local" || row.target === "opencode-dev-kit" || row.target === "instruction-artifact");
  const projectIds = outputChangeIds(outputs, "Project follow-up changes");
  const devKitIds = outputChangeIds(outputs, "opencode-dev-kit");
  const instructionIds = outputChangeIds(outputs, "Instruction-artifact follow-up changes");
  return rows.map((row) => {
    const actionableIndex = actionableRows.indexOf(row);
    const target = findingTargets.has(row.target) ? row.target as RetroProblem["target"] : "none";
    if (!findingTargets.has(row.target)) {
      errors.push(`Retrospective finding '${row.problem}' target must be one of project-local, opencode-dev-kit, none.`);
    }
    if (!confidenceValues.has(row.confidence)) {
      errors.push(`Retrospective finding '${row.problem}' confidence must be one of low, medium, high.`);
    }
      const outputIds = target === "project-local" ? projectIds : target === "opencode-dev-kit" ? devKitIds : target === "instruction-artifact" ? instructionIds : [];
    const expectedId = actionableIndex >= 0 ? expectedFollowUpId(changeId, row, actionableIndex) : null;
    const outputFollowUpId = expectedId != null && outputIds.includes(expectedId) ? expectedId : null;
    return {
      problem: row.problem,
      evidence: row.evidence,
      impact: row.impact,
      rootCause: row.rootCause,
      recommendation: row.recommendation,
      confidence: confidenceValues.has(row.confidence) ? row.confidence as RetroProblem["confidence"] : "low",
      target,
      followUpChangeId: target === "none" ? null : row.followUpChangeId ?? outputFollowUpId,
      noFollowUpReason: row.noFollowUpReason,
      preventionTarget: row.preventionTarget,
      draftRule: row.draftRule,
      replayEvidenceRef: row.replayEvidenceRef,
    };
  });
}

function parseRetroMarkdown(changeId: string, retrospective: string): { artifact?: RetroArtifact; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const heading = retrospective.match(/^#\s+(?:Retro|Retrospective):\s+(.+?)\s*$/m);
  if (heading == null) {
    errors.push("retro.md must start with '# Retro: <change-id>'.");
  } else if (heading[1] !== changeId) {
    errors.push(`retro.md heading change id must be '${changeId}'.`);
  }

  const evidence = section(retrospective, "Evidence Reviewed");
  const problems = section(retrospective, "Problems Found");
  const outputs = section(retrospective, "Outputs");
  const archiveDecision = section(retrospective, "Archive Gate Decision");
  if (evidence == null) {
    errors.push("retro.md must include ## Evidence Reviewed.");
  }
  if (problems == null) {
    errors.push("retro.md must include ## Problems Found.");
  }
  if (outputs == null) {
    errors.push("retro.md must include ## Outputs.");
  }
  if (archiveDecision == null) {
    errors.push("retro.md must include ## Archive Gate Decision.");
  }

  const evidenceReviewed = parseEvidence(evidence);
  if (evidenceReviewed.length === 0) {
    errors.push("retro.md Evidence Reviewed must include at least one evidence item.");
  }
  const parsedProblems = parseProblemRows(problems);
  if (parsedProblems.malformedRows > 0) {
    errors.push("Retrospective problem rows must have exactly nine columns or twelve columns: Problem, Evidence, Impact, Root Cause, Recommendation, Confidence, Target, Follow-up Change, No Follow-up Reason, and optional Prevention Target, Draft Rule, Replay Evidence Ref.");
  }
  const decision = archiveDecision != null ? parseDecision(archiveDecision) : undefined;
  if (!decisionValues.has(decision ?? "")) {
    errors.push("Archive Gate Decision must be one of: passed, blocked, approved-skip.");
  }
  const artifact: RetroArtifact = {
    changeId,
    evidenceReviewed,
    problems: rowsToProblems(changeId, parsedProblems.rows, outputs, errors),
    outputs: {
      projectFollowUpChanges: outputChangeIds(outputs, "Project follow-up changes"),
      opencodeDevKitChanges: outputChangeIds(outputs, "opencode-dev-kit"),
      instructionArtifactChanges: outputChangeIds(outputs, "Instruction-artifact follow-up changes"),
      noFindingsReason: outputTextValue(outputs, "No findings reason"),
    },
    archiveGate: {
      decision: decisionValues.has(decision ?? "") ? decision as RetroArtifact["archiveGate"]["decision"] : "blocked",
      reason: archiveDecision != null ? lineValue(archiveDecision, "Reason")?.replace(/[.。]+$/, "") ?? "" : "",
      approver: archiveDecision != null ? nullableLineValue(archiveDecision, "Approver") : null,
    },
  };
  return { artifact, errors, warnings };
}

function validateTasks(root: string, changeId: string, errors: string[]): void {
  const tasksPath = path.join(root, "openspec", "changes", changeId, "tasks.md");
  const tasks = fileText(tasksPath);
  if (tasks == null) {
    errors.push(`Missing tasks.md for ${changeId}.`);
    return;
  }
  const retroTasks = section(tasks, "Retrospective Before Archive");
  if (!hasFinalRetroSection(tasks)) {
    errors.push(`tasks.md must end with ## Retrospective Before Archive for ${changeId}.`);
  }
  for (const required of ["retro.md", "project-local OpenSpec", "opencode-dev-kit", "archive gate"]) {
    if (retroTasks == null || !retroTasks.toLowerCase().includes(required.toLowerCase())) {
      errors.push(`tasks.md Retrospective Before Archive section must mention ${required}.`);
    }
  }
}

function validateArtifactSemantics(root: string, artifact: RetroArtifact, errors: string[]): void {
  const projectIds = new Set(artifact.outputs.projectFollowUpChanges);
  const devKitIds = new Set(artifact.outputs.opencodeDevKitChanges);
  const instructionIds = new Set(artifact.outputs.instructionArtifactChanges ?? []);
  if (artifact.problems.length === 0 && !isMeaningful(artifact.outputs.noFindingsReason)) {
    errors.push("No-findings retrospectives must record Outputs No findings reason with evidence reviewed.");
  }
  for (const problem of artifact.problems) {
    if (![problem.problem, problem.evidence, problem.impact, problem.recommendation, problem.confidence].every(isMeaningful) || (!isMeaningful(problem.rootCause) && !isUnknownRootCause(problem.rootCause))) {
      errors.push("Retrospective problem entries must include problem, evidence, impact, root cause, recommendation, and confidence.");
    }
    if (isUnknownRootCause(problem.rootCause) && !routesUnknownRootCauseInvestigation(problem)) {
      errors.push(`Retrospective finding '${problem.problem}' has unknown root cause and must route investigation or instrumentation before remediation.`);
    }
    if (problem.target === "none") {
      if (problem.followUpChangeId != null) {
        errors.push(`Retrospective finding '${problem.problem}' target none must not set followUpChangeId.`);
      }
      if (!isMeaningful(problem.noFollowUpReason)) {
        errors.push(`Retrospective finding '${problem.problem}' target none must include noFollowUpReason.`);
      }
      continue;
    }
    if (problem.target === "instruction-artifact") {
      if (![problem.preventionTarget, problem.draftRule, problem.replayEvidenceRef].every(isMeaningful)) {
        errors.push(`Retrospective finding '${problem.problem}' target instruction-artifact must include Prevention Target, Draft Rule, and Replay Evidence Ref.`);
      }
    }
    if (!isMeaningful(problem.followUpChangeId) && !isMeaningful(problem.noFollowUpReason)) {
      errors.push(`Retrospective finding '${problem.problem}' must include followUpChangeId or noFollowUpReason.`);
      continue;
    }
    if (!isMeaningful(problem.followUpChangeId)) {
      continue;
    }
    const followUpId = problem.followUpChangeId as string;
    const outputIds = problem.target === "project-local" ? projectIds : problem.target === "opencode-dev-kit" ? devKitIds : instructionIds;
    if (!outputIds.has(followUpId)) {
      errors.push(`Retrospective finding '${problem.problem}' followUpChangeId must be listed in Outputs for ${problem.target}.`);
    }
    for (const followUpError of validateFollowUpChange(root, followUpId, problem)) {
      errors.push(`${problem.target} retrospective follow-up '${followUpId}' ${followUpError}`);
    }
  }
  if (!isMeaningful(artifact.archiveGate.reason)) {
    errors.push("Archive Gate Decision requires a reason.");
  }
  if (artifact.archiveGate.decision === "blocked") {
    errors.push("Archive Gate Decision is blocked.");
  } else if (artifact.archiveGate.decision === "approved-skip") {
    if (!isMeaningful(artifact.archiveGate.reason) || !isMeaningful(artifact.archiveGate.approver)) {
      errors.push("Archive Gate Decision approved skip requires a reason and approver.");
    }
  }
}

export function readRetroArtifact(root: string, changeId: string): RetroArtifact {
  if (!safeChangeId(changeId)) {
    throw new Error(`Invalid change id '${changeId}'.`);
  }
  const retroPath = path.join(root, "openspec", "changes", changeId, "retro.md");
  const text = fileText(retroPath);
  if (text == null) {
    throw new Error(`Missing retro.md for ${changeId}.`);
  }
  const parsed = parseRetroMarkdown(changeId, text);
  if (parsed.artifact == null || parsed.errors.length > 0) {
    throw new Error(`Invalid retro.md for ${changeId}: ${parsed.errors.join("; ")}`);
  }
  return parsed.artifact;
}

function markdownCell(value: string | null): string {
  if (value == null || value.trim() === "") {
    return "none";
  }
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function markdownId(value: string | null): string {
  return isMeaningful(value) ? `\`${value}\`` : "none";
}

function renderProblemRows(problems: RetroProblem[]): string {
  const hasPreventionColumns = problems.some((problem) => problem.target === "instruction-artifact" || isMeaningful(problem.preventionTarget) || isMeaningful(problem.draftRule) || isMeaningful(problem.replayEvidenceRef));
  const lines = hasPreventionColumns
    ? [
      "| Problem | Evidence | Impact | Root Cause | Recommendation | Confidence | Target | Follow-up Change | No Follow-up Reason | Prevention Target | Draft Rule | Replay Evidence Ref |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    : [
      "| Problem | Evidence | Impact | Root Cause | Recommendation | Confidence | Target | Follow-up Change | No Follow-up Reason |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ];
  for (const problem of problems) {
    const base = `| ${markdownCell(problem.problem)} | ${markdownCell(problem.evidence)} | ${markdownCell(problem.impact)} | ${markdownCell(problem.rootCause)} | ${markdownCell(problem.recommendation)} | ${markdownCell(problem.confidence)} | ${markdownCell(problem.target)} | ${markdownId(problem.followUpChangeId)} | ${markdownCell(problem.noFollowUpReason)} |`;
    lines.push(hasPreventionColumns ? `${base} ${markdownCell(problem.preventionTarget)} | ${markdownCell(problem.draftRule)} | ${markdownCell(problem.replayEvidenceRef)} |` : base);
  }
  return lines.join("\n");
}

function renderOutputIds(ids: string[]): string {
  return ids.length === 0 ? "none" : ids.map((id) => `\`${id}\``).join(", ");
}

function renderOutputs(artifact: RetroArtifact): string {
  return [
    `- Project follow-up changes: ${renderOutputIds(artifact.outputs.projectFollowUpChanges)}.`,
    `- \`opencode-dev-kit\` proposals/changes: ${renderOutputIds(artifact.outputs.opencodeDevKitChanges)}.`,
    `- Instruction-artifact follow-up changes: ${renderOutputIds(artifact.outputs.instructionArtifactChanges ?? [])}.`,
    `- No findings reason: ${isMeaningful(artifact.outputs.noFindingsReason) ? artifact.outputs.noFindingsReason : "n/a"}.`,
  ].join("\n");
}

function renderArchiveGate(artifact: RetroArtifact): string {
  return [
    `- Decision: ${artifact.archiveGate.decision}`,
    `- Reason: ${artifact.archiveGate.reason}`,
    `- Approver, if skipped: ${isMeaningful(artifact.archiveGate.approver) ? artifact.archiveGate.approver : "none"}`,
  ].join("\n");
}

function renderRetroMarkdown(artifact: RetroArtifact): string {
  const evidence = artifact.evidenceReviewed.length === 0
    ? "- Evidence unavailable."
    : artifact.evidenceReviewed.map((item) => `- ${item.source}`).join("\n");
  return `# Retro: ${artifact.changeId}

## Evidence Reviewed

${evidence}

## Problems Found

${renderProblemRows(artifact.problems)}

## Outputs

${renderOutputs(artifact)}

## Archive Gate Decision

${renderArchiveGate(artifact)}
`;
}

export function writeRetroArtifact(root: string, artifact: RetroArtifact): void {
  if (!safeChangeId(artifact.changeId)) {
    throw new Error(`Invalid change id '${artifact.changeId}'.`);
  }
  const retroPath = path.join(root, "openspec", "changes", artifact.changeId, "retro.md");
  fs.mkdirSync(path.dirname(retroPath), { recursive: true });
  const current = fileText(retroPath);
  const next = current == null
    ? renderRetroMarkdown(artifact)
    : replaceSection(
      replaceSection(current, "Problems Found", renderProblemRows(artifact.problems)),
      "Outputs",
      renderOutputs(artifact),
    );
  fs.writeFileSync(retroPath, `${next.trimEnd()}\n`, "utf8");
}

export function evaluateRetroGate(root: string, changeId: string): RetroGateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let archiveAllowed = false;

  if (!safeChangeId(changeId)) {
    errors.push(`Invalid change id '${changeId}'.`);
    return { valid: false, changeId, errors, warnings, archiveAllowed };
  }

  validateTasks(root, changeId, errors);
  const retroPath = path.join(root, "openspec", "changes", changeId, "retro.md");
  const retroText = fileText(retroPath);
  if (retroText == null) {
    errors.push(`Missing retro.md for ${changeId}.`);
    return { valid: false, changeId, errors, warnings, archiveAllowed };
  }

  const parsed = parseRetroMarkdown(changeId, retroText);
  errors.push(...parsed.errors);
  warnings.push(...parsed.warnings);
  if (parsed.artifact != null) {
    validateArtifactSemantics(root, parsed.artifact, errors);
  }

  archiveAllowed = errors.length === 0;
  return { valid: errors.length === 0, changeId, errors, warnings, archiveAllowed };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { root: process.cwd(), format: "json" };
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

function renderText(result: RetroGateResult): string {
  const lines = [
    `changeId: ${result.changeId}`,
    `valid: ${String(result.valid)}`,
    `archiveAllowed: ${String(result.archiveAllowed)}`,
  ];
  for (const error of result.errors) {
    lines.push(`error: ${error}`);
  }
  for (const warning of result.warnings) {
    lines.push(`warning: ${warning}`);
  }
  return `${lines.join("\n")}\n`;
}

function runCli(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.changeId == null) {
      throw new Error("Usage: node tools/openspec-retro-gate.ts <change-id> [--root <repo>] [--format json|text]");
    }
    const result = evaluateRetroGate(options.root || defaultRoot(), options.changeId);
    process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderText(result));
    if (!result.valid) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
