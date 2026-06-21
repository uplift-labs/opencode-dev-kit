#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type DateRange = { from: string | null; to: string | null };
type DeliveryContextEventKind = "message" | "session_input";
type DeliveryContextQuestionStatus = "replied" | "rejected";
type DeliveryContextRequirementSignalKind = "archive_when_complete" | "blocker_escalation_gate" | "new_change_approval_required" | "openspec_all_changes" | "push_after_archive" | "push_all";
type DeliveryContextTodoSource = "current" | "todowrite";

export type DeliveryContextTodo = {
  content?: string;
  eventRef: string;
  firstSeen: string | null;
  lastSeen: string | null;
  priority: string | null;
  seenCount: number;
  source: DeliveryContextTodoSource;
  status: string | null;
  time: string | null;
};

export type DeliveryContextTodoHistory = {
  available: boolean;
  source: "current_snapshot_only" | "todowrite_parts";
  toolCalls: number;
};

export type DeliveryContextUserMessage = {
  eventRef: string;
  kind: DeliveryContextEventKind;
  text: string;
  time: string | null;
};

export type DeliveryContextQuestionReply = {
  answers: string[][];
  eventRef: string;
  questions: string[];
  requestRef: string | null;
  status: DeliveryContextQuestionStatus;
  time: string | null;
};

export type DeliveryContextPermissionReply = {
  eventRef: string;
  reply: string | null;
  requestRef: string | null;
  time: string | null;
};

export type DeliveryContextRequirementSignal = {
  eventRef: string;
  kind: DeliveryContextRequirementSignalKind;
  messageRef: string;
  text: string;
  time: string | null;
};

export type SessionDeliveryContextResult = {
  generatedAt: string;
  missingSessions: string[];
  permissionReplies: DeliveryContextPermissionReply[];
  questionReplies: DeliveryContextQuestionReply[];
  requirementSignals: DeliveryContextRequirementSignal[];
  session: {
      counts: {
        currentTodos: number;
        everTodos: number;
        openTodos: number;
        permissionReplies: number;
        questionReplies: number;
        requirementSignals: number;
        todoToolCalls: number;
        todos: number;
        unresolvedTodos: number;
        userMessages: number;
      };
    dateRange: DateRange;
    sessionRef: string;
    sourceRef: string;
  } | null;
  resolvedFromSessionRef: string | null;
  todos: {
    current: DeliveryContextTodo[];
    ever: DeliveryContextTodo[];
    history: DeliveryContextTodoHistory;
    open: DeliveryContextTodo[];
    unresolved: DeliveryContextTodo[];
  };
  tool: "opencode-session-delivery-context";
  userMessages: DeliveryContextUserMessage[];
  warnings: string[];
};

export type ReadSessionDeliveryContextOptions = {
  dataDirs?: string[];
  dbPaths?: string[];
  generatedAt?: string;
  resolveRoot?: boolean;
  sessionId: string;
  useDefaultPaths?: boolean;
};

type SessionRow = Record<string, unknown> & { id: unknown };
type EventRow = Record<string, unknown> & { id: unknown };
type DbSchema = Map<string, Set<string>>;
type RequestedSessionSelection = {
  candidateRefs: Set<string>;
  missingRef: string;
  rawIds: Set<string>;
};
type TodoEvidence = {
  content?: string;
  eventRef: string;
  millis: number | null;
  priority: string | null;
  source: DeliveryContextTodoSource;
  status: string | null;
};
type TodoAccumulator = {
  content?: string;
  eventRefs: string[];
  firstSeenMillis: number | null;
  identity: string;
  lastSeenMillis: number | null;
  priority: string | null;
  seenCount: number;
  source: DeliveryContextTodoSource;
  status: string | null;
};
type TodoHistoryEvidence = {
  history: DeliveryContextTodoHistory;
  todos: TodoEvidence[];
};

