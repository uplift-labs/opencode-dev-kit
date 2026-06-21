#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type ValidationCommand = {
  label: string;
  command: string;
  args: string[];
  skipReason?: string;
};

export type ValidationCommandResult = {
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error | null;
};

export type ValidationCommandRunner = (root: string, command: ValidationCommand) => ValidationCommandResult;

export type ValidationOutput = {
  log: (message: string) => void;
  error: (message: string) => void;
};

export type RunPrePushValidationOptions = {
  runner?: ValidationCommandRunner;
  output?: ValidationOutput;
};

function quoteWindowsCommandArg(value: string): string {
  if (/^[A-Za-z0-9._/:\\=-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\"", "\\\"")}"`;
}

function spawnValidationCommand(root: string, command: ValidationCommand): ReturnType<typeof spawnSync> {
  if (command.command === "node") {
    return spawnSync(process.execPath, command.args, { cwd: root, encoding: "utf8", stdio: "inherit", shell: false });
  }
  if (process.platform === "win32") {
    const executable = process.env.ComSpec ?? "cmd.exe";
    const commandLine = [command.command, ...command.args].map(quoteWindowsCommandArg).join(" ");
    return spawnSync(executable, ["/d", "/s", "/c", commandLine], { cwd: root, encoding: "utf8", stdio: "inherit", shell: false });
  }
  return spawnSync(command.command, command.args, { cwd: root, encoding: "utf8", stdio: "inherit", shell: false });
}

export function buildPrePushValidationPlan(root: string): ValidationCommand[] {
  const plan: ValidationCommand[] = [
    { label: "Repository validation", command: "npm", args: ["run", "validate"] },
  ];

  if (fs.existsSync(path.join(root, "openspec"))) {
    plan.push({ label: "OpenSpec operation prepush gate", command: "npm", args: ["run", "openspec:gate", "--", "--operation", "prepush"] });
    plan.push({ label: "Repository tests", command: "npm", args: ["test"] });
    plan.push({ label: "OpenSpec validation", command: "npm", args: ["run", "openspec:validate"] });
  } else {
    plan.push({ label: "Repository tests", command: "npm", args: ["test"] });
  }

  return plan;
}

export function exitCodeFromSpawnResult(result: { status: number | null; signal?: NodeJS.Signals | null }): number {
  if (result.status == null) {
    return 1;
  }
  return result.status;
}

function defaultCommandRunner(root: string, command: ValidationCommand): ValidationCommandResult {
  const result = spawnValidationCommand(root, command);
  return { status: result.status, signal: result.signal, error: result.error ?? null };
}

function runCommand(root: string, command: ValidationCommand, runner: ValidationCommandRunner, output: ValidationOutput): number {
  if (command.skipReason) {
    output.log(`==> ${command.label}: not-applicable - ${command.skipReason}`);
    return 0;
  }
  output.log(`==> ${command.label}: ${command.command} ${command.args.join(" ")}`);
  const result = runner(root, command);
  if (result.error) {
    output.error(`Failed to start ${command.label}: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    output.error(`${command.label} terminated by signal ${result.signal}.`);
  }
  return exitCodeFromSpawnResult(result);
}

function defaultRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function runPrePushValidation(root: string, options: RunPrePushValidationOptions = {}): number {
  const runner = options.runner ?? defaultCommandRunner;
  const output = options.output ?? { log: console.log, error: console.error };
  for (const command of buildPrePushValidationPlan(root)) {
    const exitCode = runCommand(root, command, runner, output);
    if (exitCode !== 0) {
      output.error(`Pre-push validation failed at ${command.label}.`);
      return exitCode;
    }
  }
  output.log("Pre-push validation passed.");
  return 0;
}

function runCli(): number {
  return runPrePushValidation(defaultRoot());
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href);
}

if (isMainModule()) {
  process.exitCode = runCli();
}
