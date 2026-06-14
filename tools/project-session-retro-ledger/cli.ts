import fs from "node:fs";
import path from "node:path";
import type { ProjectSessionRetroLedger, ProjectSessionRetroProposalResult, ProjectSessionRetroValidationResult } from "./types.ts";
import { patchProjectSessionRetroSessions, summarizeProjectSessionRetroLedger } from "./ledger-ops.ts";
import { createProjectSessionRetroProposals } from "./openspec-proposals.ts";
import { refreshAnalysisProgress } from "./progress.ts";
import { initProjectSessionRetroLedger } from "./sqlite-source.ts";
import { readProjectSessionRetroLedgerStorage, writeProjectSessionRetroLedgerStorage } from "./storage.ts";
import { readSessionTranscripts } from "./transcript.ts";
import { readJsonFile, resolveInputPath, writeJsonFile } from "./utils.ts";
import { validateProjectSessionRetroLedger } from "./validator.ts";

type CliOptions = {
  command: "init" | "validate" | "proposals" | "refresh" | "status" | "transcript" | "patch-sessions" | "split" | "assemble" | "help";
  dataDirs: string[];
  dbPaths: string[];
  dryRun: boolean;
  format: "json" | "text";
  includeContent: boolean;
  input: string | null;
  limit: number;
  out: string | null;
  overwrite: boolean;
  patch: string | null;
  projectRoot: string | null;
  requireComplete: boolean;
  requireProposals: boolean;
  root: string;
  sessions: string[];
  showPaths: boolean;
  useDefaultPaths: boolean;
};

function printUsage(): void {
  console.log(`Usage:
  npm run retro:project-ledger -- init --project-root <path> [--out <path>] [options]
  npm run retro:project-ledger -- validate --input <path> [--root <repo>] [--require-complete] [--require-proposals] [--format json|text]
  npm run retro:project-ledger -- proposals --input <path> [--root <repo>] [--dry-run] [--format json|text]
  npm run retro:project-ledger -- refresh --input <path>
  npm run retro:project-ledger -- status --input <path> [--limit <n>] [--format json|text]
  npm run retro:project-ledger -- transcript --session <session-ref-or-raw-id> [--input <path>] [--db <path>] [--include-content] [--out <path>] [--format json|text]
  npm run retro:project-ledger -- patch-sessions --input <path> --patch <path> [--dry-run] [--format json|text]
  npm run retro:project-ledger -- split --input <retro.json> --out <retro-dir> [--overwrite]
  npm run retro:project-ledger -- assemble --input <retro-dir> [--out <retro.json>] [--overwrite]

Options:
  --db <path>              Read an explicit OpenCode SQLite database. Repeatable.
  --data-dir <path>        Add an OpenCode data directory containing opencode.db. Repeatable.
  --only-explicit          Use only --db and --data-dir paths.
  --project-root <path>    Current project root for session filtering.
  --input <path>           Read an existing retro ledger JSON file or sharded directory.
  --out <path>             Write output. Init default: <project-root>/retro. Paths ending in .json write one file; other paths write sharded directories.
  --patch <path>           Read a per-session audit patch JSON for patch-sessions.
  --session <id|ref>       Session raw id or redacted session ref. Repeatable.
  --include-content        Transcript mode includes raw prompt/text/tool content; use only for local analysis.
  --limit <n>              Limit status next-session refs. Default: 10.
  --overwrite              Allow init, split, or assemble to replace an existing output target.
  --root <path>            Repository root for proposal file validation/generation. Default: current working directory.
  --require-complete       Validate every retro stage is complete before push/final handoff.
  --require-proposals      Validate generated proposal refs and files as a final handoff gate.
  --dry-run                Preview proposal generation without writing files or updating input.
  --show-paths             Include home-redacted paths in generated ledger.
  --format <json|text>     Output format for validate/proposals. Default: text.
  --help                   Show this help.
`);
}

function readOptionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.trim() === "" || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function parseFormat(value: string): "json" | "text" {
  if (value === "json" || value === "text") {
    return value;
  }
  throw new Error("--format must be json or text.");
}

function parseLimit(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("--limit must be a non-negative integer.");
  }
  return Number.parseInt(value, 10);
}

