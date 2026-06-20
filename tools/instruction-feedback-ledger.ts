#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type InstructionCostBand = "cheap" | "medium" | "expensive";
export type InstructionRoute = "instant" | "openspec" | "backlog" | "invalid";
export type InstructionStatus = "open" | "applied" | "replayed" | "resolved" | "invalidated" | "duplicate-of";
export type ReplayResult = "resolved" | "still-failing" | "not-applicable" | "pending";
export type LedgerOwner = "this-repo" | "other-repo";

export type InstructionFeedbackEntry = {
  id: string;
  sourceRef: string;
  sourceArtifact: string;
  findingSummary: string;
  rootCause: string;
  targetArtifact: string;
  costBand: InstructionCostBand;
  draftRule: string;
  replayEvidenceRef: string;
  route: InstructionRoute;
  routeReason: string;
  status: InstructionStatus;
  duplicateOf: string | null;
  appliedRef: string | null;
  replayedAfter: string | null;
  replayResult: ReplayResult;
  owner: LedgerOwner;
  createdAt: string;
  updatedAt: string;
};

export type InstructionFeedbackLedger = {
  schemaVersion: 1;
  entries: InstructionFeedbackEntry[];
};

export type AddLedgerEntryResult = {
  entry: InstructionFeedbackEntry;
  duplicate: boolean;
};

export type DecayReport = {
  windowDays: number;
  now: string;
  staleEntries: InstructionFeedbackEntry[];
};

export type RouteWriteResult = {
  status: "allowed" | "blocked";
  reason: string;
};

type CliOptions = {
  root: string;
  ledgerPath: string;
  command: "add" | "pending" | "decay-report" | "check-bloat" | "replay-pending" | "advance" | null;
  addFile?: string;
  addJson?: string;
  changeId?: string;
  windowDays: number;
  entryId?: string;
  status?: InstructionStatus;
  replayResult?: ReplayResult;
  appliedRef?: string;
  now?: string;
};

const costBands = new Set(["cheap", "medium", "expensive"]);
const routes = new Set(["instant", "openspec", "backlog", "invalid"]);
const statuses = new Set(["open", "applied", "replayed", "resolved", "invalidated", "duplicate-of"]);
const replayResults = new Set(["resolved", "still-failing", "not-applicable", "pending"]);
const owners = new Set(["this-repo", "other-repo"]);

