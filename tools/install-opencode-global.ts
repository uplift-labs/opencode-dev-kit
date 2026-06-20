#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Options = {
  agentsMdSource: string | null;
  configDir: string | null;
  dryRun: boolean;
  audit: boolean;
  pullBack: boolean;
  forceOverwrite: boolean;
  noPrune: boolean;
  noBackup: boolean;
  profile: string;
  skipAgentsMd: boolean;
};

type InstallProfile = {
  agents?: string[];
  extends?: string;
  name?: string;
  skills?: string[];
};

type LoadedInstallProfile = Required<Pick<InstallProfile, "agents" | "skills">>;

type InstallContext = {
  backupRoot: string;
  configDir: string;
  dryRun: boolean;
  noBackup: boolean;
  runStamp: string;
};

type RelativeEntry =
  | { relative: string; type: "file" }
  | { relative: string; target: string; type: "symlink" };

type DriftEntry = {
  destination: string;
  destinationHash: string;
  label: string;
  relative: string;
  source: string;
  sourceHash: string;
  type: "file" | "directory";
};

type PullBackChange = {
  id: string;
  path: string;
  status: "created" | "existing";
  drift: DriftEntry;
};

const BEGIN_MARKER = "<!-- agents-and-skills:begin -->";
const END_MARKER = "<!-- agents-and-skills:end -->";

function printUsage(): void {
  console.log(`Usage:
  npm run install:global -- [options]

Options:
  --config-dir <path>         OpenCode config directory. Default: ~/.config/opencode
  --agents-md-source <path>   Source file to install into global AGENTS.md block.
                              Default: instructions/global-opencode-agent-instructions.md
  --profile <name>            Restrict install to profiles/<name>.json. Known: standard, strict,
                              advanced. Default: all repo skills/agents.
  --skip-agents-md           Install only skills and agents.
  --audit                    Report source-vs-destination drift without writing.
  --pull-back                Create investigation OpenSpec changes for drift without overwriting.
  --force-overwrite          Opt into legacy overwrite-with-backup behavior for drift.
  --no-prune                 Keep destination skills/agents not present in this repository.
  --no-backup                Replace changed or pruned artifacts without backup copies.
  --dry-run, --what-if       Preview changes without writing files.
  --help                     Show this help.
`);
}

function readOptionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.trim() === "" || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function readInlineOptionValue(value: string, name: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    agentsMdSource: null,
    configDir: null,
    dryRun: false,
    audit: false,
    pullBack: false,
    forceOverwrite: false,
    noPrune: false,
    noBackup: false,
    profile: "all",
    skipAgentsMd: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--config-dir" || arg === "-ConfigDir") {
      options.configDir = readOptionValue(args, i, arg);
      i++;
    } else if (arg.startsWith("--config-dir=")) {
      options.configDir = readInlineOptionValue(arg.slice("--config-dir=".length), "--config-dir");
    } else if (arg === "--agents-md-source" || arg === "-AgentsMdSource") {
      options.agentsMdSource = readOptionValue(args, i, arg);
      i++;
    } else if (arg.startsWith("--agents-md-source=")) {
      options.agentsMdSource = readInlineOptionValue(arg.slice("--agents-md-source=".length), "--agents-md-source");
    } else if (arg === "--profile") {
      options.profile = readOptionValue(args, i, arg);
      i++;
    } else if (arg.startsWith("--profile=")) {
      options.profile = readInlineOptionValue(arg.slice("--profile=".length), "--profile");
    } else if (arg === "--skip-agents-md" || arg === "-SkipAgentsMd") {
      options.skipAgentsMd = true;
    } else if (arg === "--no-prune" || arg === "-NoPrune") {
      options.noPrune = true;
    } else if (arg === "--no-backup" || arg === "-NoBackup") {
      options.noBackup = true;
    } else if (arg === "--dry-run" || arg === "--what-if" || arg === "-WhatIf") {
      options.dryRun = true;
    } else if (arg === "--audit") {
      options.audit = true;
    } else if (arg === "--pull-back") {
      options.pullBack = true;
    } else if (arg === "--force-overwrite") {
      options.forceOverwrite = arg === "--force-overwrite";
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const modeCount = [options.audit, options.pullBack, options.forceOverwrite].filter(Boolean).length;
  if (modeCount > 1) {
    throw new Error("Use only one of --audit, --pull-back, or --force-overwrite.");
  }

  return options;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function requireHome(): string {
  const home = os.homedir();
  if (!home) {
    throw new Error("Home directory is not available; pass --config-dir explicitly.");
  }
  return home;
}

function expandHome(input: string | null): string | null {
  if (!input) {
    return input;
  }
  if (input === "~") {
    return requireHome();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(requireHome(), input.slice(2));
  }
  return input;
}

function resolveConfigDir(input: string | null): string {
  if (input != null && input.trim() === "") {
    throw new Error("Missing value for --config-dir.");
  }
  const configured = input == null ? path.join(requireHome(), ".config", "opencode") : input;
  const expanded = expandHome(configured);
  if (expanded == null) {
    throw new Error("Missing value for --config-dir.");
  }
  return path.resolve(expanded);
}

function resolveSourcePath(input: string | null, repoRoot: string, defaultRelativePath: string): string {
  if (input != null && input.trim() === "") {
    throw new Error("Missing value for --agents-md-source.");
  }
  const configured = input == null ? defaultRelativePath : input;
  const expanded = expandHome(configured);
  if (expanded == null) {
    throw new Error("Missing value for --agents-md-source.");
  }
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  return path.resolve(repoRoot, expanded);
}

function assertDirectoryExists(target: string, label: string): void {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`Missing ${label} directory: ${target}`);
  }
}