const SESSION_REF_PATTERN = /^session_[a-f0-9]{12}$/;
const CLOSED_TODO_STATUSES = new Set(["cancelled", "completed"]);
const OPEN_TODO_STATUSES = new Set(["pending", "in_progress"]);
const QUESTION_ASKED_EVENTS = new Set(["question.asked", "question.v2.asked"]);
const QUESTION_REPLIED_EVENTS = new Set(["question.replied", "question.v2.replied"]);
const QUESTION_REJECTED_EVENTS = new Set(["question.rejected", "question.v2.rejected"]);
const PERMISSION_REPLIED_EVENTS = new Set(["permission.replied", "permission.v2.replied"]);
const STRUCTURAL_SECRET_KEYS = new Set(["cwd", "directory", "id", "message_id", "parent_id", "path", "project_id", "root", "session_id", "sessionid", "share_url", "workspace_id", "worktree"]);
const REQUIREMENT_PUSH_NEGATION_IN_MATCH_PATTERN = /(?:do\s+not|don't|dont|must\s+not|should\s+not|never|not|no|не|нельзя|не\s+надо|не\s+нужно)\s+[\s\S]{0,80}(?:push|пуш|запуш)/iu;
const REQUIREMENT_SIGNAL_RULES: Array<{ kind: DeliveryContextRequirementSignalKind; negationInMatch?: RegExp; pattern: RegExp; text: string }> = [
  {
    kind: "openspec_all_changes",
    pattern: /(?:реализ(?:уй|овать)|сдел[а-я]*|implement|complete|finish)[\s\S]{0,120}(?:все|all|every|кажд[а-я]*)[\s\S]{0,80}openspec[\s\S]{0,80}changes?/iu,
    text: "User requested all OpenSpec changes implemented in full.",
  },
  {
    kind: "archive_when_complete",
    pattern: /(?:как\s+закончишь[\s\S]{0,60}заархив|(?:потом|затем)[\s\S]{0,60}архив|archive[\s\S]{0,80}(?:when\s+(?:complete|done)|after\s+(?:completion|finishing)|once\s+complete)|(?:then|afterwards)[\s\S]{0,60}archive)/iu,
    text: "User requested archive after completion.",
  },
  {
    kind: "push_after_archive",
    negationInMatch: REQUIREMENT_PUSH_NEGATION_IN_MATCH_PATTERN,
    pattern: /(?:каждый\s+раз[\s\S]{0,80}архив[\s\S]{0,80}(?:пуш|запуш)|архив[\s\S]{0,80}(?:пуш|запуш)|(?:archive|archiving|archived)[\s\S]{0,80}(?:push|git)|(?:then|afterwards)[\s\S]{0,80}push)/iu,
    text: "User requested push after each archive.",
  },
  {
    kind: "blocker_escalation_gate",
    pattern: /(?:блокер[\s\S]{0,120}эскалир|escalat[\s\S]{0,80}blocker)/iu,
    text: "User allowed blocker escalation only under stated conditions.",
  },
  {
    kind: "new_change_approval_required",
    pattern: /(?:нов[а-я]*\s+change[\s\S]{0,120}соглас|create[\s\S]{0,40}new\s+change[\s\S]{0,80}(?:ask|approv|confirm))/iu,
    text: "User required approval before creating a new OpenSpec change.",
  },
  {
    kind: "push_all",
    pattern: /(?:запушь\s+все|push\s+all)/iu,
    text: "User requested pushing all completed work.",
  },
];
const REQUIREMENT_NEGATION_PREFIX_PATTERN = /(?:do\s+not|don't|dont|must\s+not|should\s+not|never|not|no|не|нельзя|не\s+надо|не\s+нужно)\s+[\s\S]{0,80}$/iu;

function requireHome(): string {
  const home = os.homedir();
  if (!home) {
    throw new Error("Home directory is not available; pass explicit dbPaths or dataDirs.");
  }
  return home;
}

function expandHome(input: string): string {
  if (input === "~") {
    return requireHome();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(requireHome(), input.slice(2));
  }
  return input;
}

function resolveInputPath(input: string): string {
  return path.resolve(expandHome(input));
}

function normalizeForDedupe(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    const key = normalizeForDedupe(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }
  return result;
}

function candidateDataDirs(options: Pick<ReadSessionDeliveryContextOptions, "dataDirs" | "useDefaultPaths">): string[] {
  const candidates = [...(options.dataDirs ?? [])];
  if (options.useDefaultPaths === false) {
    return uniquePaths(candidates.map(resolveInputPath));
  }
  const home = requireHome();
  if (process.env.OPENCODE_DATA_DIR) {
    candidates.push(resolveInputPath(process.env.OPENCODE_DATA_DIR));
  }
  if (process.env.XDG_DATA_HOME) {
    candidates.push(path.join(resolveInputPath(process.env.XDG_DATA_HOME), "opencode"));
  }
  candidates.push(path.join(home, ".local", "share", "opencode"));
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "opencode"));
  }
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "opencode"));
  }
  candidates.push(path.join(home, "Library", "Application Support", "opencode"));
  return uniquePaths(candidates.map(resolveInputPath));
}

function discoverDbPaths(options: Pick<ReadSessionDeliveryContextOptions, "dataDirs" | "dbPaths" | "useDefaultPaths">): string[] {
  const dataDirs = candidateDataDirs(options);
  const candidates = [...(options.dbPaths ?? []).map(resolveInputPath)];
  const explicitDataDirs = new Set((options.dataDirs ?? []).map((dir) => normalizeForDedupe(resolveInputPath(dir))));
  for (const dir of dataDirs) {
    const dbPath = path.join(dir, "opencode.db");
    if (explicitDataDirs.has(normalizeForDedupe(dir)) || fs.existsSync(dbPath)) {
      candidates.push(dbPath);
    }
  }
  return uniquePaths(candidates);
}

function hashRef(prefix: string, value: string | null | undefined): string {
  const normalized = value == null || value === "" ? "<missing>" : value;
  const digest = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `${prefix}_${digest}`;
}

