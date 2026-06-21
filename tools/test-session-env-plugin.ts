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

function createDeliveryContextDbWithAggregateEvents(dbPath: string, rawSessionId: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec([
      "create table session (id text primary key, time_created integer, time_updated integer);",
      "create table session_input (id text primary key, session_id text not null, prompt text, time_created integer);",
      "create table message (id text primary key, session_id text not null, time_created integer, data text);",
      "create table todo (session_id text not null, content text, status text, priority text, position integer, time_created integer);",
      "create table event (id text primary key, aggregate_id text not null, seq integer, type text, data text);",
    ].join("\n"));
    db.prepare("insert into session (id, time_created, time_updated) values (?, ?, ?)").run(rawSessionId, 1700000000000, 1700000001000);
    db.prepare("insert into session_input (id, session_id, prompt, time_created) values (?, ?, ?, ?)").run("input-secret", rawSessionId, `user request ${rawSessionId}`, 1700000000001);
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-secret", rawSessionId, 1700000000002, JSON.stringify({ role: "user", content: `message request ${rawSessionId}` }));
    db.prepare("insert into todo (session_id, content, status, priority, position, time_created) values (?, ?, ?, ?, ?, ?)").run(rawSessionId, `todo ${rawSessionId}`, "pending", "high", 1, 1700000000003);
    db.prepare("insert into event (id, aggregate_id, seq, type, data) values (?, ?, ?, ?, ?)").run("question-asked-secret", rawSessionId, 1, "question.asked", JSON.stringify({ id: "question-secret", questions: [{ question: "Choose scope" }] }));
    db.prepare("insert into event (id, aggregate_id, seq, type, data) values (?, ?, ?, ?, ?)").run("question-replied-secret", rawSessionId, 2, "question.replied", JSON.stringify({ requestID: "question-secret", answers: [[`Chosen ${rawSessionId}`]] }));
  } finally {
    db.close();
  }
}

function createDeliveryContextDbWithPartMessages(dbPath: string, rawSessionId: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec([
      "create table session (id text primary key, time_created integer, time_updated integer);",
      "create table session_input (id text primary key, session_id text not null, prompt text, time_created integer);",
      "create table message (id text primary key, session_id text not null, time_created integer, data text);",
      "create table part (id text primary key, message_id text not null, session_id text not null, time_created integer, data text);",
      "create table todo (session_id text not null, content text, status text, priority text, position integer, time_created integer);",
      "create table event (id text primary key, aggregate_id text not null, seq integer, type text, data text);",
    ].join("\n"));
    db.prepare("insert into session (id, time_created, time_updated) values (?, ?, ?)").run(rawSessionId, 1700000000000, 1700000001000);
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-user-1", rawSessionId, 1700000000001, JSON.stringify({ role: "user" }));
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-assistant", rawSessionId, 1700000000002, JSON.stringify({ role: "assistant" }));
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-user-2", rawSessionId, 1700000000003, JSON.stringify({ role: "user" }));
    db.prepare("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)").run("part-user-1", "message-user-1", rawSessionId, 1700000000001, JSON.stringify({ type: "text", text: `first requirement ${rawSessionId}` }));
    db.prepare("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)").run("part-assistant", "message-assistant", rawSessionId, 1700000000002, JSON.stringify({ type: "text", text: `assistant text ${rawSessionId}` }));
    db.prepare("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)").run("part-user-2", "message-user-2", rawSessionId, 1700000000003, JSON.stringify({ type: "text", text: `second requirement ${rawSessionId}` }));
    db.prepare("insert into todo (session_id, content, status, priority, position, time_created) values (?, ?, ?, ?, ?, ?)").run(rawSessionId, `todo ${rawSessionId}`, "pending", "high", 1, 1700000000004);
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
      "create table part (id text primary key, message_id text not null, session_id text not null, time_created integer, data text);",
      "create table todo (session_id text not null, content text, status text, priority text, position integer, time_created integer);",
      "create table event (id text primary key, session_id text not null, time_created integer, type text, properties text);",
    ].join("\n"));
    db.prepare("insert into session (id, parent_id, time_created, time_updated) values (?, ?, ?, ?)").run(rootSessionId, null, 1700000000000, 1700000001000);
    db.prepare("insert into session (id, parent_id, time_created, time_updated) values (?, ?, ?, ?)").run(childSessionId, rootSessionId, 1700000002000, 1700000003000);
    db.prepare("insert into session_input (id, session_id, prompt, time_created) values (?, ?, ?, ?)").run("input-root", rootSessionId, `user request ${rootSessionId}`, 1700000000001);
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-root", rootSessionId, 1700000000002, JSON.stringify({ role: "user" }));
    db.prepare("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)").run("part-root", "message-root", rootSessionId, 1700000000002, JSON.stringify({ type: "text", text: `message request ${rootSessionId}` }));
    db.prepare("insert into todo (session_id, content, status, priority, position, time_created) values (?, ?, ?, ?, ?, ?)").run(rootSessionId, `todo ${rootSessionId}`, "pending", "high", 1, 1700000000003);
    db.prepare("insert into event (id, session_id, time_created, type, properties) values (?, ?, ?, ?, ?)").run("question-asked-root", rootSessionId, 1700000000004, "question.asked", JSON.stringify({ id: "question-root", questions: [{ question: "Choose scope" }] }));
    db.prepare("insert into event (id, session_id, time_created, type, properties) values (?, ?, ?, ?, ?)").run("question-replied-root", rootSessionId, 1700000000005, "question.replied", JSON.stringify({ requestID: "question-root", answers: [[`Chosen ${rootSessionId}`]] }));
  } finally {
    db.close();
  }
}

