#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKILL_DESCRIPTION_MAX_CHARS,
  SKILL_NAME_PATTERN,
  SKILL_OUTPUT_CONTRACT_PATTERN,
  SKILL_TRIGGER_PATTERN,
} from "./contracts/skills.ts";
import {
  COMPLAIN_DIRECT_WRITE_CONTRACT_TEXT,
  COMPLAIN_SHARED_REQUIRED_TEXT,
} from "./contracts/complain.ts";
import {
  ALLOWED_COMPLAIN_SKILL_RULES,
  ALLOWED_REVIEWER_BASH_RULES,
  ALLOWED_REVIEWER_EDIT_RULES,
  REUSABLE_REVIEWER_FORBIDDEN_BOILERPLATE,
  REUSABLE_REVIEWER_LEAF_CONTRACT_TEXT,
  REVIEWER_DENIED_PERMISSION_KEYS,
  REVIEWER_OBSOLETE_PERMISSION_KEYS,
} from "./contracts/agents.ts";
import {
  AGENT_TEXT_CONTRACTS,
  PREVENTION_FEEDBACK_REVIEWER_FILES,
  PREVENTION_FEEDBACK_REQUIRED_TEXT,
  SESSION_DELIVERY_BINDING_HANDOFF_TOKENS,
} from "./contracts/reviewer-binding.ts";
import {
  ALLOWED_IMPLEMENTATION_WORKER_BASH_RULES,
  IMPLEMENTATION_WORKER_DENIED_PERMISSION_KEYS,
  IMPLEMENTATION_WORKER_FILE,
  IMPLEMENTATION_WORKER_HANDOFF_FIELDS,
  IMPLEMENTATION_WORKER_REQUIRED_TEXT,
  IMPLEMENTATION_WORKER_ROUTING_REQUIRED_TEXT,
} from "./contracts/implementation-worker.ts";

type FrontmatterValue = string | Record<string, never>;
type FrontmatterMap = Map<string, FrontmatterValue>;
type TextContract = {
  fileName: string;
  label: string;
  requiredText: string[];
};

type Options = {
  failOnWarnings: boolean;
  forbiddenAnchors: string[];
  root: string;
};

const errors: string[] = [];
const warnings: string[] = [];
const infos: string[] = [];
const forbiddenCodeExtensions = new Set([".cjs", ".js", ".mjs", ".ps1", ".psd1", ".psm1", ".py", ".pyw"]);
const mutationCapablePermissionKeys = new Set(["bash", "edit", "task", "external_directory"]);
const legacyToolingReferences = [
  "pwsh -NoProfile -File",
  "validate-library.ps1",
  "test-library.ps1",
  "install-opencode-global.js",
];
function addError(message: string): void {
  errors.push(message);
}

function addWarning(message: string): void {
  warnings.push(message);
}

function addInfo(message: string): void {
  infos.push(message);
}

function hasMachineOverride(config: unknown): boolean {
  if (!isPlainRecord(config)) {
    return false;
  }
  return config.machineOverride === true;
}

function defaultRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function readOptionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.trim() === "" || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function splitForbiddenAnchorValues(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseArgs(args: string[]): Options {
  let root = defaultRoot();
  let failOnWarnings = false;
  const forbiddenAnchors: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" || arg === "--Root" || arg === "-Root") {
      root = readOptionValue(args, i, arg);
      i++;
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
    } else if (arg.startsWith("--Root=")) {
      root = arg.slice("--Root=".length);
    } else if (arg === "--forbidden-anchor" || arg === "--ForbiddenAnchor" || arg === "-ForbiddenAnchor") {
      const values: string[] = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        values.push(args[i + 1]);
        i++;
      }
      if (values.length === 0) {
        throw new Error(`Missing value for ${arg}.`);
      }
      forbiddenAnchors.push(...splitForbiddenAnchorValues(values));
    } else if (arg.startsWith("--forbidden-anchor=")) {
      forbiddenAnchors.push(...splitForbiddenAnchorValues([arg.slice("--forbidden-anchor=".length)]));
    } else if (arg.startsWith("--ForbiddenAnchor=")) {
      forbiddenAnchors.push(...splitForbiddenAnchorValues([arg.slice("--ForbiddenAnchor=".length)]));
    } else if (arg === "--fail-on-warnings") {
      failOnWarnings = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { failOnWarnings, forbiddenAnchors, root: path.resolve(root) };
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function convertFromFrontmatterScalar(value: string, file: string, lineNumber: number): string {
  const trimmed = value.trim();
  const doubleQuoted = trimmed.startsWith('"') || trimmed.endsWith('"');
  const singleQuoted = trimmed.startsWith("'") || trimmed.endsWith("'");

  if (
    (doubleQuoted && !(trimmed.startsWith('"') && trimmed.endsWith('"'))) ||
    (singleQuoted && !(trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    addError(`Invalid frontmatter quoting: ${file}:${lineNumber}`);
    return trimmed;
  }

  if (!doubleQuoted && !singleQuoted && /:\s/.test(trimmed)) {
    addError(`Invalid unquoted frontmatter scalar containing ': ': ${file}:${lineNumber}`);
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function getFrontmatterMap(text: string, file: string): FrontmatterMap {
  const match = text.match(/^---\r?\n(?<body>[\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const values: FrontmatterMap = new Map();
  if (!match?.groups?.body) {
    addError(`Missing leading frontmatter block: ${file}`);
    return values;
  }

  let currentMap: string | null = null;
  let currentNestedMap: string | null = null;
  const lines = match.groups.body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 2;
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }

    const mapMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
    if (mapMatch) {
      currentMap = mapMatch[1];
      currentNestedMap = null;
      values.set(currentMap, {});
      continue;
    }

    const scalarMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.+?)\s*$/);
    if (scalarMatch) {
      currentMap = null;
      currentNestedMap = null;
      values.set(scalarMatch[1], convertFromFrontmatterScalar(scalarMatch[2], file, lineNumber));
      continue;
    }

    const nestedMapMatch = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
    if (nestedMapMatch) {
      if (!currentMap) {
        addError(`Nested frontmatter map without parent map: ${file}:${lineNumber}`);
      } else {
        currentNestedMap = `${currentMap}.${nestedMapMatch[1]}`;
        values.set(currentNestedMap, {});
      }
      continue;
    }

    const doubleNestedScalarMatch = line.match(/^\s{4,}("[^"]+"|'[^']+'|[^:]+?):\s*(.+?)\s*$/);
    if (doubleNestedScalarMatch) {
      if (!currentNestedMap) {
        addError(`Double-nested frontmatter value without parent map: ${file}:${lineNumber}`);
      } else {
        const rawKey = doubleNestedScalarMatch[1].trim();
        const key = ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) ? rawKey.slice(1, -1) : rawKey;
        values.set(`${currentNestedMap}.${key}`, convertFromFrontmatterScalar(doubleNestedScalarMatch[2], file, lineNumber));
      }
      continue;
    }

    const nestedScalarMatch = line.match(/^\s{2,}([A-Za-z_][A-Za-z0-9_-]*):\s*(.+?)\s*$/);
    if (nestedScalarMatch) {
      if (!currentMap) {
        addError(`Nested frontmatter value without parent map: ${file}:${lineNumber}`);
      } else {
        currentNestedMap = null;
        values.set(`${currentMap}.${nestedScalarMatch[1]}`, convertFromFrontmatterScalar(nestedScalarMatch[2], file, lineNumber));
      }
      continue;
    }

    addError(`Unsupported frontmatter syntax: ${file}:${lineNumber}`);
  }

  return values;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function walkMarkdownFiles(root: string, current = root, result: string[] = []): string[] {
  const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules"].includes(entry.name)) {
        continue;
      }
      walkMarkdownFiles(root, entryPath, result);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(entryPath);
    }
  }
  return result;
}

function walkRepositoryFiles(root: string, current = root, result: string[] = []): string[] {
  const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules"].includes(entry.name)) {
        continue;
      }
      walkRepositoryFiles(root, entryPath, result);
    } else if (entry.isFile()) {
      result.push(entryPath);
    }
  }
  return result;
}

