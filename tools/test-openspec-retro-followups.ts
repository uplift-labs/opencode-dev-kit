#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRetroFollowUps } from "./openspec-retro-followups.ts";
import { evaluateRetroGate } from "./openspec-retro-gate.ts";

type TestCase = {
  name: string;
  run: () => void;
};

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const retroFollowupsCli = path.join(toolDir, "openspec-retro-followups.ts");
const retroGateCli = path.join(toolDir, "openspec-retro-gate.ts");

function withTempRepo(name: string, run: (repo: string) => void): void {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `openspec-retro-followups-${name}-`));
  try {
    run(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function tasksWithRetro(changeId: string): string {
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

function markdownId(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? `\`${value}\`` : "none";
}

function markdownText(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : "none";
}

function problemTable(problems: Record<string, unknown>[]): string {
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
    const base = `| ${markdownText(problem.problem)} | ${markdownText(problem.evidence)} | ${markdownText(problem.impact)} | ${markdownText(problem.rootCause)} | ${markdownText(problem.recommendation)} | ${markdownText(problem.confidence)} | ${markdownText(problem.target)} | ${markdownId(problem.followUpChangeId)} | ${markdownText(problem.noFollowUpReason)} |`;
    lines.push(hasPreventionColumns ? `${base} ${markdownText(problem.preventionTarget)} | ${markdownText(problem.draftRule)} | ${markdownText(problem.replayEvidenceRef)} |` : base);
  }
  return lines.join("\n");
}

function outputIds(ids: unknown[]): string {
  const textIds = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  return textIds.length === 0 ? "none" : textIds.map((id) => `\`${id}\``).join(", ");
}

function retroMd(changeId: string, problems = defaultProblems()): string {
  return `# Retro: ${changeId}

## Evidence Reviewed

- Tool outputs / validation: npm test passed.

## Problems Found

${problemTable(problems)}

## Outputs

- Project follow-up changes: ${outputIds(problems.filter((problem) => problem.target === "project-local").map((problem) => problem.followUpChangeId))}.
- \`opencode-dev-kit\` proposals/changes: ${outputIds(problems.filter((problem) => problem.target === "opencode-dev-kit").map((problem) => problem.followUpChangeId))}.
- Instruction-artifact follow-up changes: ${outputIds(problems.filter((problem) => problem.target === "instruction-artifact").map((problem) => problem.followUpChangeId))}.
- No findings reason: ${problems.length === 0 ? "Evidence reviewed; no actionable findings." : "n/a"}.

## Archive Gate Decision

- Decision: passed
- Reason: ${problems.length === 0 ? "No findings with evidence reviewed." : "Findings routed to durable OpenSpec changes."}
- Approver, if skipped: none
`;
}

function defaultProblems(): Record<string, unknown>[] {
  return [
    {
      problem: "Project docs drift",
      evidence: "README section stale",
      impact: "Reviewers miss current commands",
      rootCause: "README routing was not updated with the changed command contract",
      recommendation: "Create docs follow-up",
      confidence: "high",
      target: "project-local",
      followUpChangeId: null,
      noFollowUpReason: null,
    },
    {
      problem: "Workflow routing friction",
      evidence: "No-progress handoff repeated",
      impact: "Token waste",
      rootCause: "Routing guidance did not distinguish safe handoff from repeated no-progress calls",
      recommendation: "Improve reusable skill guidance",
      confidence: "high",
      target: "opencode-dev-kit",
      followUpChangeId: null,
      noFollowUpReason: null,
    },
    {
      problem: "Fixed in scope",
      evidence: "Reviewer finding patched",
      impact: "No remaining impact",
      rootCause: "Missing coverage was already addressed by the scoped fix",
      recommendation: "No follow-up needed",
      confidence: "high",
      target: "none",
      followUpChangeId: null,
      noFollowUpReason: "Fixed in scope.",
    },
  ];
}

function unknownCauseProblems(): Record<string, unknown>[] {
  return [
    {
      problem: "Mystery failure",
      evidence: "Repeated failed validation without stable repro",
      impact: "Agents cannot pick a safe fix",
      rootCause: "unknown",
      recommendation: "Investigate root cause with instrumentation before implementing a fix",
      confidence: "medium",
      target: "project-local",
      followUpChangeId: null,
      noFollowUpReason: null,
    },
  ];
}

function instructionArtifactProblems(): Record<string, unknown>[] {
  return [
    {
      problem: "Reviewer missed recurrence prevention",
      evidence: "P1 finding had no prevention feedback",
      impact: "Same reviewer contract gap recurs",
      rootCause: "Reviewer output contract lacked durable Prevention Feedback fields",
      recommendation: "Add durable Prevention Feedback contract to reviewer agents",
      confidence: "high",
      target: "instruction-artifact",
      followUpChangeId: null,
      noFollowUpReason: null,
      preventionTarget: "agent:code-quality-reviewer",
      recurrencePath: "Reviewer contract should have required prevention feedback for P1 findings.",
      draftRule: "Reviewer agents should return Prevention Feedback for P0/P1 findings.",
      replayEvidenceRef: "fixture:reviewer-output/p1-prevention-feedback",
    },
  ];
}

function writeChange(repo: string, changeId: string, markdown = retroMd(changeId)): void {
  const base = path.join(repo, "openspec", "changes", changeId);
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, "tasks.md"), tasksWithRetro(changeId), "utf8");
  fs.writeFileSync(path.join(base, "retro.md"), markdown, "utf8");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const tests: TestCase[] = [
  {
    name: "follow-up helper creates changes and updates retro md outputs",
    run: () => withTempRepo("create", (repo) => {
      writeChange(repo, "example");
      const result = createRetroFollowUps(repo, "example");
      assert(result.changes.length === 2, `Expected two follow-up changes, got ${result.changes.length}.`);
      assert(result.changes.every((change) => change.status === "created"), `Expected created statuses, got ${JSON.stringify(result.changes)}.`);
      for (const change of result.changes) {
        assert(fs.existsSync(path.join(repo, change.path, "proposal.md")), `Missing proposal for ${change.id}.`);
        assert(fs.existsSync(path.join(repo, change.path, "tasks.md")), `Missing tasks for ${change.id}.`);
        const specPath = path.join(repo, change.path, "specs", change.id, "spec.md");
        const spec = fs.existsSync(specPath) ? fs.readFileSync(specPath, "utf8") : "";
        assert(spec.includes("## ADDED Requirements") && spec.includes("#### Scenario:"), `Missing valid spec delta for ${change.id}.`);
      }
      const retro = fs.readFileSync(path.join(repo, "openspec", "changes", "example", "retro.md"), "utf8");
      assert(retro.includes("`retro-example-01-project-docs-drift`"), "Project output must reference generated follow-up change.");
      assert(retro.includes("`retro-example-02-workflow-routing-friction`"), "Reusable output must reference generated follow-up change.");
      assert(retro.includes("No findings reason: n/a"), "No-findings reason must be cleared when findings create changes.");
      const gate = evaluateRetroGate(repo, "example");
      assert(gate.valid && gate.archiveAllowed, `Generated follow-ups should satisfy retro gate, got ${JSON.stringify(gate.errors)}.`);
    }),
  },
  {
    name: "follow-up helper routes unknown root causes to investigation wording",
    run: () => withTempRepo("unknown", (repo) => {
      writeChange(repo, "investigate-case", retroMd("investigate-case", unknownCauseProblems()));
      const result = createRetroFollowUps(repo, "investigate-case");
      assert(result.changes.length === 1, `Expected one investigation follow-up, got ${JSON.stringify(result.changes)}.`);
      const proposal = fs.readFileSync(path.join(repo, "openspec", "changes", "retro-investigate-case-01-mystery-failure", "proposal.md"), "utf8");
      assert(proposal.includes("Investigate the unknown root cause"), "Unknown-cause proposal must use investigation wording.");
      const tasks = fs.readFileSync(path.join(repo, "openspec", "changes", "retro-investigate-case-01-mystery-failure", "tasks.md"), "utf8");
      assert(tasks.includes("Investigate and document the root cause"), "Unknown-cause tasks must require root-cause investigation.");
      const second = createRetroFollowUps(repo, "investigate-case");
      assert(second.changes.every((change) => change.status === "existing"), `Unknown root-cause follow-up must be idempotent, got ${JSON.stringify(second.changes)}.`);
      const gate = evaluateRetroGate(repo, "investigate-case");
      assert(gate.valid && gate.archiveAllowed, `Unknown root-cause follow-up should satisfy gate, got ${JSON.stringify(gate.errors)}.`);
    }),
  },
  {
    name: "follow-up helper carries instruction-artifact prevention fields",
    run: () => withTempRepo("instruction-artifact", (repo) => {
      writeChange(repo, "instruction-case", retroMd("instruction-case", instructionArtifactProblems()));
      const result = createRetroFollowUps(repo, "instruction-case");
      assert(result.changes.length === 1, `Expected one instruction follow-up, got ${JSON.stringify(result.changes)}.`);
      const change = result.changes[0];
      const proposal = fs.readFileSync(path.join(repo, change.path, "proposal.md"), "utf8");
      const tasks = fs.readFileSync(path.join(repo, change.path, "tasks.md"), "utf8");
      const spec = fs.readFileSync(path.join(repo, change.path, "specs", change.id, "spec.md"), "utf8");
      assert(proposal.includes("## Prevention"), "Instruction follow-up proposal must include Prevention section.");
      assert(proposal.includes("agent:code-quality-reviewer"), "Proposal must carry prevention target.");
      assert(proposal.includes("Reviewer agents should return Prevention Feedback"), "Proposal must carry draft rule.");
      assert(proposal.includes("fixture:reviewer-output/p1-prevention-feedback"), "Proposal must carry replay evidence reference.");
      assert(tasks.includes("## Prevention Rule"), "Tasks must include Prevention Rule checklist.");
      assert(tasks.includes("run replay gate"), "Tasks must require replay gate.");
      assert(spec.includes("Requirement: Prevention Rule Surfaces In Instruction Artifact"), "Spec must include prevention rule requirement.");
      const gate = evaluateRetroGate(repo, "instruction-case");
      assert(gate.valid && gate.archiveAllowed, `Generated instruction follow-up must satisfy retro gate, got ${JSON.stringify(gate.errors)}.`);
    }),
  },
  {
    name: "follow-up helper is idempotent for existing changes",
    run: () => withTempRepo("idempotent", (repo) => {
      writeChange(repo, "example");
      const first = createRetroFollowUps(repo, "example");
      const second = createRetroFollowUps(repo, "example");
      assert(first.changes.every((change) => change.status === "created"), "First run must create changes.");
      assert(second.changes.every((change) => change.status === "existing"), `Second run must report existing changes, got ${JSON.stringify(second.changes)}.`);
      const gate = evaluateRetroGate(repo, "example");
      assert(gate.valid, `Idempotent follow-up output should keep retro gate valid, got ${JSON.stringify(gate.errors)}.`);
    }),
  },
  {
    name: "follow-up helper reports no writes for no actionable findings",
    run: () => withTempRepo("none", (repo) => {
      writeChange(repo, "example", retroMd("example", []));
      const result = createRetroFollowUps(repo, "example");
      assert(result.changes.length === 0, `No actionable targets must create no changes, got ${JSON.stringify(result.changes)}.`);
      assert(!result.retrospectiveUpdated, "No actionable targets must not update retro md outputs.");
    }),
  },
  {
    name: "follow-up helper rejects unsafe ids before writing",
    run: () => withTempRepo("unsafe-id", (repo) => {
      let unsafeSourceFailed = false;
      try {
        createRetroFollowUps(repo, "../escape");
      } catch (error) {
        unsafeSourceFailed = true;
        const message = error instanceof Error ? error.message : String(error);
        assert(message.includes("Invalid change id"), `Unsafe source change id error should be explicit, got ${message}.`);
      }
      assert(unsafeSourceFailed, "Unsafe source change id must fail before reads or writes.");

      const [problem] = defaultProblems();
      writeChange(repo, "example", retroMd("example", [{ ...problem, followUpChangeId: "../../escape" }]));
      let failed = false;
      try {
        createRetroFollowUps(repo, "example");
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        assert(message.includes("Unsafe follow-up change id"), `Unsafe id error should be explicit, got ${message}.`);
      }
      assert(failed, "Unsafe custom follow-up id must fail.");
      assert(!fs.existsSync(path.join(repo, "openspec", "escape")), "Unsafe id must not write outside openspec/changes.");
      assert(!fs.existsSync(path.join(repo, "escape")), "Unsafe id must not write outside the repository change tree.");
    }),
  },
  {
    name: "follow-up helper preflights all ids before any writes",
    run: () => withTempRepo("unsafe-batch", (repo) => {
      const [safeProblem, unsafeProblem] = defaultProblems();
      writeChange(repo, "example", retroMd("example", [safeProblem, { ...unsafeProblem, followUpChangeId: "../../escape" }]));
      let failed = false;
      try {
        createRetroFollowUps(repo, "example");
      } catch {
        failed = true;
      }
      assert(failed, "Unsafe id anywhere in the batch must fail.");
      assert(!fs.existsSync(path.join(repo, "openspec", "changes", "retro-example-01-project-docs-drift")), "Safe earlier finding must not be written before later unsafe id fails.");
      assert(!fs.existsSync(path.join(repo, "openspec", "escape")), "Unsafe later id must not write outside openspec/changes.");
    }),
  },
  {
    name: "follow-up helper preserves enriched existing files when required fragments exist",
    run: () => withTempRepo("preserve-enriched", (repo) => {
      writeChange(repo, "example");
      const existing = path.join(repo, "openspec", "changes", "retro-example-01-project-docs-drift");
      fs.mkdirSync(path.join(existing, "specs", "retro-example-01-project-docs-drift"), { recursive: true });
      const proposal = "# Custom Proposal\n\nProject docs drift\nREADME section stale\nReviewers miss current commands\nREADME routing was not updated with the changed command contract\nCreate docs follow-up\n\nHuman-added context must remain.\n";
      const tasks = "# Custom Tasks\n\nConfirm the retrospective root cause: README routing was not updated with the changed command contract\nCreate docs follow-up\n\nHuman-added task context must remain.\n";
      const spec = "# Custom Spec\n\n## ADDED Requirements\n\n#### Scenario: Preserve custom spec\n\nRoot cause: README routing was not updated with the changed command contract.\nCreate docs follow-up.\nHuman-added spec context must remain.\n";
      fs.writeFileSync(path.join(existing, "proposal.md"), proposal, "utf8");
      fs.writeFileSync(path.join(existing, "tasks.md"), tasks, "utf8");
      fs.writeFileSync(path.join(existing, "specs", "retro-example-01-project-docs-drift", "spec.md"), spec, "utf8");

      const result = createRetroFollowUps(repo, "example");
      const project = result.changes.find((change) => change.id === "retro-example-01-project-docs-drift");
      assert(project?.status === "existing", `Enriched follow-up must not be overwritten, got ${JSON.stringify(project)}.`);
      assert(fs.readFileSync(path.join(existing, "proposal.md"), "utf8") === proposal, "Proposal with required fragments must remain unchanged.");
      assert(fs.readFileSync(path.join(existing, "tasks.md"), "utf8") === tasks, "Tasks with required fragments must remain unchanged.");
      assert(fs.readFileSync(path.join(existing, "specs", "retro-example-01-project-docs-drift", "spec.md"), "utf8") === spec, "Spec with required fragments must remain unchanged.");
    }),
  },
  {
    name: "follow-up helper skips partial existing files without overwriting",
    run: () => withTempRepo("skip-partial", (repo) => {
      writeChange(repo, "example");
      const existing = path.join(repo, "openspec", "changes", "retro-example-01-project-docs-drift");
      fs.mkdirSync(existing, { recursive: true });
      const proposal = "# Human Proposal\n\nHuman-added context without generated fragments.\n";
      fs.writeFileSync(path.join(existing, "proposal.md"), proposal, "utf8");

      const result = createRetroFollowUps(repo, "example");
      const project = result.changes.find((change) => change.id === "retro-example-01-project-docs-drift");
      assert(project?.status === "skipped", `Partial existing follow-up must be skipped, got ${JSON.stringify(project)}.`);
      assert(fs.readFileSync(path.join(existing, "proposal.md"), "utf8") === proposal, "Partial existing proposal must not be overwritten.");
      assert(!fs.existsSync(path.join(existing, "tasks.md")), "Skipped partial follow-up must not receive generated tasks.");
      const retro = fs.readFileSync(path.join(repo, "openspec", "changes", "example", "retro.md"), "utf8");
      assert(!retro.includes("`retro-example-01-project-docs-drift`"), "Skipped partial follow-up must not be marked routed in retro.md.");
    }),
  },
  {
    name: "follow-up helper uses finding indexes for duplicate problem titles",
    run: () => withTempRepo("duplicate-problems", (repo) => {
      const duplicateProblems = [
        {
          problem: "Duplicate problem",
          evidence: "First evidence",
          impact: "First impact",
          rootCause: "First root cause",
          recommendation: "First recommendation",
          confidence: "high",
          target: "project-local",
          followUpChangeId: null,
          noFollowUpReason: null,
        },
        {
          problem: "Duplicate problem",
          evidence: "Second evidence",
          impact: "Second impact",
          rootCause: "Second root cause",
          recommendation: "Second recommendation",
          confidence: "medium",
          target: "opencode-dev-kit",
          followUpChangeId: null,
          noFollowUpReason: null,
        },
      ];
      writeChange(repo, "dupes", retroMd("dupes", duplicateProblems));
      const result = createRetroFollowUps(repo, "dupes");
      assert(result.changes.length === 2, `Expected two duplicate-title follow-ups, got ${JSON.stringify(result.changes)}.`);
      const retro = fs.readFileSync(path.join(repo, "openspec", "changes", "dupes", "retro.md"), "utf8");
      assert(retro.includes("`retro-dupes-01-duplicate-problem`"), `First duplicate follow-up missing: ${retro}.`);
      assert(retro.includes("`retro-dupes-02-duplicate-problem`"), `Second duplicate follow-up missing: ${retro}.`);
    }),
  },
  {
    name: "follow-up helper ignores whitespace noFollowUpReason",
    run: () => withTempRepo("blank-no-followup", (repo) => {
      const [problem] = defaultProblems();
      writeChange(repo, "example", retroMd("example", [{ ...problem, noFollowUpReason: "   " }]));
      const result = createRetroFollowUps(repo, "example");
      assert(result.changes.length === 1, `Blank noFollowUpReason must still create follow-up, got ${JSON.stringify(result.changes)}.`);
    }),
  },
  {
    name: "retro CLI supports dry-run and gate command boundary",
    run: () => withTempRepo("cli", (repo) => {
      writeChange(repo, "example");
      const retroPath = path.join(repo, "openspec", "changes", "example", "retro.md");
      const beforeDryRun = fs.readFileSync(retroPath, "utf8");
      const dryRun = spawnSync(process.execPath, [retroFollowupsCli, "example", "--root", repo, "--dry-run"], { encoding: "utf8" });
      assert(dryRun.status === 0, `Dry-run CLI should pass, got ${dryRun.status}: ${dryRun.stderr || dryRun.stdout}`);
      const dryRunPreview = JSON.parse(dryRun.stdout) as { changes: unknown[]; retrospectiveUpdated: boolean };
      assert(dryRunPreview.changes.length === 2, `Dry-run CLI should preview two changes, got ${dryRun.stdout}.`);
      assert(dryRunPreview.retrospectiveUpdated, "Dry-run CLI should report that retro.md would be updated.");
      assert(fs.readFileSync(retroPath, "utf8") === beforeDryRun, "Dry-run CLI must not mutate retro.md.");
      assert(!fs.existsSync(path.join(repo, "openspec", "changes", "retro-example-01-project-docs-drift")), "Dry-run CLI must not write follow-up changes.");

      const followups = spawnSync(process.execPath, [retroFollowupsCli, "example", "--root", repo], { encoding: "utf8" });
      assert(followups.status === 0, `Followups CLI should pass, got ${followups.status}: ${followups.stderr || followups.stdout}`);
      const gate = spawnSync(process.execPath, [retroGateCli, "example", "--root", repo], { encoding: "utf8" });
      assert(gate.status === 0, `Gate CLI should pass after followups, got ${gate.status}: ${gate.stderr || gate.stdout}`);

      const missingChange = spawnSync(process.execPath, [retroGateCli, "--root", repo], { encoding: "utf8" });
      assert(missingChange.status !== 0, "Gate CLI without change id must fail.");

      const unsafeFollowups = spawnSync(process.execPath, [retroFollowupsCli, "../escape", "--root", repo], { encoding: "utf8" });
      assert(unsafeFollowups.status !== 0 && (unsafeFollowups.stderr + unsafeFollowups.stdout).includes("Invalid change id"), "Followups CLI must reject unsafe source change id.");
      const unsafeGate = spawnSync(process.execPath, [retroGateCli, "../escape", "--root", repo], { encoding: "utf8" });
      assert(unsafeGate.status !== 0 && unsafeGate.stdout.includes("Invalid change id"), "Gate CLI must reject unsafe source change id.");
    }),
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

console.log(`OK: openspec retro follow-up tests=${tests.length}`);