function createDeliveryContextDbWithTodoHistory(dbPath: string, rawSessionId: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec([
      "create table session (id text primary key, time_created integer, time_updated integer);",
      "create table session_input (id text primary key, session_id text not null, prompt text, time_created integer);",
      "create table message (id text primary key, session_id text not null, time_created integer, data text);",
      "create table part (id text primary key, message_id text not null, session_id text not null, time_created integer, time_updated integer, data text);",
      "create table todo (session_id text not null, content text, status text, priority text, position integer, time_created integer, time_updated integer);",
      "create table event (id text primary key, session_id text not null, time_created integer, type text, properties text);",
    ].join("\n"));
    db.prepare("insert into session (id, time_created, time_updated) values (?, ?, ?)").run(rawSessionId, 1700000000000, 1700000009000);
    db.prepare("insert into session_input (id, session_id, prompt, time_created) values (?, ?, ?, ?)").run("input-history", rawSessionId, `Реализуй все OpenSpec Changes в полном объеме. Как закончишь - заархивируй. Каждый раз когда архивируешь - пушь в гит. Если встретишь блокеры, которые вообще никак не сможешь решить сам - эскалируй, но только в случае если вообще вся другая работа во всех Changes сделана. Если тебе нужно будет создать новый Change по какой-то причине - сначала согласуй это со мной и только потом приступай к реализации. ${rawSessionId}`, 1700000000001);
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-history", rawSessionId, 1700000000002, JSON.stringify({ role: "user", content: `запушь все ${rawSessionId}` }));
    db.prepare("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run("todo-call-1", "message-history", rawSessionId, 1700000000003, 1700000000004, JSON.stringify({
      type: "tool",
      tool: "todowrite",
      callID: "call-1",
      state: {
        status: "completed",
        input: {
          todos: [
            { content: `Archive OpenSpec changes ${rawSessionId}`, status: "pending", priority: "high" },
          ],
        },
        metadata: { todos: [], truncated: false },
        time: { start: 1700000000003, end: 1700000000004 },
      },
    }));
    db.prepare("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run("todo-call-2", "message-history", rawSessionId, 1700000000005, 1700000000006, JSON.stringify({
      type: "tool",
      tool: "todowrite",
      callID: "call-2",
      state: {
        status: "completed",
        input: {
          todos: [
            { content: `Implement OpenSpec change A ${rawSessionId}`, status: "completed", priority: "high" },
            { content: `Implement OpenSpec change B ${rawSessionId}`, status: "pending", priority: "high" },
          ],
        },
        metadata: { todos: [], truncated: false },
        time: { start: 1700000000005, end: 1700000000006 },
      },
    }));
    db.prepare("insert into todo (session_id, content, status, priority, position, time_created, time_updated) values (?, ?, ?, ?, ?, ?, ?)").run(rawSessionId, `Implement OpenSpec change A ${rawSessionId}`, "completed", "high", 0, 1700000000007, 1700000000008);
    db.prepare("insert into todo (session_id, content, status, priority, position, time_created, time_updated) values (?, ?, ?, ?, ?, ?, ?)").run(rawSessionId, `Implement OpenSpec change B ${rawSessionId}`, "pending", "high", 1, 1700000000007, 1700000000008);
  } finally {
    db.close();
  }
}