function validateTypeScriptOnlySourceFiles(root: string): void {
  for (const file of walkRepositoryFiles(root)) {
    const extension = path.extname(file).toLowerCase();
    if (forbiddenCodeExtensions.has(extension)) {
      addError(`Non-TypeScript source/tooling file is not allowed: ${toPosixPath(path.relative(root, file))}`);
    }
  }
}

function getMarkdownFiles(root: string): string[] {
  const gitDir = path.join(root, ".git");
  if (fs.existsSync(gitDir)) {
    const gitResult = spawnSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "*.md"], {
      encoding: "utf8",
    });
    if (gitResult.status === 0 && typeof gitResult.stdout === "string") {
      return gitResult.stdout
        .split(/\r?\n/)
        .filter((relative) => relative.trim() !== "")
        .map((relative) => toPosixPath(relative))
        .map((relative) => path.join(root, relative))
        .filter((file) => fs.existsSync(file));
    }
  }

  return walkMarkdownFiles(root).sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCatalogEntries(readmeText: string, startHeading: string, endHeading: string, readmePath: string): string[] {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(startHeading)}\\s*$\\r?\\n(?<body>.*?)^##\\s+${escapeRegExp(endHeading)}\\s*$`, "ms");
  const match = readmeText.match(pattern);
  if (!match?.groups?.body) {
    addError(`Missing README catalog section '${startHeading}': ${readmePath}`);
    return [];
  }

  return Array.from(match.groups.body.matchAll(/^-\s+`([^`]+)`:/gm), (entry) => entry[1]);
}

function getRequiredHeadingSection(readmeText: string, heading: string, readmePath: string): string {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$\\r?\\n(?<body>.*?)(?=^##\\s+|(?![\\s\\S]))`, "ms");
  const match = readmeText.match(pattern);
  if (!match?.groups?.body) {
    addError(`Missing README section '${heading}': ${readmePath}`);
    return "";
  }
  return match.groups.body;
}

function requireBulletedSection(body: string, label: string, file: string): void {
  if (!/^-\s+\S/m.test(body)) {
    addError(`${label} must include at least one bullet: ${file}`);
  }
}