function defaultLedgerPath(root: string): string {
  return path.join(root, "openspec", "instruction-feedback-ledger.json");
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isMeaningful(value: string | null | undefined): boolean {
  return value != null && value.trim() !== "";
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Ledger entry requires non-empty string field '${key}'.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Ledger entry field '${key}' must be a string when present.`);
  }
  return value.trim() === "" ? null : value;
}

function enumValue<T extends string>(input: Record<string, unknown>, key: string, allowed: Set<string>, fallback?: T): T {
  const value = input[key];
  if (value == null && fallback != null) {
    return fallback;
  }
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`Ledger entry field '${key}' must be one of ${Array.from(allowed).join(", ")}.`);
  }
  return value as T;
}

function stableId(input: Pick<InstructionFeedbackEntry, "sourceRef" | "sourceArtifact" | "findingSummary" | "targetArtifact" | "createdAt">, existingIds: Set<string>): string {
  const digest = crypto
    .createHash("sha256")
    .update([input.sourceRef, input.sourceArtifact, normalizeText(input.findingSummary), input.targetArtifact, input.createdAt].join("\0"))
    .digest("hex")
    .slice(0, 16);
  let candidate = `feedback-${digest}`;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `feedback-${digest}-${String(suffix).padStart(2, "0")}`;
    suffix++;
  }
  return candidate;
}

function sortEntries(ledger: InstructionFeedbackLedger): void {
  ledger.entries.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseEntry(value: unknown): InstructionFeedbackEntry {
  const input = asRecord(value, "Ledger entry");
  return {
    id: requireString(input, "id"),
    sourceRef: requireString(input, "sourceRef"),
    sourceArtifact: requireString(input, "sourceArtifact"),
    findingSummary: requireString(input, "findingSummary"),
    rootCause: requireString(input, "rootCause"),
    targetArtifact: requireString(input, "targetArtifact"),
    costBand: enumValue<InstructionCostBand>(input, "costBand", costBands),
    draftRule: requireString(input, "draftRule"),
    replayEvidenceRef: typeof input.replayEvidenceRef === "string" ? input.replayEvidenceRef : "",
    route: enumValue<InstructionRoute>(input, "route", routes),
    routeReason: requireString(input, "routeReason"),
    status: enumValue<InstructionStatus>(input, "status", statuses),
    duplicateOf: optionalString(input, "duplicateOf"),
    appliedRef: optionalString(input, "appliedRef"),
    replayedAfter: optionalString(input, "replayedAfter"),
    replayResult: enumValue<ReplayResult>(input, "replayResult", replayResults, "pending"),
    owner: enumValue<LedgerOwner>(input, "owner", owners),
    createdAt: requireString(input, "createdAt"),
    updatedAt: requireString(input, "updatedAt"),
  };
}

function entryFromInput(input: Record<string, unknown>, now: string, existingIds: Set<string>): InstructionFeedbackEntry {
  const base = {
    sourceRef: requireString(input, "sourceRef"),
    sourceArtifact: requireString(input, "sourceArtifact"),
    findingSummary: requireString(input, "findingSummary"),
    rootCause: requireString(input, "rootCause"),
    targetArtifact: requireString(input, "targetArtifact"),
    costBand: enumValue<InstructionCostBand>(input, "costBand", costBands),
    draftRule: requireString(input, "draftRule"),
    replayEvidenceRef: typeof input.replayEvidenceRef === "string" ? input.replayEvidenceRef : "",
    route: enumValue<InstructionRoute>(input, "route", routes),
    routeReason: requireString(input, "routeReason"),
    owner: enumValue<LedgerOwner>(input, "owner", owners),
    createdAt: typeof input.createdAt === "string" && input.createdAt.trim() !== "" ? input.createdAt : now,
  };
  return {
    id: stableId(base, existingIds),
    ...base,
    status: "open",
    duplicateOf: null,
    appliedRef: null,
    replayedAfter: null,
    replayResult: "pending",
    updatedAt: now,
  };
}

export function loadLedger(ledgerPath: string): InstructionFeedbackLedger {
  if (!fs.existsSync(ledgerPath)) {
    return { schemaVersion: 1, entries: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`unreadable ledger: ${message}`);
  }
  const record = asRecord(parsed, "Ledger");
  if (record.schemaVersion !== 1) {
    throw new Error("unsupported ledger schemaVersion");
  }
  if (!Array.isArray(record.entries)) {
    throw new Error("Ledger entries must be an array.");
  }
  const ledger: InstructionFeedbackLedger = { schemaVersion: 1, entries: record.entries.map(parseEntry) };
  sortEntries(ledger);
  return ledger;
}

export function writeLedger(ledgerPath: string, ledger: InstructionFeedbackLedger): void {
  sortEntries(ledger);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

export function addLedgerEntry(ledger: InstructionFeedbackLedger, input: Record<string, unknown>, now = new Date().toISOString()): AddLedgerEntryResult {
  const existingIds = new Set(ledger.entries.map((entry) => entry.id));
  const entry = entryFromInput(input, now, existingIds);
  const duplicate = ledger.entries.find((candidate) =>
    candidate.status !== "duplicate-of" &&
    normalizeText(candidate.findingSummary) === normalizeText(entry.findingSummary) &&
    candidate.targetArtifact === entry.targetArtifact
  );
  if (duplicate != null) {
    entry.status = "duplicate-of";
    entry.duplicateOf = duplicate.id;
  }
  ledger.entries.push(entry);
  sortEntries(ledger);
  return { entry, duplicate: duplicate != null };
}

export function advanceLedgerEntry(ledger: InstructionFeedbackLedger, id: string, patch: { status: InstructionStatus; appliedRef?: string; replayResult?: ReplayResult }, now = new Date().toISOString()): InstructionFeedbackEntry {
  const entry = ledger.entries.find((candidate) => candidate.id === id);
  if (entry == null) {
    throw new Error(`unknown ledger entry '${id}'.`);
  }
  if (patch.status === "applied") {
    if (entry.status !== "open") {
      throw new Error(`Entry '${id}' must be open before applied.`);
    }
    if (!isMeaningful(patch.appliedRef)) {
      throw new Error("applied transition requires appliedRef.");
    }
    entry.appliedRef = patch.appliedRef ?? null;
  } else if (patch.status === "replayed") {
    if (entry.status !== "applied") {
      throw new Error(`Entry '${id}' must be applied before replayed.`);
    }
    if (!isMeaningful(entry.replayEvidenceRef)) {
      throw new Error("replayed transition requires replayEvidenceRef.");
    }
    if (patch.replayResult == null || !replayResults.has(patch.replayResult) || patch.replayResult === "pending") {
      throw new Error("replayed transition requires a non-pending replayResult.");
    }
    entry.replayedAfter = now;
    entry.replayResult = patch.replayResult;
  } else if (patch.status === "resolved") {
    if (entry.status !== "replayed" || entry.replayResult !== "resolved") {
      throw new Error(`Entry '${id}' can resolve only after replayResult resolved.`);
    }
  } else if (patch.status === "open") {
    if (entry.status !== "replayed" || entry.replayResult !== "still-failing") {
      throw new Error(`Entry '${id}' can reopen only after still-failing replay.`);
    }
    entry.replayResult = "pending";
  } else if (patch.status === "invalidated") {
    if (entry.status === "duplicate-of" || entry.status === "resolved") {
      throw new Error(`Entry '${id}' cannot be invalidated from ${entry.status}.`);
    }
  } else if (patch.status === "duplicate-of") {
    throw new Error("duplicate-of status is assigned only during addLedgerEntry duplicate detection.");
  }
  entry.status = patch.status;
  entry.updatedAt = now;
  return entry;
}

export function createStillFailingEntry(ledger: InstructionFeedbackLedger, id: string, now = new Date().toISOString()): AddLedgerEntryResult {
  const original = ledger.entries.find((candidate) => candidate.id === id);
  if (original == null) {
    throw new Error(`unknown ledger entry '${id}'.`);
  }
  if (original.status !== "replayed" || original.replayResult !== "still-failing") {
    throw new Error(`Entry '${id}' must have still-failing replay before opening a rule-targeted entry.`);
  }
  original.status = "open";
  original.replayResult = "pending";
  original.updatedAt = now;
  return addLedgerEntry(ledger, {
    sourceRef: original.id,
    sourceArtifact: original.sourceArtifact,
    findingSummary: `Replay still failing after applied rule: ${original.findingSummary}`,
    rootCause: original.rootCause,
    targetArtifact: `applied-rule:${original.id}`,
    costBand: original.costBand,
    draftRule: `Revise applied prevention rule for ${original.id}.`,
    replayEvidenceRef: original.replayEvidenceRef,
    route: original.route,
    routeReason: "still-failing replay opened a new entry against the applied rule",
    owner: original.owner,
    createdAt: now,
  }, now);
}

export function decayReport(ledger: InstructionFeedbackLedger, options: { now?: string; windowDays?: number } = {}): DecayReport {
  const now = options.now ?? new Date().toISOString();
  const windowDays = options.windowDays ?? 30;
  const cutoff = new Date(new Date(now).getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const staleStatuses = new Set<InstructionStatus>(["open", "applied", "replayed"]);
  return {
    now,
    windowDays,
    staleEntries: ledger.entries.filter((entry) => staleStatuses.has(entry.status) && entry.updatedAt < cutoff),
  };
}

export function routeRuleWrite(entry: InstructionFeedbackEntry, targetOwner: LedgerOwner): RouteWriteResult {
  if (entry.owner === "other-repo" && targetOwner === "this-repo") {
    return { status: "blocked", reason: "cross-repo" };
  }
  return { status: "allowed", reason: "same-repo" };
}

export function unsupportedRequest(operation: string): { status: "unsupported"; operation: string; result: "unknown" } {
  return { status: "unsupported", operation, result: "unknown" };
}

export function pendingEntries(ledger: InstructionFeedbackLedger): InstructionFeedbackEntry[] {
  return ledger.entries.filter((entry) => ["open", "applied", "replayed"].includes(entry.status));
}

export function replayPendingEntries(ledger: InstructionFeedbackLedger): InstructionFeedbackEntry[] {
  return ledger.entries.filter((entry) => entry.status === "applied" || (entry.status === "replayed" && entry.replayResult === "still-failing"));
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return asRecord(parsed, `JSON file ${filePath}`);
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  return asRecord(JSON.parse(raw) as unknown, "--add-json payload");
}

function safeChangeId(changeId: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(changeId) && !changeId.includes("..") && !changeId.includes("/") && !changeId.includes("\\");
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function readText(filePath: string): string | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function bloatExemption(proposal: string): boolean {
  return /<!--\s*instruction-feedback-bloat-exemption:\s*[^>]+-->/.test(proposal);
}

function extractBloatTargets(proposal: string): string[] {
  const targets = new Set<string>();
  const patterns = [
    /`(AGENTS\.md|\.opencode\/skills\/[a-z0-9-]+\/SKILL\.md|instructions\/[A-Za-z0-9._-]+\.md)`/g,
    /(^|\s)(AGENTS\.md|\.opencode\/skills\/[a-z0-9-]+\/SKILL\.md|instructions\/[A-Za-z0-9._-]+\.md)(?=\s|$|[,.):])/gm,
  ];
  for (const pattern of patterns) {
    for (const match of proposal.matchAll(pattern)) {
      targets.add(match[2] ?? match[1]);
    }
  }
  return Array.from(targets).sort();
}

function gitHeadText(root: string, relativePath: string): string | null {
  const result = spawnSync("git", ["-C", root, "show", `HEAD:${relativePath}`], { encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return null;
  }
  return result.stdout.replace(/\r\n/g, "\n");
}

function normativeRuleCount(text: string): number {
  return text
    .split("\n")
    .filter((line) => /^\s*-\s+/.test(line) && /\b(must|must not|do not|never|require|requires|required|shall|forbid|forbidden|refuse|only|default)\b/i.test(line))
    .length + Array.from(text.matchAll(/^###\s+Requirement:/gm)).length;
}

export function checkBloat(root: string, changeId: string): { status: "passed" | "blocked" | "unknown"; changeId: string; reason: string; details: string[] } {
  if (!safeChangeId(changeId)) {
    return { status: "blocked", changeId, reason: "unsafe-change-id", details: [] };
  }
  const changeRoot = path.join(root, "openspec", "changes", changeId);
  if (!fs.existsSync(changeRoot) || !fs.statSync(changeRoot).isDirectory()) {
    return { status: "unknown", changeId, reason: "change-directory-unreadable", details: [] };
  }
  const proposal = readText(path.join(changeRoot, "proposal.md"));
  if (proposal == null) {
    return { status: "unknown", changeId, reason: "proposal-unreadable", details: [] };
  }
  if (bloatExemption(proposal)) {
    return { status: "passed", changeId, reason: "explicit-bloat-exemption", details: [] };
  }
  const targets = extractBloatTargets(proposal);
  if (targets.length === 0) {
    return { status: "passed", changeId, reason: "no-broad-instruction-targets", details: [] };
  }
  const details: string[] = [];
  for (const target of targets) {
    const relative = toPosix(target);
    const current = readText(path.join(root, ...relative.split("/")));
    if (current == null) {
      return { status: "unknown", changeId, reason: `target-unreadable:${relative}`, details };
    }
    const baseline = gitHeadText(root, relative);
    if (baseline == null) {
      return { status: "unknown", changeId, reason: `baseline-unreadable:${relative}`, details };
    }
    const before = normativeRuleCount(baseline);
    const after = normativeRuleCount(current);
    details.push(`${relative}: before=${before} after=${after}`);
    if (after > before) {
      return { status: "blocked", changeId, reason: `one-in-one-out required for ${relative}: before=${before} after=${after}`, details };
    }
  }
  return { status: "passed", changeId, reason: "one-in-one-out satisfied", details };
}

function parseArgs(args: string[]): CliOptions {
  let root = process.cwd();
  let ledgerPath: string | null = null;
  const options: Omit<CliOptions, "root" | "ledgerPath"> = { command: null, windowDays: 30 };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --root.");
      }
      root = path.resolve(value);
      index++;
    } else if (arg === "--ledger") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --ledger.");
      }
      ledgerPath = path.resolve(value);
      index++;
    } else if (arg === "--add") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing JSON file for --add.");
      }
      options.command = "add";
      options.addFile = path.resolve(value);
      index++;
    } else if (arg === "--add-json") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing JSON payload for --add-json.");
      }
      options.command = "add";
      options.addJson = value;
      index++;
    } else if (arg === "--pending") {
      options.command = "pending";
    } else if (arg === "--decay-report") {
      options.command = "decay-report";
    } else if (arg === "--check-bloat") {
      options.command = "check-bloat";
    } else if (arg === "--replay-pending") {
      options.command = "replay-pending";
    } else if (arg === "--advance") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing entry id for --advance.");
      }
      options.command = "advance";
      options.entryId = value;
      index++;
    } else if (arg === "--status") {
      const value = args[index + 1];
      if (!value || !statuses.has(value)) {
        throw new Error("Missing or invalid value for --status.");
      }
      options.status = value as InstructionStatus;
      index++;
    } else if (arg === "--replay-result") {
      const value = args[index + 1];
      if (!value || !replayResults.has(value)) {
        throw new Error("Missing or invalid value for --replay-result.");
      }
      options.replayResult = value as ReplayResult;
      index++;
    } else if (arg === "--applied-ref") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --applied-ref.");
      }
      options.appliedRef = value;
      index++;
    } else if (arg === "--change") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --change.");
      }
      options.changeId = value;
      index++;
    } else if (arg === "--window-days") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--window-days must be a positive integer.");
      }
      options.windowDays = value;
      index++;
    } else if (arg === "--now") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --now.");
      }
      options.now = value;
      index++;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { ...options, root, ledgerPath: ledgerPath ?? defaultLedgerPath(root) };
}

function runCli(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command == null) {
      throw new Error("Usage: node tools/instruction-feedback-ledger.ts --add <json-file>|--pending|--decay-report|--check-bloat --change <id>|--replay-pending [--ledger <path>]");
    }
    if (options.command === "check-bloat") {
      if (!options.changeId) {
        throw new Error("--check-bloat requires --change <id>.");
      }
      const result = checkBloat(options.root, options.changeId);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status !== "passed") {
        process.exitCode = 1;
      }
      return;
    }
    const ledger = loadLedger(options.ledgerPath);
    if (options.command === "add") {
      const input = options.addFile ? readJsonRecord(options.addFile) : parseJsonRecord(options.addJson ?? "{}");
      const result = addLedgerEntry(ledger, input, options.now ?? new Date().toISOString());
      writeLedger(options.ledgerPath, ledger);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (options.command === "advance") {
      if (!options.entryId || !options.status) {
        throw new Error("--advance requires entry id and --status.");
      }
      const entry = advanceLedgerEntry(ledger, options.entryId, { status: options.status, appliedRef: options.appliedRef, replayResult: options.replayResult }, options.now ?? new Date().toISOString());
      if (entry.status === "replayed" && entry.replayResult === "still-failing") {
        createStillFailingEntry(ledger, entry.id, options.now ?? new Date().toISOString());
      }
      writeLedger(options.ledgerPath, ledger);
      process.stdout.write(`${JSON.stringify({ entry }, null, 2)}\n`);
    } else if (options.command === "pending") {
      process.stdout.write(`${JSON.stringify({ entries: pendingEntries(ledger) }, null, 2)}\n`);
    } else if (options.command === "decay-report") {
      process.stdout.write(`${JSON.stringify(decayReport(ledger, { now: options.now, windowDays: options.windowDays }), null, 2)}\n`);
    } else if (options.command === "replay-pending") {
      const entries = replayPendingEntries(ledger);
      process.stdout.write(`${JSON.stringify({ entries }, null, 2)}\n`);
      if (entries.length > 0) {
        process.exitCode = 1;
      }
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
