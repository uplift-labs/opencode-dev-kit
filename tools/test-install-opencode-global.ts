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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "tools", "install-opencode-global.ts");
const globalPath = path.resolve(root, "global");
const ENV_VAR = "OPENCODE_CONFIG_DIR";

function invokeInstaller(args: string[], envOverride?: Record<string, string | undefined>): ProcessResult {
  const env = { ...process.env, ...(envOverride ?? {}) };
  if (envOverride && envOverride[ENV_VAR] === undefined) {
    delete env[ENV_VAR];
  }
  const result = spawnSync(process.execPath, [installer, ...args], { cwd: root, encoding: "utf8", env });
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

const tests: { name: string; run: () => void }[] = [
  {
    name: "help documents the config-dir pointing model",
    run: () => {
      const result = invokeInstaller(["--help"]);
      assertSuccess(result, "Help should exit successfully.");
      assertOutputContains(result, ENV_VAR, "Help should name OPENCODE_CONFIG_DIR.");
      assertOutputContains(result, "global/", "Help should reference the global/ target directory.");
      assertOutputContains(result, "setx", "Help should document the Windows setx mechanism.");
    },
  },
  {
    name: "print outputs the repo global path and platform commands",
    run: () => {
      const result = invokeInstaller(["--print"]);
      assertSuccess(result, "--print should exit successfully.");
      assertOutputContains(result, globalPath, "--print should output the resolved global/ path.");
      assertOutputContains(result, `setx ${ENV_VAR}`, "--print should show the Windows command.");
      assertOutputContains(result, `export ${ENV_VAR}`, "--print should show the posix command.");
    },
  },
  {
    name: "dry-run does not change the environment and previews the set",
    run: () => {
      const result = invokeInstaller(["--dry-run"], { [ENV_VAR]: undefined });
      assertSuccess(result, "Dry-run should exit successfully.");
      assertOutputContains(result, `would set: ${ENV_VAR}=${globalPath}`, "Dry-run should preview the value.");
      assertOutputContains(result, "No environment variable was changed.", "Dry-run must state no-write outcome.");
    },
  },
  {
    name: "check passes when env var points at repo global",
    run: () => {
      const result = invokeInstaller(["--check"], { [ENV_VAR]: globalPath });
      assertSuccess(result, "--check should pass when OPENCODE_CONFIG_DIR matches repo global/.");
      assertOutputContains(result, "configured:", "--check should report configured status.");
    },
  },
  {
    name: "check fails when env var is unset",
    run: () => {
      const result = invokeInstaller(["--check"], { [ENV_VAR]: undefined });
      assertFailure(result, "--check should fail when OPENCODE_CONFIG_DIR is unset.");
      assertOutputContains(result, "not set", "--check should report the unset state.");
    },
  },
  {
    name: "check fails on mismatched env var value",
    run: () => {
      const result = invokeInstaller(["--check"], { [ENV_VAR]: path.join(root, "some-other-dir") });
      assertFailure(result, "--check should fail when OPENCODE_CONFIG_DIR points elsewhere.");
      assertOutputContains(result, "mismatch:", "--check should report the mismatch.");
      assertOutputContains(result, globalPath, "--check should show the expected repo global/ path.");
    },
  },
  {
    name: "installer source keeps config-dir pointing model guards",
    run: () => {
      const installerText = fs.readFileSync(installer, "utf8") as string;
      assert(installerText.includes(ENV_VAR), "Installer must reference OPENCODE_CONFIG_DIR.");
      assert(installerText.includes('"global"'), "Installer must target the global/ directory.");
      assert(installerText.includes("setx"), "Installer must use setx on Windows.");
      assert(!installerText.includes("collectDrift"), "Installer must not retain legacy copy/drift logic.");
    },
  },
  {
    name: "installer source marks provisioned config with machineOverride",
    run: () => {
      const installerText = fs.readFileSync(installer, "utf8") as string;
      assert(installerText.includes("machineOverride"), "Installer must mark the provisioned local config with the machineOverride field.");
      assert(/machineOverride:\s*true/.test(installerText), "Installer must write machineOverride: true into the provisioned local config.");
      const provisionMatch = installerText.match(/ensureLocalConfig[\s\S]{0,1500}/);
      assert(provisionMatch != null, "Installer must define ensureLocalConfig.");
      assert(provisionMatch[0].includes("machineOverride"), "ensureLocalConfig must set the machineOverride marker on the provisioned local config.");
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
