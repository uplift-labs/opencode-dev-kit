import type { CoverageStatus, ProjectSessionRetroLedger, ProjectSessionRetroSession } from "./types.ts";
import { refreshAnalysisProgress } from "./progress.ts";
import { isPlainRecord } from "./utils.ts";

export type ProjectSessionRetroStatus = {
  coverage: Record<CoverageStatus, number>;
  nextSessionRefs: string[];
  nextSessions: Array<{
    coverageStatus: CoverageStatus;
    dateRange: ProjectSessionRetroSession["metadata"]["dateRange"];
    eventRows: number;
    mechanicalSignals: string[];
    messageRows: number;
    observationCount: number;
    partRows: number;
    sessionRef: string;
    todoRows: number;
    toolNames: string[];
    tokenRows: ProjectSessionRetroSession["metadata"]["tokens"];
  }>;
  progress: Omit<ProjectSessionRetroLedger["analysisProgress"], "sessionOrder">;
  scope: ProjectSessionRetroLedger["scope"];
  sources: Array<Pick<ProjectSessionRetroLedger["sources"][number], "includedSessions" | "readable" | "sessionsRead" | "sourceRef" | "status" | "type" | "warnings">>;
  totals: {
    messages: number;
    observations: number;
    parts: number;
    sessions: number;
    todos: number;
    trends: number;
    rootCauses: number;
    plans: number;
    openspecProposals: number;
  };
};

export type PatchProjectSessionRetroSessionsResult = {
  changedSessions: string[];
  ledger: ProjectSessionRetroLedger;
  progress: ProjectSessionRetroLedger["analysisProgress"];
};

type SessionPatch = Partial<Pick<ProjectSessionRetroSession, "audit" | "coverage" | "observations">>;

export function summarizeProjectSessionRetroLedger(ledger: ProjectSessionRetroLedger, options: { limit?: number } = {}): ProjectSessionRetroStatus {
  const coverage: Record<CoverageStatus, number> = { blocked: 0, complete: 0, partial: 0 };
  let messages = 0;
  let observations = 0;
  let parts = 0;
  let todos = 0;
  for (const session of Object.values(ledger.sessions)) {
    coverage[session.coverage.status]++;
    messages += session.metadata.messageRows;
    observations += session.observations.length;
    parts += session.metadata.partRows;
    todos += session.metadata.todoRows;
  }
  const limit = Math.max(0, Math.trunc(options.limit ?? 10));
  const nextSessionRefs = ledger.analysisProgress.sessionOrder
    .filter((sessionRef) => ledger.sessions[sessionRef]?.coverage.status !== "complete")
    .slice(0, limit);
  const nextSessions = nextSessionRefs.map((sessionRef) => {
    const session = ledger.sessions[sessionRef];
    return {
      coverageStatus: session.coverage.status,
      dateRange: session.metadata.dateRange,
      eventRows: session.metadata.messageRows + session.metadata.partRows + session.metadata.todoRows,
      mechanicalSignals: [...session.metadata.mechanicalSignals],
      messageRows: session.metadata.messageRows,
      observationCount: session.observations.length,
      partRows: session.metadata.partRows,
      sessionRef,
      todoRows: session.metadata.todoRows,
      tokenRows: { ...session.metadata.tokens },
      toolNames: [...session.metadata.toolNames],
    };
  });
  return {
    coverage,
    nextSessionRefs,
    nextSessions,
    progress: {
      completedSessionCount: ledger.analysisProgress.completedSessionCount,
      lastAnalyzedSessionRef: ledger.analysisProgress.lastAnalyzedSessionRef,
      nextSessionRef: ledger.analysisProgress.nextSessionRef,
      remainingSessionCount: ledger.analysisProgress.remainingSessionCount,
    },
    scope: ledger.scope,
    sources: ledger.sources.map((source) => ({
      includedSessions: source.includedSessions,
      readable: source.readable,
      sessionsRead: source.sessionsRead,
      sourceRef: source.sourceRef,
      status: source.status,
      type: source.type,
      warnings: source.warnings,
    })),
    totals: {
      messages,
      observations,
      openspecProposals: Object.keys(ledger.openspecProposals).length,
      parts,
      plans: Object.keys(ledger.plans).length,
      rootCauses: Object.keys(ledger.rootCauses).length,
      sessions: Object.keys(ledger.sessions).length,
      todos,
      trends: Object.keys(ledger.trends).length,
    },
  };
}

function asSessionPatchMap(value: unknown): Record<string, SessionPatch> {
  if (!isPlainRecord(value)) {
    throw new Error("Patch file must be an object with a sessions object.");
  }
  if (!isPlainRecord(value.sessions)) {
    throw new Error("Patch file must include a sessions object.");
  }
  return value.sessions as Record<string, SessionPatch>;
}

export function patchProjectSessionRetroSessions(ledger: ProjectSessionRetroLedger, patch: unknown): PatchProjectSessionRetroSessionsResult {
  const updated: ProjectSessionRetroLedger = { ...ledger, sessions: { ...ledger.sessions } };
  const sessionPatches = asSessionPatchMap(patch);
  const changedSessions: string[] = [];
  for (const [sessionRef, sessionPatch] of Object.entries(sessionPatches)) {
    const current = updated.sessions[sessionRef];
    if (!current) {
      throw new Error(`Patch references missing session ${sessionRef}.`);
    }
    if (!isPlainRecord(sessionPatch)) {
      throw new Error(`Patch for ${sessionRef} must be an object.`);
    }
    const unknownFields = Object.keys(sessionPatch).filter((field) => !["audit", "coverage", "observations"].includes(field));
    if (unknownFields.length > 0) {
      throw new Error(`Patch for ${sessionRef} has unsupported fields: ${unknownFields.join(", ")}.`);
    }
    updated.sessions[sessionRef] = { ...current };
    const target = updated.sessions[sessionRef];
    if (sessionPatch.audit !== undefined) {
      target.audit = sessionPatch.audit;
    }
    if (sessionPatch.coverage !== undefined) {
      target.coverage = sessionPatch.coverage;
    }
    if (sessionPatch.observations !== undefined) {
      target.observations = sessionPatch.observations;
    }
    changedSessions.push(sessionRef);
  }
  const refreshed = refreshAnalysisProgress(updated);
  return { changedSessions, ledger: refreshed, progress: refreshed.analysisProgress };
}
