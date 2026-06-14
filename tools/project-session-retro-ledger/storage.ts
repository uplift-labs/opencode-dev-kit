import fs from "node:fs";
import path from "node:path";
import type { ProjectSessionRetroLedger } from "./types.ts";
import { isPlainRecord, readJsonFile, writeJsonFile } from "./utils.ts";

const shardKeys = ["sessions", "trends", "rootCauses", "plans", "openspecProposals"] as const;
type ShardKey = typeof shardKeys[number];
type ProjectSessionRetroLedgerIndex = Omit<ProjectSessionRetroLedger, ShardKey>;
const windowsReservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export type ProjectSessionRetroStorageFormat = "auto" | "file" | "directory";

export type WriteProjectSessionRetroLedgerStorageOptions = {
  format?: ProjectSessionRetroStorageFormat;
  overwrite?: boolean;
};

function requireExistingPath(inputPath: string): fs.Stats {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Retro ledger input does not exist: ${inputPath}`);
  }
  return fs.statSync(inputPath);
}

function outputFormat(outputPath: string, requested: ProjectSessionRetroStorageFormat = "auto"): "file" | "directory" {
  if (requested === "file" || requested === "directory") {
    return requested;
  }
  if (fs.existsSync(outputPath)) {
    return fs.statSync(outputPath).isDirectory() ? "directory" : "file";
  }
  return path.extname(outputPath).toLowerCase() === ".json" ? "file" : "directory";
}

function encodeShardId(id: string): string {
  if (/^[a-z0-9][a-z0-9._-]*$/.test(id) && !id.endsWith(".") && !windowsReservedNames.test(id)) {
    return id;
  }
  return `~${Buffer.from(id, "utf8").toString("hex")}`;
}

function decodeShardId(stem: string, filePath: string): string {
  if (!stem.startsWith("~")) {
    return stem;
  }
  const encoded = stem.slice(1);
  if (!/^(?:[0-9a-f]{2})*$/.test(encoded)) {
    throw new Error(`Invalid encoded retro ledger shard filename: ${filePath}`);
  }
  const decoded = Buffer.from(encoded, "hex").toString("utf8");
  if (encodeShardId(decoded) !== stem) {
    throw new Error(`Invalid encoded retro ledger shard filename: ${filePath}`);
  }
  return decoded;
}

function shardFileName(id: string): string {
  return `${encodeShardId(id)}.json`;
}

function readShardMap(root: string, key: ShardKey): Record<string, unknown> {
  const dir = path.join(root, key);
  if (!fs.existsSync(dir)) {
    return {};
  }
  if (!fs.statSync(dir).isDirectory()) {
    throw new Error(`Retro ledger shard path must be a directory: ${dir}`);
  }
  const result: Record<string, unknown> = {};
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    const id = decodeShardId(entry.name.slice(0, -".json".length), filePath);
    result[id] = readJsonFile(filePath);
  }
  return result;
}

function readShardedLedger(root: string): ProjectSessionRetroLedger {
  const indexPath = path.join(root, "index.json");
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
    throw new Error(`Sharded retro ledger directory must contain index.json: ${root}`);
  }
  const index = readJsonFile(indexPath);
  if (!isPlainRecord(index)) {
    throw new Error(`Sharded retro ledger index must be a JSON object: ${indexPath}`);
  }
  const duplicateKeys = shardKeys.filter((key) => key in index);
  if (duplicateKeys.length > 0) {
    throw new Error(`Sharded retro ledger index must not include shard keys: ${duplicateKeys.join(", ")}`);
  }
  const typedIndex = index as ProjectSessionRetroLedgerIndex;
  return {
    schemaVersion: typedIndex.schemaVersion,
    tool: typedIndex.tool,
    generatedAt: typedIndex.generatedAt,
    scope: typedIndex.scope,
    sources: typedIndex.sources,
    analysisProgress: typedIndex.analysisProgress,
    sessions: readShardMap(root, "sessions") as ProjectSessionRetroLedger["sessions"],
    trends: readShardMap(root, "trends") as ProjectSessionRetroLedger["trends"],
    rootCauses: readShardMap(root, "rootCauses") as ProjectSessionRetroLedger["rootCauses"],
    plans: readShardMap(root, "plans") as ProjectSessionRetroLedger["plans"],
    openspecProposals: readShardMap(root, "openspecProposals") as ProjectSessionRetroLedger["openspecProposals"],
    validation: typedIndex.validation,
  };
}

function ledgerIndex(ledger: ProjectSessionRetroLedger): ProjectSessionRetroLedgerIndex {
  return {
    schemaVersion: ledger.schemaVersion,
    tool: ledger.tool,
    generatedAt: ledger.generatedAt,
    scope: ledger.scope,
    sources: ledger.sources,
    analysisProgress: ledger.analysisProgress,
    validation: ledger.validation,
  };
}

function ensureOutputParent(outputPath: string): void {
  const parent = path.dirname(outputPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`Output parent directory does not exist: ${parent}`);
  }
}

function prepareShardDirectory(root: string, overwrite: boolean): void {
  ensureOutputParent(root);
  if (fs.existsSync(root)) {
    if (!fs.statSync(root).isDirectory()) {
      throw new Error(`Sharded retro ledger output must be a directory: ${root}`);
    }
    if (!overwrite) {
      throw new Error(`Output directory already exists; pass --overwrite to replace it: ${root}`);
    }
  } else {
    fs.mkdirSync(root, { recursive: true });
  }
}

function clearShardJsonFiles(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  if (!fs.statSync(dir).isDirectory()) {
    throw new Error(`Retro ledger shard path must be a directory: ${dir}`);
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      fs.rmSync(path.join(dir, entry.name));
    }
  }
}

function writeShardMap(root: string, key: ShardKey, values: Record<string, unknown>): void {
  const dir = path.join(root, key);
  const entries = Object.entries(values)
    .map(([id, value]) => ({ fileName: shardFileName(id), id, value }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const normalizedFileNames = new Set<string>();
  for (const entry of entries) {
    const normalized = entry.fileName.toLowerCase();
    if (normalizedFileNames.has(normalized)) {
      throw new Error(`Retro ledger shard ids collide on a case-insensitive filesystem under ${key}: ${entry.id}`);
    }
    normalizedFileNames.add(normalized);
  }
  clearShardJsonFiles(dir);
  for (const entry of entries) {
    writeJsonFile(path.join(dir, entry.fileName), entry.value, { overwrite: true });
  }
}

function writeShardedLedger(root: string, ledger: ProjectSessionRetroLedger, overwrite: boolean): void {
  prepareShardDirectory(root, overwrite);
  writeJsonFile(path.join(root, "index.json"), ledgerIndex(ledger), { overwrite: true });
  writeShardMap(root, "sessions", ledger.sessions);
  writeShardMap(root, "trends", ledger.trends);
  writeShardMap(root, "rootCauses", ledger.rootCauses);
  writeShardMap(root, "plans", ledger.plans);
  writeShardMap(root, "openspecProposals", ledger.openspecProposals);
}

export function isProjectSessionRetroShardedDirectory(inputPath: string): boolean {
  return fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory() && fs.existsSync(path.join(inputPath, "index.json"));
}

export function readProjectSessionRetroLedgerStorage(inputPath: string): ProjectSessionRetroLedger {
  const stats = requireExistingPath(inputPath);
  if (stats.isDirectory()) {
    return readShardedLedger(inputPath);
  }
  return readJsonFile(inputPath) as ProjectSessionRetroLedger;
}

export function writeProjectSessionRetroLedgerStorage(outputPath: string, ledger: ProjectSessionRetroLedger, options: WriteProjectSessionRetroLedgerStorageOptions = {}): void {
  const format = outputFormat(outputPath, options.format);
  if (format === "file") {
    writeJsonFile(outputPath, ledger, { overwrite: options.overwrite });
    return;
  }
  writeShardedLedger(outputPath, ledger, options.overwrite === true);
}
