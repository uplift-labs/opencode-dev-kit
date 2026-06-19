#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import plugin, { SESSION_DELIVERY_CONTEXT_TOOL, SESSION_DELIVERY_REVIEWER_AGENT } from "../.opencode/plugin/session-env.ts";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function withTempDataDir(name: string, run: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `session-env-plugin-${name}-`));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createDeliveryContextDb(dbPath: string, rawSessionId: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec([
      "create table session (id text primary key, time_created integer, time_updated integer);",
      "create table session_input (id text primary key, session_id text not null, prompt text, time_created integer);",
      "create table message (id text primary key, session_id text not null, time_created integer, data text);",
      "create table todo (session_id text not null, content text, status text, priority text, position integer, time_created integer);",
      "create table event (id text primary key, session_id text not null, time_created integer, type text, properties text);",
    ].join("\n"));
    db.prepare("insert into session (id, time_created, time_updated) values (?, ?, ?)").run(rawSessionId, 1700000000000, 1700000001000);
    db.prepare("insert into session_input (id, session_id, prompt, time_created) values (?, ?, ?, ?)").run("input-secret", rawSessionId, `user request ${rawSessionId}`, 1700000000001);
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-secret", rawSessionId, 1700000000002, JSON.stringify({ role: "user", content: `message request ${rawSessionId}` }));
    db.prepare("insert into todo (session_id, content, status, priority, position, time_created) values (?, ?, ?, ?, ?, ?)").run(rawSessionId, `todo ${rawSessionId}`, "pending", "high", 1, 1700000000003);
    db.prepare("insert into event (id, session_id, time_created, type, properties) values (?, ?, ?, ?, ?)").run("question-asked-secret", rawSessionId, 1700000000004, "question.asked", JSON.stringify({ id: "question-secret", questions: [{ question: "Choose scope" }] }));
    db.prepare("insert into event (id, session_id, time_created, type, properties) values (?, ?, ?, ?, ?)").run("question-replied-secret", rawSessionId, 1700000000005, "question.replied", JSON.stringify({ requestID: "question-secret", answers: [[`Chosen ${rawSessionId}`]] }));
  } finally {
    db.close();
  }
}

function createDeliveryContextDbWithParent(dbPath: string, rootSessionId: string, childSessionId: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec([
      "create table session (id text primary key, parent_id text, time_created integer, time_updated integer);",
      "create table session_input (id text primary key, session_id text not null, prompt text, time_created integer);",
      "create table message (id text primary key, session_id text not null, time_created integer, data text);",
      "create table todo (session_id text not null, content text, status text, priority text, position integer, time_created integer);",
      "create table event (id text primary key, session_id text not null, time_created integer, type text, properties text);",
    ].join("\n"));
    db.prepare("insert into session (id, parent_id, time_created, time_updated) values (?, ?, ?, ?)").run(rootSessionId, null, 1700000000000, 1700000001000);
    db.prepare("insert into session (id, parent_id, time_created, time_updated) values (?, ?, ?, ?)").run(childSessionId, rootSessionId, 1700000002000, 1700000003000);
    db.prepare("insert into session_input (id, session_id, prompt, time_created) values (?, ?, ?, ?)").run("input-root", rootSessionId, `user request ${rootSessionId}`, 1700000000001);
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-root", rootSessionId, 1700000000002, JSON.stringify({ role: "user", content: `message request ${rootSessionId}` }));
    db.prepare("insert into todo (session_id, content, status, priority, position, time_created) values (?, ?, ?, ?, ?, ?)").run(rootSessionId, `todo ${rootSessionId}`, "pending", "high", 1, 1700000000003);
    db.prepare("insert into event (id, session_id, time_created, type, properties) values (?, ?, ?, ?, ?)").run("question-asked-root", rootSessionId, 1700000000004, "question.asked", JSON.stringify({ id: "question-root", questions: [{ question: "Choose scope" }] }));
    db.prepare("insert into event (id, session_id, time_created, type, properties) values (?, ?, ?, ?, ?)").run("question-replied-root", rootSessionId, 1700000000005, "question.replied", JSON.stringify({ requestID: "question-root", answers: [[`Chosen ${rootSessionId}`]] }));
  } finally {
    db.close();
  }
}