function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function normalizeCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeMillis(value: unknown): number | null {
  const numeric = normalizeCount(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function isoTime(value: number | null): string | null {
  if (value == null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function makeDateRange(values: Array<number | null>): DateRange {
  const concrete = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (concrete.length === 0) {
    return { from: null, to: null };
  }
  return { from: isoTime(Math.min(...concrete)), to: isoTime(Math.max(...concrete)) };
}

function tableNames(db: InstanceType<typeof DatabaseSync>): Set<string> {
  const rows = db.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: unknown }>;
  return new Set(rows.map((row) => String(row.name)));
}

function tableColumns(db: InstanceType<typeof DatabaseSync>, table: string): Set<string> {
  const rows = db.prepare(`pragma table_info(${quoteIdent(table)})`).all() as Array<{ name: unknown }>;
  return new Set(rows.map((row) => String(row.name)));
}

function hasColumns(schema: DbSchema, table: string, columns: string[]): boolean {
  const tableColumnsForTable = schema.get(table);
  return tableColumnsForTable != null && columns.every((column) => tableColumnsForTable.has(column));
}

function hasAnyColumn(schema: DbSchema, table: string, columns: string[]): boolean {
  const tableColumnsForTable = schema.get(table);
  return tableColumnsForTable != null && columns.some((column) => tableColumnsForTable.has(column));
}

function selectColumnOrNull(schema: DbSchema, table: string, column: string, alias = column): string {
  return schema.get(table)?.has(column) === true ? quoteIdent(column) : `null as ${quoteIdent(alias)}`;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch (_error) {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function eventTime(value: unknown): string | null {
  const millis = normalizeMillis(value);
  if (millis == null) {
    return null;
  }
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function millisFromIso(value: string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

function requestedSession(sessionId: string): RequestedSessionSelection {
  if (SESSION_REF_PATTERN.test(sessionId)) {
    return {
      candidateRefs: new Set([sessionId, hashRef("session", sessionId)]),
      missingRef: hashRef("session", sessionId),
      rawIds: new Set([sessionId]),
    };
  }
  const ref = hashRef("session", sessionId);
  return { candidateRefs: new Set([ref]), missingRef: ref, rawIds: new Set([sessionId]) };
}

function selectedRows(db: InstanceType<typeof DatabaseSync>, schema: DbSchema, requested: RequestedSessionSelection): SessionRow[] {
  const orderBy = schema.get("session")?.has("time_created") === true ? "time_created, id" : "id";
  const rows = db.prepare(`select * from session order by ${orderBy}`).all() as SessionRow[];
  return rows.filter((row) => {
    const rawId = String(row.id);
    return requested.rawIds.has(rawId) || requested.candidateRefs.has(hashRef("session", rawId));
  });
}

function resolveRootRow(db: InstanceType<typeof DatabaseSync>, schema: DbSchema, startRow: SessionRow): SessionRow {
  const sessionColumns = schema.get("session");
  if (sessionColumns == null || !sessionColumns.has("parent_id")) {
    return startRow;
  }
  const visited = new Set<string>([String(startRow.id)]);
  let current: SessionRow = startRow;
  for (let depth = 0; depth < 64; depth += 1) {
    const parentId = stringValue(current.parent_id);
    if (parentId == null || visited.has(parentId)) {
      break;
    }
    visited.add(parentId);
    const parentRow = db.prepare("select * from session where id = ?").get(parentId) as SessionRow | undefined;
    if (parentRow == null) {
      break;
    }
    current = parentRow;
  }
  return current;
}

function redactKnownSessionId(value: unknown, rawSessionId: string): unknown {
  const sessionRef = hashRef("session", rawSessionId);
  if (typeof value === "string") {
    return value.replaceAll(rawSessionId, sessionRef);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactKnownSessionId(item, rawSessionId));
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, redactKnownSessionId(nested, rawSessionId)]));
}

function redactSessionTokens(value: unknown, allowedRefs: Set<string>): unknown {
  if (typeof value === "string") {
    return value.replace(/session_[A-Za-z0-9][A-Za-z0-9_-]{5,}/g, (token) => allowedRefs.has(token) ? token : hashRef("session", token));
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSessionTokens(item, allowedRefs));
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, redactSessionTokens(nested, allowedRefs)]));
}

function redactStructuralSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactStructuralSecrets);
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (STRUCTURAL_SECRET_KEYS.has(key.toLowerCase())) {
      continue;
    }
    result[key] = redactStructuralSecrets(nested);
  }
  return result;
}

function transcriptContent(value: unknown, rawSessionId: string): unknown {
  return redactSessionTokens(redactKnownSessionId(redactStructuralSecrets(value), rawSessionId), new Set([hashRef("session", rawSessionId)]));
}

function sanitizeText(value: string, rawSessionId: string): string {
  return transcriptContent(value, rawSessionId) as string;
}

function warnMissingColumns(schema: DbSchema, table: string, columns: string[], warning: string, warnings: string[]): void {
  if (!hasColumns(schema, table, columns)) {
    warnings.push(warning);
  }
}