function assertFileExists(target: string, label: string): void {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`Missing ${label} file: ${target}`);
  }
}

function pathExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isDirectoryFollowingSymlink(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function ensureDirectory(target: string, context: InstallContext): void {
  if (pathExists(target)) {
    if (!isDirectoryFollowingSymlink(target)) {
      const backup = createBackup(target, context);
      const backupLabel = context.dryRun ? "would backup" : "backup";
      const backupMessage = backup ? ` (${backupLabel}: ${backup})` : "";
      if (context.dryRun) {
        console.log(`would replace non-directory with directory: ${target}${backupMessage}`);
        return;
      }
      removePath(target);
      fs.mkdirSync(target, { recursive: true });
      console.log(`replaced non-directory with directory: ${target}${backupMessage}`);
    }
    return;
  }
  if (context.dryRun) {
    console.log(`would create directory: ${target}`);
    return;
  }
  fs.mkdirSync(target, { recursive: true });
}

function listDirectories(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function listFiles(root: string, extension: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON file ${file}: ${message}`);
  }
}

function asStringArray(value: unknown, label: string): string[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}

function loadProfile(repoRoot: string, name: string, seen = new Set<string>()): LoadedInstallProfile {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid profile name: ${name}`);
  }
  if (seen.has(name)) {
    throw new Error(`Profile inheritance cycle: ${[...seen, name].join(" -> ")}`);
  }
  seen.add(name);
  const profilePath = path.join(repoRoot, "profiles", `${name}.json`);
  if (!fs.existsSync(profilePath) || !fs.statSync(profilePath).isFile()) {
    throw new Error(`Missing install profile: ${profilePath}`);
  }
  const raw = readJsonFile(profilePath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Install profile must be a JSON object: ${profilePath}`);
  }
  const profile = raw as InstallProfile;
  const base = typeof profile.extends === "string" ? loadProfile(repoRoot, profile.extends, seen) : { agents: [], skills: [] };
  return {
    agents: asStringArray(profile.agents, `${profilePath}: agents`) ?? base.agents,
    skills: asStringArray(profile.skills, `${profilePath}: skills`) ?? base.skills,
  };
}

function filterByProfile<T>(items: T[], getName: (item: T) => string, allowed: string[], label: string): T[] {
  const allowedSet = new Set(allowed);
  const filtered = items.filter((item) => allowedSet.has(getName(item)));
  const available = new Set(items.map(getName));
  for (const name of allowedSet) {
    if (!available.has(name)) {
      throw new Error(`Install profile references missing ${label}: ${name}`);
    }
  }
  return filtered;
}

function toPosixRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolvePathThroughExistingAncestor(target: string): string {
  const absolute = path.resolve(target);
  let current = absolute;
  const suffix: string[] = [];

  while (!pathExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    suffix.unshift(path.basename(current));
    current = parent;
  }

  let resolvedAncestor = current;
  try {
    resolvedAncestor = fs.realpathSync.native(current);
  } catch (_error) {
    resolvedAncestor = current;
  }

  return path.resolve(resolvedAncestor, ...suffix);
}

function normalizePathForContainment(target: string): string {
  const resolved = resolvePathThroughExistingAncestor(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInsideOrEqual(candidate: string, parent: string): boolean {
  const relative = path.relative(normalizePathForContainment(parent), normalizePathForContainment(candidate));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoSourceOverlap(target: string, source: string, label: string): void {
  if (isPathInsideOrEqual(target, source) || isPathInsideOrEqual(source, target)) {
    throw new Error(`${label} must not overlap source artifact directory: ${target} conflicts with ${source}`);
  }
}

function isSamePath(left: string, right: string): boolean {
  return normalizePathForContainment(left) === normalizePathForContainment(right);
}

function assertAgentsMdSourceSafe(source: string, destinationAgentsMd: string, destinationSkillsDir: string, destinationAgentsDir: string): void {
  if (isSamePath(source, destinationAgentsMd)) {
    throw new Error(`AGENTS.md source must not be the destination AGENTS.md: ${source}`);
  }
  if (isPathInsideOrEqual(source, destinationSkillsDir) || isPathInsideOrEqual(source, destinationAgentsDir)) {
    throw new Error(`AGENTS.md source must not be inside destination skills or agents loader directories: ${source}`);
  }
}

function listRelativeEntries(root: string, current = root, result: RelativeEntry[] = []): RelativeEntry[] {
  const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      listRelativeEntries(root, entryPath, result);
    } else if (entry.isFile()) {
      result.push({ relative: toPosixRelative(path.relative(root, entryPath)), type: "file" });
    } else if (entry.isSymbolicLink()) {
      result.push({ relative: toPosixRelative(path.relative(root, entryPath)), target: fs.readlinkSync(entryPath), type: "symlink" });
    } else {
      throw new Error(`Unsupported filesystem entry: ${entryPath}`);
    }
  }
  return result;
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function directoryHash(root: string): string {
  const hash = crypto.createHash("sha256");
  for (const entry of listRelativeEntries(root)) {
    hash.update(entry.relative);
    hash.update("\0");
    hash.update(entry.type);
    hash.update("\0");
    if (entry.type === "file") {
      hash.update(sha256(path.join(root, entry.relative)));
    } else {
      hash.update(entry.target);
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function artifactHash(target: string): string {
  if (!pathExists(target)) {
    return "missing";
  }
  const stat = fs.lstatSync(target);
  if (stat.isFile()) {
    return sha256(target);
  }
  if (stat.isDirectory()) {
    return directoryHash(target);
  }
  if (stat.isSymbolicLink()) {
    return `symlink:${fs.readlinkSync(target)}`;
  }
  return `unsupported:${stat.mode}`;
}

function isSameFile(source: string, destination: string): boolean {
  if (!fs.existsSync(destination) || !fs.statSync(destination).isFile()) {
    return false;
  }
  const sourceStat = fs.statSync(source);
  const destinationStat = fs.statSync(destination);
  return sourceStat.size === destinationStat.size && sha256(source) === sha256(destination);
}

function isSameDirectory(source: string, destination: string): boolean {
  if (!fs.existsSync(destination) || !fs.statSync(destination).isDirectory()) {
    return false;
  }
  const sourceEntries = listRelativeEntries(source);
  const destinationEntries = listRelativeEntries(destination);
  if (sourceEntries.length !== destinationEntries.length) {
    return false;
  }
  for (let i = 0; i < sourceEntries.length; i++) {
    const sourceEntry = sourceEntries[i];
    const destinationEntry = destinationEntries[i];
    if (sourceEntry.relative !== destinationEntry.relative || sourceEntry.type !== destinationEntry.type) {
      return false;
    }
    if (sourceEntry.type === "file" && !isSameFile(path.join(source, sourceEntry.relative), path.join(destination, destinationEntry.relative))) {
      return false;
    }
    if (sourceEntry.type === "symlink" && destinationEntry.type === "symlink" && sourceEntry.target !== destinationEntry.target) {
      return false;
    }
  }
  return true;
}

function collectDrift(items: Array<{ destination: string; label: string; relative: string; source: string; type: "file" | "directory" }>): DriftEntry[] {
  const drift: DriftEntry[] = [];
  for (const item of items) {
    if (!pathExists(item.destination)) {
      continue;
    }
    const same = item.type === "file" ? isSameFile(item.source, item.destination) : isSameDirectory(item.source, item.destination);
    if (same) {
      continue;
    }
    drift.push({
      ...item,
      sourceHash: artifactHash(item.source),
      destinationHash: artifactHash(item.destination),
    });
  }
  return drift.sort((left, right) => left.relative.localeCompare(right.relative));
}

function printDriftReport(drift: DriftEntry[]): void {
  if (drift.length === 0) {
    console.log("No drift detected.");
    return;
  }
  console.log(`drift detected: ${drift.length} artifact(s)`);
  for (const entry of drift) {
    console.log(`- ${entry.relative}: sourceHash=${entry.sourceHash} destinationHash=${entry.destinationHash}`);
  }
}

function printDriftRecovery(configDir: string, profile: string, skipAgentsMd: boolean): void {
  const common = [`--config-dir "${configDir}"`, profile === "all" ? "" : `--profile ${profile}`, skipAgentsMd ? "--skip-agents-md" : ""].filter(Boolean).join(" ");
  console.log(`Recovery: npm run install:global -- ${common} --pull-back`);
  console.log(`Recovery: npm run install:global -- ${common} --force-overwrite`);
}

function slug(value: string): string {
  const slugged = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slugged.length > 0 ? slugged.slice(0, 56).replace(/-+$/g, "") : "artifact";
}

function safeFenceContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `unreadable: ${message}`;
  }
}

function artifactContent(target: string): string {
  if (!pathExists(target)) {
    return "missing";
  }
  const stat = fs.lstatSync(target);
  if (stat.isFile()) {
    return safeFenceContent(target);
  }
  if (stat.isDirectory()) {
    const chunks: string[] = [];
    for (const entry of listRelativeEntries(target)) {
      chunks.push(`### ${entry.relative}`);
      if (entry.type === "file") {
        chunks.push(safeFenceContent(path.join(target, entry.relative)).trimEnd());
      } else {
        chunks.push(`symlink -> ${entry.target}`);
      }
    }
    return chunks.join("\n\n");
  }
  if (stat.isSymbolicLink()) {
    return `symlink -> ${fs.readlinkSync(target)}`;
  }
  return "unsupported";
}

