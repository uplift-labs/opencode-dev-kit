#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRetroGate, readRetroArtifact, writeRetroArtifact } from "./openspec-retro-gate.ts";

type TestCase = {
  name: string;
  run: () => void;
};

type FindingFixture = {
  problem: string;
  evidence: string;
  impact: string;
  rootCause: string;
  recommendation: string;
  confidence: "low" | "medium" | "high";
  target: "project-local" | "opencode-dev-kit" | "instruction-artifact" | "none";
  followUpChangeId: string | null;
  noFollowUpReason: string | null;
  preventionTarget?: string;
  recurrencePath?: string;
  draftRule?: string;
  replayEvidenceRef?: string;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectFinding: FindingFixture = {
  problem: "Project docs drift",
  evidence: "README section stale",
  impact: "Reviewers miss current commands",
  rootCause: "README routing was not updated with the changed command contract",
  recommendation: "Create follow-up",
  confidence: "high",
  target: "project-local",
  followUpChangeId: "retro-example-01-project-docs-drift",
  noFollowUpReason: null,
};
const devkitFinding: FindingFixture = {
  problem: "Workflow routing friction",
  evidence: "No-progress handoff repeated",
  impact: "Token waste",
  rootCause: "Routing guidance did not distinguish safe handoff from repeated no-progress calls",
  recommendation: "Improve reusable skill guidance",
  confidence: "high",
  target: "opencode-dev-kit",
  followUpChangeId: "retro-example-02-workflow-routing-friction",
  noFollowUpReason: null,
};
const unknownFinding: FindingFixture = {
  problem: "Mystery failure",
  evidence: "Repeated failed validation without stable repro",
  impact: "Agents cannot pick a safe fix",
  rootCause: "unknown",
  recommendation: "Investigate root cause with instrumentation before implementing a fix",
  confidence: "medium",
  target: "project-local",
  followUpChangeId: "retro-unknown-investigation-01-mystery-failure",
  noFollowUpReason: null,
};
const instructionFinding: FindingFixture = {
  problem: "Reviewer missed recurrence prevention",
  evidence: "P1 finding had no prevention feedback",
  impact: "Same reviewer contract gap recurs",
  rootCause: "Reviewer output contract lacked durable Prevention Feedback fields",
  recommendation: "Add durable Prevention Feedback contract to reviewer agents",
  confidence: "high",
  target: "instruction-artifact",
  followUpChangeId: "retro-example-03-reviewer-missed-recurrence-prevention",
  noFollowUpReason: null,
  preventionTarget: "agent:code-quality-reviewer",
  recurrencePath: "Reviewer contract should have required prevention feedback for P1 findings.",
  draftRule: "Reviewer agents should return Prevention Feedback for P0/P1 findings.",
  replayEvidenceRef: "fixture:reviewer-output/p1-prevention-feedback",
};

function withTempRepo(name: string, run: (repo: string) => void): void {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `openspec-retro-gate-${name}-`));
  try {
    run(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function writeChange(repo: string, changeId: string, files: Record<string, string>): void {
  const base = path.join(repo, "openspec", "changes", changeId);
  fs.mkdirSync(base, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const filePath = path.join(base, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function tasksWithRetroMd(changeId = "example"): string {
  return `# Tasks: Example

## Implementation

- [x] Do the work.

## Retrospective Before Archive

- [x] Review the completed change context, validation, reviewer gates, blockers, repeated work, wait time, token-heavy steps, and likely root causes.
- [x] Write \`openspec/changes/${changeId}/retro.md\` with evidence, problems, root causes, improvements, follow-up ids, and archive gate decision.
- [x] Run \`npm run openspec:retro-followups -- ${changeId}\` when available so actionable retrospective findings create or update follow-up OpenSpec changes before archive.
- [x] If the helper is unavailable, manually create or update project-local OpenSpec follow-up changes for project-local findings; for reusable \`opencode-dev-kit\` findings, write only when the current repository owns the reusable artifact and current write scope includes it, otherwise record a local handoff and do not write cross-repo without explicit approval.
- [x] Confirm archive is allowed only after the retro gate passes or an approved skip reason is recorded in \`retro.md\`.
`;
}

function markdownId(value: string | null): string {
  return value == null ? "none" : `\`${value}\``;
}

function markdownText(value: string | null): string {
  return value == null ? "none" : value;
}

function problemTable(problems: FindingFixture[]): string {
  const hasPreventionColumns = problems.some((problem) => problem.target === "instruction-artifact");
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
    const base = `| ${problem.problem} | ${problem.evidence} | ${problem.impact} | ${problem.rootCause} | ${problem.recommendation} | ${problem.confidence} | ${problem.target} | ${markdownId(problem.followUpChangeId)} | ${markdownText(problem.noFollowUpReason)} |`;
    lines.push(hasPreventionColumns ? `${base} ${markdownText(problem.preventionTarget)} | ${markdownText(problem.draftRule)} | ${markdownText(problem.replayEvidenceRef)} |` : base);
  }
  return lines.join("\n");
}

function outputIds(ids: Array<string | null>): string {
  const nonNull = ids.filter((id): id is string => id != null);
  return nonNull.length === 0 ? "none" : nonNull.map((id) => `\`${id}\``).join(", ");
}

function retroMd(changeId: string, problems: FindingFixture[] = [], options: { decision?: string; reason?: string; approver?: string | null; headingChangeId?: string; evidence?: string[] } = {}): string {
  const evidence = options.evidence ?? ["OpenSpec artifacts: proposal, design, tasks.", "Tool outputs / validation: `npm test` passed."];
  const projectIds = problems.filter((problem) => problem.target === "project-local").map((problem) => problem.followUpChangeId);
  const devkitIds = problems.filter((problem) => problem.target === "opencode-dev-kit").map((problem) => problem.followUpChangeId);
  const instructionIds = problems.filter((problem) => problem.target === "instruction-artifact").map((problem) => problem.followUpChangeId);
  const decision = options.decision ?? "passed";
  const reason = options.reason ?? (problems.length === 0 ? "No findings with evidence reviewed." : "Findings routed to durable OpenSpec changes.");
  const approver = options.approver ?? null;
  return `# Retro: ${options.headingChangeId ?? changeId}

## Evidence Reviewed

${evidence.map((line) => `- ${line}`).join("\n")}

## Problems Found

${problemTable(problems)}

## Outputs

- Project follow-up changes: ${outputIds(projectIds)}.
- \`opencode-dev-kit\` proposals/changes: ${outputIds(devkitIds)}.
- Instruction-artifact follow-up changes: ${outputIds(instructionIds)}.
- No findings reason: ${problems.length === 0 ? "Evidence reviewed; no actionable findings." : "n/a"}.

## Archive Gate Decision

- Decision: ${decision}
- Reason: ${reason}
- Approver, if skipped: ${approver ?? "none"}
`;
}

function writeRetroMd(repo: string, changeId: string, markdown = retroMd(changeId)): void {
  writeChange(repo, changeId, {
    "tasks.md": tasksWithRetroMd(changeId),
    "retro.md": markdown,
  });
}

function findingForFollowUp(changeId: string): FindingFixture {
  if (changeId.includes("workflow-routing")) {
    return devkitFinding;
  }
  if (changeId.includes("mystery-failure")) {
    return unknownFinding;
  }
  return projectFinding;
}

function writeFollowUpWithoutSpec(repo: string, changeId: string, finding = findingForFollowUp(changeId)): void {
  const base = path.join(repo, "openspec", "changes", changeId);
  fs.mkdirSync(base, { recursive: true });
  const rootCauseTask = finding.rootCause === "unknown"
    ? `Investigate and document the root cause before designing the fix: ${finding.recommendation}`
    : `Confirm root cause: ${finding.rootCause}`;
  const preventionProposal = finding.target === "instruction-artifact"
    ? `\n## Prevention\n\n- Prevention Target: ${finding.preventionTarget}\n- Draft Rule: ${finding.draftRule}\n- Replay Evidence Ref: ${finding.replayEvidenceRef}\n`
    : "";
  const preventionTasks = finding.target === "instruction-artifact"
    ? `\n## Prevention Rule\n\n- [ ] Confirm target artifact: ${finding.preventionTarget}\n- [ ] run replay gate using: ${finding.replayEvidenceRef}\n`
    : "";
  fs.writeFileSync(path.join(base, "proposal.md"), `# Proposal: ${finding.problem}\n\n- Problem: ${finding.problem}\n- Evidence: ${finding.evidence}\n- Impact: ${finding.impact}\n- Root cause: ${finding.rootCause}\n- Recommendation: ${finding.recommendation}\n${preventionProposal}`, "utf8");
  fs.writeFileSync(path.join(base, "tasks.md"), `# Tasks: ${finding.problem}\n\n- [ ] ${rootCauseTask}\n- [ ] Implement or investigate: ${finding.recommendation}\n${preventionTasks}`, "utf8");
}

function writeFollowUp(repo: string, changeId: string, finding = findingForFollowUp(changeId)): void {
  writeFollowUpWithoutSpec(repo, changeId, finding);
  const base = path.join(repo, "openspec", "changes", changeId);
  const specPath = path.join(base, "specs", changeId, "spec.md");
  const specRootCause = finding.rootCause === "unknown" ? "discovered root cause" : finding.rootCause;
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  const preventionSpec = finding.target === "instruction-artifact"
    ? `\n### Requirement: Prevention Rule Surfaces In Instruction Artifact\n\n#### Scenario: Prevention rule is visible\n\n- **GIVEN** this follow-up targets ${finding.preventionTarget}\n- **WHEN** the follow-up lands\n- **THEN** the draft rule is observable: ${finding.draftRule}.\n`
    : "";
  fs.writeFileSync(specPath, `# ${changeId} Specification\n\n## ADDED Requirements\n\n### Requirement: Follow-Up Preserves Retrospective Evidence\n\nThe follow-up SHALL preserve the routed retrospective root cause and recommendation.\n\n#### Scenario: Routed evidence is available\n\n- **GIVEN** a retrospective finding references this follow-up\n- **WHEN** the archive gate checks routed findings\n- **THEN** the follow-up proposal, tasks, and spec delta preserve root cause: ${specRootCause}.\n- **AND** the follow-up implements or investigates: ${finding.recommendation}.\n${preventionSpec}`, "utf8");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertErrorIncludes(errors: string[], expected: string): void {
  assert(errors.some((error) => error.includes(expected)), `Expected errors to include ${expected}, got ${JSON.stringify(errors)}.`);
}

function readRepoText(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

const tests: TestCase[] = [
  {
    name: "retro gate requires retro md",
    run: () => withTempRepo("missing-md", (repo) => {
      const unsafe = evaluateRetroGate(repo, "../escape");
      assert(!unsafe.valid && !unsafe.archiveAllowed, "Unsafe source change id must fail retro gate.");
      assertErrorIncludes(unsafe.errors, "Invalid change id");

      writeChange(repo, "example", { "tasks.md": tasksWithRetroMd(), "automation/retro.json": "{}\n" });
      const result = evaluateRetroGate(repo, "example");
      assert(!result.valid, "Missing retro.md must fail.");
      assert(!result.archiveAllowed, "Missing retro.md must block archive.");
      assertErrorIncludes(result.errors, "retro.md");
    }),
  },
  {
    name: "retro gate accepts concise no-findings markdown retro",
    run: () => withTempRepo("no-findings", (repo) => {
      writeRetroMd(repo, "example");
      const result = evaluateRetroGate(repo, "example");
      assert(result.valid, `No-findings retro.md should pass, got ${JSON.stringify(result.errors)}.`);
      assert(result.archiveAllowed, "No-findings retro.md should allow archive.");
    }),
  },
  {
    name: "retro gate validates approved skip reason and approver",
    run: () => withTempRepo("approved-skip", (repo) => {
      writeRetroMd(repo, "example", retroMd("example", [], { decision: "approved-skip", reason: "Product owner approved archive without findings.", approver: "product-owner" }));
      const accepted = evaluateRetroGate(repo, "example");
      assert(accepted.valid && accepted.archiveAllowed, `Approved skip with reason and approver should pass, got ${JSON.stringify(accepted.errors)}.`);

      writeRetroMd(repo, "broken", retroMd("broken", [], { decision: "approved-skip", reason: "", approver: null }));
      const rejected = evaluateRetroGate(repo, "broken");
      assert(!rejected.valid, "Approved skip without reason/approver must fail.");
      assertErrorIncludes(rejected.errors, "approved skip");
    }),
  },
  {
    name: "retro gate validates markdown contract and routed findings",
    run: () => withTempRepo("finding-routing", (repo) => {
      writeRetroMd(repo, "example", retroMd("example", [projectFinding, devkitFinding]));
      writeFollowUp(repo, "retro-example-01-project-docs-drift");
      writeFollowUp(repo, "retro-example-02-workflow-routing-friction");
      const accepted = evaluateRetroGate(repo, "example");
      assert(accepted.valid && accepted.archiveAllowed, `Routed findings should pass, got ${JSON.stringify(accepted.errors)}.`);

      writeRetroMd(repo, "wrong-change", retroMd("wrong-change", [], { headingChangeId: "other-change" }));
      assertErrorIncludes(evaluateRetroGate(repo, "wrong-change").errors, "heading change id");

      writeRetroMd(repo, "missing-evidence", retroMd("missing-evidence", [], { evidence: [] }));
      assertErrorIncludes(evaluateRetroGate(repo, "missing-evidence").errors, "Evidence Reviewed");

      writeRetroMd(repo, "escaped-pipe", `# Retro: escaped-pipe

## Evidence Reviewed

- Tool outputs / validation: npm test passed.

## Problems Found

| Problem | Evidence | Impact | Root Cause | Recommendation | Confidence | Target | Follow-up Change | No Follow-up Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pipe \\| problem | Evidence \\| detail | No remaining impact | Fixed root cause | No follow-up needed | high | none | none | Fixed in scope. |

## Outputs

- Project follow-up changes: none.
- \`opencode-dev-kit\` proposals/changes: none.
- No findings reason: n/a.

## Archive Gate Decision

- Decision: passed
- Reason: Escaped pipe table parsed.
- Approver, if skipped: none
`);
      assert(evaluateRetroGate(repo, "escaped-pipe").valid, "Escaped Markdown pipes in problem rows should parse.");

      const sectionCases = [
        { id: "missing-evidence-section", heading: "Evidence Reviewed" },
        { id: "missing-problems-section", heading: "Problems Found" },
        { id: "missing-outputs-section", heading: "Outputs" },
        { id: "missing-decision-section", heading: "Archive Gate Decision" },
      ];
      for (const item of sectionCases) {
        const markdown = retroMd(item.id).replace(new RegExp(`\\n## ${item.heading}\\n[\\s\\S]*?(?=\\n## |$)`), "");
        writeRetroMd(repo, item.id, markdown);
        const result = evaluateRetroGate(repo, item.id);
        assert(!result.valid && !result.archiveAllowed, `${item.heading} omission must block archive.`);
        assertErrorIncludes(result.errors, `## ${item.heading}`);
      }

      writeRetroMd(repo, "missing-outputs", retroMd("missing-outputs").replace(/\n## Outputs\n[\s\S]*?(?=\n## Archive Gate Decision)/, ""));
      assertErrorIncludes(evaluateRetroGate(repo, "missing-outputs").errors, "## Outputs");

      writeRetroMd(repo, "prose-finding", retroMd("prose-finding", []).replace("| Problem | Evidence | Impact | Root Cause | Recommendation | Confidence | Target | Follow-up Change | No Follow-up Reason |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |", "- Project docs drift: README section stale."));
      assertErrorIncludes(evaluateRetroGate(repo, "prose-finding").errors, "nine columns");

      writeChange(repo, "non-final-retro", { "tasks.md": `${tasksWithRetroMd("non-final-retro")}\n## Extra\n\n- [ ] Later work.\n`, "retro.md": retroMd("non-final-retro") });
      assertErrorIncludes(evaluateRetroGate(repo, "non-final-retro").errors, "must end with ## Retrospective Before Archive");

      writeChange(repo, "missing-tail-marker", { "tasks.md": tasksWithRetroMd("missing-tail-marker").replace("opencode-dev-kit", "reusable-artifact repository"), "retro.md": retroMd("missing-tail-marker") });
      assertErrorIncludes(evaluateRetroGate(repo, "missing-tail-marker").errors, "opencode-dev-kit");

      writeRetroMd(repo, "malformed-table", retroMd("malformed-table", [projectFinding]).replace("| Project docs drift | README section stale | Reviewers miss current commands | README routing was not updated with the changed command contract | Create follow-up | high | project-local | `retro-example-01-project-docs-drift` | none |", "| Project docs drift | README section stale | project-local |"));
      assertErrorIncludes(evaluateRetroGate(repo, "malformed-table").errors, "nine columns");

      writeRetroMd(repo, "bad-confidence", retroMd("bad-confidence", [{ ...projectFinding, confidence: "high" as const }]).replace("| high | project-local |", "| maybe | project-local |"));
      assertErrorIncludes(evaluateRetroGate(repo, "bad-confidence").errors, "confidence");

      writeRetroMd(repo, "bad-target", retroMd("bad-target", [projectFinding]).replace("| high | project-local |", "| high | elsewhere |"));
      assertErrorIncludes(evaluateRetroGate(repo, "bad-target").errors, "target");

      writeRetroMd(repo, "malformed-finding", retroMd("malformed-finding", [{ ...projectFinding, evidence: "" }]));
      assertErrorIncludes(evaluateRetroGate(repo, "malformed-finding").errors, "problem entries must include");

      writeRetroMd(repo, "missing-follow-up-id", retroMd("missing-follow-up-id", [{ ...projectFinding, followUpChangeId: null }]));
      assertErrorIncludes(evaluateRetroGate(repo, "missing-follow-up-id").errors, "followUpChangeId");

      writeRetroMd(repo, "missing-follow-up", retroMd("missing-follow-up", [{ ...projectFinding, followUpChangeId: "retro-missing-follow-up-01-project-docs-drift" }]));
      assertErrorIncludes(evaluateRetroGate(repo, "missing-follow-up").errors, "must exist with proposal.md");

      writeRetroMd(repo, "unknown-with-fix", retroMd("unknown-with-fix", [{ ...unknownFinding, followUpChangeId: "retro-unknown-with-fix-01-mystery-failure", recommendation: "Apply guessed fix immediately" }]));
      writeFollowUp(repo, "retro-unknown-with-fix-01-mystery-failure", { ...unknownFinding, recommendation: "Apply guessed fix immediately" });
      assertErrorIncludes(evaluateRetroGate(repo, "unknown-with-fix").errors, "unknown root cause");

      writeRetroMd(repo, "bad-decision", retroMd("bad-decision", [], { decision: "maybe", reason: "bad", approver: null }));
      assertErrorIncludes(evaluateRetroGate(repo, "bad-decision").errors, "Archive Gate Decision");
    }),
  },
  {
    name: "retro gate accepts instruction-artifact target and outputs bucket",
    run: () => withTempRepo("instruction-artifact", (repo) => {
      writeRetroMd(repo, "example", retroMd("example", [projectFinding, devkitFinding, instructionFinding]));
      writeFollowUp(repo, "retro-example-01-project-docs-drift");
      writeFollowUp(repo, "retro-example-02-workflow-routing-friction");
      writeFollowUp(repo, "retro-example-03-reviewer-missed-recurrence-prevention", instructionFinding);
      const result = evaluateRetroGate(repo, "example");
      assert(result.valid && result.archiveAllowed, `Instruction-artifact target should pass, got ${JSON.stringify(result.errors)}.`);
      const artifact = readRetroArtifact(repo, "example");
      assert(artifact.outputs.instructionArtifactChanges.includes("retro-example-03-reviewer-missed-recurrence-prevention"), "Instruction-artifact output bucket must parse.");
      assert(artifact.problems[2].preventionTarget === "agent:code-quality-reviewer", "Prevention target must parse from 12-column row.");

      writeRetroArtifact(repo, artifact);
      const retro = fs.readFileSync(path.join(repo, "openspec", "changes", "example", "retro.md"), "utf8");
      assert(retro.includes("Instruction-artifact follow-up changes"), "Rendered Outputs must include instruction-artifact bucket.");
      assert(retro.includes("Prevention Target") && retro.includes("Replay Evidence Ref"), "Rendered problem table must preserve prevention columns.");

      writeRetroMd(repo, "missing-prevention", retroMd("missing-prevention", [{ ...instructionFinding, followUpChangeId: null, preventionTarget: undefined }]));
      const missing = evaluateRetroGate(repo, "missing-prevention");
      assert(!missing.valid, "Instruction-artifact rows without prevention fields must fail.");
      assertErrorIncludes(missing.errors, "Prevention Target");
    }),
  },
  {
    name: "OpenSpec workflow skills document markdown retro gate",
    run: () => {
      const archive = readRepoText(".opencode/skills/openspec-archive-change/SKILL.md");
      const propose = readRepoText(".opencode/skills/openspec-propose/SKILL.md");
      const apply = readRepoText(".opencode/skills/openspec-apply-change/SKILL.md");
      const nextStep = readRepoText(".opencode/skills/next-step/SKILL.md");
      const readme = readRepoText("README.md");
      const projectGuide = readRepoText("openspec/project.md");
      const readmeOpenSpecRetro = readme.slice(readme.indexOf("## OpenSpec Retrospective Gate"), readme.indexOf("## Skill Catalog"));

      for (const [label, text] of Object.entries({ archive, propose, apply, nextStep, readmeOpenSpecRetro, projectGuide })) {
        assert(text.includes("retro.md"), `${label} must require retro.md.`);
        assert(!text.includes("automation/retro.json"), `${label} must not require automation/retro.json.`);
      }
      assert(archive.includes("openspec:retro-followups") && archive.includes("openspec:retro-gate") && archive.toLowerCase().includes("root cause") && archive.includes("approved skip"), "openspec-archive-change must enforce follow-up generation, root-cause evidence, the retro gate, and approved skip path.");
      assert(propose.includes("## Retrospective Before Archive") && propose.includes("openspec:retro-followups"), "openspec-propose must include the final Markdown retrospective task template.");
      assert(apply.includes("openspec:retro-followups") && apply.includes("before archive"), "openspec-apply-change must hand completed changes to follow-up generation and the Markdown retrospective gate before archive.");
    },
  },
];

let failed = 0;
for (const test of tests) {
  try {
    test.run();
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${test.name}`);
    console.error(message);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`OK: openspec retro gate tests=${tests.length}`);