function readTodoRows(db: InstanceType<typeof DatabaseSync>, schema: DbSchema, rawSessionId: string): DeliveryContextTodo[] {
  if (!hasColumns(schema, "todo", ["session_id"])) {
    return [];
  }
  const select = [selectColumnOrNull(schema, "todo", "content"), selectColumnOrNull(schema, "todo", "status"), selectColumnOrNull(schema, "todo", "priority"), selectColumnOrNull(schema, "todo", "position"), selectColumnOrNull(schema, "todo", "time_created"), selectColumnOrNull(schema, "todo", "time_updated")];
  const todoColumns = schema.get("todo") ?? new Set<string>();
  const orderBy = [todoColumns.has("position") ? "position" : null, todoColumns.has("time_updated") ? "time_updated" : null, todoColumns.has("time_created") ? "time_created" : null, "session_id"].filter((column): column is string => column != null).join(", ");
  const rows = db.prepare(`select ${select.join(", ")} from todo where session_id = ? order by ${orderBy}`).all(rawSessionId) as Array<Record<string, unknown>>;
  return rows.map((row, index) => {
    const firstSeenMillis = normalizeMillis(row.time_created);
    const lastSeenMillis = normalizeMillis(row.time_updated) ?? firstSeenMillis;
    const content = typeof row.content === "string" ? sanitizeText(row.content, rawSessionId) : undefined;
    return {
      content,
      eventRef: hashRef("todo", `${rawSessionId}:current:${String(row.position ?? index)}:${content ?? ""}`),
      firstSeen: isoTime(firstSeenMillis),
      lastSeen: isoTime(lastSeenMillis),
      priority: row.priority == null ? null : String(row.priority),
      seenCount: 1,
      source: "current" as const,
      status: row.status == null ? null : String(row.status),
      time: isoTime(lastSeenMillis),
    };
  });
}

function todoIdentity(todo: Pick<TodoEvidence, "content" | "eventRef">): string {
  if (todo.content == null || todo.content.trim() === "") {
    return `event:${todo.eventRef}`;
  }
  const normalizedContent = todo.content.trim().replace(/\s+/g, " ").toLowerCase();
  return `content:${normalizedContent}`;
}

function todoEvidenceFromCurrent(todo: DeliveryContextTodo): TodoEvidence {
  return {
    content: todo.content,
    eventRef: todo.eventRef,
    millis: millisFromIso(todo.lastSeen ?? todo.time ?? todo.firstSeen),
    priority: todo.priority,
    source: "current",
    status: todo.status,
  };
}

function todoItems(value: unknown, rawSessionId: string): Array<Pick<TodoEvidence, "content" | "priority" | "status">> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = parseJsonRecord(item);
    const content = stringValue(record?.content);
    if (content == null) {
      return [];
    }
    return [{
      content: sanitizeText(content, rawSessionId),
      priority: record?.priority == null ? null : String(record.priority),
      status: record?.status == null ? null : String(record.status),
    }];
  });
}

function todoWriteState(parsed: Record<string, unknown>): Record<string, unknown> | null {
  return parseJsonRecord(parsed.state);
}

function todoWriteItems(parsed: Record<string, unknown>, rawSessionId: string): Array<Pick<TodoEvidence, "content" | "priority" | "status">> {
  const state = todoWriteState(parsed);
  const input = parseJsonRecord(state?.input);
  const metadata = parseJsonRecord(state?.metadata);
  const inputTodos = todoItems(input?.todos, rawSessionId);
  if (inputTodos.length > 0) {
    return inputTodos;
  }
  return todoItems(metadata?.todos, rawSessionId);
}

function todoWriteMillis(row: Record<string, unknown>, parsed: Record<string, unknown>): number | null {
  const rowMillis = normalizeMillis(row.time_updated) ?? normalizeMillis(row.time_created);
  if (rowMillis != null) {
    return rowMillis;
  }
  const state = todoWriteState(parsed);
  const time = parseJsonRecord(state?.time);
  return normalizeMillis(time?.end) ?? normalizeMillis(time?.start);
}

function readTodoWriteHistory(db: InstanceType<typeof DatabaseSync>, schema: DbSchema, rawSessionId: string, warnings: string[]): TodoHistoryEvidence {
  const unavailable: TodoHistoryEvidence = { history: { available: false, source: "current_snapshot_only", toolCalls: 0 }, todos: [] };
  if (!schema.has("part")) {
    return unavailable;
  }
  if (!hasColumns(schema, "part", ["session_id", "data"])) {
    warnings.push("part table missing session_id/data columns; historical todowrite todo evidence unavailable");
    return unavailable;
  }
  const select = [selectColumnOrNull(schema, "part", "id"), selectColumnOrNull(schema, "part", "message_id"), selectColumnOrNull(schema, "part", "time_created"), selectColumnOrNull(schema, "part", "time_updated"), selectColumnOrNull(schema, "part", "data")];
  const partColumns = schema.get("part") ?? new Set<string>();
  const orderBy = [partColumns.has("time_created") ? "time_created" : null, partColumns.has("time_updated") ? "time_updated" : null, partColumns.has("id") ? "id" : null].filter((column): column is string => column != null).map(quoteIdent).join(", ");
  const rows = db.prepare(`select ${select.join(", ")} from part where session_id = ? order by ${orderBy || "session_id"}`).all(rawSessionId) as Array<Record<string, unknown>>;
  const todos: TodoEvidence[] = [];
  let toolCalls = 0;
  for (const [rowIndex, row] of rows.entries()) {
    const parsed = parseJsonRecord(row.data);
    if (parsed == null || stringValue(parsed.type) !== "tool" || stringValue(parsed.tool) !== "todowrite") {
      continue;
    }
    toolCalls += 1;
    const millis = todoWriteMillis(row, parsed);
    const callRef = String(row.id ?? row.message_id ?? `${rawSessionId}:${rowIndex}`);
    for (const [todoIndex, todo] of todoWriteItems(parsed, rawSessionId).entries()) {
      todos.push({
        content: todo.content,
        eventRef: hashRef("todo", `${rawSessionId}:todowrite:${callRef}:${todoIndex}:${todo.content ?? ""}`),
        millis,
        priority: todo.priority,
        source: "todowrite",
        status: todo.status,
      });
    }
  }
  return { history: { available: toolCalls > 0, source: toolCalls > 0 ? "todowrite_parts" : "current_snapshot_only", toolCalls }, todos };
}