function pullBackTaskTail(changeId: string): string {
  return `## Retrospective Before Archive

- [ ] Review the completed change context, validation, reviewer gates, blockers, repeated work, wait time, token-heavy steps, and likely root causes.
- [ ] Write \`openspec/changes/${changeId}/retro.md\` with evidence, problems, root causes, improvements, follow-up ids, and archive gate decision.
- [ ] Run \`npm run openspec:retro-followups -- ${changeId}\` when available so actionable retrospective findings create or update follow-up OpenSpec changes before archive.
- [ ] If the helper is unavailable, manually create or update project-local OpenSpec follow-up changes for project-local findings; for reusable \`opencode-dev-kit\` findings, write only when the current repository owns the reusable artifact and current write scope includes it, otherwise record a local handoff and do not write cross-repo without explicit approval.
- [ ] Confirm archive is allowed only after the retro gate passes or an approved skip reason is recorded in \`retro.md\`.
`;
}

function pullBackProposal(changeId: string, drift: DriftEntry): string {
  return `# Proposal: Install Pull-Back Investigation For ${drift.relative}

## Why

\`install:global --pull-back\` found destination drift for an installed OpenCode artifact.

- Artifact: ${drift.relative}
- Source Hash: ${drift.sourceHash}
- Destination Hash: ${drift.destinationHash}
- Root Cause: unknown

The source repository must decide whether the destination change is a reusable improvement, a local-only customization, or accidental drift before any source change is made.

## What Changes

- Investigate the destination drift and decide whether to open a separate implementation follow-up.
- Preserve destination and source content for review.

## Destination Content

~~~~text
${artifactContent(drift.destination).trimEnd()}
~~~~

## Source Content

~~~~text
${artifactContent(drift.source).trimEnd()}
~~~~

## Root Cause

unknown. Investigate before adding or changing any reusable instruction rule.

## Non-Goals

- Do not write cross-repo artifacts unless this repository owns the artifact family.
- Do not merge, classify severity, or extract prevention rules in this pull-back run.

## Validation

- Define focused validation in \`tasks.md\` before implementation.
`;
}