function parseArgs(args: string[]): CliOptions {
  const command = args[0] as CliOptions["command"] | undefined;
  const options: CliOptions = {
    command: command ?? "help",
    dataDirs: [],
    dbPaths: [],
    dryRun: false,
    format: "text",
    includeContent: false,
    input: null,
    limit: 10,
    out: null,
    overwrite: false,
    patch: null,
    projectRoot: null,
    requireComplete: false,
    requireProposals: false,
    root: process.cwd(),
    sessions: [],
    showPaths: false,
    useDefaultPaths: true,
  };
  if (command == null || command === "help" || command === "--help" || command === "-h") {
    options.command = "help";
    return options;
  }
  if (!["init", "validate", "proposals", "refresh", "status", "transcript", "patch-sessions", "split", "assemble"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--db") {
      options.dbPaths.push(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--db=")) {
      options.dbPaths.push(arg.slice("--db=".length));
    } else if (arg === "--data-dir") {
      options.dataDirs.push(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--data-dir=")) {
      options.dataDirs.push(arg.slice("--data-dir=".length));
    } else if (arg === "--only-explicit") {
      options.useDefaultPaths = false;
    } else if (arg === "--project-root") {
      options.projectRoot = resolveInputPath(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--project-root=")) {
      options.projectRoot = resolveInputPath(arg.slice("--project-root=".length));
    } else if (arg === "--input") {
      options.input = resolveInputPath(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--input=")) {
      options.input = resolveInputPath(arg.slice("--input=".length));
    } else if (arg === "--patch") {
      options.patch = resolveInputPath(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--patch=")) {
      options.patch = resolveInputPath(arg.slice("--patch=".length));
    } else if (arg === "--session") {
      options.sessions.push(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--session=")) {
      options.sessions.push(arg.slice("--session=".length));
    } else if (arg === "--include-content") {
      options.includeContent = true;
    } else if (arg === "--limit") {
      options.limit = parseLimit(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--limit=")) {
      options.limit = parseLimit(arg.slice("--limit=".length));
    } else if (arg === "--out") {
      options.out = resolveInputPath(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--out=")) {
      options.out = resolveInputPath(arg.slice("--out=".length));
    } else if (arg === "--root") {
      options.root = resolveInputPath(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--root=")) {
      options.root = resolveInputPath(arg.slice("--root=".length));
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--require-complete") {
      options.requireComplete = true;
    } else if (arg === "--require-proposals") {
      options.requireProposals = true;
    } else if (arg === "--show-paths") {
      options.showPaths = true;
    } else if (arg === "--format") {
      options.format = parseFormat(readOptionValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--format=")) {
      options.format = parseFormat(arg.slice("--format=".length));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function renderValidation(result: ProjectSessionRetroValidationResult): string {
  const lines = [`valid: ${String(result.valid)}`];
  if (result.errors.length > 0) {
    lines.push("errors:");
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderProposalResult(result: ProjectSessionRetroProposalResult): string {
  const lines = [`changes: ${result.changes.length}`];
  for (const change of result.changes) {
    lines.push(`${change.status}: ${change.id} (${change.planId})`);
  }
  if (result.ledger.validation.errors.length > 0) {
    lines.push("validation errors:");
    for (const error of result.ledger.validation.errors) {
      lines.push(`- ${error}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderStatus(ledger: ProjectSessionRetroLedger, limit: number): string {
  const status = summarizeProjectSessionRetroLedger(ledger, { limit });
  const lines = [
    `sessions: ${status.totals.sessions}`,
    `coverage: complete=${status.coverage.complete} partial=${status.coverage.partial} blocked=${status.coverage.blocked}`,
    `progress: completed=${status.progress.completedSessionCount} remaining=${status.progress.remainingSessionCount}`,
    `next: ${status.nextSessionRefs.join(", ") || "none"}`,
    `entities: observations=${status.totals.observations} trends=${status.totals.trends} rootCauses=${status.totals.rootCauses} plans=${status.totals.plans} proposals=${status.totals.openspecProposals}`,
  ];
  return `${lines.join("\n")}\n`;
}

function renderTranscript(result: ReturnType<typeof readSessionTranscripts>): string {
  const lines = [`sessions: ${result.sessions.length}`];
  for (const session of result.sessions) {
    lines.push(`${session.sessionRef}: events=${session.events.length} inputs=${session.counts.inputs} messages=${session.counts.messages} parts=${session.counts.parts} todos=${session.counts.todos}`);
  }
  if (result.missingSessions.length > 0) {
    lines.push(`missing: ${result.missingSessions.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderPatchResult(result: ReturnType<typeof patchProjectSessionRetroSessions>, validation: ProjectSessionRetroValidationResult): string {
  const lines = [
    `changedSessions: ${result.changedSessions.length}`,
    `progress: completed=${result.progress.completedSessionCount} remaining=${result.progress.remainingSessionCount}`,
  ];
  if (validation.errors.length > 0) {
    lines.push("validation errors:");
    for (const error of validation.errors) {
      lines.push(`- ${error}`);
    }
  }
  if (validation.warnings.length > 0) {
    lines.push("validation warnings:");
    for (const warning of validation.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function writeTextFile(filePath: string, content: string, options: { overwrite?: boolean } = {}): void {
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`Output parent directory does not exist: ${parent}`);
  }
  if (fs.existsSync(filePath) && options.overwrite !== true) {
    throw new Error(`Output file already exists; pass --overwrite to replace it: ${filePath}`);
  }
  fs.writeFileSync(filePath, content, "utf8");
}

export function runCli(args = process.argv.slice(2)): void {
  const options = parseArgs(args);
  if (options.command === "help") {
    printUsage();
    return;
  }
  if (options.command === "init") {
    if (!options.projectRoot) {
      throw new Error("init requires --project-root.");
    }
    const outPath = options.out ?? path.join(options.projectRoot, "retro");
    const ledger = initProjectSessionRetroLedger({
      dataDirs: options.dataDirs,
      dbPaths: options.dbPaths,
      projectRoot: options.projectRoot,
      showPaths: options.showPaths,
      useDefaultPaths: options.useDefaultPaths,
    });
    writeProjectSessionRetroLedgerStorage(outPath, ledger, { overwrite: options.overwrite });
    console.log(`wrote ${outPath}`);
    return;
  }
  if (options.command === "split") {
    if (!options.input) {
      throw new Error("split requires --input.");
    }
    if (!options.out) {
      throw new Error("split requires --out.");
    }
    writeProjectSessionRetroLedgerStorage(options.out, readProjectSessionRetroLedgerStorage(options.input), { format: "directory", overwrite: options.overwrite });
    console.log(`wrote ${options.out}`);
    return;
  }
  if (options.command === "assemble") {
    if (!options.input) {
      throw new Error("assemble requires --input.");
    }
    const ledger = readProjectSessionRetroLedgerStorage(options.input);
    if (options.out) {
      writeJsonFile(options.out, ledger, { overwrite: options.overwrite });
      console.log(`wrote ${options.out}`);
    } else {
      process.stdout.write(`${JSON.stringify(ledger, null, 2)}\n`);
    }
    return;
  }
  if (options.command === "validate") {
    if (!options.input) {
      throw new Error("validate requires --input.");
    }
    const result = validateProjectSessionRetroLedger(readProjectSessionRetroLedgerStorage(options.input), { requireComplete: options.requireComplete, requireProposals: options.requireProposals, root: options.root });
    process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderValidation(result));
    if (!result.valid) {
      process.exitCode = 1;
    }
    return;
  }
  if (options.command === "proposals") {
    if (!options.input) {
      throw new Error("proposals requires --input.");
    }
    const ledger = readProjectSessionRetroLedgerStorage(options.input);
    const result = createProjectSessionRetroProposals(options.root, ledger, { dryRun: options.dryRun });
    if (!options.dryRun && result.ledger.validation.errors.length === 0) {
      writeProjectSessionRetroLedgerStorage(options.input, result.ledger, { overwrite: true });
    }
    process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderProposalResult(result));
    if (result.ledger.validation.errors.length > 0) {
      process.exitCode = 1;
    }
    return;
  }
  if (options.command === "refresh") {
    if (!options.input) {
      throw new Error("refresh requires --input.");
    }
    const ledger = refreshAnalysisProgress(readProjectSessionRetroLedgerStorage(options.input));
    writeProjectSessionRetroLedgerStorage(options.input, ledger, { overwrite: true });
    process.stdout.write(options.format === "json" ? `${JSON.stringify(ledger.analysisProgress, null, 2)}\n` : `refreshed ${options.input}\n`);
    return;
  }
  if (options.command === "status") {
    if (!options.input) {
      throw new Error("status requires --input.");
    }
    const ledger = readProjectSessionRetroLedgerStorage(options.input);
    const status = summarizeProjectSessionRetroLedger(ledger, { limit: options.limit });
    process.stdout.write(options.format === "json" ? `${JSON.stringify(status, null, 2)}\n` : renderStatus(ledger, options.limit));
    return;
  }
  if (options.command === "transcript") {
    if (options.sessions.length === 0) {
      throw new Error("transcript requires at least one --session.");
    }
    const inputLedger = options.input ? readProjectSessionRetroLedgerStorage(options.input) : null;
    const result = readSessionTranscripts({
      dataDirs: options.dataDirs,
      dbPaths: options.dbPaths,
      includeContent: options.includeContent,
      inputLedger,
      sessionIds: options.sessions,
      useDefaultPaths: options.useDefaultPaths,
    });
    const output = options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderTranscript(result);
    if (options.out) {
      if (options.format === "json") {
        writeJsonFile(options.out, result, { overwrite: options.overwrite });
      } else {
        writeTextFile(options.out, output, { overwrite: options.overwrite });
      }
      process.stdout.write(`wrote ${options.out}\n`);
    } else {
      process.stdout.write(output);
    }
    if (result.missingSessions.length > 0) {
      process.exitCode = 1;
    }
    return;
  }
  if (options.command === "patch-sessions") {
    if (!options.input) {
      throw new Error("patch-sessions requires --input.");
    }
    if (!options.patch) {
      throw new Error("patch-sessions requires --patch.");
    }
    const result = patchProjectSessionRetroSessions(readProjectSessionRetroLedgerStorage(options.input), readJsonFile(options.patch));
    const validation = validateProjectSessionRetroLedger(result.ledger, { root: options.root });
    result.ledger.validation = { errors: validation.errors, warnings: validation.warnings };
    const payload = { changedSessions: result.changedSessions, progress: result.progress, validation };
    if (validation.errors.length === 0 && !options.dryRun) {
      writeProjectSessionRetroLedgerStorage(options.input, result.ledger, { overwrite: true });
    }
    process.stdout.write(options.format === "json" ? `${JSON.stringify(payload, null, 2)}\n` : renderPatchResult(result, validation));
    if (validation.errors.length > 0) {
      process.exitCode = 1;
    }
  }
}

export function runCliEntrypoint(): void {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
}