function mergeTodoEvidence(evidence: TodoEvidence[]): DeliveryContextTodo[] {
  const byIdentity = new Map<string, TodoAccumulator>();
  for (const item of evidence) {
    const key = todoIdentity(item);
    const existing = byIdentity.get(key);
    if (existing == null) {
      byIdentity.set(key, {
        content: item.content,
        eventRefs: [item.eventRef],
        firstSeenMillis: item.millis,
        identity: key,
        lastSeenMillis: item.millis,
        priority: item.priority,
        seenCount: 1,
        source: item.source,
        status: item.status,
      });
      continue;
    }
    existing.eventRefs.push(item.eventRef);
    existing.seenCount += 1;
    if (item.millis != null && (existing.firstSeenMillis == null || item.millis < existing.firstSeenMillis)) {
      existing.firstSeenMillis = item.millis;
    }
    const isLatest = item.millis == null || existing.lastSeenMillis == null || item.millis >= existing.lastSeenMillis;
    if (isLatest) {
      existing.content = item.content ?? existing.content;
      existing.lastSeenMillis = item.millis ?? existing.lastSeenMillis;
      existing.priority = item.priority;
      existing.source = item.source;
      existing.status = item.status;
    }
  }
  return [...byIdentity.values()].map((todo) => {
    const firstSeen = isoTime(todo.firstSeenMillis);
    const lastSeen = isoTime(todo.lastSeenMillis);
    return {
      content: todo.content,
      eventRef: hashRef("todo", todo.identity),
      firstSeen,
      lastSeen,
      priority: todo.priority,
      seenCount: todo.seenCount,
      source: todo.source,
      status: todo.status,
      time: lastSeen,
    };
  }).sort((left, right) => (left.firstSeen ?? "").localeCompare(right.firstSeen ?? "") || left.eventRef.localeCompare(right.eventRef));
}

function textParts(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((part) => {
    if (typeof part === "string") {
      return [part];
    }
    const record = parseJsonRecord(part);
    return [stringValue(record?.text), stringValue(record?.content)].filter((text): text is string => text != null);
  });
}

function messageText(parsed: Record<string, unknown> | null): string | null {
  if (!parsed || parsed.role !== "user") {
    return null;
  }
  const direct = stringValue(parsed.content) ?? stringValue(parsed.text);
  if (direct) {
    return direct;
  }
  const parts = textParts(parsed.parts);
  return parts.length > 0 ? parts.join("\n") : null;
}

function messagePartText(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) {
    return null;
  }
  return stringValue(parsed.text) ?? stringValue(parsed.content);
}

function readMessagePartTexts(db: InstanceType<typeof DatabaseSync>, schema: DbSchema, rawSessionId: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!hasColumns(schema, "part", ["session_id", "message_id", "data"])) {
    return result;
  }
  const select = [selectColumnOrNull(schema, "part", "id"), selectColumnOrNull(schema, "part", "message_id"), selectColumnOrNull(schema, "part", "time_created"), selectColumnOrNull(schema, "part", "data")];
  const partColumns = schema.get("part") ?? new Set<string>();
  const orderBy = [partColumns.has("time_created") ? "time_created" : null, partColumns.has("id") ? "id" : null].filter((column): column is string => column != null).map(quoteIdent).join(", ");
  const rows = db.prepare(`select ${select.join(", ")} from part where session_id = ? order by ${orderBy || "message_id"}`).all(rawSessionId) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const messageId = stringValue(row.message_id);
    if (messageId == null) {
      continue;
    }
    const text = messagePartText(parseJsonRecord(row.data));
    if (text == null) {
      continue;
    }
    const existing = result.get(messageId) ?? [];
    existing.push(text);
    result.set(messageId, existing);
  }
  return result;
}

