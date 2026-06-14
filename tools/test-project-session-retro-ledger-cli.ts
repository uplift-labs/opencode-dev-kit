#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { initProjectSessionRetroLedger, refreshAnalysisProgress } from "./opencode-project-session-retro-ledger.ts";
import type { ProjectSessionRetroLedger } from "./opencode-project-session-retro-ledger.ts";

type TestCase = {
  name: string;
  run: () => void;
};

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "opencode-project-session-retro-ledger.ts");
const rawSessionOne = "session_current_secret_1";
const rawHashLikeSession = "session_abcdef123456";
const rawMissingSession = "session_missing_secret";
const rawOtherSession = "session_other_secret";
const rawOtherHashLikeSession = "session_123456abcdef";
let patchIndex = 0;

function withTempRepo(name: string, run: (repo: string) => void): void {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `project-session-retro-ledger-cli-${name}-`));
  try {
    run(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(text: string, expected: string, message: string): void {
  assert(text.includes(expected), `${message}\nExpected: ${expected}\nActual:\n${text}`);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);
  assert(actualJson === expectedJson, `${message}\nExpected:\n${JSON.stringify(expected, null, 2)}\nActual:\n${actualJson}`);
}

function invokeCli(args: string[], cwd: string): { exitCode: number; output: string; stderr: string; stdout: string } {
  const result = spawnSync("node", [cliPath, ...args], { cwd, encoding: "utf8", shell: false });
  if (result.error) {
    throw result.error;
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { exitCode: result.status ?? 0, output: `${stdout}${stderr}`, stderr, stdout };
}

function createOpenCodeDbFixture(dbPath: string, projectRoot: string, otherRoot: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec([
      "create table project (id text primary key, worktree text, name text, time_created integer, time_updated integer);",
      "create table project_directory (project_id text not null, directory text not null, type text, strategy text, time_created integer);",
      "create table session (id text primary key, project_id text, parent_id text, directory text, path text, title text, time_created integer, time_updated integer, workspace_id text, agent text, model text, cost real, tokens_input integer, tokens_output integer, tokens_reasoning integer, tokens_cache_read integer, tokens_cache_write integer);",
      "create table message (id text primary key, session_id text not null, time_created integer, time_updated integer, data text);",
      "create table part (id text primary key, message_id text, session_id text not null, time_created integer, time_updated integer, data text);",
      "create table session_input (id text primary key, session_id text not null, prompt text, delivery text, admitted_seq integer, promoted_seq integer, time_created integer);",
      "create table todo (session_id text not null, content text, status text, priority text, position integer, time_created integer, time_updated integer);",
    ].join("\n"));
    db.prepare("insert into project (id, worktree, name, time_created, time_updated) values (?, ?, ?, ?, ?)").run("project-current-secret", projectRoot, "Secret Current Project", 1700000000000, 1700000003000);
    db.prepare("insert into project (id, worktree, name, time_created, time_updated) values (?, ?, ?, ?, ?)").run("project-other-secret", otherRoot, "Secret Other Project", 1700000000000, 1700000003000);
    db.prepare("insert into project_directory (project_id, directory, type, strategy, time_created) values (?, ?, ?, ?, ?)").run("project-current-secret", projectRoot, "root", "git", 1700000000000);
    db.prepare("insert into project_directory (project_id, directory, type, strategy, time_created) values (?, ?, ?, ?, ?)").run("project-other-secret", otherRoot, "root", "git", 1700000000000);
    const insertSession = db.prepare("insert into session (id, project_id, parent_id, directory, path, title, time_created, time_updated, workspace_id, agent, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (let index = 1; index <= 5; index++) {
      const sessionId = index === 1 ? rawSessionOne : index === 5 ? rawHashLikeSession : `session-current-secret-${index}`;
      insertSession.run(sessionId, "project-current-secret", index === 1 ? null : rawSessionOne, projectRoot, path.join(projectRoot, `secret-${index}.txt`), `Secret Session ${index}`, 1700000000000 + index * 1000, 1700000000500 + index * 1000, "workspace-current-secret", "build", "model-a", 1, 10, 20, 3, 4, 5);
    }
    insertSession.run(rawOtherSession, "project-other-secret", null, otherRoot, path.join(otherRoot, "secret-file.txt"), "Secret Other Session", 1700000010000, 1700000011000, "workspace-other-secret", "build", "model-b", 1, 10, 20, 3, 4, 5);
    insertSession.run(rawOtherHashLikeSession, "project-other-secret", null, otherRoot, path.join(otherRoot, "secret-file-2.txt"), "Secret Other Hash Session", 1700000012000, 1700000013000, "workspace-other-secret", "build", "model-b", 1, 10, 20, 3, 4, 5);
    db.prepare("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)").run("message-secret-1", rawSessionOne, 1700000001000, 1700000001000, JSON.stringify({ role: "user", content: `raw secret prompt mentioning ${rawSessionOne}` }));
    db.prepare("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run("part-secret-1", "message-secret-1", rawSessionOne, 1700000001001, 1700000001001, JSON.stringify({ type: "text", text: `assistant text mentioning ${rawSessionOne}` }));
    db.prepare("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run("part-secret-2", "message-secret-1", rawSessionOne, 1700000001002, 1700000001002, JSON.stringify({ type: "tool", tool: "bash", state: { status: "completed", input: { command: `echo ${rawSessionOne}` }, output: `tool output ${rawSessionOne}` } }));
    db.prepare("insert into session_input (id, session_id, prompt, delivery, admitted_seq, promoted_seq, time_created) values (?, ?, ?, ?, ?, ?, ?)").run("input-secret-1", rawSessionOne, `raw session input prompt ${rawSessionOne}`, "user", 1, 1, 1700000000999);
    db.prepare("insert into todo (session_id, content, status, priority, position, time_created, time_updated) values (?, ?, ?, ?, ?, ?, ?)").run(rawSessionOne, `todo mentioning ${rawSessionOne}`, "pending", "high", 1, 1700000001003, 1700000001003);
    db.prepare("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)").run("message-other-secret", rawOtherSession, 1700000010000, 1700000010000, JSON.stringify({ role: "user", content: `out of scope content ${rawOtherSession}` }));
    db.prepare("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)").run("message-other-hash-secret", rawOtherHashLikeSession, 1700000012000, 1700000012000, JSON.stringify({ role: "user", content: `out of scope hash content ${rawOtherHashLikeSession}` }));
  } finally {
    db.close();
  }
}

function emptyAudit(): ProjectSessionRetroLedger["sessions"][string]["audit"] {
  return {
    assistantActions: [],
    candidateLessons: [],
    constraints: [],
    edits: { evidenceRefs: [], happened: null },
    evidenceConfidence: null,
    likelyRootCause: null,
    mainAgentLearning: [],
    outcome: null,
    reviewerLearning: [],
    symptom: null,
    toolFailures: [],
    userCorrections: [],
    userGoal: null,
    validation: { performed: [], skippedReason: null },
  };
}

function completeAudit(goal: string): ProjectSessionRetroLedger["sessions"][string]["audit"] {
  return {
    assistantActions: ["Reviewed full transcript evidence and recorded the outcome."],
    candidateLessons: ["Use transcript helper output before writing ledger patches."],
    constraints: ["Keep raw transcript content out of user-facing output."],
    edits: { evidenceRefs: [], happened: false },
    evidenceConfidence: "high",
    likelyRootCause: "Deterministic helper coverage reduced manual ledger handling.",
    mainAgentLearning: ["Use patch-sessions instead of hand-editing retro.json."],
    outcome: "success",
    reviewerLearning: [],
    symptom: "Manual retro ledger handling was slow.",
    toolFailures: [],
    userCorrections: [],
    userGoal: goal,
    validation: { performed: ["Full transcript reviewed for this fixture session."], skippedReason: null },
  };
}

function observation(sessionRef: string): ProjectSessionRetroLedger["sessions"][string]["observations"][number] {
  return {
    confidence: "high",
    evidenceRefs: [`${sessionRef}#transcript`],
    id: "obs-001",
    impact: "medium",
    polarity: "positive",
    summary: "Session transcript had enough evidence to complete a ledger card",
  };
}

function prepareLedger(repo: string): { dbPath: string; firstRef: string; ledgerPath: string; projectRoot: string; refs: string[] } {
  const projectRoot = path.join(repo, "project");
  const otherRoot = path.join(repo, "other");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(otherRoot, { recursive: true });
  const dbPath = path.join(repo, "opencode.db");
  createOpenCodeDbFixture(dbPath, projectRoot, otherRoot);
  const ledger = initProjectSessionRetroLedger({ dbPaths: [dbPath], generatedAt: "2026-06-14T00:00:00.000Z", projectRoot, showPaths: false, useDefaultPaths: false });
  const ledgerPath = path.join(repo, "retro.json");
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  return { dbPath, firstRef: ledger.analysisProgress.sessionOrder[0], ledgerPath, projectRoot, refs: ledger.analysisProgress.sessionOrder };
}

function writePatch(repo: string, payload: unknown): string {
  patchIndex++;
  const patchPath = path.join(repo, `patch-${patchIndex}.json`);
  fs.writeFileSync(patchPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return patchPath;
}

const tests: TestCase[] = [
  {
    name: "transcript CLI redacts by default and redacts raw ids inside explicit content mode",
    run: () => withTempRepo("transcript-privacy", (repo) => {
      const { dbPath, firstRef, ledgerPath, projectRoot } = prepareLedger(repo);
      const redacted = invokeCli(["transcript", "--input", ledgerPath, "--db", dbPath, "--only-explicit", "--session", firstRef, "--format", "json"], repo);
      assert(redacted.exitCode === 0, `Redacted transcript should pass, got ${redacted.output}`);
      const redactedParsed = JSON.parse(redacted.stdout) as { sessions?: Array<{ counts?: Record<string, number>; events?: Array<{ kind?: string }>; sessionRef?: string }> };
      assert(redactedParsed.sessions?.[0]?.sessionRef === firstRef, `Transcript should return requested session ref, got ${redacted.stdout}`);
      assert(redactedParsed.sessions?.[0]?.counts?.inputs === 1 && redactedParsed.sessions?.[0]?.counts?.parts === 2, `Transcript should include deterministic counts, got ${redacted.stdout}`);
      assertDeepEqual(redactedParsed.sessions?.[0]?.events?.map((event) => event.kind), ["input", "message", "part", "part", "todo"], "Transcript events should be chronological for the fixture.");
      for (const secret of ["raw secret prompt", "raw session input prompt", rawSessionOne, projectRoot, dbPath]) {
        assert(!redacted.stdout.includes(secret), `Redacted transcript output must not expose ${secret}.`);
      }

      const raw = invokeCli(["transcript", "--input", ledgerPath, "--db", dbPath, "--only-explicit", "--session", firstRef, "--include-content", "--format", "json"], repo);
      assert(raw.exitCode === 0, `Raw-content transcript should pass, got ${raw.output}`);
      for (const expected of ["raw secret prompt", "raw session input prompt", "assistant text mentioning", "tool output", "todo mentioning", firstRef]) {
        assertIncludes(raw.output, expected, `Raw-content transcript should preserve analysis content or redacted ref: ${expected}.`);
      }
      assert(!raw.output.includes(rawSessionOne), "Raw-content transcript must redact raw session ids embedded inside content.");
    }),
  },
  {
    name: "transcript CLI accepts raw ids and reports missing sessions without raw leaks",
    run: () => withTempRepo("transcript-raw-id", (repo) => {
      const { dbPath, firstRef, ledgerPath } = prepareLedger(repo);
      const byRaw = invokeCli(["transcript", "--input", ledgerPath, "--db", dbPath, "--only-explicit", "--session", rawSessionOne, "--include-content", "--format", "json"], repo);
      assert(byRaw.exitCode === 0, `Raw id transcript should pass, got ${byRaw.output}`);
      const parsed = JSON.parse(byRaw.stdout) as { sessions?: Array<{ sessionRef?: string }> };
      assert(parsed.sessions?.[0]?.sessionRef === firstRef, `Raw id lookup should return redacted ref, got ${byRaw.stdout}`);
      assert(!byRaw.output.includes(rawSessionOne), "Raw id lookup output must not expose raw session id.");

      const byHashLikeRaw = invokeCli(["transcript", "--input", ledgerPath, "--db", dbPath, "--only-explicit", "--session", rawHashLikeSession, "--format", "json"], repo);
      assert(byHashLikeRaw.exitCode === 0, `Hash-shaped raw id transcript should pass, got ${byHashLikeRaw.output}`);
      const hashLikeParsed = JSON.parse(byHashLikeRaw.stdout) as { sessions?: Array<{ sessionRef?: string }> };
      assert(hashLikeParsed.sessions?.length === 1, `Hash-shaped raw id should resolve as raw id, got ${byHashLikeRaw.stdout}`);
      assert(!byHashLikeRaw.output.includes(rawHashLikeSession), "Hash-shaped raw id output must not expose raw id.");

      const missing = invokeCli(["transcript", "--input", ledgerPath, "--db", dbPath, "--only-explicit", "--session", rawMissingSession, "--format", "json"], repo);
      assert(missing.exitCode !== 0, "Missing transcript request should return nonzero exit.");
      const missingParsed = JSON.parse(missing.stdout) as { missingSessions?: string[]; sessions?: unknown[] };
      assert(missingParsed.sessions?.length === 0 && missingParsed.missingSessions?.length === 1, `Missing request should be explicit, got ${missing.stdout}`);
      assert(!missing.output.includes(rawMissingSession), "Missing transcript output must not expose raw missing id.");

      const outOfScope = invokeCli(["transcript", "--input", ledgerPath, "--db", dbPath, "--only-explicit", "--session", rawOtherHashLikeSession, "--include-content", "--format", "json"], repo);
      assert(outOfScope.exitCode !== 0, "Out-of-scope raw id request should fail when input ledger bounds scope.");
      const outOfScopeParsed = JSON.parse(outOfScope.stdout) as { missingSessions?: string[]; sessions?: unknown[] };
      assert(outOfScopeParsed.sessions?.length === 0 && outOfScopeParsed.missingSessions?.length === 1, `Out-of-scope request should return no sessions, got ${outOfScope.stdout}`);
      assert(!outOfScope.output.includes(rawOtherHashLikeSession) && !outOfScope.output.includes("out of scope hash content"), "Out-of-scope transcript output must not expose raw id or content.");
    }),
  },
  {
    name: "patch-sessions validates before write and dry-run leaves ledger unchanged",
    run: () => withTempRepo("patch-sessions", (repo) => {
      const { firstRef, ledgerPath, refs } = prepareLedger(repo);
      const staleLedger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as ProjectSessionRetroLedger;
      staleLedger.validation = { errors: ["stale error"], warnings: ["stale warning"] };
      fs.writeFileSync(ledgerPath, `${JSON.stringify(staleLedger, null, 2)}\n`, "utf8");
      const validPatch = writePatch(repo, { sessions: { [firstRef]: { audit: completeAudit("Complete first fixture session."), coverage: { limits: [], status: "complete" }, observations: [observation(firstRef)] } } });
      const beforeDryRun = fs.readFileSync(ledgerPath, "utf8");
      const dryRun = invokeCli(["patch-sessions", "--input", ledgerPath, "--patch", validPatch, "--dry-run", "--format", "json"], repo);
      assert(dryRun.exitCode === 0, `Dry-run patch should pass, got ${dryRun.output}`);
      assert(fs.readFileSync(ledgerPath, "utf8") === beforeDryRun, "Dry-run patch must not mutate ledger file.");

      const patched = invokeCli(["patch-sessions", "--input", ledgerPath, "--patch", validPatch, "--format", "json"], repo);
      assert(patched.exitCode === 0, `Patch should pass, got ${patched.output}`);
      const patchResult = JSON.parse(patched.stdout) as { changedSessions?: string[]; progress?: { completedSessionCount?: number; nextSessionRef?: string } };
      assertDeepEqual(patchResult.changedSessions, [firstRef], "Patch result should name changed session.");
      assert(patchResult.progress?.completedSessionCount === 1 && patchResult.progress?.nextSessionRef === refs[1], `Patch should refresh progress, got ${patched.stdout}`);
      const afterPatch = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as ProjectSessionRetroLedger;
      assert(afterPatch.validation.errors.length === 0 && afterPatch.validation.warnings.length === 0, "Successful patch should persist fresh validation state and clear stale validation.");

      const beforeInvalid = fs.readFileSync(ledgerPath, "utf8");
      const invalidPatch = writePatch(repo, { sessions: { [refs[1]]: { audit: emptyAudit(), coverage: { limits: [], status: "complete" }, observations: [observation(refs[1])] } } });
      const invalid = invokeCli(["patch-sessions", "--input", ledgerPath, "--patch", invalidPatch, "--format", "json"], repo);
      assert(invalid.exitCode !== 0, "Invalid patch should fail validation.");
      assert(fs.readFileSync(ledgerPath, "utf8") === beforeInvalid, "Invalid patch must not mutate ledger file.");
      assertIncludes(invalid.stdout, "audit.userGoal", "Invalid patch should report validation errors.");

      const missingPatch = writePatch(repo, { sessions: { session_missing: { coverage: { limits: [], status: "blocked" } } } });
      const missing = invokeCli(["patch-sessions", "--input", ledgerPath, "--patch", missingPatch], repo);
      assert(missing.exitCode !== 0, "Missing-session patch should fail.");
      assert(fs.readFileSync(ledgerPath, "utf8") === beforeInvalid, "Missing-session patch must not mutate ledger file.");
    }),
  },
  {
    name: "patch-sessions and status accept sharded ledger directory",
    run: () => withTempRepo("patch-sessions-sharded", (repo) => {
      const { firstRef, ledgerPath, refs } = prepareLedger(repo);
      const retroDir = path.join(repo, "retro");
      const split = invokeCli(["split", "--input", ledgerPath, "--out", retroDir], repo);
      assert(split.exitCode === 0, `Split should pass before sharded patching, got ${split.output}`);

      const validPatch = writePatch(repo, { sessions: { [firstRef]: { audit: completeAudit("Complete first sharded fixture session."), coverage: { limits: [], status: "complete" }, observations: [observation(firstRef)] } } });
      const patched = invokeCli(["patch-sessions", "--input", retroDir, "--patch", validPatch, "--format", "json"], repo);
      assert(patched.exitCode === 0, `Sharded patch should pass, got ${patched.output}`);
      const sessionShard = JSON.parse(fs.readFileSync(path.join(retroDir, "sessions", `${firstRef}.json`), "utf8")) as ProjectSessionRetroLedger["sessions"][string];
      assert(sessionShard.coverage.status === "complete", "Sharded patch should write the updated session shard.");

      const status = invokeCli(["status", "--input", retroDir, "--limit", "1", "--format", "json"], repo);
      assert(status.exitCode === 0, `Sharded status should pass, got ${status.output}`);
      const parsed = JSON.parse(status.stdout) as { nextSessionRefs?: string[]; progress?: { completedSessionCount?: number } };
      assert(parsed.progress?.completedSessionCount === 1, `Sharded status should reflect patched progress, got ${status.stdout}`);
      assertDeepEqual(parsed.nextSessionRefs, [refs[1]], "Sharded status should return the next incomplete session.");
    }),
  },
  {
    name: "status CLI stays compact and honors limits",
    run: () => withTempRepo("status", (repo) => {
      const { ledgerPath, refs } = prepareLedger(repo);
      const initialJson = invokeCli(["status", "--input", ledgerPath, "--limit", "1", "--format", "json"], repo);
      assert(initialJson.exitCode === 0, `Initial status JSON should pass, got ${initialJson.output}`);
      const initialParsed = JSON.parse(initialJson.stdout) as { nextSessions?: Array<{ eventRows?: number; messageRows?: number; partRows?: number; sessionRef?: string; todoRows?: number }> };
      assertDeepEqual(initialParsed.nextSessions?.map((session) => session.sessionRef), [refs[0]], "Status JSON should include bounded next-session batch metadata.");
      assert(initialParsed.nextSessions?.[0]?.messageRows === 1 && initialParsed.nextSessions?.[0]?.partRows === 2 && initialParsed.nextSessions?.[0]?.todoRows === 1 && initialParsed.nextSessions?.[0]?.eventRows === 4, `Status JSON should include redacted row counts for batching, got ${initialJson.stdout}`);
      assert(!initialJson.stdout.includes(rawSessionOne), "Status JSON next-session metadata must not expose raw session ids.");

      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as ProjectSessionRetroLedger;
      ledger.sessions[refs[0]].coverage = { limits: [], status: "complete" };
      ledger.sessions[refs[0]].audit = completeAudit("Complete first fixture session for status coverage.");
      ledger.sessions[refs[0]].observations = [observation(refs[0])];
      fs.writeFileSync(ledgerPath, `${JSON.stringify(refreshAnalysisProgress(ledger), null, 2)}\n`, "utf8");

      const json = invokeCli(["status", "--input", ledgerPath, "--limit", "1", "--format", "json"], repo);
      assert(json.exitCode === 0, `Status JSON should pass, got ${json.output}`);
      const parsed = JSON.parse(json.stdout) as { coverage?: Record<string, number>; nextSessionRefs?: string[]; nextSessions?: Array<{ sessionRef?: string }> };
      assert(parsed.coverage?.complete === 1 && parsed.coverage?.partial === 4, `Status should count coverage states, got ${json.stdout}`);
      assertDeepEqual(parsed.nextSessionRefs, [refs[1]], "Status JSON should honor next-ref limit.");
      assertDeepEqual(parsed.nextSessions?.map((session) => session.sessionRef), [refs[1]], "Status JSON should honor next-session metadata limit.");
      assert(!json.stdout.includes("sessionOrder"), "Status JSON must omit full sessionOrder everywhere.");

      const text = invokeCli(["status", "--input", ledgerPath, "--limit", "1"], repo);
      assert(text.exitCode === 0, `Status text should pass, got ${text.output}`);
      assert(!text.stdout.includes("sessionOrder"), "Status text must omit full sessionOrder.");
      assertIncludes(text.stdout, refs[1], "Status text should include next incomplete ref.");
      assert(!text.stdout.includes(refs[2]), "Status text should honor next-ref limit.");

      for (const args of [["--limit", "bad"], ["--limit", "1abc"], ["--limit", "1.5"], ["--limit", "-1"], ["--limit=1abc"]]) {
        const badLimit = invokeCli(["status", "--input", ledgerPath, ...args], repo);
        assert(badLimit.exitCode !== 0, `Bad --limit should fail for ${args.join(" ")}.`);
      }
    }),
  },
  {
    name: "transcript --out writes selected format and respects overwrite guard",
    run: () => withTempRepo("transcript-out", (repo) => {
      const { dbPath, firstRef, ledgerPath } = prepareLedger(repo);
      const outPath = path.join(repo, "transcript.txt");
      const wrote = invokeCli(["transcript", "--input", ledgerPath, "--db", dbPath, "--only-explicit", "--session", firstRef, "--out", outPath], repo);
      assert(wrote.exitCode === 0, `Transcript out should pass, got ${wrote.output}`);
      assert(fs.readFileSync(outPath, "utf8").startsWith("sessions: 1"), "Text format --out should write rendered text, not JSON.");
      const beforeRefused = fs.readFileSync(outPath, "utf8");
      const refused = invokeCli(["transcript", "--input", ledgerPath, "--db", dbPath, "--only-explicit", "--session", firstRef, "--out", outPath], repo);
      assert(refused.exitCode !== 0 && refused.output.includes("--overwrite"), "Transcript out should refuse overwrite without flag.");
      assert(fs.readFileSync(outPath, "utf8") === beforeRefused, "Refused transcript overwrite must preserve existing file bytes.");
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

console.log(`OK: project session retro ledger CLI tests=${tests.length}`);