function compareCatalog(label: string, expected: string[], actual: string[], readmePath: string): void {
  const actualCounts = new Map<string, number>();
  for (const name of actual) {
    actualCounts.set(name, (actualCounts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of actualCounts) {
    if (count > 1) {
      addError(`${label} catalog has duplicate '${name}': ${readmePath}`);
    }
  }
  const expectedSorted = [...expected].sort();
  const actualSorted = [...actual].sort();
  for (const name of expectedSorted) {
    if (!actualSorted.includes(name)) {
      addError(`${label} catalog missing '${name}': ${readmePath}`);
    }
  }
  for (const name of actualSorted) {
    if (!expectedSorted.includes(name)) {
      addError(`${label} catalog references missing artifact '${name}': ${readmePath}`);
    }
  }
}

function requireTextContains(text: string, needle: string, label: string, file: string): void {
  if (!text.includes(needle)) {
    addError(`${label} must include '${needle}': ${file}`);
  }
}

function validateTextContracts(file: string, text: string, contracts: TextContract[]): void {
  const fileName = path.basename(file);
  for (const contract of contracts) {
    if (contract.fileName !== fileName) {
      continue;
    }
    for (const requiredText of contract.requiredText) {
      requireTextContains(text, requiredText, contract.label, file);
    }
  }
}

function requireFile(root: string, relativePath: string, label: string): void {
  const target = path.join(root, ...relativePath.split("/"));
  if (!fileExists(target)) {
    addError(`Missing ${label}: ${relativePath}`);
  }
}

function requireDirectory(root: string, relativePath: string, label: string): void {
  const target = path.join(root, ...relativePath.split("/"));
  if (!directoryExists(target)) {
    addError(`Missing ${label}: ${relativePath}`);
  }
}

function getRequiredScalar(frontmatter: FrontmatterMap, key: string, file: string): string | null {
  if (!frontmatter.has(key)) {
    return null;
  }
  const value = frontmatter.get(key);
  if (typeof value !== "string") {
    addError(`Frontmatter field must be a scalar: ${file}:${key}`);
    return null;
  }
  return value;
}

function directoryExists(target: string): boolean {
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

function fileExists(target: string): boolean {
  return fs.existsSync(target) && fs.statSync(target).isFile();
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

function validateSkills(root: string): string[] {
  const skillsDir = path.join(root, "global", "skills");
  if (!directoryExists(skillsDir)) {
    addError(`Missing skills directory: ${skillsDir}`);
    return [];
  }

  const skillNames: string[] = [];
  for (const dir of listDirectories(skillsDir)) {
    const folderName = path.basename(dir);
    skillNames.push(folderName);
    const file = path.join(dir, "SKILL.md");
    if (!fileExists(file)) {
      addError(`Missing SKILL.md for skill folder: ${folderName}`);
      continue;
    }

    const text = readText(file);
    const frontmatter = getFrontmatterMap(text, file);
    const name = getRequiredScalar(frontmatter, "name", file);
    const description = getRequiredScalar(frontmatter, "description", file);
    if (!name || name.trim() === "") {
      addError(`Missing skill name: ${file}`);
    } else if (name !== folderName) {
      addError(`Skill name mismatch: folder=${folderName} name=${name}`);
    } else if (!SKILL_NAME_PATTERN.test(name)) {
      addError(`Invalid skill name format: ${name}`);
    }
    if (!description || description.trim() === "") {
      addError(`Missing skill description: ${file}`);
    } else if (description.length > SKILL_DESCRIPTION_MAX_CHARS) {
      addError(`Skill description exceeds ${SKILL_DESCRIPTION_MAX_CHARS} chars: ${file}`);
    }
    if (!SKILL_TRIGGER_PATTERN.test(text)) {
      addError(`Skill must define explicit trigger text with 'Use this skill/helper': ${file}`);
    }
    if (!SKILL_OUTPUT_CONTRACT_PATTERN.test(text)) {
      addError(`Skill must define an output or ledger contract: ${file}`);
    }
  }

  return skillNames;
}

function validateFeedbackLedgerArtifacts(root: string, skillNames: string[]): void {
  if (!skillNames.includes("complain")) {
    return;
  }
  const skillPath = path.join(root, "global", "skills", "complain", "SKILL.md");
  const readmePath = path.join(root, "docs", "feedbacks", "README.md");
  if (!fileExists(skillPath)) {
    addError(`Missing complain skill file: ${skillPath}`);
    return;
  }
  if (!fileExists(readmePath)) {
    addError(`Missing feedback ledger README: ${readmePath}`);
    return;
  }

  const skillText = readText(skillPath);
  const readmeText = readText(readmePath);
  for (const required of COMPLAIN_SHARED_REQUIRED_TEXT) {
    requireTextContains(skillText, required, "complain skill feedback template", skillPath);
    requireTextContains(readmeText, required, "feedback ledger README template", readmePath);
  }
  for (const required of COMPLAIN_DIRECT_WRITE_CONTRACT_TEXT) {
    requireTextContains(skillText, required, "complain skill direct-write contract", skillPath);
  }
}

function validateReviewerBashPermission(frontmatter: FrontmatterMap, file: string): void {
  for (const [key, expected] of ALLOWED_REVIEWER_BASH_RULES) {
    if (frontmatter.get(key) !== expected) {
      addError(`Agent permission must set ${key.replace("permission.", "")}: ${expected}: ${file}`);
    }
  }
}

function validateSessionDeliveryContextPermission(frontmatter: FrontmatterMap, file: string): void {
  const isSessionDeliveryReviewer = path.basename(file) === "session-delivery-reviewer.md";
  if (isSessionDeliveryReviewer && frontmatter.get("permission.session_delivery_context") !== "allow") {
    addError(`session-delivery-reviewer must allow session_delivery_context custom tool: ${file}`);
  }
  if (!isSessionDeliveryReviewer && frontmatter.has("permission.session_delivery_context")) {
    addError(`Only session-delivery-reviewer may set session_delivery_context permission: ${file}`);
  }
}

function validateComplainSkillPermission(frontmatter: FrontmatterMap, file: string, owner: string): void {
  for (const [key, expected] of ALLOWED_COMPLAIN_SKILL_RULES) {
    if (frontmatter.get(key) !== expected) {
      addError(`${owner} must set ${key.replace("permission.", "")}: ${expected}: ${file}`);
    }
  }
  for (const [key, value] of frontmatter) {
    if (key.startsWith("permission.skill.") && ALLOWED_COMPLAIN_SKILL_RULES.get(key) !== value) {
      addError(`${owner} has unsupported skill permission '${key.replace("permission.skill.", "")}: ${String(value)}': ${file}`);
    }
  }
  if (frontmatter.has("permission.skill") && typeof frontmatter.get("permission.skill") !== "object") {
    addError(`${owner} must use scoped skill permissions, not skill: ${String(frontmatter.get("permission.skill"))}: ${file}`);
  }
}

function validateReviewerFeedbackEditPermission(frontmatter: FrontmatterMap, file: string): void {
  for (const [key, expected] of ALLOWED_REVIEWER_EDIT_RULES) {
    if (frontmatter.get(key) !== expected) {
      addError(`Agent permission must set ${key.replace("permission.", "")}: ${expected}: ${file}`);
    }
  }
  for (const [key, value] of frontmatter) {
    if (key.startsWith("permission.edit.") && ALLOWED_REVIEWER_EDIT_RULES.get(key) !== value) {
      addError(`Agent has unsupported edit permission '${key.replace("permission.edit.", "")}: ${String(value)}': ${file}`);
    }
  }
  if (frontmatter.has("permission.edit") && typeof frontmatter.get("permission.edit") !== "object") {
    addError(`Agent permission must use scoped edit permissions, not edit: ${String(frontmatter.get("permission.edit"))}: ${file}`);
  }
}

function validateImplementationWorker(frontmatter: FrontmatterMap, text: string, file: string): void {
  if (frontmatter.get("permission.edit") !== "allow") {
    addError(`Implementation worker must set edit: allow: ${file}`);
  }
  for (const [key, expected] of ALLOWED_IMPLEMENTATION_WORKER_BASH_RULES) {
    if (frontmatter.get(key) !== expected) {
      addError(`Implementation worker must set ${key.replace("permission.", "")}: ${expected}: ${file}`);
    }
  }
  for (const [key, value] of frontmatter) {
    if (key.startsWith("permission.bash.") && ALLOWED_IMPLEMENTATION_WORKER_BASH_RULES.get(key) !== value) {
      addError(`Implementation worker has unsupported bash permission '${key.replace("permission.bash.", "")}: ${String(value)}': ${file}`);
    }
  }
  validateComplainSkillPermission(frontmatter, file, "Implementation worker");
  for (const permission of IMPLEMENTATION_WORKER_DENIED_PERMISSION_KEYS) {
    const key = `permission.${permission}`;
    if (frontmatter.get(key) !== "deny") {
      addError(`Implementation worker must set ${permission}: deny: ${file}`);
    }
  }
  for (const required of IMPLEMENTATION_WORKER_REQUIRED_TEXT) {
    requireTextContains(text, required, "Implementation worker contract", file);
  }
}

function validateAgents(root: string): string[] {
  const agentsDir = path.join(root, "global", "agents");
  if (!directoryExists(agentsDir)) {
    addError(`Missing agents directory: ${agentsDir}`);
    return [];
  }

  const agentNames: string[] = [];
  for (const file of listFiles(agentsDir, ".md")) {
    agentNames.push(path.basename(file, ".md"));
    const text = readText(file);
    const frontmatter = getFrontmatterMap(text, file);
    const description = getRequiredScalar(frontmatter, "description", file);
    const mode = getRequiredScalar(frontmatter, "mode", file);
    if (!description || description.trim() === "") {
      addError(`Missing agent description: ${file}`);
    }
    if (mode !== "subagent") {
      addError(`Reusable reviewer agent must use mode: subagent: ${file}`);
    }
    for (const permission of ["read", "glob", "grep"]) {
      const key = `permission.${permission}`;
      if (frontmatter.get(key) !== "allow") {
        addError(`Agent permission must set ${permission}: allow: ${file}`);
      }
    }
    for (const obsolete of REVIEWER_OBSOLETE_PERMISSION_KEYS) {
      const key = `permission.${obsolete}`;
      if (frontmatter.has(key)) {
        addError(`Agent permission must not set obsolete permission.${obsolete}; directory listing is covered by read: ${file}`);
      }
    }
    validateSessionDeliveryContextPermission(frontmatter, file);
    if (path.basename(file) === IMPLEMENTATION_WORKER_FILE) {
      validateImplementationWorker(frontmatter, text, file);
      continue;
    }
    validateReviewerBashPermission(frontmatter, file);
    validateReviewerFeedbackEditPermission(frontmatter, file);
    validateComplainSkillPermission(frontmatter, file, "Agent permission");
    for (const permission of REVIEWER_DENIED_PERMISSION_KEYS) {
      const key = `permission.${permission}`;
      if (frontmatter.get(key) !== "deny") {
        addError(`Agent permission must set ${permission}: deny: ${file}`);
      }
    }
    for (const required of REUSABLE_REVIEWER_LEAF_CONTRACT_TEXT) {
      requireTextContains(text, required, "Reusable reviewer leaf contract", file);
    }
    if (REUSABLE_REVIEWER_FORBIDDEN_BOILERPLATE.some((pattern) => pattern.test(text))) {
      addError(`Reusable reviewer agent must use the compact Leaf Contract instead of old boilerplate: ${file}`);
    }
    validateTextContracts(file, text, AGENT_TEXT_CONTRACTS);
  }

  return agentNames;
}

function getInstructionNames(root: string): string[] {
  const instructionsDir = path.join(root, "instructions");
  if (!directoryExists(instructionsDir)) {
    return [];
  }
  return listFiles(instructionsDir, ".md").map((file) => path.basename(file));
}

function validateReadme(root: string, skillNames: string[], agentNames: string[], instructionNames: string[]): void {
  const readmePath = path.join(root, "README.md");
  if (!fileExists(readmePath)) {
    addError(`Missing README.md: ${readmePath}`);
    return;
  }

  const readmeText = readText(readmePath);
  const routingMap = getRequiredHeadingSection(readmeText, "Routing Map", readmePath);
  const reviewerGateMap = getRequiredHeadingSection(readmeText, "Reviewer Gate Map", readmePath);
  requireBulletedSection(routingMap, "README routing map", readmePath);
  requireBulletedSection(reviewerGateMap, "README reviewer gate map", readmePath);
  requireTextContains(routingMap, "instruction-artifact-tuning", "README instruction-artifact route", readmePath);
  requireTextContains(routingMap, "instruction-artifact-audit-runbook.md", "README instruction-artifact route", readmePath);
  requireTextContains(reviewerGateMap, "instruction-artifact-reviewer", "README reviewer gate map", readmePath);
  compareCatalog("Skill", skillNames, getCatalogEntries(readmeText, "Skill Catalog", "Agent Catalog", readmePath), readmePath);
  compareCatalog("Agent", agentNames, getCatalogEntries(readmeText, "Agent Catalog", "Instruction Templates", readmePath), readmePath);
  compareCatalog("Instruction template", instructionNames, getCatalogEntries(readmeText, "Instruction Templates", "Porting Notes", readmePath), readmePath);
}

function validateAgentsMd(root: string): void {
  const agentsPath = path.join(root, "AGENTS.md");
  if (!fileExists(agentsPath)) {
    addError(`Missing AGENTS.md: ${agentsPath}`);
    return;
  }

  const agentsText = readText(agentsPath);
  requireTextContains(agentsText, "## Autonomous Work Contract", "AGENTS.md autonomous work contract", agentsPath);
  requireTextContains(agentsText, "Ask the user only", "AGENTS.md autonomous work contract", agentsPath);
  requireTextContains(agentsText, "## Completion Handoff", "AGENTS.md completion handoff contract", agentsPath);
  requireTextContains(agentsText, "`question`", "AGENTS.md completion handoff contract", agentsPath);
  requireTextContains(agentsText, "(Recommended)", "AGENTS.md completion handoff contract", agentsPath);
  requireTextContains(agentsText, "Suggested Next Options", "AGENTS.md completion handoff contract", agentsPath);
  requireTextContains(agentsText, "Actionable Continuation Items", "AGENTS.md completion handoff contract", agentsPath);
  requireTextContains(agentsText, "## TypeScript Development", "AGENTS.md TypeScript-only development policy", agentsPath);
  requireTextContains(agentsText, "TypeScript", "AGENTS.md TypeScript-only development policy", agentsPath);
  requireTextContains(agentsText, "PowerShell", "AGENTS.md TypeScript-only development policy", agentsPath);
  requireTextContains(agentsText, "Python", "AGENTS.md TypeScript-only development policy", agentsPath);
  requireTextContains(agentsText, "JavaScript", "AGENTS.md TypeScript-only development policy", agentsPath);
  requireTextContains(agentsText, "## Deterministic Helper Automation", "AGENTS.md deterministic helper automation policy", agentsPath);
  requireTextContains(agentsText, "repetitive, evidence-heavy", "AGENTS.md deterministic helper automation policy", agentsPath);
  requireTextContains(agentsText, "no hidden heuristics", "AGENTS.md deterministic helper automation policy", agentsPath);
  requireTextContains(agentsText, "explicit inputs", "AGENTS.md deterministic helper automation policy", agentsPath);
  requireTextContains(agentsText, "explicit outputs", "AGENTS.md deterministic helper automation policy", agentsPath);
  requireTextContains(agentsText, "privacy-safe output", "AGENTS.md deterministic helper automation policy", agentsPath);
  requireTextContains(agentsText, "fuzzy scoring", "AGENTS.md deterministic helper automation policy", agentsPath);
  requireTextContains(agentsText, "model-like summarization", "AGENTS.md deterministic helper automation policy", agentsPath);
  for (const fallback of ["unknown", "unreadable", "unsupported", "blocked"]) {
    requireTextContains(agentsText, fallback, "AGENTS.md deterministic helper automation fallback policy", agentsPath);
  }
  requireTextContains(agentsText, "npm run instruction:feedback -- --add", "AGENTS.md prevention feedback ledger handoff", agentsPath);
  requireTextContains(agentsText, "applied -> replayed -> resolved", "AGENTS.md replay gate policy", agentsPath);
  requireTextContains(agentsText, "## Feedback Ledger", "AGENTS.md feedback ledger policy", agentsPath);
  requireTextContains(agentsText, "complain", "AGENTS.md feedback ledger policy", agentsPath);
  requireTextContains(agentsText, "docs/feedbacks", "AGENTS.md feedback ledger policy", agentsPath);
  requireTextContains(agentsText, "Recurrence: unknown", "AGENTS.md feedback ledger policy", agentsPath);

  if (/after (a )?non-trivial user-visible work( cycle)?,? (the main session offers|offer|use the built-in `?question`?|before stopping)/i.test(agentsText)) {
    addError(`AGENTS.md must not require routine post-task question handoff: ${agentsPath}`);
  }
}

function validateInstructionFeedbackContracts(root: string): void {
  const helperPath = path.join(root, "tools", "instruction-feedback-ledger.ts");
  if (fileExists(helperPath)) {
    const helperText = readText(helperPath);
    for (const required of ["--add", "--pending", "--decay-report", "--check-bloat", "--replay-pending", "duplicate", "routeRuleWrite", "unsupportedRequest"]) {
      requireTextContains(helperText, required, "instruction-feedback ledger helper CLI surface", helperPath);
    }
  }
}

function validateInstallerConfigDirModel(root: string): void {
  const installerPath = path.join(root, "tools", "install-opencode-global.ts");
  if (!fileExists(installerPath)) {
    return;
  }
  const text = readText(installerPath);
  if (!text.includes("OPENCODE_CONFIG_DIR")) {
    addError("install-opencode-global must point OPENCODE_CONFIG_DIR at the repository global/ directory (config-dir pointing model, not file copy).");
  }
  if (!text.includes('"global"') && !text.includes("'global'") && !text.includes("`global`")) {
    addError("install-opencode-global must reference the repository global/ directory as the OPENCODE_CONFIG_DIR target.");
  }
  const globalDir = path.join(root, "global");
  if (!directoryExists(globalDir)) {
    addError(`Missing global config directory: ${globalDir}`);
    return;
  }
  for (const required of ["skills", "agents", "AGENTS.md", "opencode.json.template"]) {
    const candidate = path.join(globalDir, required);
    if (!fileExists(candidate) && !directoryExists(candidate)) {
      addError(`Missing global/${required}: the OPENCODE_CONFIG_DIR target must contain it.`);
    }
  }
}

function validatePackageScripts(root: string): void {
  const packagePath = path.join(root, "package.json");
  if (!fileExists(packagePath)) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(packagePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addError(`Invalid package.json: ${packagePath}: ${message}`);
    return;
  }

  if (!parsed || typeof parsed !== "object" || !("scripts" in parsed)) {
    return;
  }

  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object") {
    return;
  }

  for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== "string") {
      continue;
    }
    if (/(^|\s)(pwsh|powershell)(\s|$)|\.(ps1|psd1|psm1|py|pyw|js|cjs|mjs)\b/i.test(value)) {
      addError(`Package script '${name}' must use TypeScript tooling, not PowerShell, Python, or JavaScript entrypoints: ${packagePath}`);
    }
  }
}

function readPackageScripts(root: string): Record<string, string> {
  const packagePath = path.join(root, "package.json");
  if (!fileExists(packagePath)) {
    addError(`Missing package.json for opencode-dev-kit tooling: ${packagePath}`);
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(packagePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addError(`Invalid package.json: ${packagePath}: ${message}`);
    return {};
  }
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.scripts)) {
    addError(`package.json must define scripts for opencode-dev-kit tooling: ${packagePath}`);
    return {};
  }
  const scripts: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed.scripts)) {
    if (typeof value === "string") {
      scripts[name] = value;
    }
  }
  return scripts;
}