function readSessionInputs(db: InstanceType<typeof DatabaseSync>, schema: DbSchema, rawSessionId: string): DeliveryContextUserMessage[] {
  if (!hasColumns(schema, "session_input", ["session_id"])) {
    return [];
  }
  const select = [selectColumnOrNull(schema, "session_input", "id"), selectColumnOrNull(schema, "session_input", "prompt"), selectColumnOrNull(schema, "session_input", "time_created")];
  const orderBy = schema.get("session_input")?.has("time_created") === true ? "time_created, id" : "session_id";
  const rows = db.prepare(`select ${select.join(", ")} from session_input where session_id = ? order by ${orderBy}`).all(rawSessionId) as Array<Record<string, unknown>>;
  return rows.flatMap((row, index): DeliveryContextUserMessage[] => {
    if (typeof row.prompt !== "string") {
      return [];
    }
    return [{ eventRef: hashRef("input", String(row.id ?? `${rawSessionId}:${index}`)), kind: "session_input", text: sanitizeText(row.prompt, rawSessionId), time: eventTime(row.time_created) }];
  });
}

function readUserMessages(db: InstanceType<typeof DatabaseSync>, schema: DbSchema, rawSessionId: string): DeliveryContextUserMessage[] {
  if (!hasColumns(schema, "message", ["session_id"])) {
    return [];
  }
  const partTextsByMessage = readMessagePartTexts(db, schema, rawSessionId);
  const select = [selectColumnOrNull(schema, "message", "id"), selectColumnOrNull(schema, "message", "time_created"), selectColumnOrNull(schema, "message", "data")];
  const orderBy = schema.get("message")?.has("time_created") === true ? "time_created, id" : "session_id";
  const rows = db.prepare(`select ${select.join(", ")} from message where session_id = ? order by ${orderBy}`).all(rawSessionId) as Array<Record<string, unknown>>;
  return rows.flatMap((row, index): DeliveryContextUserMessage[] => {
    const parsed = parseJsonRecord(row.data);
    if (!parsed || parsed.role !== "user") {
      return [];
    }
    const messageId = String(row.id ?? `${rawSessionId}:${index}`);
    const partsText = partTextsByMessage.get(messageId)?.join("\n");
    const text = partsText && partsText.length > 0 ? partsText : messageText(parsed);
    if (!text) {
      return [];
    }
    return [{ eventRef: hashRef("message", messageId), kind: "message", text: sanitizeText(text, rawSessionId), time: eventTime(row.time_created) }];
  });
}

function lastClauseBoundary(text: string, index: number): number {
  return Math.max(text.lastIndexOf(".", index), text.lastIndexOf("!", index), text.lastIndexOf("?", index), text.lastIndexOf(";", index), text.lastIndexOf("\n", index)) + 1;
}

function requirementMatches(pattern: RegExp, text: string): RegExpMatchArray[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))];
}

function positiveRequirementSignal(rule: { negationInMatch?: RegExp; pattern: RegExp }, text: string): boolean {
  for (const match of requirementMatches(rule.pattern, text)) {
    if (match.index == null) {
      continue;
    }
    const clauseStart = lastClauseBoundary(text, match.index);
    const prefix = text.slice(clauseStart, match.index);
    const span = match[0];
    if (!REQUIREMENT_NEGATION_PREFIX_PATTERN.test(prefix) && rule.negationInMatch?.test(span) !== true) {
      return true;
    }
  }
  return false;
}