function pullBackTasks(changeId: string, drift: DriftEntry): string {
  return `# Tasks: Install Pull-Back Investigation For ${drift.relative}

## Investigation

- [ ] Confirm whether the destination change is reusable, project-specific, or accidental.
- [ ] Investigate and document the root cause before designing any source change.
- [ ] If reusable, open a separate follow-up change that modifies the source artifact with focused validation.
- [ ] If local-only, close as \`approved-skip\` with evidence and reason.

## Validation

- [ ] Run the focused validation command for the eventual source change, or record why no source change is needed.
- [ ] Run \`openspec validate --all\` when this investigation changes OpenSpec artifacts.

${pullBackTaskTail(changeId)}`;
}

function pullBackSpec(changeId: string, drift: DriftEntry): string {
  return `# ${changeId} Specification

## ADDED Requirements

### Requirement: Install Drift Investigation Is Routed Before Source Changes

Destination drift for ${drift.relative} SHALL be investigated before any reusable source artifact is changed.

#### Scenario: Unknown root cause is investigated before remediation

- **GIVEN** \`install:global --pull-back\` generated this change with root cause unknown
- **WHEN** the change is selected for implementation
- **THEN** the implementer reviews destination content, source content, source hash, destination hash, and ownership
- **AND** records the discovered root cause before opening or applying any source remediation.
`;
}

