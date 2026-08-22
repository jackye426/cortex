import type { RawEnvelope } from "@cortex/core";
import type { SessionDetail, SessionMessage, SessionToolCall } from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extraSummary(env: RawEnvelope): Record<string, unknown> | null {
  const extra = env.provenance.extra;
  if (!isRecord(extra)) return null;
  const summary = extra.summary;
  return isRecord(summary) ? summary : extra;
}

/**
 * Lift a Claude/Codex/Cursor (or ChatGPT) RawEnvelope into SessionDetail
 * using provenance.extra.summary turns + nested tools.
 */
export function sessionDetailFromEnvelope(env: RawEnvelope): SessionDetail {
  const summary = extraSummary(env);
  const body = isRecord(env.body) ? env.body : {};
  const sourceSessionId =
    env.sourceRecordId ||
    (typeof summary?.sessionId === "string" ? summary.sessionId : null) ||
    (typeof summary?.conversationId === "string"
      ? summary.conversationId
      : null) ||
    (typeof body.sessionId === "string" ? body.sessionId : "unknown");

  const title =
    (typeof summary?.title === "string" && summary.title) ||
    (typeof body.title === "string" && body.title) ||
    null;

  const workspace =
    env.provenance.workspace ??
    (typeof summary?.cwd === "string" ? summary.cwd : null) ??
    (typeof summary?.projectDir === "string" ? summary.projectDir : null);

  const startedAt =
    env.occurredAt ??
    (typeof summary?.occurredAt === "string" ? summary.occurredAt : null);
  const endedAt =
    typeof summary?.updatedAt === "string" ? summary.updatedAt : startedAt;

  const turns = Array.isArray(summary?.turns) ? summary.turns : [];
  const messages: SessionMessage[] = [];
  const toolCalls: SessionToolCall[] = [];
  let toolIndex = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!isRecord(turn)) continue;
    const role = typeof turn.role === "string" ? turn.role : "unknown";
    const id =
      (typeof turn.uuid === "string" && turn.uuid) ||
      (typeof turn.bubbleId === "string" && turn.bubbleId) ||
      (typeof turn.messageId === "string" && turn.messageId) ||
      `turn-${i}`;
    const content =
      (typeof turn.textPreview === "string" && turn.textPreview) ||
      (typeof turn.content === "string" && turn.content) ||
      "";
    messages.push({ id, role, content });

    const tools = Array.isArray(turn.tools) ? turn.tools : [];
    for (const tool of tools) {
      if (!isRecord(tool)) continue;
      const toolName =
        (typeof tool.name === "string" && tool.name) ||
        (typeof tool.toolName === "string" && tool.toolName) ||
        "Tool";
      const argsSummary =
        (typeof tool.argsPreview === "string" && tool.argsPreview) ||
        (typeof tool.command === "string" && tool.command) ||
        (typeof tool.argsSummary === "string" && tool.argsSummary) ||
        null;
      const status = typeof tool.status === "string" ? tool.status : "ok";
      const toolId =
        (typeof tool.id === "string" && tool.id) ||
        (typeof tool.callId === "string" && tool.callId) ||
        `tool-${toolIndex}`;
      toolIndex += 1;
      toolCalls.push({ id: toolId, toolName, argsSummary, status });
    }
  }

  return {
    id: `${env.source}:${sourceSessionId}`,
    sourceId: env.source,
    sourceSessionId,
    title,
    workspace,
    startedAt,
    endedAt,
    metadata: {
      collector: env.provenance.collector,
      host: env.provenance.host,
      extraKind: isRecord(env.provenance.extra)
        ? env.provenance.extra.kind
        : undefined,
    },
    messages,
    toolCalls,
    distillate: null,
  };
}

export const CODING_SESSION_SOURCES = new Set([
  "claude-code",
  "codex",
  "cursor",
]);

export function isCodingSessionEnvelope(env: RawEnvelope): boolean {
  return CODING_SESSION_SOURCES.has(env.source);
}