function detectRequirementSignals(userMessages: DeliveryContextUserMessage[]): DeliveryContextRequirementSignal[] {
  const signals: DeliveryContextRequirementSignal[] = [];
  const seen = new Set<string>();
  for (const message of userMessages) {
    for (const rule of REQUIREMENT_SIGNAL_RULES) {
      if (!positiveRequirementSignal(rule, message.text)) {
        continue;
      }
      const key = `${message.eventRef}:${rule.kind}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      signals.push({
        eventRef: hashRef("requirement", key),
        kind: rule.kind,
        messageRef: message.eventRef,
        text: rule.text,
        time: message.time,
      });
    }
  }
  return signals;
}

function eventPayload(row: EventRow): Record<string, unknown> {
  return [parseJsonRecord(row.data), parseJsonRecord(row.properties), parseJsonRecord(row.payload)].reduce<Record<string, unknown>>((acc, record) => record == null ? acc : { ...acc, ...record }, {});
}

function eventType(row: EventRow, payload: Record<string, unknown>): string | null {
  return stringValue(row.type) ?? stringValue(row.name) ?? stringValue(row.event) ?? stringValue(payload.type) ?? stringValue(payload.name);
}

function requestId(payload: Record<string, unknown>): string | null {
  return stringValue(payload.requestID) ?? stringValue(payload.requestId) ?? stringValue(payload.id);
}

function questionTexts(payload: Record<string, unknown>, rawSessionId: string): string[] {
  const questions = payload.questions;
  if (!Array.isArray(questions)) {
    return [];
  }
  return questions.flatMap((question) => {
    if (typeof question === "string") {
      return [sanitizeText(question, rawSessionId)];
    }
    const record = parseJsonRecord(question);
    const text = stringValue(record?.question) ?? stringValue(record?.header) ?? stringValue(record?.title);
    return text == null ? [] : [sanitizeText(text, rawSessionId)];
  });
}

function answerMatrix(value: unknown, rawSessionId: string): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((answerRow) => Array.isArray(answerRow) ? answerRow.filter((answer): answer is string => typeof answer === "string").map((answer) => sanitizeText(answer, rawSessionId)) : typeof answerRow === "string" ? [sanitizeText(answerRow, rawSessionId)] : []).filter((answerRow) => answerRow.length > 0);
}

function deliveryEventRef(row: EventRow, index: number, type: string | null, request: string | null): string {
  const id = row.id == null ? `${String(type ?? "event")}:${String(request ?? "unknown")}:${index}` : String(row.id);
  return hashRef("event", id);
}

function eventSessionColumn(schema: DbSchema): string | null {
  const columns = schema.get("event");
  if (columns == null) {
    return null;
  }
  if (columns.has("session_id")) {
    return "session_id";
  }
  if (columns.has("aggregate_id")) {
    return "aggregate_id";
  }
  return null;
}

function eventOrderBy(schema: DbSchema, sessionColumn: string): string {
  const columns = schema.get("event") ?? new Set<string>();
  const orderColumns = [columns.has("time_created") ? "time_created" : null, columns.has("seq") ? "seq" : null, columns.has("id") ? "id" : null].filter((column): column is string => column != null);
  return orderColumns.length > 0 ? orderColumns.map(quoteIdent).join(", ") : quoteIdent(sessionColumn);
}

function readQuestionAndPermissionEvents(db: InstanceType<typeof DatabaseSync>, schema: DbSchema, rawSessionId: string, warnings: string[]): { permissionReplies: DeliveryContextPermissionReply[]; questionReplies: DeliveryContextQuestionReply[] } {
  if (!schema.has("event")) {
    warnings.push("event table missing; question and permission replies unavailable");
    return { permissionReplies: [], questionReplies: [] };
  }
  const sessionColumn = eventSessionColumn(schema);
  if (sessionColumn == null) {
    warnings.push("event table missing session_id/aggregate_id column; question and permission replies unavailable");
    return { permissionReplies: [], questionReplies: [] };
  }
  if (!hasAnyColumn(schema, "event", ["type", "name", "event"])) {
    warnings.push("event table missing type/name/event discriminator columns; question and permission replies may be unavailable");
  }
  if (!hasAnyColumn(schema, "event", ["data", "properties", "payload"])) {
    warnings.push("event table missing data/properties/payload columns; question and permission replies may be unavailable");
  }
  const select = [selectColumnOrNull(schema, "event", "id"), selectColumnOrNull(schema, "event", "time_created"), selectColumnOrNull(schema, "event", "type"), selectColumnOrNull(schema, "event", "name"), selectColumnOrNull(schema, "event", "event"), selectColumnOrNull(schema, "event", "data"), selectColumnOrNull(schema, "event", "properties"), selectColumnOrNull(schema, "event", "payload")];
  const rows = db.prepare(`select ${select.join(", ")} from event where ${quoteIdent(sessionColumn)} = ? order by ${eventOrderBy(schema, sessionColumn)}`).all(rawSessionId) as EventRow[];
  const questionsByRequest = new Map<string, string[]>();
  const questionReplies: DeliveryContextQuestionReply[] = [];
  const permissionReplies: DeliveryContextPermissionReply[] = [];

  for (const [index, row] of rows.entries()) {
    const payload = eventPayload(row);
    const type = eventType(row, payload);
    const request = requestId(payload);
    if (type != null && QUESTION_ASKED_EVENTS.has(type) && request != null) {
      questionsByRequest.set(request, questionTexts(payload, rawSessionId));
      continue;
    }
    if (type != null && (QUESTION_REPLIED_EVENTS.has(type) || QUESTION_REJECTED_EVENTS.has(type))) {
      const replied = QUESTION_REPLIED_EVENTS.has(type);
      questionReplies.push({
        answers: replied ? answerMatrix(payload.answers, rawSessionId) : [],
        eventRef: deliveryEventRef(row, index, type, request),
        questions: request == null ? [] : questionsByRequest.get(request) ?? [],
        requestRef: request == null ? null : hashRef("question", request),
        status: replied ? "replied" : "rejected",
        time: eventTime(row.time_created),
      });
      continue;
    }
    if (type != null && PERMISSION_REPLIED_EVENTS.has(type)) {
      const reply = stringValue(payload.reply) ?? stringValue(payload.response);
      permissionReplies.push({
        eventRef: deliveryEventRef(row, index, type, request),
        reply: reply == null ? null : sanitizeText(reply, rawSessionId),
        requestRef: request == null ? null : hashRef("permission", request),
        time: eventTime(row.time_created),
      });
    }
  }
  return { permissionReplies, questionReplies };
}

function emptyResult(options: ReadSessionDeliveryContextOptions, missingRef: string, warnings: string[]): SessionDeliveryContextResult {
  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    missingSessions: [missingRef],
    permissionReplies: [],
    questionReplies: [],
    requirementSignals: [],
    resolvedFromSessionRef: null,
    session: null,
    todos: { current: [], ever: [], history: { available: false, source: "current_snapshot_only", toolCalls: 0 }, open: [], unresolved: [] },
    tool: "opencode-session-delivery-context",
    userMessages: [],
    warnings,
  };
}

function contextForRow(db: InstanceType<typeof DatabaseSync>, schema: DbSchema, sourceRef: string, row: SessionRow, options: ReadSessionDeliveryContextOptions, warnings: string[], resolvedFromSessionRef: string | null): SessionDeliveryContextResult {
  const rawSessionId = String(row.id);
  warnMissingColumns(schema, "todo", ["session_id"], "todo table missing session_id column; todo evidence unavailable", warnings);
  warnMissingColumns(schema, "session_input", ["session_id"], "session_input table missing session_id column; direct prompt evidence unavailable", warnings);
  warnMissingColumns(schema, "message", ["session_id"], "message table missing session_id column; message prompt evidence unavailable", warnings);
  if (hasColumns(schema, "todo", ["session_id"]) && !hasColumns(schema, "todo", ["content", "status"])) {
    warnings.push("todo table missing content/status columns; todo evidence may be incomplete");
  }
  if (hasColumns(schema, "session_input", ["session_id"]) && !hasColumns(schema, "session_input", ["prompt"])) {
    warnings.push("session_input table missing prompt column; direct prompt evidence unavailable");
  }
  if (hasColumns(schema, "message", ["session_id"]) && !hasColumns(schema, "message", ["data"])) {
    warnings.push("message table missing data column; message prompt evidence unavailable");
  }
  const currentTodos = readTodoRows(db, schema, rawSessionId);
  const todoHistory = readTodoWriteHistory(db, schema, rawSessionId, warnings);
  const everTodos = mergeTodoEvidence([...todoHistory.todos, ...currentTodos.map(todoEvidenceFromCurrent)]);
  const openTodos = currentTodos.filter((todo) => todo.status != null && OPEN_TODO_STATUSES.has(todo.status));
  const unresolvedTodos = everTodos.filter((todo) => todo.status == null || !CLOSED_TODO_STATUSES.has(todo.status));
  const userMessages = [...readSessionInputs(db, schema, rawSessionId), ...readUserMessages(db, schema, rawSessionId)].sort((left, right) => (left.time ?? "").localeCompare(right.time ?? "") || left.eventRef.localeCompare(right.eventRef));
  const requirementSignals = detectRequirementSignals(userMessages);
  const events = readQuestionAndPermissionEvents(db, schema, rawSessionId, warnings);
  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    missingSessions: [],
    permissionReplies: events.permissionReplies,
    questionReplies: events.questionReplies,
    requirementSignals,
    resolvedFromSessionRef,
    session: {
      counts: {
        currentTodos: currentTodos.length,
        everTodos: everTodos.length,
        openTodos: openTodos.length,
        permissionReplies: events.permissionReplies.length,
        questionReplies: events.questionReplies.length,
        requirementSignals: requirementSignals.length,
        todoToolCalls: todoHistory.history.toolCalls,
        todos: everTodos.length,
        unresolvedTodos: unresolvedTodos.length,
        userMessages: userMessages.length,
      },
      dateRange: makeDateRange([normalizeMillis(row.time_created), normalizeMillis(row.time_updated)]),
      sessionRef: hashRef("session", rawSessionId),
      sourceRef,
    },
    todos: { current: currentTodos, ever: everTodos, history: todoHistory.history, open: openTodos, unresolved: unresolvedTodos },
    tool: "opencode-session-delivery-context",
    userMessages,
    warnings,
  };
}

export function readSessionDeliveryContext(options: ReadSessionDeliveryContextOptions): SessionDeliveryContextResult {
  const requested = requestedSession(options.sessionId);
  const warnings: string[] = [];
  const dbPaths = discoverDbPaths({ dataDirs: options.dataDirs, dbPaths: options.dbPaths, useDefaultPaths: options.useDefaultPaths });
  if (dbPaths.length === 0) {
    warnings.push("no OpenCode database candidates found; pass dbPaths or dataDirs");
  }

  for (const dbPath of dbPaths) {
    if (!fs.existsSync(dbPath)) {
      warnings.push(`${hashRef("source", dbPath)} missing`);
      continue;
    }
    let db: InstanceType<typeof DatabaseSync> | null = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const tables = tableNames(db);
      if (!tables.has("session")) {
        warnings.push(`${hashRef("source", dbPath)} missing session table`);
        continue;
      }
      const schema = new Map([...tables].map((table) => [table, tableColumns(db!, table)]));
      if (!hasColumns(schema, "session", ["id"])) {
        warnings.push(`${hashRef("source", dbPath)} missing session.id column`);
        continue;
      }
      const rows = selectedRows(db, schema, requested);
      if (rows.length > 0) {
        const startRow = rows[0];
        const startId = String(startRow.id);
        const targetRow = options.resolveRoot ? resolveRootRow(db, schema, startRow) : startRow;
        const resolvedFromSessionRef = options.resolveRoot && String(targetRow.id) !== startId ? hashRef("session", startId) : null;
        return contextForRow(db, schema, hashRef("source", dbPath), targetRow, options, warnings, resolvedFromSessionRef);
      }
    } catch (error) {
      warnings.push(`${hashRef("source", dbPath)} error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      db?.close();
    }
  }

  return emptyResult(options, requested.missingRef, warnings);
}