function validateDevKitContract(root: string): void {
  requireFile(root, "instructions/universal-development-loop.md", "Universal Development Loop instruction");
  requireFile(root, "templates/project/AGENTS.md", "project AGENTS.md template");
  requireFile(root, "templates/project/opencode.json", "project opencode.json template");
  requireFile(root, "templates/project/docs/feedbacks/README.md", "project feedback ledger template");
  requireFile(root, "templates/project/validation.md", "project validation template");
  requireFile(root, "templates/project/adapter.json", "project adapter template");
  requireFile(root, "templates/ci/github-actions.yml", "CI template");
  requireDirectory(root, "profiles", "install profiles directory");
  requireFile(root, "profiles/all.json", "all install profile");
  requireFile(root, "tools/init-project.ts", "project bootstrap tool");
  requireFile(root, "tools/doctor.ts", "doctor tool");
  requireFile(root, "tools/project-inventory.ts", "project inventory tool");
  requireFile(root, "tools/instruction-artifacts-inventory.ts", "instruction inventory tool");
  requireFile(root, "tools/pre-push-validate.ts", "pre-push validation tool");
  requireFile(root, ".githooks/pre-push", "tracked pre-push hook");

  const universalLoop = path.join(root, "instructions", "universal-development-loop.md");
  if (fileExists(universalLoop)) {
    const text = readText(universalLoop);
    for (const required of ["Intake", "Evidence", "Baseline Proof", "Small Slice", "Test First", "Focused Validation", "Review Gate", "Handoff", "Process Improvement"]) {
      requireTextContains(text, required, "Universal Development Loop", universalLoop);
    }
  }

  const projectTemplate = path.join(root, "templates", "project", "AGENTS.md");
  if (fileExists(projectTemplate)) {
    const projectTemplateText = readText(projectTemplate);
    requireTextContains(projectTemplateText, "Universal Development Loop", "project AGENTS.md template", projectTemplate);
    requireTextContains(projectTemplateText, "Do not commit, push, merge, delete source artifacts, or alter remote state unless explicitly requested", "project AGENTS.md remote/destructive guard", projectTemplate);
  }

  const projectFeedbackTemplate = path.join(root, "templates", "project", "docs", "feedbacks", "README.md");
  if (fileExists(projectFeedbackTemplate)) {
    const text = readText(projectFeedbackTemplate);
    for (const required of ["Feedback Ledger", "complain", "Recurrence: unknown", "raw private prompts", "large logs", "personal blame"]) {
      requireTextContains(text, required, "project feedback ledger template", projectFeedbackTemplate);
    }
  }

  const adapterTemplate = path.join(root, "templates", "project", "adapter.json");
  if (fileExists(adapterTemplate)) {
    const adapter = readJsonRecord(adapterTemplate);
    if (adapter) {
      if (adapter.schemaVersion !== 1) {
        addError(`Project adapter template must use schemaVersion 1: ${adapterTemplate}`);
      }
      if (!isPlainRecord(adapter.validation)) {
        addError(`Project adapter template must define validation commands object: ${adapterTemplate}`);
      }
    }
  }

  const opencodeTemplate = path.join(root, "templates", "project", "opencode.json");
  if (fileExists(opencodeTemplate)) {
    const config = readJsonRecord(opencodeTemplate);
    if (config && config.$schema !== "https://opencode.ai/config.json") {
      addError(`Project opencode.json template must declare the OpenCode schema: ${opencodeTemplate}`);
    }
  }

  const readmePath = path.join(root, "README.md");
  if (fileExists(readmePath)) {
    const readme = readText(readmePath);
    for (const heading of ["What This Is", "Universal Development Loop", "Install", "Bootstrap A Project", "Token Economy", "Validate"]) {
      requireTextContains(readme, `## ${heading}`, "README opencode-dev-kit quickstart", readmePath);
    }
    requireTextContains(readme, "opencode-dev-kit", "README product framing", readmePath);
  }

  const scripts = readPackageScripts(root);
  for (const script of ["install:global", "init:project", "doctor", "project:inventory", "instruction:inventory", "instruction:feedback", "code-quality:inventory", "openspec:validate", "openspec:gate", "prepush:validate", "validate", "validate:strict", "test"]) {
    if (!scripts[script]) {
      addError(`package.json missing required opencode-dev-kit script '${script}'`);
    }
  }
  if (scripts["openspec:validate"] && scripts["openspec:validate"] !== "openspec validate --all") {
    addError("package.json script 'openspec:validate' must run openspec validate --all.");
  }
  if (scripts["openspec:gate"] && scripts["openspec:gate"] !== "node tools/openspec-operation-gate.ts") {
    addError("package.json script 'openspec:gate' must run node tools/openspec-operation-gate.ts.");
  }
  if (scripts["instruction:feedback"] && scripts["instruction:feedback"] !== "node tools/instruction-feedback-ledger.ts") {
    addError("package.json script 'instruction:feedback' must run node tools/instruction-feedback-ledger.ts.");
  }
  if (scripts.test && !/(^|&&)\s*node\s+tools\/test-instruction-feedback-ledger\.ts(\s|$|&&)/.test(scripts.test)) {
    addError("package.json script 'test' must include node tools/test-instruction-feedback-ledger.ts.");
  }
  if (scripts.test && !/(^|&&)\s*node\s+tools\/test-install-opencode-global\.ts(\s|$|&&)/.test(scripts.test)) {
    addError("package.json script 'test' must include node tools/test-install-opencode-global.ts.");
  }
  if (scripts["validate:strict"] && !scripts["validate:strict"].includes("--fail-on-warnings")) {
    addError("package.json script 'validate:strict' must pass --fail-on-warnings.");
  }
}

