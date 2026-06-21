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
      openTodos: number;
      questionReplies: number;
      userMessages: number;
    };
    sessionRef: string;
  } | null;
  warnings: unknown[];
};

type SessionDeliveryContextModule = {
  readSessionDeliveryContext: (options: { resolveRoot?: boolean; sessionId: string }) => SessionDeliveryContextResult;
};

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
        description: "Return redacted delivery-review context for the OpenCode session being reviewed: user prompts, question replies, permission replies, and todos. When the reviewer runs as a subagent, resolves the root parent session so it audits the reviewed work session, not its own child session.",
        async execute(_args, context) {
          const { readSessionDeliveryContext } = await loadSessionDeliveryContextModule();
          const result = readSessionDeliveryContext({ resolveRoot: true, sessionId: context.sessionID });
          context.metadata({
            metadata: {
              missingSessions: result.missingSessions.length,
              openTodos: result.session?.counts.openTodos ?? 0,
              questionReplies: result.session?.counts.questionReplies ?? 0,
              resolvedFromSessionRef: result.resolvedFromSessionRef,
              sessionRef: result.session?.sessionRef ?? null,
              userMessages: result.session?.counts.userMessages ?? 0,
              warnings: result.warnings.length,
            },
            title: "Session delivery context",
          });
          return {
            metadata: {
              missingSessions: result.missingSessions.length,
              openTodos: result.session?.counts.openTodos ?? 0,
              resolvedFromSessionRef: result.resolvedFromSessionRef,
              sessionRef: result.session?.sessionRef ?? null,
              warnings: result.warnings.length,
            },
            output: `${JSON.stringify(result, null, 2)}\n`,
            title: "Session delivery context",
          };
        },
      },
    },
  }),
} satisfies { id: string; server: Plugin };