function createDeliveryContextDbWithTodoPriorityChange(dbPath: string, rawSessionId: string): void {
  const db = new DatabaseSync(dbPath);
  const unrelatedSessionId = "session_unrelated_secret";
  const hexLikeSessionId = "session_deadbeefcafe";
  try {
    db.exec([
      "create table session (id text primary key, time_created integer, time_updated integer);",
      "create table message (id text primary key, session_id text not null, time_created integer, data text);",
      "create table part (id text primary key, message_id text not null, session_id text not null, time_created integer, time_updated integer, data text);",
      "create table todo (session_id text not null, content text, status text, priority text, position integer, time_created integer, time_updated integer);",
      "create table event (id text primary key, session_id text not null, time_created integer, type text, properties text);",
    ].join("\n"));
    db.prepare("insert into session (id, time_created, time_updated) values (?, ?, ?)").run(rawSessionId, 1700000000000, 1700000009000);
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-priority", rawSessionId, 1700000000001, JSON.stringify({ role: "user", content: `finish priority-shifted todo ${rawSessionId} while mentioning ${unrelatedSessionId} and ${hexLikeSessionId}` }));
    db.prepare("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run("todo-priority-1", "message-priority", rawSessionId, 1700000000002, 1700000000003, JSON.stringify({
      type: "tool",
      tool: "todowrite",
      callID: "call-priority-1",
      state: {
        input: { todos: [{ content: `Priority mutable todo ${rawSessionId}`, status: "pending", priority: "high" }] },
        metadata: { todos: [], truncated: false },
        status: "completed",
        time: { start: 1700000000002, end: 1700000000003 },
      },
    }));
    db.prepare("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run("todo-priority-2", "message-priority", rawSessionId, 1700000000004, 1700000000005, JSON.stringify({
      type: "tool",
      tool: "todowrite",
      callID: "call-priority-2",
      state: {
        input: { todos: [{ content: `Priority mutable todo ${rawSessionId}`, status: "completed", priority: "medium" }] },
        metadata: { todos: [], truncated: false },
        status: "completed",
        time: { start: 1700000000004, end: 1700000000005 },
      },
    }));
    db.prepare("insert into todo (session_id, content, status, priority, position, time_created, time_updated) values (?, ?, ?, ?, ?, ?, ?)").run(rawSessionId, `Priority mutable todo ${rawSessionId}`, "completed", "medium", 0, 1700000000006, 1700000000007);
  } finally {
    db.close();
  }
}

function createDeliveryContextDbWithPromptOnly(dbPath: string, rawSessionId: string, prompt: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec([
      "create table session (id text primary key, time_created integer, time_updated integer);",
      "create table message (id text primary key, session_id text not null, time_created integer, data text);",
      "create table todo (session_id text not null, content text, status text, priority text, position integer, time_created integer, time_updated integer);",
      "create table event (id text primary key, session_id text not null, time_created integer, type text, properties text);",
    ].join("\n"));
    db.prepare("insert into session (id, time_created, time_updated) values (?, ?, ?)").run(rawSessionId, 1700000000000, 1700000001000);
    db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run("message-prompt-only", rawSessionId, 1700000000001, JSON.stringify({ role: "user", content: prompt }));
  } finally {
    db.close();
  }
}