function readJsonRecord(file: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(file));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addError(`Invalid JSON: ${file}: ${message}`);
    return null;
  }
  if (!isPlainRecord(parsed)) {
    addError(`JSON file must contain an object: ${file}`);
    return null;
  }
  return parsed;
}

function validateStringArray(value: unknown, file: string, key: string): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    addError(`Profile field '${key}' must be an array of non-empty strings: ${file}`);
    return [];
  }
  return value;
}

function findDuplicateStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort((left, right) => left.localeCompare(right));
}

function compareStringSets(actual: string[], expected: string[]): { extra: string[]; missing: string[] } {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    extra: [...actualSet].filter((value) => !expectedSet.has(value)).sort((left, right) => left.localeCompare(right)),
    missing: [...expectedSet].filter((value) => !actualSet.has(value)).sort((left, right) => left.localeCompare(right)),
  };
}

function validateProfiles(root: string, skillNames: string[], agentNames: string[]): void {
  const profilesDir = path.join(root, "profiles");
  if (!directoryExists(profilesDir)) {
    return;
  }
  const profileFiles = listFiles(profilesDir, ".json");
  const profileNames = new Set(profileFiles.map((file) => path.basename(file, ".json")));
  const allowedKeys = new Set(["agents", "description", "extends", "name", "skills"]);
  const extendsMap = new Map<string, string>();
  const profileSkillsMap = new Map<string, string[] | undefined>();
  const profileAgentsMap = new Map<string, string[] | undefined>();
  const skillSet = new Set(skillNames);
  const agentSet = new Set(agentNames);

  if (profileNames.size !== 1 || !profileNames.has("all")) {
    addError("Install profiles must contain exactly profiles/all.json; restricted standard/strict/advanced profiles are not supported.");
  }

  for (const file of profileFiles) {
    const name = path.basename(file, ".json");
    const profile = readJsonRecord(file);
    if (!profile) {
      continue;
    }
    for (const key of Object.keys(profile)) {
      if (!allowedKeys.has(key)) {
        addError(`Unsupported profile field '${key}': ${file}`);
      }
    }
    if (typeof profile.name !== "string" || profile.name !== name) {
      addError(`Profile name must match filename '${name}': ${file}`);
    }
    if (profile.description != null && typeof profile.description !== "string") {
      addError(`Profile description must be a string: ${file}`);
    }
    if (profile.extends != null) {
      if (typeof profile.extends !== "string" || profile.extends.trim() === "") {
        addError(`Profile extends must be a non-empty string: ${file}`);
      } else if (!profileNames.has(profile.extends)) {
        addError(`Profile extends missing profile '${profile.extends}': ${file}`);
      } else {
        extendsMap.set(name, profile.extends);
      }
    }
    const skills = validateStringArray(profile.skills, file, "skills");
    profileSkillsMap.set(name, profile.skills == null ? undefined : skills);
    const duplicateSkills = findDuplicateStrings(skills);
    if (duplicateSkills.length > 0) {
      addError(`Profile has duplicate skills ${duplicateSkills.join(", ")}: ${file}`);
    }
    for (const skill of skills) {
      if (!skillSet.has(skill)) {
        addError(`Profile references missing skill '${skill}': ${file}`);
      }
    }
    const agents = validateStringArray(profile.agents, file, "agents");
    profileAgentsMap.set(name, profile.agents == null ? undefined : agents);
    const duplicateAgents = findDuplicateStrings(agents);
    if (duplicateAgents.length > 0) {
      addError(`Profile has duplicate agents ${duplicateAgents.join(", ")}: ${file}`);
    }
    for (const agent of agents) {
      if (!agentSet.has(agent)) {
        addError(`Profile references missing agent '${agent}': ${file}`);
      }
    }
  }

  const allProfilePath = path.join(profilesDir, "all.json");
  if (profileNames.has("all")) {
    const allSkills = profileSkillsMap.get("all");
    const allAgents = profileAgentsMap.get("all");
    if (allSkills == null || allAgents == null) {
      addError(`profiles/all.json must explicitly list every skill and every agent: ${allProfilePath}`);
    } else {
      const skillDiff = compareStringSets(allSkills, skillNames);
      const agentDiff = compareStringSets(allAgents, agentNames);
      if (skillDiff.missing.length > 0 || skillDiff.extra.length > 0) {
        addError(`profiles/all.json must match repository skills. Missing: ${skillDiff.missing.join(", ") || "none"}. Extra: ${skillDiff.extra.join(", ") || "none"}.`);
      }
      if (agentDiff.missing.length > 0 || agentDiff.extra.length > 0) {
        addError(`profiles/all.json must match repository agents. Missing: ${agentDiff.missing.join(", ") || "none"}. Extra: ${agentDiff.extra.join(", ") || "none"}.`);
      }
    }
  }

  for (const profile of profileNames) {
    const seen = new Set<string>();
    let current: string | undefined = profile;
    while (current) {
      if (seen.has(current)) {
        addError(`Profile inheritance cycle: ${[...seen, current].join(" -> ")}`);
        break;
      }
      seen.add(current);
      current = extendsMap.get(current);
    }
  }
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaping = false;
  for (let index = 0; index < text.length; index++) {
    const current = text[index];
    const next = text[index + 1];
    if (inString) {
      output += current;
      if (escaping) {
        escaping = false;
      } else if (current === "\\") {
        escaping = true;
      } else if (current === quote) {
        inString = false;
      }
      continue;
    }
    if (current === '"' || current === "'") {
      inString = true;
      quote = current;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        index++;
      }
      output += "\n";
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      let closed = false;
      while (index < text.length) {
        if (text[index] === "*" && text[index + 1] === "/") {
          closed = true;
          break;
        }
        output += text[index] === "\n" ? "\n" : " ";
        index++;
      }
      if (!closed) {
        throw new Error("Unterminated JSONC block comment.");
      }
      index++;
      continue;
    }
    output += current;
  }
  return output;
}

