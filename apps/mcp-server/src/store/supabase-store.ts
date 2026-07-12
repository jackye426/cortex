import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  calendarFromRecords,
  emailThreadFromRecords,
  fileFromRecords,
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapRecord(row: Record<string, unknown>): RecordHit {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    sourceRecordId: String(row.source_record_id),
    recordType: String(row.record_type),
    payload: asRecord(row.payload),
    contentHash: String(row.content_hash ?? ""),
    occurredAt:
      typeof row.occurred_at === "string" ? row.occurred_at : null,
  };
}

function mapDistillate(row: Record<string, unknown>): DistillateRow {
  return {
    id: String(row.id),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    kind: String(row.kind ?? "summary"),
    content: typeof row.content === "string" ? row.content : null,
    embeddingRef:
      typeof row.embedding_ref === "string" ? row.embedding_ref : null,
    model: typeof row.model === "string" ? row.model : null,
    metadata: asRecord(row.metadata),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

/**
 * Supabase-backed store. Requires SUPABASE_URL + service role (or anon) key.
 * Queries are intentionally simple ILIKE / range filters for Phase 6.
 */
export class SupabaseStore implements CortexStore {
  readonly mode = "supabase" as const;
  private readonly client: SupabaseClient;
  private readonly ownerId: string | undefined;

  constructor(client: SupabaseClient, ownerId?: string) {
    this.client = client;
    this.ownerId = ownerId;
  }

  static fromEnv(): SupabaseStore {
    const url = process.env.SUPABASE_URL!.trim();
    const key = (
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      process.env.SUPABASE_ANON_KEY?.trim()
    )!;
    const ownerId = process.env.CORTEX_OWNER_ID?.trim() || undefined;
    return new SupabaseStore(createClient(url, key), ownerId);
  }

  private applyOwner<T extends { eq: (col: string, val: string) => T }>(
    query: T,
  ): T {
    if (this.ownerId) {
      return query.eq("owner_id", this.ownerId);
    }
    return query;
  }

  /** Load tombstoned target ids for record / session (cached per call batch). */
  private async loadTombstoneIds(
    targetType: "record" | "session",
  ): Promise<Set<string>> {
    let q = this.client
      .from("deletions")
      .select("target_id")
      .eq("target_type", targetType)
      .limit(5000);
    q = this.applyOwner(q);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] deletions:", error.message);
      return new Set();
    }
    return new Set(
      (data ?? [])
        .map((row) => String((row as { target_id?: string }).target_id ?? ""))
        .filter(Boolean),
    );
  }

  private filterTombstonedRecords(
    rows: RecordHit[],
    tombstoned: Set<string>,
  ): RecordHit[] {
    if (tombstoned.size === 0) return rows;
    return rows.filter(
      (r) => !tombstoned.has(r.id) && !tombstoned.has(r.sourceRecordId),
    );
  }

  async searchRecords(query: string, limit = 20): Promise<RecordHit[]> {
    const capped = Math.max(1, Math.min(limit, 100));
    const tombstoned = await this.loadTombstoneIds("record");
    let q = this.client
      .from("records")
      .select(
        "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
      )
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(Math.min(capped + tombstoned.size, 200));

    q = this.applyOwner(q);

    const trimmed = query.trim();
    if (trimmed) {
      q = q.or(
        `record_type.ilike.%${trimmed}%,source_record_id.ilike.%${trimmed}%,source_id.ilike.%${trimmed}%`,
      );
    }

    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] searchRecords:", error.message);
      return [];
    }
    return this.filterTombstonedRecords(
      (data ?? []).map((row) => mapRecord(row as Record<string, unknown>)),
      tombstoned,
    ).slice(0, capped);
  }

  async getSession(sessionId: string): Promise<SessionDetail | null> {
    const tombstonedSessions = await this.loadTombstoneIds("session");
    let sessionQuery = this.client
      .from("sessions")
      .select(
        "id, source_id, source_session_id, title, workspace, started_at, ended_at, metadata",
      )
      .or(`id.eq.${sessionId},source_session_id.eq.${sessionId}`)
      .limit(1);

    sessionQuery = this.applyOwner(sessionQuery);
    const { data: sessions, error } = await sessionQuery;
    if (error || !sessions?.length) {
      if (error) console.warn("[store/supabase] getSession:", error.message);
      return null;
    }
    const s = sessions[0] as Record<string, unknown>;
    const id = String(s.id);
    if (
      tombstonedSessions.has(id) ||
      tombstonedSessions.has(String(s.source_session_id))
    ) {
      return null;
    }

    const [{ data: messages }, { data: tools }, { data: distillates }] =
      await Promise.all([
        this.client
          .from("messages")
          .select("id, role, content")
          .eq("session_id", id)
          .order("created_at", { ascending: true })
          .limit(200),
        this.client
          .from("tool_calls")
          .select("id, tool_name, args_summary, status")
          .eq("session_id", id)
          .order("created_at", { ascending: true })
          .limit(100),
        this.client
          .from("distillates")
          .select("*")
          .eq("subject_type", "session")
          .eq("subject_id", id)
          .eq("kind", "summary")
          .limit(1),
      ]);

    return {
      id,
      sourceId: String(s.source_id),
      sourceSessionId: String(s.source_session_id),
      title: typeof s.title === "string" ? s.title : null,
      workspace: typeof s.workspace === "string" ? s.workspace : null,
      startedAt: typeof s.started_at === "string" ? s.started_at : null,
      endedAt: typeof s.ended_at === "string" ? s.ended_at : null,
      metadata: asRecord(s.metadata),
      messages: (messages ?? []).map((m) => {
        const row = m as Record<string, unknown>;
        return {
          id: String(row.id),
          role: String(row.role),
          content: typeof row.content === "string" ? row.content : null,
        };
      }),
      toolCalls: (tools ?? []).map((t) => {
        const row = t as Record<string, unknown>;
        return {
          id: String(row.id),
          toolName: String(row.tool_name),
          argsSummary:
            typeof row.args_summary === "string" ? row.args_summary : null,
          status: typeof row.status === "string" ? row.status : null,
        };
      }),
      distillate: distillates?.[0]
        ? mapDistillate(distillates[0] as Record<string, unknown>)
        : null,
    };
  }

  async listRecentWork(limit = 20): Promise<RecentWorkItem[]> {
    const capped = Math.max(1, Math.min(limit, 100));
    const [tombstonedRecords, tombstonedSessions] = await Promise.all([
      this.loadTombstoneIds("record"),
      this.loadTombstoneIds("session"),
    ]);
    let sessionsQ = this.client
      .from("sessions")
      .select(
        "id, source_id, source_session_id, title, started_at, ended_at",
      )
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(capped + 20);
    sessionsQ = this.applyOwner(sessionsQ);

    let recordsQ = this.client
      .from("records")
      .select(
        "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
      )
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(capped + 20);
    recordsQ = this.applyOwner(recordsQ);

    const [{ data: sessions }, { data: records }] = await Promise.all([
      sessionsQ,
      recordsQ,
    ]);

    const items: RecentWorkItem[] = [
      ...(sessions ?? [])
        .filter((row) => {
          const s = row as Record<string, unknown>;
          const id = String(s.id);
          return (
            !tombstonedSessions.has(id) &&
            !tombstonedSessions.has(String(s.source_session_id))
          );
        })
        .map((row) => {
          const s = row as Record<string, unknown>;
          return sessionToRecent({
            id: String(s.id),
            sourceId: String(s.source_id),
            sourceSessionId: String(s.source_session_id),
            title: typeof s.title === "string" ? s.title : null,
            workspace: null,
            startedAt: typeof s.started_at === "string" ? s.started_at : null,
            endedAt: typeof s.ended_at === "string" ? s.ended_at : null,
            metadata: {},
            messages: [],
            toolCalls: [],
            distillate: null,
          });
        }),
      ...this.filterTombstonedRecords(
        (records ?? []).map((row) =>
          mapRecord(row as Record<string, unknown>),
        ),
        tombstonedRecords,
      ).map((row) => recordToRecent(row)),
    ];
    items.sort((a, b) =>
      (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""),
    );
    return items.slice(0, capped);
  }

  async getEmailThread(threadId: string): Promise<EmailThread | null> {
    const tombstoned = await this.loadTombstoneIds("record");
    let q = this.client
      .from("records")
      .select(
        "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
      )
      .eq("record_type", "email_message")
      .contains("payload", { threadId })
      .order("occurred_at", { ascending: true })
      .limit(100);
    q = this.applyOwner(q);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] getEmailThread:", error.message);
      return null;
    }
    return emailThreadFromRecords(
      threadId,
      this.filterTombstonedRecords(
        (data ?? []).map((row) => mapRecord(row as Record<string, unknown>)),
        tombstoned,
      ),
    );
  }

  async getCalendarRange(
    start: string,
    end: string,
  ): Promise<CalendarEventItem[]> {
    const tombstoned = await this.loadTombstoneIds("record");
    let q = this.client
      .from("records")
      .select(
        "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
      )
      .eq("record_type", "calendar_event")
      .gte("occurred_at", start)
      .lte("occurred_at", end)
      .order("occurred_at", { ascending: true })
      .limit(200);
    q = this.applyOwner(q);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] getCalendarRange:", error.message);
      return [];
    }
    return calendarFromRecords(
      start,
      end,
      this.filterTombstonedRecords(
        (data ?? []).map((row) => mapRecord(row as Record<string, unknown>)),
        tombstoned,
      ),
    );
  }

  async getFileSummary(fileId: string): Promise<FileSummary | null> {
    const tombstoned = await this.loadTombstoneIds("record");
    let q = this.client
      .from("records")
      .select(
        "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
      )
      .or(`id.eq.${fileId},source_record_id.eq.${fileId}`)
      .limit(5);
    q = this.applyOwner(q);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] getFileSummary:", error.message);
      return null;
    }
    const hits = this.filterTombstonedRecords(
      (data ?? []).map((row) => mapRecord(row as Record<string, unknown>)),
      tombstoned,
    );
    return fileFromRecords(fileId, hits);
  }

  async listRecordsByType(
    recordType: string,
    limit = 20,
  ): Promise<RecordHit[]> {
    const capped = Math.max(1, Math.min(limit, 100));
    const tombstoned = await this.loadTombstoneIds("record");
    let q = this.client
      .from("records")
      .select(
        "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
      )
      .eq("record_type", recordType)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(Math.min(capped + tombstoned.size, 200));
    q = this.applyOwner(q);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listRecordsByType:", error.message);
      return [];
    }
    return this.filterTombstonedRecords(
      (data ?? []).map((row) => mapRecord(row as Record<string, unknown>)),
      tombstoned,
    ).slice(0, capped);
  }

  async listSessionsForDistillate(
    limit = 50,
  ): Promise<SessionEnvelopeInput[]> {
    const capped = Math.max(1, Math.min(limit, 200));
    let q = this.client
      .from("sessions")
      .select(
        "id, source_id, source_session_id, title, workspace, started_at, ended_at, metadata",
      )
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(capped);
    q = this.applyOwner(q);
    const { data, error } = await q;
    if (error) {
      console.warn(
        "[store/supabase] listSessionsForDistillate:",
        error.message,
      );
      return [];
    }
    return (data ?? []).map((row) => {
      const s = row as Record<string, unknown>;
      return sessionToEnvelope({
        id: String(s.id),
        sourceId: String(s.source_id),
        sourceSessionId: String(s.source_session_id),
        title: typeof s.title === "string" ? s.title : null,
        workspace: typeof s.workspace === "string" ? s.workspace : null,
        startedAt: typeof s.started_at === "string" ? s.started_at : null,
        endedAt: typeof s.ended_at === "string" ? s.ended_at : null,
        metadata: asRecord(s.metadata),
        messages: [],
        toolCalls: [],
        distillate: null,
      });
    });
  }

  async upsertDistillate(
    row: Omit<DistillateRow, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): Promise<DistillateRow> {
    const now = new Date().toISOString();
    const ownerId =
      this.ownerId ?? "00000000-0000-4000-8000-000000000001";
    const payload = {
      owner_id: ownerId,
      subject_type: row.subjectType,
      subject_id: row.subjectId,
      kind: row.kind,
      content: row.content,
      embedding_ref: row.embeddingRef,
      model: row.model,
      metadata: row.metadata,
      updated_at: now,
    };

    const { data, error } = await this.client
      .from("distillates")
      .upsert(payload, { onConflict: "subject_type,subject_id,kind" })
      .select("*")
      .limit(1)
      .single();

    if (error) {
      console.warn("[store/supabase] upsertDistillate:", error.message);
      // Soft no-op shape when write fails (e.g. RLS / missing table)
      return {
        id: row.id ?? "noop",
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        kind: row.kind,
        content: row.content,
        embeddingRef: row.embeddingRef,
        model: row.model,
        metadata: { ...row.metadata, writeError: error.message },
        createdAt: now,
        updatedAt: now,
      };
    }
    return mapDistillate(data as Record<string, unknown>);
  }
}