async function readDeliveryContextOutput(dataDir: string, rawSessionId: string): Promise<string> {
  const hooks = await plugin.server({} as never);
  const result = await hooks.tool?.[SESSION_DELIVERY_CONTEXT_TOOL]?.execute({}, {
    abort: new AbortController().signal,
    agent: SESSION_DELIVERY_REVIEWER_AGENT,
    ask: async () => undefined,
    directory: dataDir,
    messageID: "message_fixture",
    metadata: () => { /* ignore */ },
    sessionID: rawSessionId,
    worktree: dataDir,
  });
  const output = typeof result === "string" ? result : result?.output;
  assert(typeof output === "string", "Custom tool should return JSON output string.");
  return output;
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
        const resultMetadata = typeof result === "string" ? null : result?.metadata as Record<string, unknown> | undefined;
        assert(typeof output === "string", "Custom tool should return JSON output string.");
        const parsed = JSON.parse(output) as { questionReplies?: unknown[]; session?: { counts?: Record<string, number>; sessionRef?: string }; todos?: { open?: unknown[]; unresolved?: unknown[] }; userMessages?: unknown[] };
        assert(parsed.session?.counts?.openTodos === 1, `Custom tool should report open todo, got ${output}`);
        assert(parsed.session?.counts?.unresolvedTodos === 1, `Custom tool should report unresolved todo, got ${output}`);
        assert(parsed.session?.counts?.userMessages === 2, `Custom tool should report user messages, got ${output}`);
        assert(parsed.questionReplies?.length === 1, `Custom tool should report question reply, got ${output}`);
        assert(metadataCalls.length === 1, "Custom tool should publish metadata once.");
        const metadataCall = metadataCalls[0] as { metadata?: Record<string, unknown> };
        assert(metadataCall.metadata?.userMessages === 2, `Custom tool card metadata should report user messages, got ${JSON.stringify(metadataCalls)}`);
        assert(metadataCall.metadata?.permissionReplies === 0, `Custom tool card metadata should report permission replies, got ${JSON.stringify(metadataCalls)}`);
        assert(metadataCall.metadata?.questionReplies === 1, `Custom tool card metadata should report question replies, got ${JSON.stringify(metadataCalls)}`);
        assert(metadataCall.metadata?.requirementSignals === 0, `Custom tool card metadata should report requirement signals, got ${JSON.stringify(metadataCalls)}`);
        assert(resultMetadata?.userMessages === 2, `Custom tool result metadata should report user messages, got ${JSON.stringify(resultMetadata)}`);
        assert(resultMetadata?.permissionReplies === 0, `Custom tool result metadata should report permission replies, got ${JSON.stringify(resultMetadata)}`);
        assert(resultMetadata?.questionReplies === 1, `Custom tool result metadata should report question replies, got ${JSON.stringify(resultMetadata)}`);
        assert(resultMetadata?.requirementSignals === 0, `Custom tool result metadata should report requirement signals, got ${JSON.stringify(resultMetadata)}`);
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
    name: "session delivery context custom tool supports aggregate_id event schema",
    run: async () => withTempDataDir("tool-aggregate-events", async (dataDir) => {
      const rawSessionId = "session_aggregate_secret";
      createDeliveryContextDbWithAggregateEvents(path.join(dataDir, "opencode.db"), rawSessionId);
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
          sessionID: rawSessionId,
          worktree: dataDir,
        });
        const output = typeof result === "string" ? result : result?.output;
        assert(typeof output === "string", "Custom tool should return JSON output string.");
        const parsed = JSON.parse(output) as { questionReplies?: unknown[]; warnings?: unknown[] };
        assert(parsed.questionReplies?.length === 1, `Custom tool should report aggregate_id question reply, got ${output}`);
        assert(parsed.warnings?.length === 0, `Aggregate event schema should not warn, got ${output}`);
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
    name: "session delivery context custom tool extracts all user message parts",
    run: async () => withTempDataDir("tool-message-parts", async (dataDir) => {
      const rawSessionId = "session_parts_secret";
      createDeliveryContextDbWithPartMessages(path.join(dataDir, "opencode.db"), rawSessionId);
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
          sessionID: rawSessionId,
          worktree: dataDir,
        });
        const output = typeof result === "string" ? result : result?.output;
        assert(typeof output === "string", "Custom tool should return JSON output string.");
        const parsed = JSON.parse(output) as { session?: { counts?: Record<string, number> }; userMessages?: Array<{ text?: string }>; todos?: { open?: unknown[]; unresolved?: unknown[] }; warnings?: unknown[] };
        assert(parsed.session?.counts?.userMessages === 2, `Custom tool should report all user messages from parts, got ${output}`);
        assert(parsed.userMessages?.some((message) => (message.text ?? "").includes("first requirement")) === true, `First user requirement part missing, got ${output}`);
        assert(parsed.userMessages?.some((message) => (message.text ?? "").includes("second requirement")) === true, `Second user requirement part missing, got ${output}`);
        assert(parsed.userMessages?.some((message) => (message.text ?? "").includes("assistant text")) !== true, `Assistant parts must not be counted as user messages, got ${output}`);
        assert(parsed.todos?.open?.length === 1, `Custom tool should retain open todos with part-based messages, got ${output}`);
        assert(parsed.todos?.unresolved?.length === 1, `Custom tool should report unresolved todos with part-based messages, got ${output}`);
        assert(parsed.warnings?.length === 0, `Part-based message schema should not warn, got ${output}`);
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
        const parsed = JSON.parse(output) as { questionReplies?: unknown[]; resolvedFromSessionRef?: string | null; session?: { counts?: Record<string, number>; sessionRef?: string }; todos?: { open?: unknown[]; unresolved?: unknown[] }; userMessages?: Array<{ text?: string }>; };
        assert(parsed.session?.counts?.openTodos === 1, `Custom tool invoked from child must resolve root open todo, got ${output}`);
        assert(parsed.session?.counts?.unresolvedTodos === 1, `Custom tool invoked from child must resolve root unresolved todo, got ${output}`);
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
  {
    name: "session delivery context custom tool reconstructs historical todowrite todos",
    run: async () => withTempDataDir("tool-todo-history", async (dataDir) => {
      const rawSessionId = "session_history_secret";
      createDeliveryContextDbWithTodoHistory(path.join(dataDir, "opencode.db"), rawSessionId);
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
          sessionID: rawSessionId,
          worktree: dataDir,
        });
        const output = typeof result === "string" ? result : result?.output;
        assert(typeof output === "string", "Custom tool should return JSON output string.");
        const parsed = JSON.parse(output) as { requirementSignals?: Array<{ kind?: string }>; session?: { counts?: Record<string, number> }; todos?: { current?: Array<{ content?: string }>; ever?: Array<{ content?: string; status?: string }>; history?: { toolCalls?: number; available?: boolean }; unresolved?: Array<{ content?: string; status?: string }> }; warnings?: unknown[] };
        assert(parsed.todos?.history?.available === true, `Custom tool should mark todowrite history as available, got ${output}`);
        assert(parsed.todos?.history?.toolCalls === 2, `Custom tool should count todowrite calls, got ${output}`);
        assert(parsed.session?.counts?.currentTodos === 2, `Custom tool should keep current snapshot count, got ${output}`);
        assert(parsed.session?.counts?.everTodos === 3, `Custom tool should reconstruct historical todo count, got ${output}`);
        assert(parsed.session?.counts?.unresolvedTodos === 2, `Custom tool should report unresolved historical todos, got ${output}`);
        assert(parsed.session?.counts?.requirementSignals === 6, `Custom tool should detect root requirement signals, got ${output}`);
        const requirementKinds = new Set((parsed.requirementSignals ?? []).map((signal) => signal.kind));
        for (const kind of ["archive_when_complete", "blocker_escalation_gate", "new_change_approval_required", "openspec_all_changes", "push_after_archive", "push_all"]) {
          assert(requirementKinds.has(kind), `Requirement signal ${kind} missing, got ${output}`);
        }
        assert(parsed.todos?.current?.some((todo) => (todo.content ?? "").includes("Archive OpenSpec changes")) !== true, `Current snapshot should not contain replaced parent todo in fixture, got ${output}`);
        assert(parsed.todos?.ever?.some((todo) => (todo.content ?? "").includes("Archive OpenSpec changes")) === true, `Historical todo should be retained from todowrite history, got ${output}`);
        assert(parsed.todos?.unresolved?.some((todo) => (todo.content ?? "").includes("Archive OpenSpec changes") && todo.status === "pending") === true, `Replaced unfinished todo should remain unresolved, got ${output}`);
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
    name: "session delivery context custom tool treats priority as mutable todo metadata",
    run: async () => withTempDataDir("tool-todo-priority-change", async (dataDir) => {
      const rawSessionId = "session_priority_secret";
      createDeliveryContextDbWithTodoPriorityChange(path.join(dataDir, "opencode.db"), rawSessionId);
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
          sessionID: rawSessionId,
          worktree: dataDir,
        });
        const output = typeof result === "string" ? result : result?.output;
        assert(typeof output === "string", "Custom tool should return JSON output string.");
        const parsed = JSON.parse(output) as { session?: { counts?: Record<string, number> }; todos?: { ever?: Array<{ priority?: string; status?: string }>; unresolved?: unknown[] } };
        assert(parsed.session?.counts?.everTodos === 1, `Priority-only todo updates should merge into one historical todo, got ${output}`);
        assert(parsed.session?.counts?.unresolvedTodos === 0, `Completed priority-updated todo should not remain unresolved, got ${output}`);
        assert(parsed.todos?.ever?.[0]?.priority === "medium", `Latest priority should be retained, got ${output}`);
        assert(parsed.todos?.ever?.[0]?.status === "completed", `Latest status should be retained, got ${output}`);
        assert(!output.includes(rawSessionId), "Custom tool output must redact raw session id.");
        assert(!output.includes("session_unrelated_secret"), "Custom tool output must redact unrelated session-like ids.");
        assert(!output.includes("session_deadbeefcafe"), "Custom tool output must redact hex-shaped session-like ids.");
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
    name: "session delivery context custom tool filters negated requirement signals",
    run: async () => withTempDataDir("tool-requirement-negation", async (dataDir) => {
      const rawSessionId = "session_negation_secret";
      createDeliveryContextDbWithPromptOnly(path.join(dataDir, "opencode.db"), rawSessionId, "Do not implement all OpenSpec changes. Do not archive when complete. Do not push all. Do not escalate blockers.");
      const previousDataDir = process.env.OPENCODE_DATA_DIR;
      process.env.OPENCODE_DATA_DIR = dataDir;
      try {
        const output = await readDeliveryContextOutput(dataDir, rawSessionId);
        const parsed = JSON.parse(output) as { requirementSignals?: unknown[]; session?: { counts?: Record<string, number> } };
        assert(parsed.session?.counts?.requirementSignals === 0, `Negated requirement phrases must not emit requirement signals, got ${output}`);
        assert(parsed.requirementSignals?.length === 0, `Negated requirement phrases must not emit requirement signal objects, got ${output}`);
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
    name: "session delivery context custom tool handles mixed negated requirement signals",
    run: async () => withTempDataDir("tool-requirement-mixed-negation", async (dataDir) => {
      const archiveNoPushSessionId = "session_no_push_secret";
      createDeliveryContextDbWithPromptOnly(path.join(dataDir, "opencode.db"), archiveNoPushSessionId, "Archive when complete, but do not push.");
      const previousDataDir = process.env.OPENCODE_DATA_DIR;
      process.env.OPENCODE_DATA_DIR = dataDir;
      try {
        const noPushOutput = await readDeliveryContextOutput(dataDir, archiveNoPushSessionId);
        const noPushParsed = JSON.parse(noPushOutput) as { requirementSignals?: Array<{ kind?: string }> };
        const noPushKinds = new Set((noPushParsed.requirementSignals ?? []).map((signal) => signal.kind));
        assert(noPushKinds.has("archive_when_complete"), `Archive signal should remain positive, got ${noPushOutput}`);
        assert(!noPushKinds.has("push_after_archive"), `Negated push inside archive span must not emit push_after_archive, got ${noPushOutput}`);
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
    name: "session delivery context custom tool keeps later affirmative requirement signals",
    run: async () => withTempDataDir("tool-requirement-later-affirmative", async (dataDir) => {
      const rawSessionId = "session_later_affirmative_secret";
      createDeliveryContextDbWithPromptOnly(path.join(dataDir, "opencode.db"), rawSessionId, "Do not push all; now push all.");
      const previousDataDir = process.env.OPENCODE_DATA_DIR;
      process.env.OPENCODE_DATA_DIR = dataDir;
      try {
        const output = await readDeliveryContextOutput(dataDir, rawSessionId);
        const parsed = JSON.parse(output) as { requirementSignals?: Array<{ kind?: string }>; session?: { counts?: Record<string, number> } };
        const requirementKinds = new Set((parsed.requirementSignals ?? []).map((signal) => signal.kind));
        assert(requirementKinds.has("push_all"), `Later affirmative push_all signal missing, got ${output}`);
        assert(parsed.session?.counts?.requirementSignals === 1, `Only later affirmative push_all should remain, got ${output}`);
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
    name: "session delivery context custom tool detects affirmative requirement variants",
    run: async () => withTempDataDir("tool-requirement-variants", async (dataDir) => {
      const rawSessionId = "session_variants_secret";
      createDeliveryContextDbWithPromptOnly(path.join(dataDir, "opencode.db"), rawSessionId, "Implement every OpenSpec change, then archive and push.");
      const previousDataDir = process.env.OPENCODE_DATA_DIR;
      process.env.OPENCODE_DATA_DIR = dataDir;
      try {
        const output = await readDeliveryContextOutput(dataDir, rawSessionId);
        const parsed = JSON.parse(output) as { requirementSignals?: Array<{ kind?: string }>; session?: { counts?: Record<string, number> } };
        const requirementKinds = new Set((parsed.requirementSignals ?? []).map((signal) => signal.kind));
        for (const kind of ["archive_when_complete", "openspec_all_changes", "push_after_archive"]) {
          assert(requirementKinds.has(kind), `Affirmative requirement variant signal ${kind} missing, got ${output}`);
        }
        assert(parsed.session?.counts?.requirementSignals === 3, `Affirmative variant should emit expected requirement signal count, got ${output}`);
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