function stripJsonTrailingCommas(text: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaping = false;
  for (let index = 0; index < text.length; index++) {
    const current = text[index];
    if (inString) {
      output += current;
      if (escaping) {
        escaping = false;
      } else if (current === "\\") {
        escaping = true;
      } else if (current === quote) {
        inString = false;
      }
      continue;
    }
    if (current === '"' || current === "'") {
      inString = true;
      quote = current;
      output += current;
      continue;
    }
    if (current === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) {
        lookahead++;
      }
      if (text[lookahead] === "}" || text[lookahead] === "]") {
        continue;
      }
    }
    output += current;
  }
  return output;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function validateOpenCodePermissionRules(config: unknown, file: string): void {
  if (!isPlainRecord(config)) {
    return;
  }
  const machineOverride = hasMachineOverride(config);
  const notePermission = machineOverride
    ? (message: string): void => { addInfo(message); }
    : (message: string): void => { addWarning(message); };
  const permission = config.permission;
  if (permission === "allow") {
    notePermission(`OpenCode permission config uses top-level allow; this allows all tools by default: ${file}`);
    return;
  }
  if (!isPlainRecord(permission)) {
    return;
  }
  if (permission["*"] === "allow") {
    notePermission(`OpenCode permission config permission.* uses wildcard allow; all otherwise-unmatched tools are allowed: ${file}`);
  }
  for (const [permissionKey, value] of Object.entries(permission)) {
    if (!mutationCapablePermissionKeys.has(permissionKey)) {
      continue;
    }
    if (value === "allow") {
      notePermission(`OpenCode permission config permission.${permissionKey} uses tool-wide allow; unmatched operations are allowed: ${file}`);
      continue;
    }
    if (!isPlainRecord(value)) {
      continue;
    }
    const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    const wildcardAllowIndex = entries.findIndex(([pattern, action]) => pattern === "*" && action === "allow");
    if (wildcardAllowIndex < 0) {
      continue;
    }
    const protectiveIndex = entries.findIndex(([pattern, action]) => pattern !== "*" && (action === "ask" || action === "deny"));
    if (protectiveIndex < 0) {
      notePermission(`OpenCode permission config permission.${permissionKey} uses wildcard allow; unmatched operations are allowed: ${file}`);
    } else if (wildcardAllowIndex > protectiveIndex) {
      notePermission(`OpenCode permission config permission.${permissionKey} places wildcard allow after narrower ask/deny rules; last matching permission rule can override protections: ${file}`);
    } else {
      notePermission(`OpenCode permission config permission.${permissionKey} uses wildcard allow with narrower ask/deny rules; unmatched operations are allowed: ${file}`);
    }
  }
}