function findExistingPullBack(changesRoot: string, drift: DriftEntry): string | null {
  if (!pathExists(changesRoot) || !isDirectoryFollowingSymlink(changesRoot)) {
    return null;
  }
  for (const dir of listDirectories(changesRoot)) {
    const id = path.basename(dir);
    if (!id.startsWith("install-pullback-")) {
      continue;
    }
    const proposalPath = path.join(dir, "proposal.md");
    if (!fs.existsSync(proposalPath)) {
      continue;
    }
    const proposal = fs.readFileSync(proposalPath, "utf8");
    if (proposal.includes(`- Artifact: ${drift.relative}`) && proposal.includes(`- Source Hash: ${drift.sourceHash}`) && proposal.includes(`- Destination Hash: ${drift.destinationHash}`)) {
      return id;
    }
  }
  return null;
}

function createPullBackChanges(repoRoot: string, drift: DriftEntry[], runStamp: string): PullBackChange[] {
  const changesRoot = path.join(repoRoot, "openspec", "changes");
  fs.mkdirSync(changesRoot, { recursive: true });
  const changes: PullBackChange[] = [];
  for (const entry of drift) {
    const existing = findExistingPullBack(changesRoot, entry);
    const id = existing ?? `install-pullback-${runStamp.toLowerCase()}-${slug(entry.relative)}`.slice(0, 96).replace(/-+$/g, "");
    const changeRoot = path.join(changesRoot, id);
    if (existing == null) {
      fs.mkdirSync(path.join(changeRoot, "specs", id), { recursive: true });
      fs.writeFileSync(path.join(changeRoot, "proposal.md"), pullBackProposal(id, entry), "utf8");
      fs.writeFileSync(path.join(changeRoot, "tasks.md"), pullBackTasks(id, entry), "utf8");
      fs.writeFileSync(path.join(changeRoot, "specs", id, "spec.md"), pullBackSpec(id, entry), "utf8");
    }
    changes.push({ id, path: changeRoot, status: existing == null ? "created" : "existing", drift: entry });
  }
  return changes;
}

function copyPath(source: string, destination: string): void {
  const stat = fs.lstatSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyPath(path.join(source, entry.name), path.join(destination, entry.name));
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  } else if (stat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(fs.readlinkSync(source), destination);
  } else {
    throw new Error(`Unsupported filesystem entry: ${source}`);
  }
}

function removePath(target: string): void {
  fs.rmSync(target, { force: true, recursive: true });
}

