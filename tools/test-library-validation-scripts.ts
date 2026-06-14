#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ProcessResult = {
  exitCode: number;
  output: string;
};

type TestCase = {
  name: string;
  run: () => void;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validator = path.join(root, "tools", "validate-library.ts");

const requiredScripts = {
  "install:global": "node tools/install-opencode-global.ts",
  "init:project": "node tools/init-project.ts",
  doctor: "node tools/doctor.ts",
  "project:inventory": "node tools/project-inventory.ts",
  "instruction:inventory": "node tools/instruction-artifacts-inventory.ts",
  "code-quality:inventory": "node tools/code-quality-inventory.ts",
  "retro:inventory": "node tools/opencode-session-retro-inventory.ts",
  "retro:analyze": "node tools/opencode-session-retro-analyze.ts",
  "retro:project-ledger": "node tools/opencode-project-session-retro-ledger.ts",
  "openspec:validate": "openspec validate --all",
  "openspec:gate": "node tools/openspec-operation-gate.ts",
  "openspec:retro-gate": "node tools/openspec-retro-gate.ts",
  "openspec:retro-followups": "node tools/openspec-retro-followups.ts",
  "prepush:validate": "node tools/pre-push-validate.ts",
  validate: "node tools/validate-library.ts",
  "validate:strict": "node tools/validate-library.ts --fail-on-warnings",
  test: "node tools/test-library.ts && node tools/test-project-session-retro-ledger.ts && node tools/test-project-session-retro-ledger-cli.ts",
} as const;

function newTempDir(name: string): string {
  const parent = path.join(os.tmpdir(), "agents-and-skills-validation-script-tests");
  fs.mkdirSync(parent, { recursive: true });
  const dir = path.join(parent, `${name}-${crypto.randomUUID().replace(/-/g, "")}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function withTempDir(name: string, run: (fixture: string) => void): void {
  const fixture = newTempDir(name);
  try {
    run(fixture);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function writePackageJson(fixtureRoot: string, scripts: Record<string, string>): void {
  fs.writeFileSync(path.join(fixtureRoot, "package.json"), `${JSON.stringify({ name: "opencode-dev-kit-fixture", private: true, type: "module", scripts }, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.replace(/\r?\n/g, os.EOL), "utf8");
}

function writeProjectRetroFixture(fixtureRoot: string, skillText: string): void {
  writePackageJson(fixtureRoot, { ...requiredScripts });
  writeText(path.join(fixtureRoot, ".opencode", "skills", "project-sessions-retro", "SKILL.md"), skillText);
  writeText(path.join(fixtureRoot, "README.md"), [
    "# opencode-dev-kit",
    "",
    "## Routing Map",
    "",
    "- Instruction artifacts -> `instruction-artifact-tuning`; broad audits use `instruction-artifact-audit-runbook.md`.",
    "- Current-project retros -> `project-sessions-retro` with `retro:project-ledger` and root `retro/`; all-history retros -> `all-sessions-retro`.",
    "",
    "Full-retro phase routing:",
    "",
    "| Phase | Skill/agent/helper |",
    "| --- | --- |",
    "| Scope and source inventory | `project-sessions-retro`, `retro:project-ledger` |",
    "| Batch decomposition | `orchestrator` |",
    "| Per-session observation | `session-observation-worker`, optional `qwen-local-worker` first pass |",
    "| Trend synthesis | `project-sessions-retro` main session |",
    "| Root-cause analysis | `root-cause-analysis` |",
    "| Plan design | `deep-task-planning` |",
    "| OpenSpec follow-up routing | `openspec-propose` |",
    "| Instruction artifact changes | `instruction-artifact-tuning`, `instruction-artifact-reviewer` |",
    "| Code/test/tooling changes | relevant domain skill, `code-quality-audit`, `code-quality-reviewer`, `test-coverage-reviewer` |",
    "| Final delivery control | `session-delivery-reviewer` |",
    "",
    "Transcript handoff uses repo-local ignored scratch.",
    "",
    "## Reviewer Gate Map",
    "",
    "- Instruction artifacts -> `instruction-artifact-reviewer`.",
    "",
    "## Skill Catalog",
    "",
    "- `project-sessions-retro`: Project session retro.",
    "",
    "## Agent Catalog",
    "",
    "## Instruction Templates",
    "",
    "## Porting Notes",
    "",
  ].join("\n"));
  writeText(path.join(fixtureRoot, "AGENTS.md"), [
    "# Repository Instructions",
    "",
    "## Autonomous Work Contract",
    "",
    "Ask the user only for real blockers.",
    "",
    "## Completion Handoff",
    "",
    "Use `question` with (Recommended), Suggested Next Options, and Actionable Continuation Items when blocked.",
    "",
    "## TypeScript Development",
    "",
    "Use TypeScript. Do not add PowerShell, Python, or JavaScript source files.",
    "",
  ].join("\n"));
}

function invokeValidator(fixtureRoot: string): ProcessResult {
  const result = spawnSync("node", [validator, "--root", fixtureRoot], { cwd: root, encoding: "utf8", shell: false });
  if (result.error) {
    throw result.error;
  }
  return {
    exitCode: result.status ?? 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function assertFailure(result: ProcessResult, message: string): void {
  if (result.exitCode === 0) {
    throw new Error(`${message}\nOutput:\n${result.output}`);
  }
}

function assertOutputContains(result: ProcessResult, expected: string, message: string): void {
  if (!result.output.includes(expected)) {
    throw new Error(`${message}\nExpected output to include: ${expected}\nActual output:\n${result.output}`);
  }
}

function withoutScript(name: keyof typeof requiredScripts): Record<string, string> {
  const scripts = { ...requiredScripts };
  delete scripts[name];
  return scripts;
}

function withScript(name: keyof typeof requiredScripts, command: string): Record<string, string> {
  return { ...requiredScripts, [name]: command };
}

const tests: TestCase[] = [
  {
    name: "validator rejects missing documented OpenSpec validation script",
    run: () => {
      withTempDir("missing-openspec-validation-script", (fixture) => {
        writePackageJson(fixture, withoutScript("openspec:validate"));
        const result = invokeValidator(fixture);
        assertFailure(result, "Missing documented OpenSpec validation script should fail validation.");
        assertOutputContains(result, "openspec:validate", "Missing OpenSpec validation script should name the required script.");
      });
    },
  },
  {
    name: "validator rejects wrong documented OpenSpec validation script",
    run: () => {
      withTempDir("wrong-openspec-validation-script", (fixture) => {
        writePackageJson(fixture, withScript("openspec:validate", "openspec validate"));
        const result = invokeValidator(fixture);
        assertFailure(result, "Wrong documented OpenSpec validation script should fail validation.");
        assertOutputContains(result, "openspec:validate", "Wrong OpenSpec validation script should name the script.");
        assertOutputContains(result, "openspec validate --all", "Wrong OpenSpec validation script should name the required command.");
      });
    },
  },
  {
    name: "validator rejects missing documented OpenSpec retro gate script",
    run: () => {
      withTempDir("missing-openspec-retro-gate-script", (fixture) => {
        writePackageJson(fixture, withoutScript("openspec:retro-gate"));
        const result = invokeValidator(fixture);
        assertFailure(result, "Missing documented OpenSpec retro gate script should fail validation.");
        assertOutputContains(result, "openspec:retro-gate", "Missing OpenSpec retro gate script should name the required script.");
      });
    },
  },
  {
    name: "validator rejects missing documented OpenSpec retro followups script",
    run: () => {
      withTempDir("missing-openspec-retro-followups-script", (fixture) => {
        writePackageJson(fixture, withoutScript("openspec:retro-followups"));
        const result = invokeValidator(fixture);
        assertFailure(result, "Missing documented OpenSpec retro followups script should fail validation.");
        assertOutputContains(result, "openspec:retro-followups", "Missing OpenSpec retro followups script should name the required script.");
      });
    },
  },
  {
    name: "validator rejects missing project session retro ledger script",
    run: () => {
      withTempDir("missing-project-retro-ledger-script", (fixture) => {
        writePackageJson(fixture, withoutScript("retro:project-ledger"));
        const result = invokeValidator(fixture);
        assertFailure(result, "Missing project session retro ledger script should fail validation.");
        assertOutputContains(result, "retro:project-ledger", "Missing project retro ledger script should name the required script.");
      });
    },
  },
  {
    name: "validator rejects wrong project session retro ledger script",
    run: () => {
      withTempDir("wrong-project-retro-ledger-script", (fixture) => {
        writePackageJson(fixture, withScript("retro:project-ledger", "node wrong.ts"));
        const result = invokeValidator(fixture);
        assertFailure(result, "Wrong project session retro ledger script should fail validation.");
        assertOutputContains(result, "retro:project-ledger", "Wrong project retro ledger script should name the script.");
        assertOutputContains(result, "node tools/opencode-project-session-retro-ledger.ts", "Wrong project retro ledger script should name the required command.");
      });
    },
  },
  {
    name: "validator rejects test script missing project retro ledger tests",
    run: () => {
      withTempDir("test-script-missing-project-retro-ledger", (fixture) => {
        writePackageJson(fixture, withScript("test", "node tools/test-library.ts"));
        const result = invokeValidator(fixture);
        assertFailure(result, "Test script missing project retro ledger tests should fail validation.");
        assertOutputContains(result, "node tools/test-project-session-retro-ledger.ts", "Missing test wiring should name the required test command.");
        assertOutputContains(result, "node tools/test-project-session-retro-ledger-cli.ts", "Missing CLI test wiring should name the required test command.");
      });
    },
  },
  {
    name: "validator rejects non-executed project retro ledger test mention",
    run: () => {
      withTempDir("test-script-echoes-project-retro-ledger", (fixture) => {
        writePackageJson(fixture, withScript("test", "node tools/test-library.ts && echo node tools/test-project-session-retro-ledger.ts"));
        const result = invokeValidator(fixture);
        assertFailure(result, "Echoed project retro ledger test command should fail validation.");
        assertOutputContains(result, "node tools/test-project-session-retro-ledger.ts", "Echoed test wiring should name the required executable command.");
        assertOutputContains(result, "node tools/test-project-session-retro-ledger-cli.ts", "Missing CLI test wiring should name the required executable command.");
      });
    },
  },
  {
    name: "validator rejects missing project retro helper commands and no-ask batching contract",
    run: () => {
      const baseSkill = fs.readFileSync(path.join(root, ".opencode", "skills", "project-sessions-retro", "SKILL.md"), "utf8");
      const cases = [
        { expected: "status --input retro", name: "missing-status-helper", text: baseSkill.replaceAll("status --input retro", "status helper omitted") },
        { expected: "transcript --input retro", name: "missing-transcript-helper", text: baseSkill.replaceAll("transcript --input retro", "transcript helper omitted") },
        { expected: "patch-sessions --input retro", name: "missing-patch-helper", text: baseSkill.replaceAll("patch-sessions --input retro", "patch helper omitted") },
        { expected: "without asking whether batching is desired", name: "missing-no-ask-batching", text: baseSkill.replaceAll("without asking whether batching is desired", "without using the required no-ask batching phrase") },
        { expected: "Do not stop after a successful batch", name: "missing-no-stop-after-batch", text: baseSkill.replaceAll("Do not stop after a successful batch", "A batch may be a reasonable stopping point") },
        { expected: "parallel worker batches", name: "missing-parallel-worker-batches", text: baseSkill.replaceAll("parallel worker batches", "serial batches") },
        { expected: "A batch size of 1-5 sessions is a debugging fallback", name: "missing-small-batch-fallback", text: baseSkill.replaceAll("A batch size of 1-5 sessions is a debugging fallback", "Small batches are fine") },
        { expected: "## Phase Skill Routing", name: "missing-phase-routing", text: baseSkill.replaceAll("## Phase Skill Routing", "## Phase Routing Omitted") },
        { expected: "session-observation-worker", name: "missing-session-observation-worker", text: baseSkill.replaceAll("session-observation-worker", "session observation worker omitted") },
        { expected: "root-cause-analysis", name: "missing-root-cause-analysis", text: baseSkill.replaceAll("root-cause-analysis", "root cause skill omitted") },
        { expected: "deep-task-planning", name: "missing-deep-task-planning", text: baseSkill.replaceAll("deep-task-planning", "deep planning skill omitted") },
        { expected: "openspec-propose", name: "missing-openspec-propose", text: baseSkill.replaceAll("openspec-propose", "openspec propose skill omitted") },
        { expected: "session-delivery-reviewer", name: "missing-session-delivery-reviewer", text: baseSkill.replaceAll("session-delivery-reviewer", "session delivery reviewer omitted") },
        { expected: "instruction-artifact-reviewer", name: "missing-instruction-artifact-reviewer", text: baseSkill.replaceAll("instruction-artifact-reviewer", "instruction artifact reviewer omitted") },
        { expected: "repo-local ignored scratch", name: "missing-worker-scratch-contract", text: baseSkill.replaceAll("repo-local ignored scratch", "external temp path") },
        { expected: "Code/test/tooling changes", name: "missing-code-tooling-phase", text: baseSkill.replaceAll("Code/test/tooling changes", "Code tooling phase omitted") },
        { expected: "unexpected phase row 'Transcript handoff'", name: "unexpected-phase-row", text: baseSkill.replace("| Final delivery control | `session-delivery-reviewer` | Check goal alignment, proportional rigor, coverage, validation, reviewer handling, residual risks, and handoff readiness. |", "| Transcript handoff | repo-local ignored scratch | unexpected row |\n| Final delivery control | `session-delivery-reviewer` | Check goal alignment, proportional rigor, coverage, validation, reviewer handling, residual risks, and handoff readiness. |") },
      ];
      for (const item of cases) {
        withTempDir(`project-retro-${item.name}`, (fixture) => {
          writeProjectRetroFixture(fixture, item.text);
          const result = invokeValidator(fixture);
          assertFailure(result, `Project retro contract should fail for ${item.name}.`);
          assertOutputContains(result, item.expected, `Project retro validator should name missing required fragment ${item.expected}.`);
        });
      }
    },
  },
  {
    name: "validator rejects markdown automation wrapper artifacts",
    run: () => {
      withTempDir("markdown-automation-wrapper", (fixture) => {
        writePackageJson(fixture, { ...requiredScripts });
        const wrapper = path.join(fixture, "openspec", "changes", "example", "automation", "review.md");
        fs.mkdirSync(path.dirname(wrapper), { recursive: true });
        fs.writeFileSync(wrapper, "# Review\n\nMachine-read wrapper that should be JSON.\n", "utf8");
        const result = invokeValidator(fixture);
        assertFailure(result, "Markdown automation wrapper must fail validation.");
        assertOutputContains(result, "automation wrapper Markdown artifact is not allowed", "Wrapper error should explain JSON-only rule.");
        assertOutputContains(result, "automation/review.json", "Wrapper error should name canonical JSON replacement.");
      });
    },
  },
  {
    name: "validator rejects missing README project retro routing contract",
    run: () => {
      const baseSkill = fs.readFileSync(path.join(root, ".opencode", "skills", "project-sessions-retro", "SKILL.md"), "utf8");
      withTempDir("missing-project-retro-readme-route", (fixture) => {
        writeProjectRetroFixture(fixture, baseSkill);
        const readmePath = path.join(fixture, "README.md");
        const readme = fs.readFileSync(readmePath, "utf8");
        writeText(readmePath, readme.replaceAll("`retro:project-ledger`", "retro helper omitted"));
        const result = invokeValidator(fixture);
        assertFailure(result, "Missing README project retro route should fail validation.");
        assertOutputContains(result, "README project session retro route", "Missing README project retro route should name the route contract.");
        assertOutputContains(result, "retro:project-ledger", "Missing README project retro route should name the helper command.");
      });
    },
  },
  {
    name: "validator rejects missing README project retro phase routing contract",
    run: () => {
      const baseSkill = fs.readFileSync(path.join(root, ".opencode", "skills", "project-sessions-retro", "SKILL.md"), "utf8");
      const cases = [
        { expected: "Full-retro phase routing", name: "missing-phase-table", replace: "Full-retro phase routing", withText: "Phase routing omitted" },
        { expected: "session-observation-worker", name: "missing-readme-observation-worker", replace: "session-observation-worker", withText: "session observation worker omitted" },
        { expected: "root-cause-analysis", name: "missing-readme-root-cause", replace: "root-cause-analysis", withText: "root cause skill omitted" },
        { expected: "deep-task-planning", name: "missing-readme-deep-planning", replace: "deep-task-planning", withText: "deep planning skill omitted" },
        { expected: "openspec-propose", name: "missing-readme-openspec-propose", replace: "openspec-propose", withText: "openspec propose skill omitted" },
        { expected: "session-delivery-reviewer", name: "missing-readme-delivery-reviewer", replace: "session-delivery-reviewer", withText: "session delivery reviewer omitted" },
        { expected: "repo-local ignored scratch", name: "missing-readme-scratch-contract", replace: "repo-local ignored scratch", withText: "external temp path" },
        { expected: "Code/test/tooling changes", name: "missing-readme-code-tooling-row", replace: "Code/test/tooling changes", withText: "Code tooling phase omitted" },
        { expected: "unexpected phase row 'Transcript handoff'", name: "unexpected-readme-phase-row", replace: "| Final delivery control | `session-delivery-reviewer` |", withText: "| Transcript handoff | repo-local ignored scratch |\n| Final delivery control | `session-delivery-reviewer` |" },
        { expected: "duplicate phase row 'Batch decomposition'", name: "duplicate-readme-phase-row", replace: "| Final delivery control | `session-delivery-reviewer` |", withText: "| Batch decomposition | `orchestrator` |\n| Final delivery control | `session-delivery-reviewer` |" },
        { expected: "phase row order mismatch", name: "reordered-readme-phase-row", replace: "Scope and source inventory", withText: "Batch decomposition" },
      ];
      for (const item of cases) {
        withTempDir(`missing-project-retro-readme-${item.name}`, (fixture) => {
          writeProjectRetroFixture(fixture, baseSkill);
          const readmePath = path.join(fixture, "README.md");
          const readme = fs.readFileSync(readmePath, "utf8");
          writeText(readmePath, readme.replaceAll(item.replace, item.withText));
          const result = invokeValidator(fixture);
          assertFailure(result, `Missing README project retro phase route should fail for ${item.name}.`);
          assertOutputContains(result, "README project session retro phase routing", "Missing README phase route should name the route contract.");
          assertOutputContains(result, item.expected, `Missing README phase route should name ${item.expected}.`);
        });
      }
    },
  },
];

let failed = 0;
for (const test of tests) {
  try {
    test.run();
    console.log(`PASS: ${test.name}`);
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL: ${test.name}\n${message}`);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`OK: library validation script tests=${tests.length}`);