function validateOpenCodeConfigFiles(root: string): void {
  for (const file of walkRepositoryFiles(root)) {
    if (path.basename(file) !== "opencode.json" && path.basename(file) !== "opencode.jsonc") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonTrailingCommas(stripJsonComments(readText(file))));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addError(`Invalid OpenCode config JSON: ${file}: ${message}`);
      continue;
    }
    validateOpenCodePermissionRules(parsed, file);
  }
}

function jsonReplacementForAutomationMarkdown(relative: string): string | null {
  const openspecMatch = relative.match(/^(openspec\/changes\/[^/]+\/automation\/.+)\.md$/);
  if (openspecMatch) {
    return `${openspecMatch[1]}.json`;
  }
  return null;
}

function validateMarkdownFile(root: string, file: string, forbiddenAnchors: string[]): void {
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const text = lines.join("\n");
  const relative = toPosixPath(path.relative(root, file));
  const jsonReplacement = jsonReplacementForAutomationMarkdown(relative);
  if (jsonReplacement != null) {
    addError(`OpenSpec automation wrapper Markdown artifact is not allowed: ${relative}. Use ${jsonReplacement} with schemaVersion instead.`);
  }

  for (let index = 0; index < lines.length; index++) {
    if (/[ \t]+$/.test(lines[index])) {
      addError(`Trailing whitespace: ${file}:${index + 1}`);
    }
  }

  for (const anchor of forbiddenAnchors) {
    if (anchor.trim() !== "" && text.includes(anchor)) {
      addError(`Forbidden anchor '${anchor}' found in ${file}`);
    }
  }

  const isInstructionArtifact = /^(?:global|\.opencode)\/(skills|agents)\//.test(relative) ||
    /^instructions\//.test(relative) ||
    ["AGENTS.md", "README.md"].includes(relative);
  if (isInstructionArtifact) {
    for (const reference of legacyToolingReferences) {
      if (text.includes(reference)) {
        addError(`Legacy non-TypeScript tooling reference '${reference}' found in ${file}`);
      }
    }
  }

  const implementationLanguage = /\b(implement|implementation|code changes?|behavior-changing|behavior changes?|fixes are allowed|edit workers?|write scope|make the smallest correct change)\b/i;
  const negatedScopeLanguage = /\b(non-goals?|out of scope|not in scope|excluded|do not|must not|never)\b/i;
  const mentionsImplementation = lines.some((line) => implementationLanguage.test(line) && !negatedScopeLanguage.test(line));
  const mentionsTdd = /\b(TDD|test-first|validation-first|tests? before|failing tests?[^.\n]{0,80}\bbefore\b|(?:tests?|benchmarks?|manual gates?|golden vectors?|fixtures?)[^.\n]{0,120}\bbefore\b|\bbefore\b[^.\n]{0,120}(?:tests?|benchmarks?|manual gates?|golden vectors?|fixtures?))\b/is.test(text);

  if (isInstructionArtifact && mentionsImplementation && !mentionsTdd) {
    addWarning(`Implementation-related artifact language lacks TDD/test-first language: ${file}`);
  }
  if (isInstructionArtifact && /after (a )?non-trivial user-visible work( cycle)?,? (the main session offers|offer|use the built-in `?question`?|before stopping)/i.test(text)) {
    addError(`Instruction artifact must not require routine post-task question handoff: ${file}`);
  }
  if (isInstructionArtifact && /(^#{2,4}\s+.*Self-Improvement\s*$|Self-improvement while context is hot|Core principle\s+[-\u2014]\s+do not remove)/im.test(text)) {
    addError(`Instruction artifact must not include automatic self-improvement/self-edit loops: ${file}`);
  }
  if (isInstructionArtifact && /\bshared URLs?\b/i.test(text)) {
    const hasSharedUrlApproval = /user-approved shared URLs?/i.test(text) ||
      /fetch remote\/shared URLs?.{0,160}(explicitly grants|explicit permission|user approved|user-approved|approved)/is.test(text);
    const hasSharedUrlProhibition = /(never|do not|must not|out of scope|exclude|excluded|not in scope).{0,120}shared URLs?/is.test(text) ||
      /shared URLs?.{0,120}(out of scope|excluded|not in scope|must not|never)/is.test(text);
    if (!hasSharedUrlApproval && !hasSharedUrlProhibition) {
      addError(`Instruction artifact mentioning shared URLs must require user-approved remote/shared URL access: ${file}`);
    }
  }

}

function validateImplementationWorkerRouting(root: string, agentNames: string[]): void {
  if (!agentNames.includes("implementation-worker")) {
    return;
  }

  for (const relative of [
    "AGENTS.md",
    "global/AGENTS.md",
    "instructions/reusable-project-agent-instructions.md",
    "templates/project/AGENTS.md",
  ]) {
    const file = path.join(root, relative);
    if (!fileExists(file)) {
      continue;
    }
    const text = readText(file);
    requireTextContains(text, "implementation-worker", "implementation-worker routing", file);
    for (const required of IMPLEMENTATION_WORKER_ROUTING_REQUIRED_TEXT) {
      if (required === "implementation-worker") continue;
      requireTextContains(text, required, "implementation-worker routing", file);
    }
    for (const field of IMPLEMENTATION_WORKER_HANDOFF_FIELDS) {
      requireTextContains(text, field, "implementation-worker handoff fields", file);
    }
  }

  const orchestratorPath = path.join(root, "global", "skills", "orchestrator", "SKILL.md");
  if (fileExists(orchestratorPath)) {
    const text = readText(orchestratorPath);
    requireTextContains(text, "implementation-worker", "orchestrator implementation-worker routing", orchestratorPath);
    requireTextContains(text, "IMPLEMENTATION_WORKER_REPORT", "orchestrator implementation-worker report contract", orchestratorPath);
    requireTextContains(text, "Run", "orchestrator implementation-worker report contract", orchestratorPath);
    requireTextContains(text, "Worker", "orchestrator implementation-worker report contract", orchestratorPath);
  }
}

function validateSessionDeliveryBinding(root: string, agentNames: string[]): void {
  if (!agentNames.includes("session-delivery-reviewer")) {
    return;
  }

  for (const relative of [
    "AGENTS.md",
    "global/AGENTS.md",
    "instructions/reusable-project-agent-instructions.md",
    "instructions/universal-development-loop.md",
    "templates/project/AGENTS.md",
  ]) {
    const file = path.join(root, relative);
    if (!fileExists(file)) {
      continue;
    }
    const text = readText(file);
    requireTextContains(text, "session-delivery-reviewer", "session-delivery-reviewer binding handoff", file);
    for (const token of SESSION_DELIVERY_BINDING_HANDOFF_TOKENS) {
      requireTextContains(text, token, "session-delivery-reviewer binding handoff", file);
    }
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const root = options.root;
  const skillNames = validateSkills(root);
  validateFeedbackLedgerArtifacts(root, skillNames);
  const agentNames = validateAgents(root);
  const instructionNames = getInstructionNames(root);
  validateTypeScriptOnlySourceFiles(root);
  validatePackageScripts(root);
  validateDevKitContract(root);
  validateProfiles(root, skillNames, agentNames);
  validateImplementationWorkerRouting(root, agentNames);
  validateSessionDeliveryBinding(root, agentNames);
  validateOpenCodeConfigFiles(root);
  validateReadme(root, skillNames, agentNames, instructionNames);
  validateAgentsMd(root);
  validateInstructionFeedbackContracts(root);
  validateInstallerConfigDirModel(root);

  const markdownFiles = getMarkdownFiles(root);
  for (const file of markdownFiles) {
    validateMarkdownFile(root, file, options.forbiddenAnchors);
  }

  for (const warning of warnings) {
    console.log(`WARN: ${warning}`);
  }

  for (const info of infos) {
    console.log(`INFO: ${info}`);
  }

  if (options.failOnWarnings && warnings.length > 0) {
    addError(`Warnings are not allowed in strict validation mode: ${warnings.length} warning(s).`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.log(`ERROR: ${error}`);
    }
    process.exit(1);
  }

  console.log(`OK: skills=${skillNames.length} agents=${agentNames.length} markdown=${markdownFiles.length} warnings=${warnings.length} infos=${infos.length}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
