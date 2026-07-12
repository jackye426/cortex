/** Shared shapes for MCP tool backends (Supabase or fixture mode). */

export interface RecordHit {
  id: string;
  sourceId: string;
  sourceRecordId: string;
  recordType: string;
  payload: Record<string, unknown>;
  contentHash: string;
  occurredAt: string | null;
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
  messages: Array<{
    id: string;
    role: string;
    content: string | null;
  }>;
  toolCalls: Array<{
    id: string;
    toolName: string;
    argsSummary: string | null;
    status: string | null;
  }>;
  distillate: DistillateRow | null;
}

export interface RecentWorkItem {
  kind: "session" | "record";
  id: string;
  sourceId: string;
  title: string;
  occurredAt: string | null;
  recordType?: string;
}

export interface EmailThread {
  threadId: string;
  subject: string | null;
  messages: Array<{
    id: string;
    sourceRecordId: string;
    from: string | null;
    to: string | null;
    subject: string | null;
    snippet: string | null;
    occurredAt: string | null;
  }>;
}

export interface CalendarEventItem {
  id: string;
  sourceRecordId: string;
  summary: string | null;
  start: string | null;
  end: string | null;
  calendarId: string | null;
  location: string | null;
}

export interface FileSummary {
  id: string;
  sourceRecordId: string;
  name: string | null;
  mimeType: string | null;
  path: string | null;
  summary: string | null;
  occurredAt: string | null;
  metadata: Record<string, unknown>;
}

/** Matches public.distillates row shape (minus owner_id for fixture mode). */
export interface DistillateRow {
  id: string;
  subjectType: string;
  subjectId: string;
  kind: string;
  content: string | null;
  embeddingRef: string | null;
  model: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SessionEnvelopeInput {
  sourceId: string;
  sourceSessionId: string;
  title?: string | null;
  workspace?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  /** Optional free-text / message snippets used for the stub summary. */
  excerpts?: string[];
  metadata?: Record<string, unknown>;
}

export interface CortexStore {
  readonly mode: "supabase" | "fixture";
  searchRecords(query: string, limit?: number): Promise<RecordHit[]>;
  getSession(sessionId: string): Promise<SessionDetail | null>;
  listRecentWork(limit?: number): Promise<RecentWorkItem[]>;
  getEmailThread(threadId: string): Promise<EmailThread | null>;
  getCalendarRange(start: string, end: string): Promise<CalendarEventItem[]>;
  getFileSummary(fileId: string): Promise<FileSummary | null>;
  /** List recent records of a given record_type (ebook, bookmark, spotify_*, youtube_*). */
  listRecordsByType(
    recordType: string,
    limit?: number,
  ): Promise<RecordHit[]>;
  listSessionsForDistillate(limit?: number): Promise<SessionEnvelopeInput[]>;
  upsertDistillate(row: Omit<DistillateRow, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
  }): Promise<DistillateRow>;
}