const tests: TestCase[] = [
  {
    name: "exposes canonical object-form server plugin shape",
    run: () => {
      assert(typeof plugin === "object" && plugin !== null, "Default export must be an object-form plugin, not a bare factory function.");
      assert(typeof plugin.id === "string" && plugin.id.length > 0, "Object-form plugin must export a non-empty id for local path loading.");
      assert(typeof plugin.server === "function", "Object-form plugin must expose a server factory function.");
      assert(plugin.server !== (plugin as unknown), "server must be a named factory, not the plugin object itself (bare-function legacy form rejected).");
    },
  },
  {
    name: "injects current session id into shell env",
    run: async () => {
      const hooks = await plugin.server({} as never);
      const output = { env: { EXISTING: "1" } };
      await hooks["shell.env"]?.({ callID: "call_fixture", cwd: process.cwd(), sessionID: "session_fixture" }, output);
      assert(output.env.EXISTING === "1", "shell.env hook must preserve existing env entries.");
      assert(output.env.OPENCODE_SESSION_ID === "session_fixture", "shell.env hook must inject OPENCODE_SESSION_ID.");
    },
  },
  {
    name: "registers session delivery context custom tool",
    run: async () => {
      const hooks = await plugin.server({} as never);
      assert(hooks.tool?.[SESSION_DELIVERY_CONTEXT_TOOL] != null, "Plugin must register session_delivery_context tool.");
      assert(hooks.tool?.[SESSION_DELIVERY_CONTEXT_TOOL]?.description.includes("root parent session"), "Custom tool description should document root parent session resolution for subagent reviewers.");
    },
  },
  {
    name: "session delivery context custom tool executes for current session",
    run: async () => withTempDataDir("tool-execute", async (dataDir) => {
      const rawSessionId = "session_plugin_secret";
      createDeliveryContextDb(path.join(dataDir, "opencode.db"), rawSessionId);
      const previousDataDir = process.env.OPENCODE_DATA_DIR;
      process.env.OPENCODE_DATA_DIR = dataDir;
      try {
        const hooks = await plugin.server({} as never);
        const metadataCalls: unknown[] = [];
        const result = await hooks.tool?.[SESSION_DELIVERY_CONTEXT_TOOL]?.execute({}, {
          abort: new AbortController().signal,
          agent: SESSION_DELIVERY_REVIEWER_AGENT,
          ask: async () => undefined,
          directory: dataDir,
          messageID: "message_fixture",
          metadata: (input: unknown) => { metadataCalls.push(input); },
          sessionID: rawSessionId,
          worktree: dataDir,
        });
        const output = typeof result === "string" ? result : result?.output;
        assert(typeof output === "string", "Custom tool should return JSON output string.");
        const parsed = JSON.parse(output) as { questionReplies?: unknown[]; session?: { counts?: Record<string, number>; sessionRef?: string }; todos?: { open?: unknown[] }; userMessages?: unknown[] };
        assert(parsed.session?.counts?.openTodos === 1, `Custom tool should report open todo, got ${output}`);
        assert(parsed.session?.counts?.userMessages === 2, `Custom tool should report user messages, got ${output}`);
        assert(parsed.questionReplies?.length === 1, `Custom tool should report question reply, got ${output}`);
        assert(metadataCalls.length === 1, "Custom tool should publish metadata once.");
        assert(!output.includes(rawSessionId), "Custom tool output must redact raw session id.");
      } finally {
        if (previousDataDir == null) {
          delete process.env.OPENCODE_DATA_DIR;
        } else {
          process.env.OPENCODE_DATA_DIR = previousDataDir;
        }
      }
    }),
  },
  {
    name: "session delivery context custom tool resolves root parent session from a subagent child session id",
    run: async () => withTempDataDir("tool-resolve-root", async (dataDir) => {
      const rootSessionId = "session_root_secret";
      const childSessionId = "session_child_secret";
      createDeliveryContextDbWithParent(path.join(dataDir, "opencode.db"), rootSessionId, childSessionId);
      const previousDataDir = process.env.OPENCODE_DATA_DIR;
      process.env.OPENCODE_DATA_DIR = dataDir;
      try {
        const hooks = await plugin.server({} as never);
        const result = await hooks.tool?.[SESSION_DELIVERY_CONTEXT_TOOL]?.execute({}, {
          abort: new AbortController().signal,
          agent: SESSION_DELIVERY_REVIEWER_AGENT,
          ask: async () => undefined,
          directory: dataDir,
          messageID: "message_fixture",
          metadata: () => { /* ignore */ },
          sessionID: childSessionId,
          worktree: dataDir,
        });
        const output = typeof result === "string" ? result : result?.output;
        assert(typeof output === "string", "Custom tool should return JSON output string.");
        const parsed = JSON.parse(output) as { questionReplies?: unknown[]; resolvedFromSessionRef?: string | null; session?: { counts?: Record<string, number>; sessionRef?: string }; todos?: { open?: unknown[] }; userMessages?: Array<{ text?: string }>; };
        assert(parsed.session?.counts?.openTodos === 1, `Custom tool invoked from child must resolve root open todo, got ${output}`);
        assert(parsed.session?.counts?.userMessages === 2, `Custom tool invoked from child must resolve root user messages, got ${output}`);
        assert(parsed.questionReplies?.length === 1, `Custom tool invoked from child must resolve root question reply, got ${output}`);
        assert(parsed.resolvedFromSessionRef != null && parsed.resolvedFromSessionRef !== "", "Custom tool must report resolvedFromSessionRef when it walks to root.");
        assert(parsed.userMessages?.some((message) => (message.text ?? "").includes("user request")) === true, "Custom tool invoked from child must return root session user messages.");
        assert(!output.includes(rootSessionId) && !output.includes(childSessionId), "Custom tool output must redact raw session ids (root and child).");
      } finally {
        if (previousDataDir == null) {
          delete process.env.OPENCODE_DATA_DIR;
        } else {
          process.env.OPENCODE_DATA_DIR = previousDataDir;
        }
      }
    }),
  },
];

let failed = 0;
for (const test of tests) {
  try {
    await test.run();
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

console.log(`OK: session env plugin tests=${tests.length}`);