function relativeUnderConfig(target: string, configDir: string): string | null {
  const relative = path.relative(configDir, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return toPosixRelative(relative);
}

function backupPathFor(target: string, context: InstallContext): string {
  const relative = relativeUnderConfig(path.resolve(target), context.configDir) || path.basename(target);
  const parts = relative.split("/").filter(Boolean);
  let candidate = path.join(context.backupRoot, context.runStamp, ...parts);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${path.join(context.backupRoot, context.runStamp, ...parts)}.${suffix}`;
    suffix++;
  }
  return candidate;
}

function createBackup(target: string, context: InstallContext): string | null {
  if (context.noBackup || !pathExists(target)) {
    return null;
  }
  const destination = backupPathFor(target, context);
  ensureDirectory(path.dirname(destination), context);
  if (!context.dryRun) {
    copyPath(target, destination);
  }
  return destination;
}

function installFile(source: string, destination: string, label: string, context: InstallContext): void {
  if (isSameFile(source, destination)) {
    console.log(`unchanged: ${label}`);
    return;
  }
  ensureDirectory(path.dirname(destination), context);
  const backup = createBackup(destination, context);
  if (context.dryRun) {
    const backupMessage = backup ? ` (would backup: ${backup})` : "";
    console.log(`would install: ${label} -> ${destination}${backupMessage}`);
    return;
  }
  if (pathExists(destination)) {
    removePath(destination);
  }
  fs.copyFileSync(source, destination);
  console.log(backup ? `installed: ${label} (backup: ${backup})` : `installed: ${label}`);
}

function installDirectory(source: string, destination: string, label: string, context: InstallContext): void {
  if (isSameDirectory(source, destination)) {
    console.log(`unchanged: ${label}`);
    return;
  }
  ensureDirectory(path.dirname(destination), context);
  const backup = createBackup(destination, context);
  if (context.dryRun) {
    const backupMessage = backup ? ` (would backup: ${backup})` : "";
    console.log(`would install: ${label} -> ${destination}${backupMessage}`);
    return;
  }
  removePath(destination);
  copyPath(source, destination);
  console.log(backup ? `installed: ${label} (backup: ${backup})` : `installed: ${label}`);
}

function prunePath(target: string, label: string, context: InstallContext): void {
  const backup = createBackup(target, context);
  if (context.dryRun) {
    const backupMessage = backup ? ` (would backup: ${backup})` : "";
    console.log(`would prune: ${label} -> ${target}${backupMessage}`);
    return;
  }
  removePath(target);
  console.log(backup ? `pruned: ${label} (backup: ${backup})` : `pruned: ${label}`);
}

function pruneStaleDirectories(destinationRoot: string, desiredNames: Set<string>, labelPrefix: string, context: InstallContext): void {
  if (!pathExists(destinationRoot)) {
    return;
  }
  if (!isDirectoryFollowingSymlink(destinationRoot)) {
    throw new Error(`Destination ${labelPrefix} root exists but is not a directory: ${destinationRoot}`);
  }
  for (const dir of listDirectories(destinationRoot)) {
    const name = path.basename(dir);
    if (!desiredNames.has(name)) {
      prunePath(dir, `stale ${labelPrefix} ${name}`, context);
    }
  }
}

function pruneStaleFiles(destinationRoot: string, desiredNames: Set<string>, extension: string, labelPrefix: string, context: InstallContext): void {
  if (!pathExists(destinationRoot)) {
    return;
  }
  if (!isDirectoryFollowingSymlink(destinationRoot)) {
    throw new Error(`Destination ${labelPrefix} root exists but is not a directory: ${destinationRoot}`);
  }
  for (const file of listFiles(destinationRoot, extension)) {
    const basename = path.basename(file);
    if (!desiredNames.has(basename)) {
      prunePath(file, `stale ${labelPrefix} ${path.basename(file, extension)}`, context);
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}

function validateAgentsMdMarkers(existing: string, destination: string): void {
  const pattern = new RegExp(`${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\r?\\n?`);
  const beginCount = countOccurrences(existing, BEGIN_MARKER);
  const endCount = countOccurrences(existing, END_MARKER);
  if (beginCount !== endCount) {
    throw new Error(`Malformed AGENTS.md managed block markers in ${destination}: begin=${beginCount} end=${endCount}`);
  }
  if (beginCount > 1) {
    throw new Error(`Multiple AGENTS.md managed blocks found in ${destination}; keep exactly one managed block before reinstalling.`);
  }
  if (beginCount === 1 && !pattern.test(existing)) {
    throw new Error(`Malformed AGENTS.md managed block markers in ${destination}: begin marker must precede end marker.`);
  }
}

function detectNewline(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function agentsMdBlock(source: string, newline: string): string {
  const sourceText = fs.readFileSync(source, "utf8").trimEnd().replace(/\r\n?/g, "\n").replace(/\n/g, newline);
  return `${BEGIN_MARKER}${newline}${sourceText}${newline}${END_MARKER}${newline}`;
}

function readExistingAgentsMd(destination: string): string {
  if (!pathExists(destination)) {
    return "";
  }
  try {
    if (!fs.statSync(destination).isFile()) {
      return "";
    }
    return fs.readFileSync(destination, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function installAgentsMd(source: string, destination: string, context: InstallContext): void {
  const existing = readExistingAgentsMd(destination);
  validateAgentsMdMarkers(existing, destination);
  const newline = existing ? detectNewline(existing) : "\n";
  const block = agentsMdBlock(source, newline);
  const pattern = new RegExp(`${escapeRegExp(BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\r?\\n?`);

  let next: string;
  if (pattern.test(existing)) {
    next = existing.replace(pattern, block);
  } else if (existing.trim() === "") {
    next = block;
  } else {
    const separator = existing.endsWith(`${newline}${newline}`) ? "" : existing.endsWith(newline) ? newline : `${newline}${newline}`;
    next = `${existing}${separator}${block}`;
  }

  if (existing === next) {
    console.log("unchanged: AGENTS.md block");
    return;
  }
  ensureDirectory(path.dirname(destination), context);
  const backup = createBackup(destination, context);
  if (context.dryRun) {
    const backupMessage = backup ? ` (would backup: ${backup})` : "";
    console.log(`would install: AGENTS.md block -> ${destination}${backupMessage}`);
    return;
  }
  if (pathExists(destination)) {
    removePath(destination);
  }
  fs.writeFileSync(destination, next, "utf8");
  console.log(backup ? `installed: AGENTS.md block (backup: ${backup})` : "installed: AGENTS.md block");
}

function run(): void {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourceSkillsDir = path.join(repoRoot, ".opencode", "skills");
  const sourceAgentsDir = path.join(repoRoot, ".opencode", "agents");
  const sourcePluginDir = path.join(repoRoot, ".opencode", "plugin");
  const sourceRetroToolEntrypoint = path.join(repoRoot, "tools", "opencode-project-session-retro-ledger.ts");
  const sourceRetroToolDir = path.join(repoRoot, "tools", "project-session-retro-ledger");
  const sourceAgentsMd = options.skipAgentsMd
    ? null
    : resolveSourcePath(options.agentsMdSource, repoRoot, path.join("instructions", "global-opencode-agent-instructions.md"));
  const configDir = resolveConfigDir(options.configDir);
  const context: InstallContext = {
    backupRoot: path.join(configDir, ".backups", "agents-and-skills"),
    configDir,
    dryRun: options.dryRun,
    noBackup: options.noBackup,
    runStamp: new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"),
  };

  assertDirectoryExists(sourceSkillsDir, "source skills");
  assertDirectoryExists(sourceAgentsDir, "source agents");
  assertDirectoryExists(sourcePluginDir, "source plugin");
  assertFileExists(sourceRetroToolEntrypoint, "source project session retro ledger tool");
  assertDirectoryExists(sourceRetroToolDir, "source project session retro ledger support");
  if (fs.existsSync(configDir) && !fs.statSync(configDir).isDirectory()) {
    throw new Error(`OpenCode config path exists but is not a directory: ${configDir}`);
  }
  if (sourceAgentsMd) {
    assertFileExists(sourceAgentsMd, "source AGENTS.md");
  }

  const allSkillDirs = listDirectories(sourceSkillsDir);
  const allAgentFiles = listFiles(sourceAgentsDir, ".md");
  const profile = options.profile === "all" ? null : loadProfile(repoRoot, options.profile);
  const skillDirs = profile == null ? allSkillDirs : filterByProfile(allSkillDirs, (dir) => path.basename(dir), profile.skills, "skill");
  const agentFiles = profile == null ? allAgentFiles : filterByProfile(allAgentFiles, (file) => path.basename(file, ".md"), profile.agents, "agent");
  const destinationSkillsDir = path.join(configDir, "skills");
  const destinationAgentsDir = path.join(configDir, "agents");
  const destinationPluginDir = path.join(configDir, "plugin");
  const destinationSupportToolsDir = path.join(configDir, "opencode-dev-kit", "tools");
  const destinationAgentsMd = path.join(configDir, "AGENTS.md");

  assertNoSourceOverlap(configDir, sourceSkillsDir, "--config-dir");
  assertNoSourceOverlap(configDir, sourceAgentsDir, "--config-dir");
  assertNoSourceOverlap(configDir, sourcePluginDir, "--config-dir");
  assertNoSourceOverlap(configDir, sourceRetroToolDir, "--config-dir");
  assertNoSourceOverlap(destinationSkillsDir, sourceSkillsDir, "destination skills directory");
  assertNoSourceOverlap(destinationAgentsDir, sourceAgentsDir, "destination agents directory");
  assertNoSourceOverlap(destinationPluginDir, sourcePluginDir, "destination plugin directory");
  assertNoSourceOverlap(destinationSupportToolsDir, sourceRetroToolDir, "destination support tools directory");
  if (sourceAgentsMd) {
    assertAgentsMdSourceSafe(sourceAgentsMd, destinationAgentsMd, destinationSkillsDir, destinationAgentsDir);
    validateAgentsMdMarkers(readExistingAgentsMd(destinationAgentsMd), destinationAgentsMd);
  }

  const drift = collectDrift([
    ...skillDirs.map((skillDir) => ({
      destination: path.join(destinationSkillsDir, path.basename(skillDir)),
      label: `skill ${path.basename(skillDir)}`,
      relative: `skills/${path.basename(skillDir)}`,
      source: skillDir,
      type: "directory" as const,
    })),
    ...agentFiles.map((agentFile) => ({
      destination: path.join(destinationAgentsDir, path.basename(agentFile)),
      label: `agent ${path.basename(agentFile, ".md")}`,
      relative: `agents/${path.basename(agentFile)}`,
      source: agentFile,
      type: "file" as const,
    })),
    ...listFiles(sourcePluginDir, ".ts").map((pluginFile) => ({
      destination: path.join(destinationPluginDir, path.basename(pluginFile)),
      label: `plugin ${path.basename(pluginFile, ".ts")}`,
      relative: `plugin/${path.basename(pluginFile)}`,
      source: pluginFile,
      type: "file" as const,
    })),
    {
      destination: path.join(destinationSupportToolsDir, "opencode-project-session-retro-ledger.ts"),
      label: "support tool opencode-project-session-retro-ledger",
      relative: "opencode-dev-kit/tools/opencode-project-session-retro-ledger.ts",
      source: sourceRetroToolEntrypoint,
      type: "file" as const,
    },
    {
      destination: path.join(destinationSupportToolsDir, "project-session-retro-ledger"),
      label: "support tool project-session-retro-ledger",
      relative: "opencode-dev-kit/tools/project-session-retro-ledger",
      source: sourceRetroToolDir,
      type: "directory" as const,
    },
  ]);

  console.log(`OpenCode global config: ${configDir}`);
  console.log(`Install profile: ${options.profile}`);
  console.log(sourceAgentsMd ? `AGENTS.md source: ${sourceAgentsMd}` : "AGENTS.md source: skipped");
  if (options.audit) {
    printDriftReport(drift);
    if (drift.length > 0) {
      process.exitCode = 1;
    }
    return;
  }
  if (options.pullBack) {
    printDriftReport(drift);
    if (drift.length === 0) {
      console.log("Pull-back no-op. No files were changed.");
      return;
    }
    for (const change of createPullBackChanges(repoRoot, drift, context.runStamp)) {
      console.log(`${change.status}: ${change.id} (${change.drift.relative})`);
    }
    console.log("Pull-back complete. Destination artifacts were not overwritten.");
    return;
  }
  if (!options.forceOverwrite && drift.length > 0) {
    printDriftReport(drift);
    console.log("Default install refuses to overwrite drifted artifacts.");
    printDriftRecovery(configDir, options.profile, options.skipAgentsMd);
    process.exitCode = 1;
    return;
  }
  console.log(`Installing skills: ${skillDirs.length}`);
  for (const skillDir of skillDirs) {
    installDirectory(skillDir, path.join(destinationSkillsDir, path.basename(skillDir)), `skill ${path.basename(skillDir)}`, context);
  }
  if (options.noPrune) {
    console.log("skipped: stale skill pruning");
  } else {
    pruneStaleDirectories(destinationSkillsDir, new Set(skillDirs.map((dir) => path.basename(dir))), "skill", context);
  }

  console.log(`Installing agents: ${agentFiles.length}`);
  for (const agentFile of agentFiles) {
    installFile(agentFile, path.join(destinationAgentsDir, path.basename(agentFile)), `agent ${path.basename(agentFile, ".md")}`, context);
  }
  if (options.noPrune) {
    console.log("skipped: stale agent pruning");
  } else {
    pruneStaleFiles(destinationAgentsDir, new Set(agentFiles.map((file) => path.basename(file))), ".md", "agent", context);
  }

  if (options.skipAgentsMd || sourceAgentsMd == null) {
    console.log("skipped: AGENTS.md block");
  } else {
    installAgentsMd(sourceAgentsMd, destinationAgentsMd, context);
  }

  console.log("Installing plugin support: session delivery context");
  for (const pluginFile of listFiles(sourcePluginDir, ".ts")) {
    installFile(pluginFile, path.join(destinationPluginDir, path.basename(pluginFile)), `plugin ${path.basename(pluginFile, ".ts")}`, context);
  }
  installFile(sourceRetroToolEntrypoint, path.join(destinationSupportToolsDir, "opencode-project-session-retro-ledger.ts"), "support tool opencode-project-session-retro-ledger", context);
  installDirectory(sourceRetroToolDir, path.join(destinationSupportToolsDir, "project-session-retro-ledger"), "support tool project-session-retro-ledger", context);

  if (options.dryRun) {
    console.log("Dry run complete. No files were changed.");
  } else {
    console.log("Done. Restart OpenCode for newly installed global artifacts to be loaded.");
  }
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
