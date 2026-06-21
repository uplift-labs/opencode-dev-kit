import type { Plugin } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SESSION_DELIVERY_CONTEXT_TOOL = "session_delivery_context";
export const SESSION_DELIVERY_REVIEWER_AGENT = "session-delivery-reviewer";

type SessionDeliveryContextResult = {
  missingSessions: unknown[];
  resolvedFromSessionRef: string | null;
  session: {
    counts: {
      currentTodos: number;
      everTodos: number;
      openTodos: number;
      permissionReplies: number;
      questionReplies: number;
      requirementSignals: number;
      todoToolCalls: number;
      unresolvedTodos: number;
      userMessages: number;
    };
    sessionRef: string;
  } | null;
  warnings: unknown[];
};

type SessionDeliveryContextModule = {
  readSessionDeliveryContext: (options: { resolveRoot?: boolean; sessionId: string }) => SessionDeliveryContextResult;
};

function deliveryContextMetadata(result: SessionDeliveryContextResult): Record<string, unknown> {
  return {
    missingSessions: result.missingSessions.length,
    currentTodos: result.session?.counts.currentTodos ?? 0,
    everTodos: result.session?.counts.everTodos ?? 0,
    openTodos: result.session?.counts.openTodos ?? 0,
    permissionReplies: result.session?.counts.permissionReplies ?? 0,
    questionReplies: result.session?.counts.questionReplies ?? 0,
    requirementSignals: result.session?.counts.requirementSignals ?? 0,
    resolvedFromSessionRef: result.resolvedFromSessionRef,
    sessionRef: result.session?.sessionRef ?? null,
    todoToolCalls: result.session?.counts.todoToolCalls ?? 0,
    unresolvedTodos: result.session?.counts.unresolvedTodos ?? 0,
    userMessages: result.session?.counts.userMessages ?? 0,
    warnings: result.warnings.length,
  };
}

async function loadSessionDeliveryContextModule(): Promise<SessionDeliveryContextModule> {
  const pluginDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(pluginDir, "..", "..", "tools", "session-delivery-context.ts"),
    path.resolve(pluginDir, "..", "opencode-dev-kit", "tools", "session-delivery-context.ts"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return await import(pathToFileURL(candidate).href) as SessionDeliveryContextModule;
    }
  }
  throw new Error(`Unable to locate session-delivery-context.ts from ${pluginDir}`);
}

export default {
  id: "opencode-dev-kit.session-env",
  server: async () => ({
    "shell.env": async (input, output) => {
      if (typeof input.sessionID === "string" && input.sessionID !== "") {
        output.env.OPENCODE_SESSION_ID = input.sessionID;
      }
    },
    tool: {
      [SESSION_DELIVERY_CONTEXT_TOOL]: {
        args: {},
        description: "Return redacted delivery-review context for the OpenCode session being reviewed: user prompts, question replies, permission replies, current todos, and todowrite history. When the reviewer runs as a subagent, resolves the root parent session so it audits the reviewed work session, not its own child session.",
        async execute(_args, context) {
          const { readSessionDeliveryContext } = await loadSessionDeliveryContextModule();
          const result = readSessionDeliveryContext({ resolveRoot: true, sessionId: context.sessionID });
          const metadata = deliveryContextMetadata(result);
          context.metadata({
            metadata,
            title: "Session delivery context",
          });
          return {
            metadata,
            output: `${JSON.stringify(result, null, 2)}\n`,
            title: "Session delivery context",
          };
        },
      },
    },
  }),
} satisfies { id: string; server: Plugin };
