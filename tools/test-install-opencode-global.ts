#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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
const installer = path.join(root, "tools", "install-opencode-global.ts");

function newTempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `install-opencode-global-${name}-`));
  return dir;
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content.trimEnd()}\n`, "utf8");
}

function invokeInstaller(args: string[]): ProcessResult {
  const result = spawnSync(process.execPath, [installer, ...args], { cwd: root, encoding: "utf8" });
  return { exitCode: result.status ?? 0, output: `${result.stdout}${result.stderr}` };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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

function installCleanConfig(name: string): string {
  const configDir = path.join(newTempDir(name), "config");
  const result = invokeInstaller(["--config-dir", configDir, "--profile", "standard", "--skip-agents-md"]);
  assertSuccess(result, "Initial clean install should succeed.");
  return configDir;
}

function driftSkill(configDir: string, skillName = "adaptive-delivery"): string {
  const skillPath = path.join(configDir, "skills", skillName, "SKILL.md");
  writeText(skillPath, `${fs.readFileSync(skillPath, "utf8")}\nLocal destination-only prevention rule.`);
  return skillPath;
}

function sourceSkillPath(skillName = "adaptive-delivery"): string {
  return path.join(root, ".opencode", "skills", skillName, "SKILL.md");
}

function backupRoot(configDir: string): string {
  return path.join(configDir, ".backups", "agents-and-skills");
}

function countInstallPullbackChanges(): number {
  const changesRoot = path.join(root, "openspec", "changes");
  if (!fs.existsSync(changesRoot)) {
    return 0;
  }
  return fs.readdirSync(changesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("install-pullback-"))
    .length;
}

function latestPullbackChange(): string {
  const changesRoot = path.join(root, "openspec", "changes");
  const entries = fs.readdirSync(changesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("install-pullback-"))
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) {
    throw new Error("No install-pullback changes were generated.");
  }
  return entries[entries.length - 1];
}

const tests: TestCase[] = [
  {
    name: "default install refuses drift and prints recovery commands",
    run: () => {
      const configDir = installCleanConfig("default-refuse");
      const drifted = driftSkill(configDir);
      const before = fs.readFileSync(drifted, "utf8");
      const result = invokeInstaller(["--config-dir", configDir, "--profile", "standard", "--skip-agents-md"]);
      assertFailure(result, "Default install must refuse drift.");
      assertOutputContains(result, "drift detected", "Refusal should name drift.");
      assertOutputContains(result, "--pull-back", "Refusal should offer pull-back.");
      assertOutputContains(result, "--force-overwrite", "Refusal should offer force-overwrite.");
      assert(fs.readFileSync(drifted, "utf8") === before, "Default refusal must not overwrite drifted destination skill.");
    },
  },
  {
    name: "default install into empty config still installs artifacts",
    run: () => {
      const configDir = path.join(newTempDir("empty-install"), "config");
      const result = invokeInstaller(["--config-dir", configDir, "--profile", "standard", "--skip-agents-md"]);
      assertSuccess(result, "Clean install into empty config should succeed.");
      assert(fs.existsSync(path.join(configDir, "skills", "adaptive-delivery", "SKILL.md")), "Clean install must write standard skill.");
      assert(fs.existsSync(path.join(configDir, "agents", "code-quality-reviewer.md")), "Clean install must write standard agent.");
    },
  },
  {
    name: "audit reports drift without writes backups or removals",
    run: () => {
      const cleanConfig = installCleanConfig("audit-clean");
      const cleanAudit = invokeInstaller(["--config-dir", cleanConfig, "--profile", "standard", "--skip-agents-md", "--audit"]);
      assertSuccess(cleanAudit, "Audit should exit zero when no drift exists.");

      const configDir = installCleanConfig("audit-drift");
      const drifted = driftSkill(configDir);
      const before = fs.readFileSync(drifted, "utf8");
      const result = invokeInstaller(["--config-dir", configDir, "--profile", "standard", "--skip-agents-md", "--audit"]);
      assertFailure(result, "Audit should exit non-zero when drift exists.");
      assertOutputContains(result, "sourceHash", "Audit output must include source hash.");
      assertOutputContains(result, "destinationHash", "Audit output must include destination hash.");
      assert(fs.readFileSync(drifted, "utf8") === before, "Audit must not overwrite drifted file.");
      assert(!fs.existsSync(backupRoot(configDir)), "Audit must not create backups.");
    },
  },
  {
    name: "pull-back writes deterministic investigation change without overwrite",
    run: () => {
      const beforeCount = countInstallPullbackChanges();
      const configDir = installCleanConfig("pullback");
      const drifted = driftSkill(configDir);
      const before = fs.readFileSync(drifted, "utf8");
      const first = invokeInstaller(["--config-dir", configDir, "--profile", "standard", "--skip-agents-md", "--pull-back"]);
      assertSuccess(first, "Pull-back should succeed on drift.");
      assertOutputContains(first, "install-pullback", "Pull-back should report generated investigation change.");
      assert(fs.readFileSync(drifted, "utf8") === before, "Pull-back must not overwrite drifted destination.");
      const changeId = latestPullbackChange();
      assert(countInstallPullbackChanges() === beforeCount + 1, "Pull-back should create exactly one change for one drifted artifact.");
      const changeRoot = path.join(root, "openspec", "changes", changeId);
      const proposal = fs.readFileSync(path.join(changeRoot, "proposal.md"), "utf8");
      const tasks = fs.readFileSync(path.join(changeRoot, "tasks.md"), "utf8");
      const spec = fs.readFileSync(path.join(changeRoot, "specs", changeId, "spec.md"), "utf8");
      assert(proposal.includes("## Destination Content") && proposal.includes("## Source Content") && proposal.includes("unknown"), "Pull-back proposal must preserve content and unknown root cause.");
      assert(tasks.includes("## Retrospective Before Archive"), "Pull-back tasks must end with retrospective section.");
      assert(spec.includes("## ADDED Requirements"), "Pull-back spec delta must be generated.");

      const second = invokeInstaller(["--config-dir", configDir, "--profile", "standard", "--skip-agents-md", "--pull-back"]);
      assertSuccess(second, "Second pull-back should succeed.");
      assertOutputContains(second, "existing", "Second pull-back should report existing change.");
      assert(countInstallPullbackChanges() === beforeCount + 1, "Second pull-back must not create a duplicate change.");
      fs.rmSync(changeRoot, { recursive: true, force: true });
      assert(countInstallPullbackChanges() === beforeCount, "Pull-back test must clean generated investigation change.");
    },
  },
  {
    name: "force-overwrite restores legacy backup and overwrite path",
    run: () => {
      const configDir = installCleanConfig("force-overwrite");
      const drifted = driftSkill(configDir);
      const result = invokeInstaller(["--config-dir", configDir, "--profile", "standard", "--skip-agents-md", "--force-overwrite"]);
      assertSuccess(result, "Force-overwrite should succeed on drift.");
      assertOutputContains(result, "backup:", "Force-overwrite should create backup for drifted destination.");
      assert(fs.readFileSync(drifted, "utf8") === fs.readFileSync(sourceSkillPath(), "utf8"), "Force-overwrite must restore source content.");
      assert(fs.existsSync(backupRoot(configDir)), "Force-overwrite must create backup root.");
    },
  },
  {
    name: "force-overwrite guard text remains present",
    run: () => {
      const installerText = fs.readFileSync(installer, "utf8");
      assert(installerText.includes("collectDrift("), "Installer must keep collectDrift call in default path.");
      assert(!/options\.forceOverwrite\s*=\s*true/.test(installerText), "Installer must not default forceOverwrite to true.");
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

console.log(`OK: install opencode global tests=${tests.length}`);
