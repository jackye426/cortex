import { randomUUID } from "node:crypto";
import {
  FIXTURE_RECORDS,
  FIXTURE_SESSIONS,
  calendarFromRecords,
  emailThreadFromRecords,
  fileFromRecords,
  fixtureDistillates,
  matchQuery,
  recordToRecent,
  sessionToEnvelope,
  sessionToRecent,
} from "./fixtures.js";
import type {
  CalendarEventItem,
  CortexStore,
  DistillateRow,
  EmailThread,
  FileSummary,
  RecentWorkItem,
  RecordHit,
  SessionDetail,
  SessionEnvelopeInput,
} from "./types.js";

/**
 * In-memory fixture store — used when Supabase is not configured.
 * Mutates fixture distillates in-process for distillate worker demos.
 */
export class FixtureStore implements CortexStore {
  readonly mode = "fixture" as const;

  async searchRecords(query: string, limit = 20): Promise<RecordHit[]> {
    const hits = FIXTURE_RECORDS.filter((r) =>
      matchQuery(
        JSON.stringify({
          type: r.recordType,
          source: r.sourceId,
          id: r.sourceRecordId,
          payload: r.payload,
        }),
        query,
      ),
    );
    return hits.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  async getSession(sessionId: string): Promise<SessionDetail | null> {
    const session =
      FIXTURE_SESSIONS.find(
        (s) => s.id === sessionId || s.sourceSessionId === sessionId,
      ) ?? null;
    if (!session) return null;
    const distillate =
      fixtureDistillates.find(
        (d) =>
          d.subjectType === "session" &&
          d.subjectId === session.id &&
          d.kind === "summary",
      ) ?? null;
    return { ...session, distillate };
  }

  async listRecentWork(limit = 20): Promise<RecentWorkItem[]> {
    const items: RecentWorkItem[] = [
      ...FIXTURE_SESSIONS.map(sessionToRecent),
      ...FIXTURE_RECORDS.map(recordToRecent),
    ];
    items.sort((a, b) =>
      (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""),
    );
    return items.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  async getEmailThread(threadId: string): Promise<EmailThread | null> {
    return emailThreadFromRecords(threadId, FIXTURE_RECORDS);
  }

  async getCalendarRange(
    start: string,
    end: string,
  ): Promise<CalendarEventItem[]> {
    return calendarFromRecords(start, end, FIXTURE_RECORDS);
  }

  async getFileSummary(fileId: string): Promise<FileSummary | null> {
    return fileFromRecords(fileId, FIXTURE_RECORDS);
  }

  async listRecordsByType(
    recordType: string,
    limit = 20,
  ): Promise<RecordHit[]> {
    return FIXTURE_RECORDS.filter((r) => r.recordType === recordType).slice(
      0,
      Math.max(1, Math.min(limit, 100)),
    );
  }

  async listSessionsForDistillate(
    limit = 50,
  ): Promise<SessionEnvelopeInput[]> {
    return FIXTURE_SESSIONS.slice(0, limit).map(sessionToEnvelope);
  }

  async upsertDistillate(
    row: Omit<DistillateRow, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): Promise<DistillateRow> {
    const now = new Date().toISOString();
    const existingIdx = fixtureDistillates.findIndex(
      (d) =>
        d.subjectType === row.subjectType &&
        d.subjectId === row.subjectId &&
        d.kind === row.kind,
    );
    if (existingIdx >= 0) {
      const prev = fixtureDistillates[existingIdx]!;
      const updated: DistillateRow = {
        ...prev,
        content: row.content,
        embeddingRef: row.embeddingRef,
        model: row.model,
        metadata: row.metadata,
        updatedAt: now,
      };
      fixtureDistillates[existingIdx] = updated;
      return updated;
    }
    const created: DistillateRow = {
      id: row.id ?? randomUUID(),
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      kind: row.kind,
      content: row.content,
      embeddingRef: row.embeddingRef,
      model: row.model,
      metadata: row.metadata,
      createdAt: now,
      updatedAt: now,
    };
    fixtureDistillates.push(created);
    return created;
  }
}
