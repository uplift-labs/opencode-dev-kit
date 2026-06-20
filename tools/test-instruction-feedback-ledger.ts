#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addLedgerEntry,
  advanceLedgerEntry,
  createStillFailingEntry,
  decayReport,
  loadLedger,
  routeRuleWrite,
  unsupportedRequest,
  writeLedger,
} from "./instruction-feedback-ledger.ts";

type TestCase = {
  name: string;
  run: () => void;
};

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const ledgerCli = path.join(toolDir, "instruction-feedback-ledger.ts");

function withTempLedger(name: string, run: (ledgerPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `instruction-feedback-ledger-${name}-`));
  try {
    run(path.join(dir, "ledger.json"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function withTempRepo(name: string, run: (repo: string) => void): void {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `instruction-feedback-repo-${name}-`));
  try {
    run(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content.trimEnd()}\n`, "utf8");
}

function runGit(repo: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
}

function commitBaseline(repo: string): void {
  runGit(repo, ["init"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline"]);
}

function writeBloatChange(repo: string, changeId: string, extraProposal = ""): void {
  writeText(path.join(repo, "openspec", "changes", changeId, "proposal.md"), `# Proposal: ${changeId}

## What Changes

- Update \`AGENTS.md\` with prevention routing guidance.
${extraProposal}
`);
}

function invokeLedgerCli(repo: string, args: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [ledgerCli, "--root", repo, ...args], { cwd: repo, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

function baseEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceRef: "review-run-1",
    sourceArtifact: "code-quality-reviewer",
    findingSummary: "Reviewer missed reusable instruction drift",
    rootCause: "reviewer contract lacked prevention routing",
    targetArtifact: "agent:code-quality-reviewer",
    costBand: "cheap",
    draftRule: "For P1 findings, return Prevention Feedback with replay evidence.",
    replayEvidenceRef: "diff:agents/code-quality-reviewer.md",
    route: "instant",
    routeReason: "cheap single-agent rule",
    owner: "this-repo",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const tests: TestCase[] = [
  {
    name: "loads missing ledger as versioned empty schema",
    run: () => withTempLedger("load-empty", (ledgerPath) => {
      const ledger = loadLedger(ledgerPath);
      assertEqual(ledger.schemaVersion, 1, "Missing ledger must load as schemaVersion 1.");
      assertEqual(ledger.entries.length, 0, "Missing ledger must have no entries.");
    }),
  },
  {
    name: "detects duplicate findings by exact normalized summary and target",
    run: () => withTempLedger("duplicate", (ledgerPath) => {
      let ledger = loadLedger(ledgerPath);
      const first = addLedgerEntry(ledger, baseEntry(), "2026-01-01T00:00:00.000Z");
      const second = addLedgerEntry(ledger, baseEntry({
        sourceRef: "review-run-2",
        findingSummary: "  reviewer   MISSED reusable instruction drift  ",
      }), "2026-01-01T00:00:01.000Z");
      assertEqual(first.entry.status, "open", "First entry must stay open.");
      assertEqual(second.entry.status, "duplicate-of", "Duplicate entry must be marked duplicate-of.");
      assertEqual(second.entry.duplicateOf, first.entry.id, "Duplicate entry must point to original id.");
      writeLedger(ledgerPath, ledger);
      ledger = loadLedger(ledgerPath);
      assertEqual(ledger.entries.length, 2, "Both ledger entries must persist for auditability.");
    }),
  },
  {
    name: "enforces replay status transitions",
    run: () => withTempLedger("transitions", (ledgerPath) => {
      const ledger = loadLedger(ledgerPath);
      const added = addLedgerEntry(ledger, baseEntry({ replayEvidenceRef: "" }), "2026-01-01T00:00:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "applied", appliedRef: "change:demo" }, "2026-01-01T00:01:00.000Z");
      let failed = false;
      try {
        advanceLedgerEntry(ledger, added.entry.id, { status: "replayed", replayResult: "resolved" }, "2026-01-01T00:02:00.000Z");
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        assert(message.includes("replayEvidenceRef"), `Missing replay evidence failure must be explicit, got ${message}.`);
      }
      assert(failed, "Applied entry without replayEvidenceRef must not advance to replayed.");
    }),
  },
  {
    name: "reports empty decay report without side effects",
    run: () => withTempLedger("empty-decay", (ledgerPath) => {
      const ledger = loadLedger(ledgerPath);
      writeLedger(ledgerPath, ledger);
      const before = fs.readFileSync(ledgerPath, "utf8");
      const report = decayReport(ledger, { now: "2026-02-01T00:00:00.000Z", windowDays: 30 });
      const after = fs.readFileSync(ledgerPath, "utf8");
      assertEqual(report.staleEntries.length, 0, "Empty ledger must produce no stale entries.");
      assertEqual(after, before, "Decay report must not mutate ledger file.");
    }),
  },
  {
    name: "decay report flags stale applied entries without mutation",
    run: () => withTempLedger("stale-decay", (ledgerPath) => {
      const ledger = loadLedger(ledgerPath);
      const added = addLedgerEntry(ledger, baseEntry(), "2026-01-01T00:00:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "applied", appliedRef: "skill:demo" }, "2026-01-01T00:01:00.000Z");
      writeLedger(ledgerPath, ledger);
      const before = fs.readFileSync(ledgerPath, "utf8");
      const report = decayReport(ledger, { now: "2026-03-01T00:00:00.000Z", windowDays: 30 });
      const after = fs.readFileSync(ledgerPath, "utf8");
      assertEqual(report.staleEntries.length, 1, "Old applied entry must be reported stale.");
      assertEqual(report.staleEntries[0].id, added.entry.id, "Decay report must name the stale entry.");
      assertEqual(after, before, "Decay report must not mutate stale applied entries.");
    }),
  },
  {
    name: "refuses cross-repository writes",
    run: () => withTempLedger("cross-repo", (ledgerPath) => {
      const ledger = loadLedger(ledgerPath);
      const added = addLedgerEntry(ledger, baseEntry({ owner: "other-repo" }), "2026-01-01T00:00:00.000Z");
      const route = routeRuleWrite(added.entry, "this-repo");
      assertEqual(route.status, "blocked", "Cross-repository route must be blocked.");
      assertEqual(route.reason, "cross-repo", "Cross-repository route must name cross-repo reason.");
    }),
  },
  {
    name: "unsupported classification returns unknown instead of guessing",
    run: () => {
      const result = unsupportedRequest("classify-cost-band");
      assertEqual(result.status, "unsupported", "Unsupported helper request must be explicit.");
      assertEqual(result.result, "unknown", "Unsupported helper request must return unknown.");
    },
  },
  {
    name: "instant edit replay path reaches resolved",
    run: () => withTempLedger("resolved-replay", (ledgerPath) => {
      const ledger = loadLedger(ledgerPath);
      const added = addLedgerEntry(ledger, baseEntry(), "2026-01-01T00:00:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "applied", appliedRef: "change:demo" }, "2026-01-01T00:01:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "replayed", replayResult: "resolved" }, "2026-01-01T00:02:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "resolved" }, "2026-01-01T00:03:00.000Z");
      assertEqual(ledger.entries[0].status, "resolved", "Resolved replay must close the ledger entry.");
    }),
  },
  {
    name: "characterizes P0 prevention feedback through stub reviewer replay",
    run: () => withTempLedger("p0-characterization", (ledgerPath) => {
      const p0Finding = baseEntry({
        sourceRef: "review-run-p0",
        findingSummary: "P0 reviewer finding recurred without reusable guard",
        costBand: "cheap",
        route: "instant",
        routeReason: "cheap single-agent prevention feedback target",
        targetArtifact: "agent:instruction-artifact-reviewer",
        draftRule: "Reviewer gates must verify replay evidence before closing prevention feedback.",
        replayEvidenceRef: "fixture:p0-prevention-feedback/replay.json",
      });
      const stubReviewerReplay = { replayResult: "resolved" as const };
      const ledger = loadLedger(ledgerPath);
      const added = addLedgerEntry(ledger, p0Finding, "2026-01-01T00:00:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "applied", appliedRef: "scratch-skill-copy" }, "2026-01-01T00:01:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "replayed", replayResult: stubReviewerReplay.replayResult }, "2026-01-01T00:02:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "resolved" }, "2026-01-01T00:03:00.000Z");
      writeLedger(ledgerPath, ledger);
      const persisted = loadLedger(ledgerPath);
      assertEqual(persisted.entries[0].status, "resolved", "Stub reviewer replay result must close the ledger entry.");
      assertEqual(persisted.entries[0].replayResult, "resolved", "Replay result must be persisted.");
    }),
  },
  {
    name: "still-failing replay opens a new rule-targeted entry",
    run: () => withTempLedger("still-failing", (ledgerPath) => {
      const ledger = loadLedger(ledgerPath);
      const added = addLedgerEntry(ledger, baseEntry(), "2026-01-01T00:00:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "applied", appliedRef: "change:demo" }, "2026-01-01T00:01:00.000Z");
      advanceLedgerEntry(ledger, added.entry.id, { status: "replayed", replayResult: "still-failing" }, "2026-01-01T00:02:00.000Z");
      const opened = createStillFailingEntry(ledger, added.entry.id, "2026-01-01T00:03:00.000Z");
      assertEqual(ledger.entries[0].status, "open", "Still-failing original entry must reopen.");
      assert(opened.entry.targetArtifact.includes(added.entry.id), "New entry must target the just-applied rule.");
      assertEqual(ledger.entries.length, 2, "Still-failing replay must open one new entry.");
    }),
  },
  {
    name: "check-bloat fails when a broad rule is added without removal or exemption",
    run: () => withTempRepo("bloat-fail", (repo) => {
      writeText(path.join(repo, "AGENTS.md"), "# Instructions\n\n- Agents must preserve evidence.");
      commitBaseline(repo);
      writeText(path.join(repo, "AGENTS.md"), "# Instructions\n\n- Agents must preserve evidence.\n- Agents must run replay before closure.");
      writeBloatChange(repo, "bloat-fail");
      const result = invokeLedgerCli(repo, ["--check-bloat", "--change", "bloat-fail"]);
      assert(result.status !== 0, `Bloat check must fail, got ${result.status}: ${result.output}`);
      assert(result.output.includes("one-in-one-out"), `Bloat failure must request one-in-one-out evidence, got ${result.output}.`);
    }),
  },
  {
    name: "check-bloat passes when a new rule merges an existing rule",
    run: () => withTempRepo("bloat-merge", (repo) => {
      writeText(path.join(repo, "AGENTS.md"), "# Instructions\n\n- Agents must preserve evidence.\n- Agents must run replay before closure.");
      commitBaseline(repo);
      writeText(path.join(repo, "AGENTS.md"), "# Instructions\n\n- Agents must preserve evidence and run replay before closure.");
      writeBloatChange(repo, "bloat-merge");
      const result = invokeLedgerCli(repo, ["--check-bloat", "--change", "bloat-merge"]);
      assertEqual(result.status, 0, `Merged-rule bloat check must pass, got ${result.status}: ${result.output}`);
      assert(result.output.includes("passed"), `Merged-rule output must show passed, got ${result.output}.`);
    }),
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

console.log(`OK: instruction feedback ledger tests=${tests.length}`);
