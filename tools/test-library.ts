#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

type ProcessResult = {
  exitCode: number;
  output: string;
};

type TestCase = {
  name: string;
  run: () => void;
};

const root = parseRoot(process.argv.slice(2));
const validator = path.join(root, "tools", "validate-library.ts");
const installer = path.join(root, "tools", "install-opencode-global.ts");
const initProject = path.join(root, "tools", "init-project.ts");
const doctor = path.join(root, "tools", "doctor.ts");
const projectInventory = path.join(root, "tools", "project-inventory.ts");
const instructionInventory = path.join(root, "tools", "instruction-artifacts-inventory.ts");

function defaultRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function parseRoot(args: string[]): string {
  let configuredRoot = defaultRoot();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" || arg === "--Root" || arg === "-Root") {
      const value = args[i + 1];
      if (!value || value.trim() === "" || value.startsWith("-")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      configuredRoot = value;
      i++;
    } else if (arg.startsWith("--root=")) {
      configuredRoot = arg.slice("--root=".length);
    } else if (arg.startsWith("--Root=")) {
      configuredRoot = arg.slice("--Root=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return path.resolve(configuredRoot);
}

function newTempDir(name: string): string {
  const parent = path.join(os.tmpdir(), "agents-and-skills-tests");
  fs.mkdirSync(parent, { recursive: true });
  const dir = path.join(parent, `${name}-${crypto.randomUUID().replace(/-/g, "")}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.replace(/\r?\n/g, os.EOL), "utf8");
}

function appendReadmeAgentCatalogEntry(fixture: string, entry: string): void {
  const readmePath = path.join(fixture, "README.md");
  const readmeText = fs.readFileSync(readmePath, "utf8");
  const marker = "- `demo-reviewer`: Demo reviewer.";
  if (!readmeText.includes(marker)) {
    throw new Error(`Fixture README missing agent catalog marker: ${marker}`);
  }
  writeText(readmePath, readmeText.replace(marker, `${marker}\n${entry}`));
}

function lines(values: string[]): string {
  return values.join("\n");
}

function newLibraryFixture(name: string): string {
  const dir = newTempDir(name);
  writeText(path.join(dir, ".opencode", "skills", "demo-skill", "SKILL.md"), lines([
    "---",
    "name: demo-skill",
    "description: Use when testing a demo reusable skill.",
    "license: MIT",
    "---",
    "",
    "# Demo Skill",
    "",
    "Use this skill when testing reusable skill validation fixtures.",
    "",
    "## Output",
    "",
    "Return fixture validation evidence.",
    "",
  ]));
  writeText(path.join(dir, ".opencode", "skills", "complain", "SKILL.md"), fs.readFileSync(path.join(root, ".opencode", "skills", "complain", "SKILL.md"), "utf8"));
  writeText(path.join(dir, "docs", "feedbacks", "README.md"), fs.readFileSync(path.join(root, "docs", "feedbacks", "README.md"), "utf8"));
  writeText(path.join(dir, ".opencode", "agents", "demo-reviewer.md"), lines([
    "---",
    "description: Reviews demo fixture behavior.",
    "mode: subagent",
    "permission:",
    "  read: allow",
    "  glob: allow",
    "  grep: allow",
    "  bash: deny",
    "  edit:",
    "    \"*\": deny",
    "    \"docs/feedbacks/**\": allow",
    "  task: deny",
    "  question: deny",
    "  skill:",
    "    \"*\": deny",
    "    complain: allow",
    "  webfetch: deny",
    "  websearch: deny",
    "  todowrite: deny",
    "  external_directory: deny",
    "  lsp: deny",
    "  doom_loop: deny",
    "---",
    "",
    "You are a read-only demo reviewer.",
    "",
    "## Leaf Contract",
    "",
    "Read/search-only leaf reviewer, except feedback-ledger appends under `docs/feedbacks/**` through the `complain` skill. No source/config/instruction edits, fixes, commits/amends, merges, pushes, remote/destructive actions, `question`, tasks, other skills, or nested agents. Stay in scope. Missing evidence -> exact main-session command/manual gate in `Actionable Continuation Items`; external domain -> `Needs external reviewer: <agent-name> required|optional`.",
    "",
    "## Feedback Ledger",
    "",
    "When current-session workflow friction appears, use `complain` and append a privacy-safe entry to `docs/feedbacks/demo-reviewer.md`.",
    "",
    "## Output",
    "",
    "Return:",
    "",
    "- `Findings`: ordered by severity. Each finding includes `Severity`, `Evidence`, `Evidence Type`, `Impact`, `Likely Root Cause`, `Recommendation`, `Confidence`, `Needs external reviewer`.",
    "- `Residual Risks`: known low-confidence gaps, missing evidence, or `none`.",
    "- `Actionable Continuation Items`: concrete tasks for the main session, or `none`.",
    "",
  ]));
  writeText(path.join(dir, "instructions", "example.md"), lines(["# Example", ""]));
  writeText(path.join(dir, "instructions", "universal-development-loop.md"), lines([
    "# Universal Development Loop",
    "",
    "## Contract",
    "",
    "1. Intake",
    "2. Evidence",
    "3. Baseline Proof",
    "4. Small Slice",
    "5. Test First",
    "6. Focused Validation",
    "7. Review Gate",
    "8. Handoff",
    "9. Process Improvement",
    "",
  ]));
  writeText(path.join(dir, "templates", "project", "AGENTS.md"), lines([
    "# Project Agent Instructions",
    "",
    "## Universal Development Loop",
    "",
    "- Use Intake, Evidence, Baseline Proof, Small Slice, Test First, Focused Validation, Review Gate, Handoff, and Process Improvement.",
    "- For behavior changes, write tests before implementation.",
    "- Do not commit, push, merge, delete source artifacts, or alter remote state unless explicitly requested and allowed by repository policy.",
    "",
  ]));
  writeText(path.join(dir, "templates", "project", "opencode.json"), lines(["{", "  \"$schema\": \"https://opencode.ai/config.json\"", "}", ""]));
  writeText(path.join(dir, "templates", "project", "docs", "feedbacks", "README.md"), lines([
    "# Feedback Ledger",
    "",
    "Use `complain` for current-session workflow friction. If recurrence is unknown, write `Recurrence: unknown`.",
    "",
    "Rules: no raw private prompts, large logs, or personal blame.",
    "",
  ]));
  writeText(path.join(dir, "templates", "project", "validation.md"), lines(["# Project Validation", "", "- Tests before implementation when behavior changes.", ""]));
  writeText(path.join(dir, "templates", "project", "adapter.json"), lines([
    "{",
    "  \"schemaVersion\": 1,",
    "  \"validation\": {",
    "    \"focusedTest\": \"unknown\",",
    "    \"test\": \"unknown\"",
    "  }",
    "}",
    "",
  ]));
  writeText(path.join(dir, "templates", "ci", "github-actions.yml"), lines(["name: validate", "", "jobs:", "  validate:", "    steps:", "      - run: <validation-command>", ""]));
  writeText(path.join(dir, "profiles", "all.json"), lines([
    "{",
    "  \"name\": \"all\",",
    "  \"description\": \"Fixture all profile.\",",
    "  \"skills\": [\"complain\", \"demo-skill\"],",
    "  \"agents\": [\"demo-reviewer\"]",
    "}",
    "",
  ]));
  for (const tool of ["init-project.ts", "doctor.ts", "project-inventory.ts", "instruction-artifacts-inventory.ts", "pre-push-validate.ts"]) {
    writeText(path.join(dir, "tools", tool), lines(["#!/usr/bin/env node", "", ""]));
  }
  writeText(path.join(dir, ".githooks", "pre-push"), lines(["#!/bin/sh", "node tools/pre-push-validate.ts", ""]));
  writeText(path.join(dir, "package.json"), lines([
    "{",
    "  \"name\": \"opencode-dev-kit-fixture\",",
    "  \"private\": true,",
    "  \"type\": \"module\",",
    "  \"scripts\": {",
    "    \"install:global\": \"node tools/install-opencode-global.ts\",",
    "    \"init:project\": \"node tools/init-project.ts\",",
    "    \"doctor\": \"node tools/doctor.ts\",",
    "    \"project:inventory\": \"node tools/project-inventory.ts\",",
    "    \"instruction:inventory\": \"node tools/instruction-artifacts-inventory.ts\",",
    "    \"instruction:feedback\": \"node tools/instruction-feedback-ledger.ts\",",
    "    \"code-quality:inventory\": \"node tools/code-quality-inventory.ts\",",
    "    \"openspec:validate\": \"openspec validate --all\",",
    "    \"openspec:gate\": \"node tools/openspec-operation-gate.ts\",",
    "    \"prepush:validate\": \"node tools/pre-push-validate.ts\",",
    "    \"validate\": \"node tools/validate-library.ts\",",
    "    \"validate:strict\": \"node tools/validate-library.ts --fail-on-warnings\",",
    "    \"test\": \"node tools/test-library.ts && node tools/test-instruction-feedback-ledger.ts && node tools/test-install-opencode-global.ts\"",
    "  }",
    "}",
    "",
  ]));
  writeText(path.join(dir, "AGENTS.md"), lines([
    "# Repository Instructions",
    "",
    "## TypeScript Development",
    "",
    "- Use TypeScript for all repository automation and implementation code.",
    "- Do not add PowerShell, Python, or JavaScript source files; rewrite any such code to TypeScript instead.",
    "- For behavior changes, add the smallest useful TDD/test-first gate before code changes.",
    "- Run repository tooling through npm scripts or `node` against `.ts` entrypoints.",
    "",
    "## Deterministic Helper Automation",
    "",
    "- For repetitive, evidence-heavy, or token-heavy work, first consider whether a small deterministic helper could gather, count, validate, redact, diff, inventory, or enforce explicit rules more efficiently than manual inspection.",
    "- When writing helper code for agent workflow, use explicit inputs, explicit outputs, schemas or fixtures, stable ordering, privacy-safe output, and no hidden heuristics.",
    "- Do not encode fuzzy scoring, probabilistic classification, model-like summarization, or unstated inference in helper code.",
    "- If deterministic helper code cannot answer from inputs, report unknown, unreadable, unsupported, or blocked instead.",
    "",
    "## Feedback Ledger",
    "",
    "- Use `complain` for current-session workflow friction and append entries under `docs/feedbacks/<agent-or-skill-name>.md`.",
    "- If recurrence is unknown, write `Recurrence: unknown`.",
    "- Prevention feedback can be persisted with `npm run instruction:feedback -- --add ...` when reviewer output supplies it.",
    "- Prevention edits require replay evidence and close only after `applied -> replayed -> resolved`.",
    "",
    "## Completion Handoff",
    "",
    "- Ask the user only for real blockers, remote/destructive actions, scope or risk decisions, credentials, and MR/PR outcomes.",
    "- When asking, offer 2-4 self-contained next actions via `question` when available.",
    "- Put the recommended option first and end its label with `(Recommended)`.",
    "- In read-only, no-question, or subagent contexts, return `Suggested Next Options` or `Actionable Continuation Items` instead of asking the user directly.",
    "",
    "## Autonomous Work Contract",
    "",
    "- The main session owns skill selection, decomposition, validation, reviewer gates, and ready-to-land handoff.",
    "",
  ]));
  writeText(path.join(dir, "README.md"), lines([
    "# Fixture",
    "",
    "## What This Is",
    "",
    "This is an opencode-dev-kit fixture.",
    "",
    "## Universal Development Loop",
    "",
    "Use one canonical development process.",
    "",
    "## Install",
    "",
    "Install with npm scripts.",
    "",
    "## Bootstrap A Project",
    "",
    "Run init:project.",
    "",
    "## Token Economy",
    "",
    "Use deterministic inventories before broad reads.",
    "",
    "## Validate",
    "",
    "Run validate and test.",
    "",
    "## Routing Map",
    "",
    "- Default broad work -> `adaptive-delivery`.",
    "- Instruction artifacts -> `instruction-artifact-tuning`; broad audits -> `instruction-artifact-audit-runbook.md`.",
    "",
    "## Reviewer Gate Map",
    "",
    "- Instruction artifacts -> `instruction-artifact-reviewer`.",
    "",
    "## Skill Catalog",
    "",
    "- `complain`: Feedback ledger capture skill.",
    "- `demo-skill`: Demo skill.",
    "",
    "## Agent Catalog",
    "",
    "- `demo-reviewer`: Demo reviewer.",
    "",
    "## Instruction Templates",
    "",
    "- `example.md`: Demo instruction.",
    "- `universal-development-loop.md`: Universal loop.",
    "",
    "## Porting Notes",
    "",
  ]));
  return dir;
}

function invokeProcessCapture(command: string, args: string[], workingDirectory: string): ProcessResult {
  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    exitCode: result.status ?? 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function invokeValidator(fixtureRoot: string): ProcessResult {
  return invokeProcessCapture("node", [validator, "--root", fixtureRoot], root);
}

function invokeInstaller(args: string[]): ProcessResult {
  return invokeProcessCapture("node", [installer, ...args], root);
}

function invokeInitProject(args: string[]): ProcessResult {
  return invokeProcessCapture("node", [initProject, ...args], root);
}

function invokeDoctor(args: string[]): ProcessResult {
  return invokeProcessCapture("node", [doctor, ...args], root);
}

function invokeProjectInventory(args: string[]): ProcessResult {
  return invokeProcessCapture("node", [projectInventory, ...args], root);
}

function invokeInstructionInventory(args: string[]): ProcessResult {
  return invokeProcessCapture("node", [instructionInventory, ...args], root);
}

function assertSuccess(result: ProcessResult, message: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${message}\nExitCode: ${result.exitCode}\nOutput:\n${result.output}`);
  }
}

function assertFailure(result: ProcessResult, message: string): void {
  if (result.exitCode === 0) {
    throw new Error(`${message}\nExpected failure but command succeeded.\nOutput:\n${result.output}`);
  }
}

function assertOutputContains(result: ProcessResult, needle: string, message: string): void {
  if (!result.output.includes(needle)) {
    throw new Error(`${message}\nExpected output to contain: ${needle}\nOutput:\n${result.output}`);
  }
}

function assertOutputExcludes(result: ProcessResult, needle: string, message: string): void {
  if (result.output.includes(needle)) {
    throw new Error(`${message}\nOutput must not contain: ${needle}\nOutput:\n${result.output}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nActual: ${actualJson}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseJsonOutput(result: ProcessResult): unknown {
  const start = result.output.indexOf("{");
  const end = result.output.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(`Expected JSON object output.\nOutput:\n${result.output}`);
  }
  return JSON.parse(result.output.slice(start, end + 1)) as unknown;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, message: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }
  return value.map((item) => asRecord(item, message));
}

function findBucket(rows: Array<Record<string, unknown>>, keyName: string, keyValue: string): Record<string, unknown> {
  const found = rows.find((row) => row[keyName] === keyValue);
  if (!found) {
    throw new Error(`Missing bucket ${keyName}=${keyValue}.\nRows:\n${JSON.stringify(rows, null, 2)}`);
  }
  return found;
}

function anyPathWithBasename(rootPath: string, basename: string): boolean {
  return findPathWithBasename(rootPath, basename) != null;
}

function findPathWithBasename(rootPath: string, basename: string): string | null {
  if (!fs.existsSync(rootPath)) {
    return null;
  }
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.name === basename) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const found = findPathWithBasename(entryPath, basename);
      if (found != null) {
        return found;
      }
    }
  }
  return null;
}

function addImplementationWorkerFixture(fixture: string): string {
  const workerPath = path.join(fixture, ".opencode", "agents", "implementation-worker.md");
  const sourcePath = path.join(root, ".opencode", "agents", "implementation-worker.md");
  writeText(workerPath, fs.readFileSync(sourcePath, "utf8"));

  const profilePath = path.join(fixture, "profiles", "all.json");
  const profile = fs.readFileSync(profilePath, "utf8");
  writeText(profilePath, profile.replace("\"demo-reviewer\"]", "\"demo-reviewer\", \"implementation-worker\"]"));

  const agentsPath = path.join(fixture, "AGENTS.md");
  const agents = fs.readFileSync(agentsPath, "utf8");
  writeText(agentsPath, agents.replace(
    "- The main session owns skill selection, decomposition, validation, reviewer gates, and ready-to-land handoff.",
    "- The main session owns skill selection, decomposition, validation, reviewer gates, and ready-to-land handoff.\n- Use `implementation-worker` for bounded edit-mode implementation slices with exact non-overlapping write scope, clear acceptance criteria, and a focused validation gate.\n- When delegating to `implementation-worker`, pass `Mission`, `Read scope`, `Write scope`, `Forbidden`, `Verification`, and acceptance criteria.",
  ));

  const templatePath = path.join(fixture, "templates", "project", "AGENTS.md");
  const template = fs.readFileSync(templatePath, "utf8");
  writeText(templatePath, `${template}- Use \`implementation-worker\` for bounded edit-mode implementation slices with exact non-overlapping write scope, clear acceptance criteria, and a focused validation gate.\n- When delegating to \`implementation-worker\`, pass \`Mission\`, \`Read scope\`, \`Write scope\`, \`Forbidden\`, \`Verification\`, and acceptance criteria.\n`);

  const readmePath = path.join(fixture, "README.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  writeText(readmePath, readme.replace("- `demo-reviewer`: Demo reviewer.", "- `demo-reviewer`: Demo reviewer.\n- `implementation-worker`: Bounded TDD/test-first implementation worker."));
  return workerPath;
}

const tests: TestCase[] = [
  {
    name: "validator accepts valid fixture",
    run: () => {
      const fixture = newLibraryFixture("valid");
      assertSuccess(invokeValidator(fixture), "Valid fixture should pass validation.");
    },
  },
  {
    name: "validator rejects weakened complain feedback contract",
    run: () => {
      const fixture = newLibraryFixture("complain-contract");
      const skillPath = path.join(fixture, ".opencode", "skills", "complain", "SKILL.md");
      const readmePath = path.join(fixture, "docs", "feedbacks", "README.md");
      writeText(readmePath, fs.readFileSync(path.join(root, "docs", "feedbacks", "README.md"), "utf8"));
      const skill = fs.readFileSync(skillPath, "utf8");
      writeText(skillPath, skill.replace("raw private prompts", "private prompt details"));
      const result = invokeValidator(fixture);
      assertFailure(result, "Weakened complain privacy contract should fail validation.");
      assertOutputContains(result, "raw private prompts", "Complain contract validation should name missing privacy guard.");
    },
  },
  {
    name: "validator accepts bounded implementation worker",
    run: () => {
      const fixture = newLibraryFixture("bounded-implementation-worker");
      addImplementationWorkerFixture(fixture);
      assertSuccess(invokeValidator(fixture), "Bounded implementation worker should pass validation.");
    },
  },
  {
    name: "validator rejects unsupported implementation worker bash allow",
    run: () => {
      const fixture = newLibraryFixture("implementation-worker-extra-bash");
      const workerPath = addImplementationWorkerFixture(fixture);
      const worker = fs.readFileSync(workerPath, "utf8");
      writeText(workerPath, worker.replace("    \"git diff*\": allow", "    \"git diff*\": allow\n    \"git push*\": allow"));
      const result = invokeValidator(fixture);
      assertFailure(result, "Implementation worker must reject unsupported bash allow rules.");
      assertOutputContains(result, "unsupported bash permission", "Implementation worker permission failure should name unsupported bash permission.");
    },
  },
  {
    name: "validator rejects missing implementation worker base routing",
    run: () => {
      const fixture = newLibraryFixture("implementation-worker-missing-routing");
      const workerPath = path.join(fixture, ".opencode", "agents", "implementation-worker.md");
      const sourcePath = path.join(root, ".opencode", "agents", "implementation-worker.md");
      writeText(workerPath, fs.readFileSync(sourcePath, "utf8"));
      const readmePath = path.join(fixture, "README.md");
      const readme = fs.readFileSync(readmePath, "utf8");
      writeText(readmePath, readme.replace("- `demo-reviewer`: Demo reviewer.", "- `demo-reviewer`: Demo reviewer.\n- `implementation-worker`: Bounded TDD/test-first implementation worker."));
      const result = invokeValidator(fixture);
      assertFailure(result, "Implementation worker without base routing should fail validation.");
      assertOutputContains(result, "implementation-worker routing", "Routing failure should name implementation-worker routing.");
    },
  },
  {
    name: "validator rejects invalid YAML-like frontmatter",
    run: () => {
      const fixture = newLibraryFixture("invalid-frontmatter");
      writeText(path.join(fixture, ".opencode", "skills", "demo-skill", "SKILL.md"), lines([
        "---",
        "name: demo-skill",
        "description: Invalid: unquoted colon-space scalar.",
        "license: MIT",
        "---",
        "",
        "# Demo Skill",
        "",
      ]));
      assertFailure(invokeValidator(fixture), "Invalid frontmatter should fail validation.");
    },
  },
  {
    name: "validator ignores body-only metadata",
    run: () => {
      const fixture = newLibraryFixture("body-metadata");
      writeText(path.join(fixture, ".opencode", "skills", "demo-skill", "SKILL.md"), lines([
        "# Demo Skill",
        "",
        "name: demo-skill",
        "description: Body metadata must not count as frontmatter.",
        "",
      ]));
      assertFailure(invokeValidator(fixture), "Body-only metadata should not satisfy frontmatter requirements.");
    },
  },
  {
    name: "validator rejects bare required scalars",
    run: () => {
      const fixture = newLibraryFixture("bare-description");
      writeText(path.join(fixture, ".opencode", "skills", "demo-skill", "SKILL.md"), lines([
        "---",
        "name: demo-skill",
        "description:",
        "license: MIT",
        "---",
        "",
        "# Demo Skill",
        "",
      ]));
      assertFailure(invokeValidator(fixture), "Bare required scalar fields should fail validation.");
    },
  },
  {
    name: "validator rejects unsafe reviewer permissions",
    run: () => {
      const fixture = newLibraryFixture("unsafe-permissions");
      writeText(path.join(fixture, ".opencode", "agents", "demo-reviewer.md"), lines([
        "---",
        "description: Reviews demo fixture behavior.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  glob: allow",
        "  grep: allow",
        "  bash: ask",
        "  edit: deny",
        "  task: deny",
        "  question: deny",
        "  skill: allow",
        "---",
        "",
        "You are a read-only demo reviewer.",
        "",
      ]));
      assertFailure(invokeValidator(fixture), "Unsafe reviewer permissions should fail validation.");
    },
  },
  {
    name: "validator rejects incomplete reviewer permissions",
    run: () => {
      const fixture = newLibraryFixture("incomplete-reviewer-permissions");
      writeText(path.join(fixture, ".opencode", "agents", "demo-reviewer.md"), lines([
        "---",
        "description: Reviews demo fixture behavior.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  glob: allow",
        "  grep: allow",
        "  bash: deny",
        "  edit:",
        "    \"*\": deny",
        "    \"docs/feedbacks/**\": allow",
        "  task: deny",
        "  question: deny",
        "  skill:",
        "    \"*\": deny",
        "    complain: allow",
        "---",
        "",
        "You are a read-only demo reviewer.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Incomplete reviewer permissions should fail validation.");
      assertOutputContains(result, "webfetch: deny", "Incomplete reviewer permissions should name the missing deny key.");
    },
  },
  {
    name: "validator accepts reviewer permissions without obsolete list key",
    run: () => {
      const fixture = newLibraryFixture("reviewer-without-list-permission");
      writeText(path.join(fixture, ".opencode", "agents", "demo-reviewer.md"), lines([
        "---",
        "description: Reviews demo fixture behavior.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  glob: allow",
        "  grep: allow",
        "  bash: deny",
        "  edit:",
        "    \"*\": deny",
        "    \"docs/feedbacks/**\": allow",
        "  task: deny",
        "  question: deny",
        "  skill:",
        "    \"*\": deny",
        "    complain: allow",
        "  webfetch: deny",
        "  websearch: deny",
        "  todowrite: deny",
        "  external_directory: deny",
        "  lsp: deny",
        "  doom_loop: deny",
        "---",
        "",
        "You are a read-only demo reviewer.",
        "",
        "## Leaf Contract",
        "",
        "Read/search-only leaf reviewer, except feedback-ledger appends under `docs/feedbacks/**` through the `complain` skill. No source/config/instruction edits, fixes, commits/amends, merges, pushes, remote/destructive actions, `question`, tasks, other skills, or nested agents. Stay in scope. Missing evidence -> exact main-session command/manual gate in `Actionable Continuation Items`; external domain -> `Needs external reviewer: <agent-name> required|optional`.",
        "",
        "## Feedback Ledger",
        "",
        "When current-session workflow friction appears, use `complain` and append a privacy-safe entry to `docs/feedbacks/demo-reviewer.md`.",
        "",
        "## Output",
        "",
        "Return:",
        "",
        "- `Findings`: ordered by severity. Each finding includes `Severity`, `Evidence`, `Evidence Type`, `Impact`, `Likely Root Cause`, `Recommendation`, `Confidence`, `Needs external reviewer`.",
        "- `Residual Risks`: known low-confidence gaps, missing evidence, or `none`.",
        "- `Actionable Continuation Items`: concrete tasks for the main session, or `none`.",
        "",
      ]));
      assertSuccess(invokeValidator(fixture), "Reviewer permissions should not require obsolete list permission.");
    },
  },
  {
    name: "validator rejects reviewer bash allow outside session delivery reviewer",
    run: () => {
      const fixture = newLibraryFixture("reviewer-bash-exception-scope");
      writeText(path.join(fixture, ".opencode", "agents", "demo-reviewer.md"), lines([
        "---",
        "description: Reviews demo fixture behavior.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  glob: allow",
        "  grep: allow",
        "  bash:",
        "    \"*\": deny",
        "    \"npm run validate*\": allow",
        "  edit:",
        "    \"*\": deny",
        "    \"docs/feedbacks/**\": allow",
        "  task: deny",
        "  question: deny",
        "  skill:",
        "    \"*\": deny",
        "    complain: allow",
        "  webfetch: deny",
        "  websearch: deny",
        "  todowrite: deny",
        "  external_directory: deny",
        "  lsp: deny",
        "  doom_loop: deny",
        "---",
        "",
        "You are a read-only demo reviewer.",
        "",
        "## Leaf Contract",
        "",
        "Read/search-only leaf reviewer, except feedback-ledger appends under `docs/feedbacks/**` through the `complain` skill. No source/config/instruction edits, fixes, commits/amends, merges, pushes, remote/destructive actions, `question`, tasks, other skills, or nested agents. Stay in scope. Missing evidence -> exact main-session command/manual gate in `Actionable Continuation Items`; external domain -> `Needs external reviewer: <agent-name> required|optional`.",
        "",
        "## Feedback Ledger",
        "",
        "When current-session workflow friction appears, use `complain` and append a privacy-safe entry to `docs/feedbacks/demo-reviewer.md`.",
        "",
        "## Output",
        "",
        "Return:",
        "",
        "- `Findings`: ordered by severity. Each finding includes `Severity`, `Evidence`, `Evidence Type`, `Impact`, `Likely Root Cause`, `Recommendation`, `Confidence`, `Needs external reviewer`.",
        "- `Residual Risks`: known low-confidence gaps, missing evidence, or `none`.",
        "- `Actionable Continuation Items`: concrete tasks for the main session, or `none`.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Only session-delivery-reviewer should be allowed to run delivery-context.");
      assertOutputContains(result, "bash: deny", "Unauthorized reviewer bash exception should explain expected deny policy.");
      assertOutputExcludes(result, "Unsupported frontmatter syntax", "Validator should parse nested bash permission objects.");
    },
  },
  {
    name: "validator rejects session delivery context tool outside session delivery reviewer",
    run: () => {
      const fixture = newLibraryFixture("reviewer-custom-tool-exception-scope");
      writeText(path.join(fixture, ".opencode", "agents", "demo-reviewer.md"), lines([
        "---",
        "description: Reviews demo fixture behavior.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  glob: allow",
        "  grep: allow",
        "  bash: deny",
        "  session_delivery_context: allow",
        "  edit:",
        "    \"*\": deny",
        "    \"docs/feedbacks/**\": allow",
        "  task: deny",
        "  question: deny",
        "  skill:",
        "    \"*\": deny",
        "    complain: allow",
        "  webfetch: deny",
        "  websearch: deny",
        "  todowrite: deny",
        "  external_directory: deny",
        "  lsp: deny",
        "  doom_loop: deny",
        "---",
        "",
        "You are a read-only demo reviewer.",
        "",
        "## Leaf Contract",
        "",
        "Read/search-only leaf reviewer. No edits, fixes, commits/amends, merges, pushes, remote/destructive actions, `question`, tasks, skills, or nested agents. Stay in scope. Missing evidence -> exact main-session command/manual gate in `Actionable Continuation Items`; external domain -> `Needs external reviewer: <agent-name> required|optional`.",
        "",
        "## Output",
        "",
        "Return:",
        "",
        "- `Findings`: ordered by severity. Each finding includes `Severity`, `Evidence`, `Evidence Type`, `Impact`, `Likely Root Cause`, `Recommendation`, `Confidence`, `Needs external reviewer`.",
        "- `Residual Risks`: known low-confidence gaps, missing evidence, or `none`.",
        "- `Actionable Continuation Items`: concrete tasks for the main session, or `none`.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Only session-delivery-reviewer should be allowed to use session_delivery_context.");
      assertOutputContains(result, "Only session-delivery-reviewer", "Custom-tool permission exception should be exclusive.");
    },
  },
  {
    name: "validator rejects obsolete reviewer list permission",
    run: () => {
      const fixture = newLibraryFixture("obsolete-list-permission");
      writeText(path.join(fixture, ".opencode", "agents", "demo-reviewer.md"), lines([
        "---",
        "description: Reviews demo fixture behavior.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  glob: allow",
        "  grep: allow",
        "  list: allow",
        "  bash: deny",
        "  edit: deny",
        "  task: deny",
        "  question: deny",
        "  skill: deny",
        "  webfetch: deny",
        "  websearch: deny",
        "  todowrite: deny",
        "  external_directory: deny",
        "  lsp: deny",
        "  doom_loop: deny",
        "---",
        "",
        "You are a read-only demo reviewer.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Reviewer permissions should reject obsolete list permission.");
      assertOutputContains(result, "permission.list", "Validation output should name obsolete list permission.");
    },
  },
  {
    name: "validator rejects missing test-coverage reviewer task context contract",
    run: () => {
      const fixture = newLibraryFixture("test-coverage-context-contract");
      writeText(path.join(fixture, ".opencode", "agents", "test-coverage-reviewer.md"), lines([
        "---",
        "description: Reviews acceptance and test coverage.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  glob: allow",
        "  grep: allow",
        "  bash: deny",
        "  edit: deny",
        "  task: deny",
        "  question: deny",
        "  skill: deny",
        "  webfetch: deny",
        "  websearch: deny",
        "  todowrite: deny",
        "  external_directory: deny",
        "  lsp: deny",
        "  doom_loop: deny",
        "---",
        "",
        "You are a read-only reviewer for test coverage.",
        "",
        "## Checks",
        "",
        "- Map requirements to tests.",
        "",
      ]));
      appendReadmeAgentCatalogEntry(fixture, "- `test-coverage-reviewer`: Test coverage reviewer.");
      const result = invokeValidator(fixture);
      assertFailure(result, "Missing test-coverage reviewer task context contract should fail validation.");
      assertOutputContains(result, "test-coverage-reviewer must require task/repro/runtime-envelope coverage", "Validation output should name the missing reviewer contract.");
    },
  },
  {
    name: "validator rejects missing session-delivery reviewer control contract",
    run: () => {
      const fixture = newLibraryFixture("session-delivery-control-contract");
      writeText(path.join(fixture, ".opencode", "agents", "session-delivery-reviewer.md"), lines([
        "---",
        "description: Reviews OpenCode session delivery.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  glob: allow",
        "  grep: allow",
        "  bash: deny",
        "  edit: deny",
        "  task: deny",
        "  question: deny",
        "  skill: deny",
        "  webfetch: deny",
        "  websearch: deny",
        "  todowrite: deny",
        "  external_directory: deny",
        "  lsp: deny",
        "  doom_loop: deny",
        "---",
        "",
        "You are a read-only session delivery reviewer.",
        "",
        "## Checks",
        "",
        "- Verify goal alignment.",
        "",
      ]));
      appendReadmeAgentCatalogEntry(fixture, "- `session-delivery-reviewer`: Session delivery reviewer.");
      const result = invokeValidator(fixture);
      assertFailure(result, "Missing session-delivery reviewer control contract should fail validation.");
      assertOutputContains(result, "session-delivery-reviewer must require delivery-control safeguards", "Validation output should name the missing reviewer contract.");
    },
  },
  {
    name: "validator rejects missing reviewer Prevention Feedback contract",
    run: () => {
      const fixture = newLibraryFixture("reviewer-prevention-feedback-contract");
      writeText(path.join(fixture, ".opencode", "agents", "code-quality-reviewer.md"), lines([
        "---",
        "description: Reviews changed code quality.",
        "mode: subagent",
        "permission:",
        "  read: allow",
        "  glob: allow",
        "  grep: allow",
        "  bash: deny",
        "  edit:",
        "    \"*\": deny",
        "    \"docs/feedbacks/**\": allow",
        "  task: deny",
        "  question: deny",
        "  skill:",
        "    \"*\": deny",
        "    complain: allow",
        "  webfetch: deny",
        "  websearch: deny",
        "  todowrite: deny",
        "  external_directory: deny",
        "  lsp: deny",
        "  doom_loop: deny",
        "---",
        "",
        "You are a read-only code quality reviewer.",
        "",
        "## Leaf Contract",
        "",
        "Read/search-only leaf reviewer. No edits, fixes, commits/amends, merges, pushes, remote/destructive actions, `question`, tasks, skills, or nested agents. Stay in scope. Missing evidence -> exact main-session command/manual gate in `Actionable Continuation Items`; external domain -> `Needs external reviewer: <agent-name> required|optional`.",
        "",
        "## Output",
        "",
        "Return:",
        "",
        "- `Findings`: ordered by severity. Each finding includes `Severity`, `Evidence`, `Evidence Type`, `Impact`, `Likely Root Cause`, `Recommendation`, `Confidence`, `Needs external reviewer`.",
        "- `Residual Risks`: known low-confidence gaps, missing evidence, or `none`.",
        "- `Actionable Continuation Items`: concrete tasks for the main session, or `none`.",
        "",
      ]));
      appendReadmeAgentCatalogEntry(fixture, "- `code-quality-reviewer`: Code quality reviewer.");
      const result = invokeValidator(fixture);
      assertFailure(result, "Missing reviewer Prevention Feedback section should fail validation.");
      assertOutputContains(result, "Prevention Feedback", "Validation output should name the missing Prevention Feedback contract.");
    },
  },
  {
    name: "validator rejects catalog drift",
    run: () => {
      const fixture = newLibraryFixture("catalog-drift");
      writeText(path.join(fixture, "README.md"), lines([
        "# Fixture",
        "",
        "## Routing Map",
        "",
        "- Default broad work -> `adaptive-delivery`.",
        "",
        "## Reviewer Gate Map",
        "",
        "- Instruction artifacts -> `instruction-artifact-reviewer`.",
        "",
        "## Skill Catalog",
        "",
        "## Agent Catalog",
        "",
        "- `demo-reviewer`: Demo reviewer.",
        "",
        "## Instruction Templates",
        "",
        "- `example.md`: Demo instruction.",
        "",
        "## Porting Notes",
        "",
      ]));
      assertFailure(invokeValidator(fixture), "README catalog drift should fail validation.");
    },
  },
  {
    name: "validator rejects duplicate catalog entries",
    run: () => {
      const fixture = newLibraryFixture("duplicate-catalog-entry");
      const readmePath = path.join(fixture, "README.md");
      const readme = fs.readFileSync(readmePath, "utf8");
      writeText(readmePath, readme.replace("- `demo-skill`: Demo skill.", "- `demo-skill`: Demo skill.\n- `demo-skill`: Duplicate demo skill."));
      const result = invokeValidator(fixture);
      assertFailure(result, "Duplicate catalog entries should fail validation.");
      assertOutputContains(result, "catalog has duplicate 'demo-skill'", "Duplicate catalog failure should name the duplicate entry.");
    },
  },
  {
    name: "validator rejects missing routing map",
    run: () => {
      const fixture = newLibraryFixture("missing-routing-map");
      writeText(path.join(fixture, "README.md"), lines([
        "# Fixture",
        "",
        "## Reviewer Gate Map",
        "",
        "- Instruction artifacts -> `instruction-artifact-reviewer`.",
        "",
        "## Skill Catalog",
        "",
        "- `demo-skill`: Demo skill.",
        "",
        "## Agent Catalog",
        "",
        "- `demo-reviewer`: Demo reviewer.",
        "",
        "## Instruction Templates",
        "",
        "- `example.md`: Demo instruction.",
        "",
        "## Porting Notes",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Missing routing map should fail validation.");
      assertOutputContains(result, "Missing README section 'Routing Map'", "Missing routing map should explain the section gap.");
    },
  },
  {
    name: "validator rejects empty reviewer gate map",
    run: () => {
      const fixture = newLibraryFixture("empty-reviewer-map");
      writeText(path.join(fixture, "README.md"), lines([
        "# Fixture",
        "",
        "## Routing Map",
        "",
        "- Default broad work -> `adaptive-delivery`.",
        "",
        "## Reviewer Gate Map",
        "",
        "## Skill Catalog",
        "",
        "- `demo-skill`: Demo skill.",
        "",
        "## Agent Catalog",
        "",
        "- `demo-reviewer`: Demo reviewer.",
        "",
        "## Instruction Templates",
        "",
        "- `example.md`: Demo instruction.",
        "",
        "## Porting Notes",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Empty reviewer gate map should fail validation.");
      assertOutputContains(result, "README reviewer gate map must include at least one bullet", "Empty reviewer gate map should explain the bullet gap.");
    },
  },
  {
    name: "validator rejects missing instruction audit route",
    run: () => {
      const fixture = newLibraryFixture("missing-instruction-audit-route");
      writeText(path.join(fixture, "README.md"), lines([
        "# Fixture",
        "",
        "## Routing Map",
        "",
        "- Default broad work -> `adaptive-delivery`.",
        "",
        "## Reviewer Gate Map",
        "",
        "- Instruction artifacts -> `instruction-artifact-reviewer`.",
        "",
        "## Skill Catalog",
        "",
        "- `demo-skill`: Demo skill.",
        "",
        "## Agent Catalog",
        "",
        "- `demo-reviewer`: Demo reviewer.",
        "",
        "## Instruction Templates",
        "",
        "- `example.md`: Demo instruction.",
        "",
        "## Porting Notes",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Missing instruction audit route should fail validation.");
      assertOutputContains(result, "instruction-artifact-audit-runbook.md", "Missing instruction audit route should explain the route gap.");
    },
  },
  {
    name: "validator rejects missing completion handoff",
    run: () => {
      const fixture = newLibraryFixture("missing-completion-handoff");
      writeText(path.join(fixture, "AGENTS.md"), lines([
        "# Repository Instructions",
        "",
        "- Keep artifacts reusable.",
        "",
      ]));
      assertFailure(invokeValidator(fixture), "Missing completion handoff should fail validation.");
    },
  },
  {
    name: "validator rejects missing TypeScript-only policy",
    run: () => {
      const fixture = newLibraryFixture("missing-typescript-policy");
      writeText(path.join(fixture, "AGENTS.md"), lines([
        "# Repository Instructions",
        "",
        "## Completion Handoff",
        "",
        "- Ask the user only for real blockers, remote/destructive actions, scope or risk decisions, credentials, and MR/PR outcomes.",
        "- When asking, offer 2-4 self-contained next actions via `question` when available.",
        "- Put the recommended option first and end its label with `(Recommended)`.",
        "- In read-only, no-question, or subagent contexts, return `Suggested Next Options` or `Actionable Continuation Items` instead of asking the user directly.",
        "",
        "## Autonomous Work Contract",
        "",
        "- The main session owns skill selection, decomposition, validation, reviewer gates, and ready-to-land handoff.",
        "- Ask the user only for real blockers.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Missing TypeScript-only policy should fail validation.");
      assertOutputContains(result, "TypeScript-only development policy", "Missing TypeScript policy should explain the section gap.");
    },
  },
  {
    name: "validator rejects missing deterministic helper automation policy",
    run: () => {
      const fixture = newLibraryFixture("missing-helper-automation-policy");
      writeText(path.join(fixture, "AGENTS.md"), lines([
        "# Repository Instructions",
        "",
        "## TypeScript Development",
        "",
        "- Use TypeScript for all repository automation and implementation code.",
        "- Do not add PowerShell, Python, or JavaScript source files; rewrite any such code to TypeScript instead.",
        "",
        "## Completion Handoff",
        "",
        "- Ask the user only for real blockers, remote/destructive actions, scope or risk decisions, credentials, and MR/PR outcomes.",
        "- When asking, offer 2-4 self-contained next actions via `question` when available.",
        "- Put the recommended option first and end its label with `(Recommended)`.",
        "- In read-only, no-question, or subagent contexts, return `Suggested Next Options` or `Actionable Continuation Items` instead of asking the user directly.",
        "",
        "## Autonomous Work Contract",
        "",
        "- The main session owns skill selection, decomposition, validation, reviewer gates, and ready-to-land handoff.",
        "- Ask the user only for real blockers.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Missing deterministic helper automation policy should fail validation.");
      assertOutputContains(result, "deterministic helper automation policy", "Missing helper automation policy should explain the section gap.");
    },
  },
  {
    name: "validator rejects non-TypeScript source files",
    run: () => {
      const fixture = newLibraryFixture("non-typescript-files");
      writeText(path.join(fixture, "tools", "legacy.ps1"), lines(["# legacy", ""]));
      writeText(path.join(fixture, "tools", "legacy.py"), lines(["print('legacy')", ""]));
      writeText(path.join(fixture, "tools", "legacy.js"), lines(["console.log('legacy');", ""]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Non-TypeScript source/tooling files should fail validation.");
      assertOutputContains(result, "legacy.ps1", "PowerShell source file should be named.");
      assertOutputContains(result, "legacy.py", "Python source file should be named.");
      assertOutputContains(result, "legacy.js", "JavaScript source file should be named.");
    },
  },
  {
    name: "validator rejects legacy tooling references",
    run: () => {
      const fixture = newLibraryFixture("legacy-tooling-references");
      writeText(path.join(fixture, "README.md"), lines([
        "# Fixture",
        "",
        "## Validate",
        "",
        "Run `pwsh -NoProfile -File tools/validate-library.ps1`.",
        "",
        "## Routing Map",
        "",
        "- Default broad work -> `adaptive-delivery`.",
        "- Instruction artifacts -> `instruction-artifact-tuning`; broad audits -> `instruction-artifact-audit-runbook.md`.",
        "",
        "## Reviewer Gate Map",
        "",
        "- Instruction artifacts -> `instruction-artifact-reviewer`.",
        "",
        "## Skill Catalog",
        "",
        "- `demo-skill`: Demo skill.",
        "",
        "## Agent Catalog",
        "",
        "- `demo-reviewer`: Demo reviewer.",
        "",
        "## Instruction Templates",
        "",
        "- `example.md`: Demo instruction.",
        "",
        "## Porting Notes",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Legacy tooling references should fail validation.");
      assertOutputContains(result, "validate-library.ps1", "Legacy validator route should be named.");
    },
  },
  {
    name: "validator rejects legacy package scripts",
    run: () => {
      const fixture = newLibraryFixture("legacy-package-scripts");
      writeText(path.join(fixture, "package.json"), JSON.stringify({
        private: true,
        scripts: {
          validate: "pwsh -NoProfile -File tools/validate-library.ps1",
        },
      }, null, 2));
      const result = invokeValidator(fixture);
      assertFailure(result, "Legacy package scripts should fail validation.");
      assertOutputContains(result, "Package script 'validate'", "Legacy package script failure should name the script.");
    },
  },
  {
    name: "validator rejects force-overwrite installer default bypass without exemption",
    run: () => {
      const fixture = newLibraryFixture("installer-force-overwrite-guard");
      writeText(path.join(fixture, "tools", "install-opencode-global.ts"), lines([
        "#!/usr/bin/env node",
        "function parseArgs() {",
        "  const options = { forceOverwrite: false };",
        "  options.forceOverwrite = true;",
        "  return options;",
        "}",
        "function run() {",
        "  const options = parseArgs();",
        "  installFile(options);",
        "}",
        "function installFile(_options: unknown) {}",
        "run();",
        "",
      ]));
      const rejected = invokeValidator(fixture);
      assertFailure(rejected, "Force-overwrite default bypass should fail validation.");
      assertOutputContains(rejected, "force-overwrite default", "Validation output should name force-overwrite default guard.");

      writeText(path.join(fixture, "openspec", "changes", "guard-exemption", "proposal.md"), lines([
        "# Proposal: guard-exemption",
        "",
        "<!-- install-force-overwrite-default-exemption: fixture proves explicit exemption path -->",
        "",
      ]));
      assertSuccess(invokeValidator(fixture), "Explicit force-overwrite default exemption marker should pass validation.");
    },
  },
  {
    name: "validator rejects routine question handoff",
    run: () => {
      const fixture = newLibraryFixture("routine-question-handoff");
      writeText(path.join(fixture, "AGENTS.md"), lines([
        "# Repository Instructions",
        "",
        "## TypeScript Development",
        "",
        "- Use TypeScript for all repository automation and implementation code.",
        "- Do not add PowerShell, Python, or JavaScript source files; rewrite any such code to TypeScript instead.",
        "",
        "## Completion Handoff",
        "",
        "- After non-trivial user-visible work, the main session offers 2-4 self-contained next actions via `question` when available.",
        "- Put the recommended option first and end its label with `(Recommended)`.",
        "- In read-only, no-question, or subagent contexts, return `Suggested Next Options` or `Actionable Continuation Items` instead of asking the user directly.",
        "",
        "## Autonomous Work Contract",
        "",
        "- Ask the user only for real blockers, remote/destructive actions, scope or risk decisions, credentials, and MR/PR outcomes.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Routine question handoff should fail validation.");
      assertOutputContains(result, "routine post-task question handoff", "Routine question handoff should explain the autonomy regression.");
    },
  },
  {
    name: "validator rejects self-improvement loops",
    run: () => {
      const fixture = newLibraryFixture("self-improvement-loop");
      writeText(path.join(fixture, ".opencode", "skills", "demo-skill", "SKILL.md"), lines([
        "---",
        "name: demo-skill",
        "description: Use when testing a demo reusable skill.",
        "---",
        "",
        "# Demo Skill",
        "",
        "### Step 4 - Self-Improvement",
        "",
        "> Core principle - do not remove.",
        "",
        "Update this skill after every run.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Self-improvement loops should fail validation.");
      assertOutputContains(result, "automatic self-improvement/self-edit loops", "Self-improvement loop should explain the autonomy regression.");
    },
  },
  {
    name: "validator ignores deleted tracked markdown",
    run: () => {
      const fixture = newLibraryFixture("deleted-tracked-markdown");
      const stalePath = path.join(fixture, "notes", "stale.md");
      writeText(stalePath, lines(["# Stale", ""]));
      assertSuccess(invokeProcessCapture("git", ["init"], fixture), "Fixture git init should succeed.");
      assertSuccess(invokeProcessCapture("git", ["add", "."], fixture), "Fixture git add should succeed.");
      fs.unlinkSync(stalePath);
      assertSuccess(invokeValidator(fixture), "Deleted tracked markdown should not affect validation.");
    },
  },
  {
    name: "validator warns on implementation language without TDD",
    run: () => {
      const fixture = newLibraryFixture("tdd-warning");
      writeText(path.join(fixture, ".opencode", "skills", "demo-skill", "SKILL.md"), lines([
        "---",
        "name: demo-skill",
        "description: Use when testing a demo reusable skill.",
        "---",
        "",
        "# Demo Skill",
        "",
        "Use this skill when testing implementation-language warnings.",
        "",
        "This skill can implement code changes.",
        "",
        "## Output",
        "",
        "Return implementation notes.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertSuccess(result, "TDD warning should not fail validation.");
      assertOutputContains(result, "WARN:", "TDD warning should be visible.");
    },
  },
  {
    name: "validator ignores non-goal implementation language",
    run: () => {
      const fixture = newLibraryFixture("non-goal-implementation-language");
      writeText(path.join(fixture, ".opencode", "skills", "demo-skill", "SKILL.md"), lines([
        "---",
        "name: demo-skill",
        "description: Use when testing non-goal wording.",
        "---",
        "",
        "# Demo Skill",
        "",
        "Use this skill when testing instruction validation wording.",
        "",
        "Non-goals: plugin implementation is out of scope.",
        "",
        "## Output",
        "",
        "Return scope notes.",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertSuccess(result, "Non-goal implementation wording should not warn.");
      assertOutputContains(result, "warnings=0", "Non-goal implementation wording should emit no warnings.");
    },
  },
  {
    name: "validator rejects forbidden anchors",
    run: () => {
      const fixture = newLibraryFixture("forbidden-anchor");
      writeText(path.join(fixture, "instructions", "example.md"), lines(["# Example", "OldProductName", ""]));
      const result = invokeProcessCapture("node", [validator, "--root", fixture, "--forbidden-anchor", "OldProductName"], root);
      assertFailure(result, "Forbidden anchors should fail validation.");
      assertOutputContains(result, "Forbidden anchor 'OldProductName'", "Forbidden anchor failure should name the anchor.");
    },
  },
  {
    name: "validator warns on broad permission wildcard allow",
    run: () => {
      const riskyFixture = newLibraryFixture("permission-wildcard-risk");
      writeText(path.join(riskyFixture, "opencode.jsonc"), lines([
        "{",
        "  \"$schema\": \"https://opencode.ai/config.json\",",
        "  \"permission\": {",
        "    \"*\": \"allow\",",
        "    \"bash\": {",
        "      \"git reset --hard*\": \"ask\",",
        "      \"*\": \"allow\"",
        "    },",
        "    \"read\": {",
        "      \"*\": \"allow\"",
        "    }",
        "  }",
        "}",
      ]));
      const riskyResult = invokeValidator(riskyFixture);
      assertSuccess(riskyResult, "Broad permission wildcard allow should be warning-only.");
      assertOutputContains(riskyResult, "WARN:", "Broad permission wildcard allow should emit a warning.");
      assertOutputContains(riskyResult, "permission.*", "Permission warning should identify top-level wildcard allow.");
      assertOutputContains(riskyResult, "permission.bash", "Permission warning should identify the affected permission key.");
      assertOutputContains(riskyResult, "wildcard allow", "Permission warning should explain the wildcard allow risk.");
      assertOutputExcludes(riskyResult, "permission.read", "Read wildcard allow should not warn as mutation-capable permission.");

      const safeFixture = newLibraryFixture("permission-wildcard-safe");
      writeText(path.join(safeFixture, "opencode.jsonc"), lines([
        "{",
        "  // JSONC comments are allowed by this validator subset.",
        "  \"$schema\": \"https://opencode.ai/config.json\",",
        "  \"permission\": {",
        "    \"*\": \"ask\",",
        "    \"bash\": {",
        "      \"*\": \"ask\",",
        "      \"git status*\": \"allow\",",
        "    },",
        "  },",
        "}",
      ]));
      const safeResult = invokeValidator(safeFixture);
      assertSuccess(safeResult, "Safe broad ask plus narrow allow should pass validation.");
      assertOutputContains(safeResult, "warnings=0", "Safe permission config should emit no validator warnings.");
      assertOutputExcludes(safeResult, "OpenCode permission config", "Safe permission config should not emit permission warnings.");
    },
  },
  {
    name: "validator rejects unterminated JSONC comments",
    run: () => {
      const fixture = newLibraryFixture("unterminated-jsonc-comment");
      writeText(path.join(fixture, "opencode.jsonc"), lines([
        "{",
        "  \"$schema\": \"https://opencode.ai/config.json\"",
        "}",
        "/* not closed",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Unterminated JSONC comments should fail validation.");
      assertOutputContains(result, "Unterminated JSONC block comment", "JSONC failure should name unterminated block comments.");
    },
  },
  {
    name: "validator strict mode rejects warnings",
    run: () => {
      const fixture = newLibraryFixture("strict-warning");
      writeText(path.join(fixture, ".opencode", "skills", "demo-skill", "SKILL.md"), lines([
        "---",
        "name: demo-skill",
        "description: Use when testing a demo reusable skill.",
        "---",
        "",
        "# Demo Skill",
        "",
        "Use this skill when testing strict implementation-language warnings.",
        "",
        "This skill can implement code changes.",
        "",
        "## Output",
        "",
        "Return implementation notes.",
        "",
      ]));
      const result = invokeProcessCapture("node", [validator, "--root", fixture, "--fail-on-warnings"], root);
      assertFailure(result, "Strict validation should reject warning-level drift.");
      assertOutputContains(result, "Warnings are not allowed", "Strict validation should explain warning failures.");
    },
  },
  {
    name: "validator rejects invalid profile contracts",
    run: () => {
      const fixture = newLibraryFixture("invalid-profile-contract");
      writeText(path.join(fixture, "profiles", "standard.json"), lines([
        "{",
        "  \"name\": \"standard\",",
        "  \"description\": \"Broken profile.\",",
        "  \"skills\": [\"missing-skill\"],",
        "  \"agents\": [\"demo-reviewer\"],",
        "  \"validation\": { \"failOnWarnings\": true }",
        "}",
        "",
      ]));
      const result = invokeValidator(fixture);
      assertFailure(result, "Invalid profile references and unsupported fields should fail validation.");
      assertOutputContains(result, "Unsupported profile field 'validation'", "Profile validation should reject unsupported semantic fields.");
      assertOutputContains(result, "Profile references missing skill 'missing-skill'", "Profile validation should reject missing skill refs.");
    },
  },
  {
    name: "init project previews and writes universal loop bootstrap",
    run: () => {
      const project = newTempDir("init-project-target");
      const preview = invokeInitProject(["--target", project]);
      assertSuccess(preview, "Project bootstrap preview should succeed.");
      assertOutputContains(preview, "would create: AGENTS.md", "Preview should show AGENTS.md creation.");
      assertOutputContains(preview, "would create: docs/feedbacks/README.md", "Preview should show feedback ledger creation.");
      if (fs.existsSync(path.join(project, "AGENTS.md"))) {
        throw new Error("Project bootstrap preview must not write files.");
      }
      if (fs.existsSync(path.join(project, "docs", "feedbacks", "README.md"))) {
        throw new Error("Project bootstrap preview must not write feedback ledger files.");
      }

      const write = invokeInitProject(["--target", project, "--mode", "write"]);
      assertSuccess(write, "Project bootstrap write should succeed for an empty project.");
      assertOutputContains(write, "created: AGENTS.md", "Write should create AGENTS.md.");
      assertOutputContains(write, "created: docs/feedbacks/README.md", "Write should create feedback ledger README.");
      assertOutputContains(write, "created: opencode-dev-kit/adapter.json", "Write should create the adapter file.");
      const agentsText = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
      if (!agentsText.includes("Universal Development Loop")) {
        throw new Error("Project AGENTS.md should install the Universal Development Loop template.");
      }
      const feedbackText = fs.readFileSync(path.join(project, "docs", "feedbacks", "README.md"), "utf8");
      if (!feedbackText.includes("Feedback Ledger") || !feedbackText.includes("complain")) {
        throw new Error("Project bootstrap should install the feedback ledger README.");
      }
    },
  },
  {
    name: "init project refuses overwrite without explicit flag",
    run: () => {
      const project = newTempDir("init-project-overwrite");
      const agentsPath = path.join(project, "AGENTS.md");
      writeText(agentsPath, "existing rules\n");
      const result = invokeInitProject(["--target", project, "--mode", "write"]);
      assertFailure(result, "Project bootstrap should refuse overwriting existing files without --overwrite.");
      assertOutputContains(result, "Refusing to overwrite", "Overwrite refusal should explain the safety boundary.");
      assertEqual(fs.readFileSync(agentsPath, "utf8"), "existing rules\n".replace(/\n/g, os.EOL), "Overwrite refusal should preserve existing AGENTS.md.");
    },
  },
  {
    name: "init project overwrite backs up and replaces existing files",
    run: () => {
      const project = newTempDir("init-project-overwrite-backup");
      const agentsPath = path.join(project, "AGENTS.md");
      writeText(agentsPath, "existing rules\n");
      const result = invokeInitProject(["--target", project, "--mode", "write", "--overwrite"]);
      assertSuccess(result, "Project bootstrap should overwrite only with explicit --overwrite.");
      assertOutputContains(result, "replaced: AGENTS.md", "Overwrite should report replaced AGENTS.md.");
      assertOutputContains(result, "backup:", "Overwrite should report backup path.");
      const backup = findPathWithBasename(path.join(project, ".backups", "opencode-dev-kit"), "AGENTS.md");
      if (!backup) {
        throw new Error("Overwrite should create an AGENTS.md backup.");
      }
      if (!fs.readFileSync(backup, "utf8").includes("existing rules")) {
        throw new Error(`Backup should preserve original AGENTS.md content.\nBackup: ${backup}`);
      }
      const expected = fs.readFileSync(path.join(root, "templates", "project", "AGENTS.md"), "utf8");
      assertEqual(fs.readFileSync(agentsPath, "utf8"), expected, "Overwrite should copy the project AGENTS.md template exactly.");
    },
  },
  {
    name: "doctor reports bootstrapped project readiness",
    run: () => {
      const project = newTempDir("doctor-project");
      assertSuccess(invokeInitProject(["--target", project, "--mode", "write"]), "Bootstrap should prepare the doctor fixture.");
      const result = invokeDoctor(["--project", project, "--format", "json"]);
      assertSuccess(result, "Doctor should pass for a bootstrapped project.");
      const report = asRecord(parseJsonOutput(result), "Doctor JSON root should be an object.");
      assertEqual(report.status, "pass", "Doctor should report pass for a bootstrapped project.");
      assertEqual(report.project, "<redacted>", "Doctor should redact project paths by default.");
    },
  },
  {
    name: "doctor reports warnings for unbootstrapped project",
    run: () => {
      const project = newTempDir("doctor-warning-project");
      const result = invokeDoctor(["--project", project, "--format", "json"]);
      assertSuccess(result, "Doctor warning status should remain machine-readable with exit 0.");
      const report = asRecord(parseJsonOutput(result), "Doctor JSON root should be an object.");
      assertEqual(report.status, "warn", "Doctor should report warn for a project missing bootstrap files.");
      const checks = asArray(report.checks, "Doctor checks should be an array.");
      const agentsCheck = findBucket(checks, "name", "project AGENTS.md");
      assertEqual(agentsCheck.status, "warn", "Doctor should warn when project AGENTS.md is missing the loop.");
      const adapterCheck = findBucket(checks, "name", "project adapter");
      assertEqual(adapterCheck.status, "warn", "Doctor should warn when project adapter is missing.");
      const feedbackCheck = findBucket(checks, "name", "project feedback ledger");
      assertEqual(feedbackCheck.status, "warn", "Doctor should warn when project feedback ledger is missing.");
    },
  },
  {
    name: "project inventory reports deterministic project signals",
    run: () => {
      const project = newTempDir("project-inventory");
      writeText(path.join(project, "package.json"), lines([
        "{",
        "  \"scripts\": {",
        "    \"test\": \"npm test -- --runInBand\",",
        "    \"build\": \"tsc -p tsconfig.json\"",
        "  }",
        "}",
      ]));
      writeText(path.join(project, "src", "index.ts"), "export const value = 1;\n");
      writeText(path.join(project, "tests", "index.test.ts"), "test('value', () => {});\n");
      writeText(path.join(project, "tsconfig.json"), "{}\n");
      const result = invokeProjectInventory(["--root", project, "--format", "json"]);
      assertSuccess(result, "Project inventory should read a small fixture project.");
      const report = asRecord(parseJsonOutput(result), "Project inventory JSON root should be an object.");
      assertEqual(report.root, "<redacted>", "Project inventory should redact root by default.");
      const scripts = asArray(report.packageScripts, "Project inventory scripts should be an array.");
      findBucket(scripts, "name", "test");
      const buildFiles = asArray(report.buildFiles, "Project inventory build files should be an array.");
      findBucket(buildFiles, "path", "package.json");
      const sourceRoots = asArray(report.sourceRoots, "Project inventory source roots should be an array.");
      findBucket(sourceRoots, "path", "src");
    },
  },
  {
    name: "instruction inventory reports token-cost artifact metrics",
    run: () => {
      const result = invokeInstructionInventory(["--format", "json"]);
      assertSuccess(result, "Instruction inventory should scan repository artifacts.");
      const report = asRecord(parseJsonOutput(result), "Instruction inventory JSON root should be an object.");
      assertEqual(report.root, "<redacted>", "Instruction inventory should redact root by default.");
      const totals = asRecord(report.totals, "Instruction inventory totals should be an object.");
      if (typeof totals.artifacts !== "number" || totals.artifacts < 1) {
        throw new Error(`Instruction inventory should count artifacts.\nTotals:\n${JSON.stringify(totals, null, 2)}`);
      }
      const artifacts = asArray(report.artifacts, "Instruction inventory artifacts should be an array.");
      findBucket(artifacts, "path", "instructions/universal-development-loop.md");
    },
  },
  {
    name: "installer dry-run writes nothing",
    run: () => {
      const configDir = path.join(newTempDir("installer-dry-run"), "config");
      const result = invokeInstaller(["--dry-run", "--config-dir", configDir]);
      assertSuccess(result, "Installer dry-run should succeed.");
      assertOutputContains(result, "Install profile: all", "Default installer run should install all repo artifacts without profile selection.");
      assertOutputContains(result, "skill adaptive-delivery", "Default installer run should include core skills.");
      assertOutputContains(result, "skill wire-protocol-golden-tests", "Default installer run should include the full repository skill set.");
      assertOutputContains(result, "agent deployment-config-reviewer", "Default installer run should include every reviewer.");
      assertOutputContains(result, "plugin session-env", "Default installer run should include session delivery context plugin.");
      if (fs.existsSync(configDir)) {
        throw new Error(`Installer dry-run created config directory: ${configDir}`);
      }
    },
  },
  {
    name: "installer supports only the all profile",
    run: () => {
      const configDir = path.join(newTempDir("installer-profile-all"), "config");
      const result = invokeInstaller(["--dry-run", "--config-dir", configDir, "--profile", "all"]);
      assertSuccess(result, "Installer dry-run should support profile all.");
      assertOutputContains(result, "Install profile: all", "Installer output should name profile all.");
      assertOutputContains(result, "skill adaptive-delivery", "All profile should include the Universal Development Loop entrypoint.");
      assertOutputContains(result, "skill wire-protocol-golden-tests", "All profile should include every repository skill.");
      assertOutputContains(result, "agent deployment-config-reviewer", "All profile should include every reviewer.");

      for (const profile of ["standard", "strict", "advanced"]) {
        const rejected = invokeInstaller(["--dry-run", "--config-dir", path.join(newTempDir(`installer-profile-${profile}`), "config"), "--profile", profile]);
        assertFailure(rejected, `Installer should reject removed profile ${profile}.`);
        assertOutputContains(rejected, "Missing install profile", `Removed profile ${profile} should fail as missing.`);
      }
    },
  },
  {
    name: "installer rejects missing profile",
    run: () => {
      const configDir = path.join(newTempDir("installer-missing-profile"), "config");
      const result = invokeInstaller(["--dry-run", "--config-dir", configDir, "--profile", "missing-profile"]);
      assertFailure(result, "Installer should reject unknown profiles.");
      assertOutputContains(result, "Missing install profile", "Missing profile error should explain the profile lookup failure.");
    },
  },
  {
    name: "installer rejects source-nested config dir",
    run: () => {
      const configDir = path.join(root, ".opencode", "skills", "adaptive-delivery", "install-target");
      assertFailure(invokeInstaller(["--dry-run", "--config-dir", configDir]), "Installer should reject config paths nested inside source skills.");
    },
  },
  {
    name: "installer rejects source-parent config dirs",
    run: () => {
      assertFailure(invokeInstaller(["--dry-run", "--config-dir", path.join(root, ".opencode")]), "Installer should reject config paths that contain source artifacts.");
      assertFailure(invokeInstaller(["--dry-run", "--config-dir", root]), "Installer should reject repository root as config path.");
    },
  },
  {
    name: "installer rejects symlinked source config dirs",
    run: () => {
      const fixture = newTempDir("installer-symlink-overlap");
      const repoLink = path.join(fixture, "repo-link");
      try {
        fs.symlinkSync(root, repoLink, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`SKIP: installer rejects symlinked source config dirs (${message})`);
        return;
      }
      const configDir = path.join(repoLink, ".opencode", "skills", "adaptive-delivery", "install-target");
      const result = invokeInstaller(["--dry-run", "--config-dir", configDir]);
      assertFailure(result, "Installer should reject config paths nested inside symlinked source skills.");
      assertOutputContains(result, "overlap source artifact directory", "Symlink overlap rejection should explain the source overlap.");
    },
  },
  {
    name: "installer rejects destination AGENTS source",
    run: () => {
      const configDir = path.join(newTempDir("installer-agents-source-self"), "config");
      const agentsPath = path.join(configDir, "AGENTS.md");
      writeText(agentsPath, lines(["# User Rules", ""]));
      const result = invokeInstaller(["--dry-run", "--config-dir", configDir, "--agents-md-source", agentsPath]);
      assertFailure(result, "Installer should reject using destination AGENTS.md as the source block.");
      assertOutputContains(result, "must not be the destination AGENTS.md", "Destination AGENTS source failure should explain the self-source risk.");
    },
  },
  {
    name: "installer rejects loader-dir AGENTS source",
    run: () => {
      const configDir = path.join(newTempDir("installer-agents-source-loader"), "config");
      const sourcePath = path.join(configDir, "agents", "source.md");
      writeText(sourcePath, lines(["# Source", ""]));
      const result = invokeInstaller(["--dry-run", "--config-dir", configDir, "--agents-md-source", sourcePath]);
      assertFailure(result, "Installer should reject AGENTS source paths inside destination loader directories.");
      assertOutputContains(result, "must not be inside destination skills or agents", "Loader-dir source failure should explain prune/loader risk.");
    },
  },
  {
    name: "installer rejects duplicate AGENTS markers",
    run: () => {
      const configDir = path.join(newTempDir("installer-markers"), "config");
      writeText(path.join(configDir, "AGENTS.md"), lines([
        "before",
        "<!-- agents-and-skills:begin -->",
        "old",
        "<!-- agents-and-skills:end -->",
        "middle",
        "<!-- agents-and-skills:begin -->",
        "older",
        "<!-- agents-and-skills:end -->",
        "",
      ]));
      assertFailure(invokeInstaller(["--dry-run", "--config-dir", configDir]), "Duplicate AGENTS.md markers should fail.");
    },
  },
  {
    name: "installer prunes stale skills and agents with prune opt-in",
    run: () => {
      const configDir = path.join(newTempDir("installer-prune"), "config");
      const staleSkillDir = path.join(configDir, "skills", "stale-skill");
      const staleAgentFile = path.join(configDir, "agents", "stale-agent.md");
      writeText(path.join(staleSkillDir, "SKILL.md"), lines([
        "---",
        "name: stale-skill",
        "description: Stale installed skill.",
        "---",
        "",
        "# Stale Skill",
        "",
      ]));
      writeText(staleAgentFile, lines(["---", "description: Stale installed agent.", "mode: subagent", "---", ""]));
      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md", "--prune"]);
      assertSuccess(result, "Installer should prune stale skills and agents with --prune.");
      assertOutputContains(result, "pruned: stale skill stale-skill", "Installer should report stale skill pruning.");
      assertOutputContains(result, "pruned: stale agent stale-agent", "Installer should report stale agent pruning.");
      if (fs.existsSync(staleSkillDir)) {
        throw new Error(`Stale skill directory still exists: ${staleSkillDir}`);
      }
      if (fs.existsSync(staleAgentFile)) {
        throw new Error(`Stale agent file still exists: ${staleAgentFile}`);
      }
      const backupRoot = path.join(configDir, ".backups", "agents-and-skills");
      if (!anyPathWithBasename(backupRoot, "stale-skill")) {
        throw new Error(`Stale skill was not backed up under: ${backupRoot}`);
      }
      if (!anyPathWithBasename(backupRoot, "stale-agent.md")) {
        throw new Error(`Stale agent was not backed up under: ${backupRoot}`);
      }
    },
  },
  {
    name: "installer installs plugin support without pruning user plugins",
    run: () => {
      const configDir = path.join(newTempDir("installer-plugin-support"), "config");
      const userPlugin = path.join(configDir, "plugin", "user-plugin.ts");
      writeText(userPlugin, lines(["export default async () => ({})", ""]));
      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md"]);
      assertSuccess(result, "Installer should install plugin support.");
      assertOutputContains(result, "plugin session-env", "Installer should report session env plugin install.");
      assertOutputContains(result, "support tool session-delivery-context", "Installer should report support tool install.");
      if (!fs.existsSync(userPlugin)) {
        throw new Error(`Installer pruned unrelated user plugin: ${userPlugin}`);
      }
      for (const expected of [
        path.join(configDir, "plugin", "session-env.ts"),
        path.join(configDir, "opencode-dev-kit", "tools", "session-delivery-context.ts"),
      ]) {
        if (!fs.existsSync(expected)) {
          throw new Error(`Installer did not install expected plugin support file: ${expected}`);
        }
      }
    },
  },
  {
    name: "installer dry-run does not prune stale artifacts",
    run: () => {
      const configDir = path.join(newTempDir("installer-prune-dry-run"), "config");
      const staleSkillDir = path.join(configDir, "skills", "stale-skill");
      const staleAgentFile = path.join(configDir, "agents", "stale-agent.md");
      writeText(path.join(staleSkillDir, "SKILL.md"), lines(["# Stale Skill", ""]));
      writeText(staleAgentFile, lines(["# Stale Agent", ""]));
      const result = invokeInstaller(["--dry-run", "--config-dir", configDir, "--skip-agents-md", "--prune"]);
      assertSuccess(result, "Installer dry-run prune should succeed.");
      assertOutputContains(result, "would prune: stale skill stale-skill", "Dry-run should report stale skill prune without deleting.");
      assertOutputContains(result, "would prune: stale agent stale-agent", "Dry-run should report stale agent prune without deleting.");
      if (!fs.existsSync(staleSkillDir)) {
        throw new Error(`Dry-run removed stale skill directory: ${staleSkillDir}`);
      }
      if (!fs.existsSync(staleAgentFile)) {
        throw new Error(`Dry-run removed stale agent file: ${staleAgentFile}`);
      }
    },
  },
  {
    name: "installer no-backup prunes without backups",
    run: () => {
      const configDir = path.join(newTempDir("installer-prune-no-backup"), "config");
      const staleSkillDir = path.join(configDir, "skills", "stale-skill");
      const staleAgentFile = path.join(configDir, "agents", "stale-agent.md");
      writeText(path.join(staleSkillDir, "SKILL.md"), lines(["# Stale Skill", ""]));
      writeText(staleAgentFile, lines(["# Stale Agent", ""]));
      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md", "--no-backup", "--prune"]);
      assertSuccess(result, "Installer --no-backup prune should succeed.");
      assertOutputContains(result, "pruned: stale skill stale-skill", "No-backup prune should still report stale skill pruning.");
      assertOutputContains(result, "pruned: stale agent stale-agent", "No-backup prune should still report stale agent pruning.");
      if (fs.existsSync(staleSkillDir)) {
        throw new Error(`No-backup prune left stale skill directory: ${staleSkillDir}`);
      }
      if (fs.existsSync(staleAgentFile)) {
        throw new Error(`No-backup prune left stale agent file: ${staleAgentFile}`);
      }
      const backupRoot = path.join(configDir, ".backups", "agents-and-skills");
      if (fs.existsSync(backupRoot)) {
        throw new Error(`--no-backup created backup root during prune: ${backupRoot}`);
      }
    },
  },
  {
    name: "installer no-prune keeps stale artifacts",
    run: () => {
      const configDir = path.join(newTempDir("installer-no-prune"), "config");
      const staleSkillDir = path.join(configDir, "skills", "stale-skill");
      const staleAgentFile = path.join(configDir, "agents", "stale-agent.md");
      writeText(path.join(staleSkillDir, "SKILL.md"), lines(["# Stale Skill", ""]));
      writeText(staleAgentFile, lines(["# Stale Agent", ""]));
      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md", "--no-prune"]);
      assertSuccess(result, "Installer --no-prune should succeed.");
      if (!fs.existsSync(staleSkillDir)) {
        throw new Error(`--no-prune removed stale skill directory: ${staleSkillDir}`);
      }
      if (!fs.existsSync(staleAgentFile)) {
        throw new Error(`--no-prune removed stale agent file: ${staleAgentFile}`);
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
    console.log(`FAIL: ${test.name}`);
    console.log(message);
  }
}

if (failed > 0) {
  throw new Error(`${failed} library test(s) failed.`);
}

console.log(`OK: library tests=${tests.length}`);
