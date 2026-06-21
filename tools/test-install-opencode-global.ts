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
  const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md"]);
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
  return listInstallPullbackChanges().length;
}

function listInstallPullbackChanges(): string[] {
  const changesRoot = path.join(root, "openspec", "changes");
  if (!fs.existsSync(changesRoot)) {
    return [];
  }
  return fs.readdirSync(changesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("install-pullback-"))
    .map((entry) => entry.name)
    .sort();
}

function newPullbackChangesSince(beforeIds: Set<string>): string[] {
  return listInstallPullbackChanges().filter((changeId) => !beforeIds.has(changeId));
}

const tests: TestCase[] = [
  {
    name: "help documents skip-agents-md write surface",
    run: () => {
      const result = invokeInstaller(["--help"]);
      assertSuccess(result, "Help should exit successfully.");
      assertOutputContains(result, "Skip the managed AGENTS.md block", "Help should describe --skip-agents-md precisely.");
      assertOutputContains(result, "plugin, and support files still install", "Help should mention plugin/support writes.");
      assertOutputExcludes(result, "Install only skills and agents", "Help must not understate the --skip-agents-md write surface.");
    },
  },
  {
    name: "default install refuses drift and prints recovery commands",
    run: () => {
      const configDir = installCleanConfig("default-refuse");
      const drifted = driftSkill(configDir);
      const before = fs.readFileSync(drifted, "utf8");
      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md"]);
      assertFailure(result, "Default install must refuse drift.");
      assertOutputContains(result, "drift detected", "Refusal should name drift.");
      assertOutputContains(result, "--pull-back", "Refusal should offer pull-back.");
      assertOutputContains(result, "--force-overwrite", "Refusal should offer force-overwrite.");
      assert(fs.readFileSync(drifted, "utf8") === before, "Default refusal must not overwrite drifted destination skill.");
    },
  },
  {
    name: "default install refuses AGENTS.md drift and asks for smart merge",
    run: () => {
      const configDir = path.join(newTempDir("agents-md-drift"), "config");
      const initial = invokeInstaller(["--config-dir", configDir]);
      assertSuccess(initial, "Initial install should create AGENTS.md block.");
      const agentsPath = path.join(configDir, "AGENTS.md");
      const before = fs.readFileSync(agentsPath, "utf8").replace(
        "<!-- agents-and-skills:end -->",
        "Local destination-only global rule.\n<!-- agents-and-skills:end -->",
      );
      fs.writeFileSync(agentsPath, before, "utf8");

      const result = invokeInstaller(["--config-dir", configDir]);
      assertFailure(result, "Default install must refuse AGENTS.md drift.");
      assertOutputContains(result, "AGENTS.md", "Refusal should name AGENTS.md drift.");
      assertOutputContains(result, "smart-merge", "Refusal should ask for smart merge.");
      assert(fs.readFileSync(agentsPath, "utf8") === before, "Default refusal must not overwrite drifted AGENTS.md.");
    },
  },
  {
    name: "default install keeps destination-only skills and agents",
    run: () => {
      const configDir = path.join(newTempDir("default-keep-stale"), "config");
      const staleSkillDir = path.join(configDir, "skills", "stale-skill");
      const staleAgentFile = path.join(configDir, "agents", "stale-agent.md");
      writeText(path.join(staleSkillDir, "SKILL.md"), "# Stale Skill");
      writeText(staleAgentFile, "# Stale Agent");

      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md"]);
      assertSuccess(result, "Default install should keep destination-only global skills and agents.");
      assertOutputContains(result, "skipped: stale skill pruning", "Default install should report skipped skill pruning.");
      assertOutputContains(result, "skipped: stale agent pruning", "Default install should report skipped agent pruning.");
      assert(fs.existsSync(staleSkillDir), "Default install must not prune destination-only skill.");
      assert(fs.existsSync(staleAgentFile), "Default install must not prune destination-only agent.");
    },
  },
  {
    name: "prune opt-in removes destination-only skills and agents",
    run: () => {
      const configDir = path.join(newTempDir("prune-opt-in"), "config");
      const staleSkillDir = path.join(configDir, "skills", "stale-skill");
      const staleAgentFile = path.join(configDir, "agents", "stale-agent.md");
      writeText(path.join(staleSkillDir, "SKILL.md"), "# Stale Skill");
      writeText(staleAgentFile, "# Stale Agent");

      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md", "--prune"]);
      assertSuccess(result, "Installer --prune should remove destination-only global skills and agents.");
      assertOutputContains(result, "pruned: stale skill stale-skill", "--prune should report stale skill pruning.");
      assertOutputContains(result, "pruned: stale agent stale-agent", "--prune should report stale agent pruning.");
      assert(!fs.existsSync(staleSkillDir), "--prune should remove destination-only skill.");
      assert(!fs.existsSync(staleAgentFile), "--prune should remove destination-only agent.");
    },
  },
  {
    name: "default install into empty config still installs artifacts",
    run: () => {
      const configDir = path.join(newTempDir("empty-install"), "config");
      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md"]);
      assertSuccess(result, "Clean install into empty config should succeed.");
      assert(fs.existsSync(path.join(configDir, "skills", "adaptive-delivery", "SKILL.md")), "Clean install must write core skill.");
      assert(fs.existsSync(path.join(configDir, "skills", "complain", "SKILL.md")), "Default install must write the current repository skill set.");
      assert(fs.existsSync(path.join(configDir, "agents", "code-quality-reviewer.md")), "Clean install must write core agent.");
    },
  },
  {
    name: "audit reports drift without writes backups or removals",
    run: () => {
      const cleanConfig = installCleanConfig("audit-clean");
      const cleanAudit = invokeInstaller(["--config-dir", cleanConfig, "--skip-agents-md", "--audit"]);
      assertSuccess(cleanAudit, "Audit should exit zero when no drift exists.");

      const configDir = installCleanConfig("audit-drift");
      const drifted = driftSkill(configDir);
      const before = fs.readFileSync(drifted, "utf8");
      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md", "--audit"]);
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
      const beforeIds = new Set(listInstallPullbackChanges());
      const configDir = installCleanConfig("pullback");
      const drifted = driftSkill(configDir);
      const before = fs.readFileSync(drifted, "utf8");
      try {
        const first = invokeInstaller(["--config-dir", configDir, "--skip-agents-md", "--pull-back"]);
        assertSuccess(first, "Pull-back should succeed on drift.");
        assertOutputContains(first, "install-pullback", "Pull-back should report generated investigation change.");
        assert(fs.readFileSync(drifted, "utf8") === before, "Pull-back must not overwrite drifted destination.");
        const newIds = newPullbackChangesSince(beforeIds);
        assert(newIds.length === 1, "Pull-back should create exactly one change for one drifted artifact.");
        const changeId = newIds[0];
        const changeRoot = path.join(root, "openspec", "changes", changeId);
        const proposal = fs.readFileSync(path.join(changeRoot, "proposal.md"), "utf8");
        const tasks = fs.readFileSync(path.join(changeRoot, "tasks.md"), "utf8");
        const spec = fs.readFileSync(path.join(changeRoot, "specs", changeId, "spec.md"), "utf8");
        assert(proposal.includes("## Destination Content") && proposal.includes("## Source Content") && proposal.includes("unknown"), "Pull-back proposal must preserve content and unknown root cause.");
        assert(tasks.includes("## Archive Readiness"), "Pull-back tasks must include archive readiness section.");
        const removedArchiveCommandPrefix = ["openspec", "retro"].join(":");
        assert(!tasks.includes(removedArchiveCommandPrefix), "Pull-back tasks must not reference removed archive-learning commands.");
        assert(spec.includes("## ADDED Requirements"), "Pull-back spec delta must be generated.");

        const second = invokeInstaller(["--config-dir", configDir, "--skip-agents-md", "--pull-back"]);
        assertSuccess(second, "Second pull-back should succeed.");
        assertOutputContains(second, "existing", "Second pull-back should report existing change.");
        assert(countInstallPullbackChanges() === beforeIds.size + 1, "Second pull-back must not create a duplicate change.");
      } finally {
        const changesRoot = path.join(root, "openspec", "changes");
        for (const changeId of listInstallPullbackChanges()) {
          if (!beforeIds.has(changeId)) {
            fs.rmSync(path.join(changesRoot, changeId), { recursive: true, force: true });
          }
        }
      }
      assert(countInstallPullbackChanges() === beforeIds.size, "Pull-back test must clean generated investigation change.");
    },
  },
  {
    name: "pull-back dry-run reports changes without writing investigation files",
    run: () => {
      const beforeIds = new Set(listInstallPullbackChanges());
      const configDir = installCleanConfig("pullback-dry-run");
      const drifted = driftSkill(configDir);
      const before = fs.readFileSync(drifted, "utf8");
      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md", "--pull-back", "--dry-run"]);
      assertSuccess(result, "Pull-back dry-run should succeed on drift.");
      assertOutputContains(result, "would create", "Pull-back dry-run should preview investigation changes.");
      assertOutputContains(result, "Pull-back dry run complete. No files were changed.", "Pull-back dry-run should state no-write outcome.");
      assert(fs.readFileSync(drifted, "utf8") === before, "Pull-back dry-run must not overwrite drifted destination.");
      assert(countInstallPullbackChanges() === beforeIds.size, "Pull-back dry-run must not create investigation changes.");
    },
  },
  {
    name: "force-overwrite restores legacy backup and overwrite path",
    run: () => {
      const configDir = installCleanConfig("force-overwrite");
      const drifted = driftSkill(configDir);
      const result = invokeInstaller(["--config-dir", configDir, "--skip-agents-md", "--force-overwrite"]);
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
      assert(installerText.includes("forceOverwrite: false"), "Installer must default forceOverwrite to false.");
      assert(installerText.includes("if (!options.forceOverwrite && drift.length > 0)"), "Default drift path must remain guarded by forceOverwrite.");
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
