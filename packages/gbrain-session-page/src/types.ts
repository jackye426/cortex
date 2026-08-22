/**
 * Session grain consumed by extractSessionOps.
 * Structural clone of apps/mcp-server SessionDetail (messages + toolCalls).
 */
export interface SessionMessage {
  id: string;
  role: string;
  content: string | null;
}

export interface SessionToolCall {
  id: string;
  toolName: string;
  argsSummary: string | null;
  status: string | null;
}

export interface SessionDetail {
  id: string;
  sourceId: string;
  sourceSessionId: string;
  title: string | null;
  workspace: string | null;
  startedAt: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
  messages: SessionMessage[];
  toolCalls: SessionToolCall[];
  distillate: unknown | null;
}

export const SESSION_SCHEMA = "session-v1" as const;

export interface SessionPageRender {
  markdown: string;
  redactionHitCount: number;
  relativePath: string;
  contentHash: string;
}

export interface SessionPageFrontmatter {
  cortex_schema: typeof SESSION_SCHEMA;
  harness: string;
  source_session_id: string;
  id: string;
  title: string | null;
  workspace: string | null;
  started_at: string | null;
  ended_at: string | null;
  content_hash: string;
  metadata: Record<string, unknown>;
}
