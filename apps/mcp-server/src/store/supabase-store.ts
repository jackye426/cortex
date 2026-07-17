import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  resolveSupabaseGatewayKey,
  resolveSupabaseMirrorKey,
  type SupabaseStoreKind,
} from "../env.js";
import {
  CALENDAR_TYPE,
  EMPTY_MEMORY_HINT,
  EMPTY_SEARCH_HINT,
  cosineSimilarity,
  horizonCutoffIso,
  isWorkRecordType,
  payloadMatchesQuery,
  resolveExcludeTypes,
  textMatchesQuery,
  withinHorizon,
} from "./search-helpers.js";
import { distillateMatchesLenses, kindsForMode } from "./memory-lenses.js";
import {
  DEFAULT_SAMPLE_STRATEGY,
  sampleSessionTurns,
  turnsToExcerpts,
  type SampleTurn,
} from "../session-sampler.js";
import {
  calendarFromRecords,
  emailThreadFromRecords,
  fileFromRecords,
  recordToRecent,
  sessionToEnvelope,
  sessionToRecent,
} from "./fixtures.js";
import type {
  AffectSignalRow,
  CalendarEventItem,
  CalendarStructureItem,
  CortexStore,
  DistillateRow,
  EmailThread,
  EntityLinkRow,
  EntityRow,
  FileSummary,
  InsertAffectSignalInput,
  InterestRow,
  LinkEntityInput,
  ListInterestsOptions,
  ListObservationsOptions,
  ListRecentWorkOptions,
  MemorySearchHit,
  MemorySearchOptions,
  MemorySearchResult,
  ObservationRow,
  RecentWorkItem,
  RecordHit,
  SearchRecordsOptions,
  SearchRecordsResult,
  SessionDetail,
  SessionEnvelopeInput,
  StoreCredential,
  UpsertEntityInput,
  UpsertInterestInput,
  UpsertObservationInput,
} from "./types.js";
import type {
  AffectSignalType,
  EvidenceSupportKind,
  InterestClass,
  InterestStatus,
  SourceFamily,
} from "../intrapersonal/types.js";

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

function mapObservation(row: Record<string, unknown>): ObservationRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    epistemicType:
      row.epistemic_type === "self_report" ? "self_report" : "observation",
    statement: String(row.statement ?? ""),
    sourceFamily: String(row.source_family ?? "other") as SourceFamily,
    independenceGroup: String(row.independence_group ?? "other"),
    occurredAt: typeof row.occurred_at === "string" ? row.occurred_at : null,
    capturedAt:
      typeof row.captured_at === "string"
        ? row.captured_at
        : new Date().toISOString(),
    recordId: typeof row.record_id === "string" ? row.record_id : null,
    distillateId:
      typeof row.distillate_id === "string" ? row.distillate_id : null,
    sessionId: typeof row.session_id === "string" ? row.session_id : null,
    supportKind: String(
      row.support_kind ?? "direct_observation",
    ) as EvidenceSupportKind,
    confidence:
      typeof row.confidence === "number" ? row.confidence : Number(row.confidence) || 0.5,
    metadata: asRecord(row.metadata),
    contentHash: String(row.content_hash ?? ""),
  };
}

function mapInterest(row: Record<string, unknown>): InterestRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    canonicalKey: String(row.canonical_key ?? ""),
    displayName: String(row.display_name ?? row.canonical_key ?? ""),
    class: String(row.class ?? "situational") as InterestClass,
    status: String(row.status ?? "active") as InterestStatus,
    confidence:
      typeof row.confidence === "number" ? row.confidence : Number(row.confidence) || 0.5,
    summary: String(row.summary ?? ""),
    firstSeenAt:
      typeof row.first_seen_at === "string" ? row.first_seen_at : null,
    lastActiveAt:
      typeof row.last_active_at === "string" ? row.last_active_at : null,
    recurrenceScore:
      typeof row.recurrence_score === "number" ? row.recurrence_score : 0,
    specificityScore:
      typeof row.specificity_score === "number" ? row.specificity_score : 0,
    voluntaryReturnScore:
      typeof row.voluntary_return_score === "number"
        ? row.voluntary_return_score
        : 0,
    persistenceAfterUtility:
      typeof row.persistence_after_utility === "number"
        ? row.persistence_after_utility
        : 0,
    energyDelta:
      typeof row.energy_delta === "number" ? row.energy_delta : null,
    metadata: asRecord(row.metadata),
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
    updatedAt:
      typeof row.updated_at === "string"
        ? row.updated_at
        : new Date().toISOString(),
  };
}

function mapAffectSignal(row: Record<string, unknown>): AffectSignalRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    signalType: String(row.signal_type ?? "energy") as AffectSignalType,
    value: typeof row.value === "number" ? row.value : Number(row.value) || 0,
    sourceFamily: String(row.source_family ?? "other") as SourceFamily,
    observationId:
      typeof row.observation_id === "string" ? row.observation_id : null,
    context: asRecord(row.context),
    occurredAt: typeof row.occurred_at === "string" ? row.occurred_at : null,
    captureMode:
      row.capture_mode === "self_report" ? "self_report" : "inferred",
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
  };
}

function mapDistillate(row: Record<string, unknown>): DistillateRow {
  let embedding: number[] | null | undefined;
  const rawEmb = row.embedding;
  if (Array.isArray(rawEmb)) {
    embedding = rawEmb.map((n) => Number(n));
  } else if (typeof rawEmb === "string" && rawEmb.startsWith("[")) {
    try {
      embedding = (JSON.parse(rawEmb) as number[]).map(Number);
    } catch {
      embedding = null;
    }
  } else {
    embedding = rawEmb == null ? null : undefined;
  }
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
    embedding: embedding ?? null,
  };
}

function mapEntity(row: Record<string, unknown>): EntityRow {
  return {
    id: String(row.id),
    entityType: String(row.entity_type),
    canonicalKey: String(row.canonical_key),
    displayName:
      typeof row.display_name === "string" ? row.display_name : null,
    metadata: asRecord(row.metadata),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function mapEntityLink(row: Record<string, unknown>): EntityLinkRow {
  return {
    id: String(row.id),
    entityId: String(row.entity_id),
    linkedType: String(row.linked_type),
    linkedId: String(row.linked_id),
    relation: String(row.relation ?? "related"),
    metadata: asRecord(row.metadata),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

/**
 * Supabase-backed store.
 * - vault: service_role (Ops + compilers)
 * - mirror: SUPABASE_MIRROR_KEY JWT via accessToken (Kong still needs a gateway key)
 */
export class SupabaseStore implements CortexStore {
  readonly mode = "supabase" as const;
  readonly credential: StoreCredential;
  private readonly client: SupabaseClient;
  private readonly ownerId: string | undefined;

  constructor(
    client: SupabaseClient,
    ownerId?: string,
    credential: StoreCredential = "vault",
  ) {
    this.client = client;
    this.ownerId = ownerId;
    this.credential = credential;
  }

  static fromEnv(kind: SupabaseStoreKind = "vault"): SupabaseStore {
    const url = process.env.SUPABASE_URL!.trim();
    const gatewayKey = resolveSupabaseGatewayKey()!;
    const ownerId = process.env.CORTEX_OWNER_ID?.trim() || undefined;
    const mirrorKey = resolveSupabaseMirrorKey();

    if (kind === "mirror" && mirrorKey) {
      const client = createClient(url, gatewayKey, {
        accessToken: async () => mirrorKey,
      });
      return new SupabaseStore(client, ownerId, "mirror");
    }

    if (kind === "mirror" && !mirrorKey) {
      console.warn(
        "[store] SUPABASE_MIRROR_KEY unset; Mirror store falls back to vault credential",
      );
    }

    return new SupabaseStore(createClient(url, gatewayKey), ownerId, "vault");
  }

  private applyOwner<T extends { eq: (col: string, val: string) => T }>(
    query: T,
  ): T {
    if (this.ownerId) {
      return query.eq("owner_id", this.ownerId);
    }
    return query;
  }

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

  async searchRecords(
    query: string,
    options: SearchRecordsOptions = {},
  ): Promise<SearchRecordsResult> {
    const capped = Math.max(1, Math.min(options.limit ?? 20, 100));
    const excludeTypes = resolveExcludeTypes(options);
    const trimmed = query.trim();
    const tombstoned = await this.loadTombstoneIds("record");

    const rpcHits = await this.searchRecordsViaRpc(
      trimmed,
      capped,
      options,
      excludeTypes,
    );
    let hits: RecordHit[];
    if (rpcHits) {
      hits = this.filterTombstonedRecords(rpcHits, tombstoned).slice(0, capped);
    } else {
      hits = await this.searchRecordsFallback(
        trimmed,
        capped,
        options,
        excludeTypes,
        tombstoned,
      );
    }

    const distillates = trimmed
      ? await this.searchDistillates(trimmed, Math.min(capped, 10))
      : [];

    const hint =
      hits.length === 0 && distillates.length === 0
        ? EMPTY_SEARCH_HINT
        : undefined;

    return { hits, distillates, hint };
  }

  private async searchRecordsViaRpc(
    query: string,
    limit: number,
    options: SearchRecordsOptions,
    excludeTypes: string[],
  ): Promise<RecordHit[] | null> {
    const { data, error } = await this.client.rpc("cortex_search_records", {
      p_owner_id: this.ownerId ?? null,
      p_query: query,
      p_limit: limit,
      p_record_types: options.recordTypes?.length
        ? options.recordTypes
        : null,
      p_sources: options.sources?.length ? options.sources : null,
      p_exclude_types: excludeTypes.length ? excludeTypes : null,
      p_since: options.since ?? null,
      p_until: options.until ?? null,
    });
    if (error) {
      // Function may not be migrated yet — fall back silently.
      if (!/could not find the function|PGRST202/i.test(error.message)) {
        console.warn("[store/supabase] cortex_search_records:", error.message);
      }
      return null;
    }
    return (data ?? []).map((row: Record<string, unknown>) => mapRecord(row));
  }

  private async searchRecordsFallback(
    query: string,
    limit: number,
    options: SearchRecordsOptions,
    excludeTypes: string[],
    tombstoned: Set<string>,
  ): Promise<RecordHit[]> {
    const fetchLimit = Math.min(Math.max(limit * 5, 50), 300);
    let q = this.client
      .from("records")
      .select(
        "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
      )
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(fetchLimit);
    q = this.applyOwner(q);

    if (options.recordTypes?.length) {
      q = q.in("record_type", options.recordTypes);
    }
    if (options.sources?.length) {
      q = q.in("source_id", options.sources);
    }
    if (options.since) {
      q = q.gte("occurred_at", options.since);
    }
    if (options.until) {
      q = q.lte("occurred_at", options.until);
    }

    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] searchRecords fallback:", error.message);
      return [];
    }

    const exclude = new Set(excludeTypes);
    let rows = this.filterTombstonedRecords(
      (data ?? []).map((row) => mapRecord(row as Record<string, unknown>)),
      tombstoned,
    ).filter((r) => !exclude.has(r.recordType));

    if (query) {
      const pattern = query.toLowerCase();
      rows = rows.filter((r) => {
        if (r.recordType.toLowerCase().includes(pattern)) return true;
        if (r.sourceId.toLowerCase().includes(pattern)) return true;
        if (r.sourceRecordId.toLowerCase().includes(pattern)) return true;
        return payloadMatchesQuery(r.payload, query);
      });
    }

    return rows.slice(0, limit);
  }

  async searchDistillates(
    query: string,
    limit = 20,
    kinds?: string[],
  ): Promise<DistillateRow[]> {
    const capped = Math.max(1, Math.min(limit, 100));
    const trimmed = query.trim();
    let q = this.client
      .from("distillates")
      .select("*")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(Math.min(capped * 3, 150));
    q = this.applyOwner(q);
    if (kinds?.length) {
      q = q.in("kind", kinds);
    }
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] searchDistillates:", error.message);
      return [];
    }
    let rows = (data ?? []).map((row) =>
      mapDistillate(row as Record<string, unknown>),
    );
    if (trimmed) {
      rows = rows.filter(
        (d) =>
          textMatchesQuery(d.content, trimmed) ||
          textMatchesQuery(JSON.stringify(d.metadata), trimmed) ||
          textMatchesQuery(d.kind, trimmed),
      );
    }
    return rows.slice(0, capped);
  }

  async listDistillates(options: {
    limit?: number;
    kinds?: string[];
    missingEmbedding?: boolean;
  } = {}): Promise<DistillateRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("distillates")
      .select("*")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(options.missingEmbedding ? Math.min(capped * 4, 400) : capped);
    q = this.applyOwner(q);
    if (options.kinds?.length) {
      q = q.in("kind", options.kinds);
    }
    if (options.missingEmbedding) {
      q = q.is("embedding", null);
    }
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listDistillates:", error.message);
      return [];
    }
    let rows = (data ?? []).map((row) =>
      mapDistillate(row as Record<string, unknown>),
    );
    if (options.missingEmbedding) {
      rows = rows.filter((d) => !d.embedding?.length);
    }
    return rows.slice(0, capped);
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

  async listRecentWork(
    options: ListRecentWorkOptions = {},
  ): Promise<RecentWorkItem[]> {
    if (this.credential === "mirror") {
      return this.listRecentWorkFromDistillates(options);
    }
    return this.listRecentWorkVault(options);
  }

  /** Mirror: sessions/records tables are denied — derive recent work from distillates. */
  private async listRecentWorkFromDistillates(
    options: ListRecentWorkOptions = {},
  ): Promise<RecentWorkItem[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 20, 100));
    const cutoff = horizonCutoffIso(options.horizonDays);
    const kinds = [
      "summary",
      "decision",
      "outcome",
      "project_brief",
      "github_outcome_digest",
      "email_thread_digest",
    ];
    let dq = this.client
      .from("distillates")
      .select(
        "id, kind, subject_type, subject_id, content, updated_at, created_at, metadata",
      )
      .in("kind", kinds)
      .order("updated_at", { ascending: false })
      .limit(Math.min(capped * 3, 120));
    dq = this.applyOwner(dq);
    const { data, error } = await dq;
    if (error) {
      console.warn(
        "[store/supabase] listRecentWork(mirror):",
        error.message,
      );
      return [];
    }

    const items: RecentWorkItem[] = [];
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      const updated =
        (typeof r.updated_at === "string" && r.updated_at) ||
        (typeof r.created_at === "string" ? r.created_at : null);
      if (!withinHorizon(updated, cutoff)) continue;
      const kind = String(r.kind ?? "");
      const subjectType = String(r.subject_type ?? "");
      const content = typeof r.content === "string" ? r.content : "";
      const title =
        content.split("\n")[0]?.slice(0, 120) ||
        `${kind}:${subjectType}/${String(r.subject_id ?? "")}`;
      items.push({
        kind: subjectType === "session" ? "session" : "record",
        id: String(r.subject_id ?? r.id),
        sourceId: "distillate",
        title,
        occurredAt: updated,
        recordType: kind,
        distillateSummary: content.slice(0, 180),
      });
      if (items.length >= capped) break;
    }
    return items;
  }

  private async listRecentWorkVault(
    options: ListRecentWorkOptions = {},
  ): Promise<RecentWorkItem[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 20, 100));
    const kinds = options.kinds;
    const includeSessions = !kinds || kinds.includes("session");
    const includeRecords = !kinds || kinds.includes("record");
    const workMode =
      options.workMode ?? (kinds === undefined || kinds.length === 0);
    const excludeTypes = new Set(
      options.excludeTypes ?? (workMode ? [CALENDAR_TYPE] : []),
    );
    const cutoff = horizonCutoffIso(options.horizonDays);
    const fetchN = capped + 40;

    const [tombstonedRecords, tombstonedSessions] = await Promise.all([
      this.loadTombstoneIds("record"),
      this.loadTombstoneIds("session"),
    ]);

    const sessionPromise = includeSessions
      ? (async () => {
          let sessionsQ = this.client
            .from("sessions")
            .select(
              "id, source_id, source_session_id, title, started_at, ended_at",
            )
            .order("started_at", { ascending: false, nullsFirst: false })
            .limit(fetchN);
          sessionsQ = this.applyOwner(sessionsQ);
          const { data } = await sessionsQ;
          return data ?? [];
        })()
      : Promise.resolve([]);

    const recordsPromise = includeRecords
      ? (async () => {
          let recordsQ = this.client
            .from("records")
            .select(
              "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
            )
            .order("occurred_at", { ascending: false, nullsFirst: false })
            .limit(fetchN);
          recordsQ = this.applyOwner(recordsQ);
          if (options.recordTypes?.length) {
            recordsQ = recordsQ.in("record_type", options.recordTypes);
          }
          if (cutoff) {
            recordsQ = recordsQ.lte("occurred_at", cutoff);
          }
          const { data } = await recordsQ;
          return data ?? [];
        })()
      : Promise.resolve([]);

    const distillatePromise = includeSessions
      ? (async () => {
          let dq = this.client
            .from("distillates")
            .select("subject_id, content, kind")
            .eq("subject_type", "session")
            .eq("kind", "summary")
            .order("updated_at", { ascending: false })
            .limit(fetchN);
          dq = this.applyOwner(dq);
          const { data } = await dq;
          return data ?? [];
        })()
      : Promise.resolve([]);

    const [sessions, records, distillateRows] = await Promise.all([
      sessionPromise,
      recordsPromise,
      distillatePromise,
    ]);

    const distillateBySession = new Map<string, string>();
    for (const row of distillateRows) {
      const r = row as Record<string, unknown>;
      const sid = String(r.subject_id ?? "");
      const content = typeof r.content === "string" ? r.content : "";
      if (sid && content && !distillateBySession.has(sid)) {
        distillateBySession.set(sid, content.slice(0, 180));
      }
    }

    const items: RecentWorkItem[] = [];

    for (const row of sessions) {
      const s = row as Record<string, unknown>;
      const id = String(s.id);
      if (
        tombstonedSessions.has(id) ||
        tombstonedSessions.has(String(s.source_session_id))
      ) {
        continue;
      }
      const occurredAt =
        (typeof s.ended_at === "string" && s.ended_at) ||
        (typeof s.started_at === "string" ? s.started_at : null);
      if (!withinHorizon(occurredAt, cutoff)) continue;
      const recent = sessionToRecent({
        id,
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
      recent.distillateSummary = distillateBySession.get(id) ?? null;
      items.push(recent);
    }

    const recordHits = this.filterTombstonedRecords(
      records.map((row) => mapRecord(row as Record<string, unknown>)),
      tombstonedRecords,
    ).filter((r) => {
      if (excludeTypes.has(r.recordType)) return false;
      if (options.recordTypes?.length) {
        return options.recordTypes.includes(r.recordType);
      }
      if (workMode && includeRecords) {
        return isWorkRecordType(r.recordType);
      }
      return true;
    });

    for (const r of recordHits) {
      if (!withinHorizon(r.occurredAt, cutoff)) continue;
      items.push(recordToRecent(r));
    }

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

  async getCalendarStructure(
    start: string,
    end: string,
  ): Promise<CalendarStructureItem[]> {
    const tombstoned = await this.loadTombstoneIds("record");
    let q = this.client
      .from("cortex_calendar_structure")
      .select(
        "id, source_record_id, summary, start_at, end_at, attendee_count, has_description, has_attachments, occurred_at",
      )
      .gte("occurred_at", start)
      .lte("occurred_at", end)
      .order("occurred_at", { ascending: true })
      .limit(200);
    q = this.applyOwner(q);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] getCalendarStructure:", error.message);
      return [];
    }
    const out: CalendarStructureItem[] = [];
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      const id = String(r.id);
      if (tombstoned.has(id)) continue;
      out.push({
        id,
        sourceRecordId: String(r.source_record_id ?? ""),
        summary: typeof r.summary === "string" ? r.summary : null,
        start: typeof r.start_at === "string" ? r.start_at : null,
        end: typeof r.end_at === "string" ? r.end_at : null,
        attendeeCount:
          typeof r.attendee_count === "number" ? r.attendee_count : 0,
        hasDescription: Boolean(r.has_description),
        hasAttachments: Boolean(r.has_attachments),
      });
    }
    return out;
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
    // Raised so adapter backfills are not truncated at a low global top-N.
    const capped = Math.max(1, Math.min(limit, 2000));
    const tombstoned = await this.loadTombstoneIds("record");
    let q = this.client
      .from("records")
      .select(
        "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
      )
      .eq("record_type", recordType)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(Math.min(capped + tombstoned.size, 2500));
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

  async listRecordsByTypeInRange(
    recordType: string,
    since: string,
    until: string,
    limit = 500,
  ): Promise<RecordHit[]> {
    const capped = Math.max(1, Math.min(limit, 2000));
    const tombstoned = await this.loadTombstoneIds("record");
    const pageSize = 500;
    const out: RecordHit[] = [];
    let offset = 0;
    while (out.length < capped) {
      const fetch = Math.min(pageSize, capped - out.length + tombstoned.size);
      let q = this.client
        .from("records")
        .select(
          "id, source_id, source_record_id, record_type, payload, content_hash, occurred_at",
        )
        .eq("record_type", recordType)
        .gte("occurred_at", since)
        .lt("occurred_at", until)
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + fetch - 1);
      q = this.applyOwner(q);
      const { data, error } = await q;
      if (error) {
        console.warn(
          "[store/supabase] listRecordsByTypeInRange:",
          error.message,
        );
        break;
      }
      const page = this.filterTombstonedRecords(
        (data ?? []).map((row) => mapRecord(row as Record<string, unknown>)),
        tombstoned,
      );
      if (page.length === 0) break;
      out.push(...page);
      offset += fetch;
      if ((data ?? []).length < fetch) break;
    }
    return out.slice(0, capped);
  }

  private async loadDistilledSessionIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const pageSize = 500;
    let offset = 0;
    while (true) {
      let q = this.client
        .from("distillates")
        .select("subject_id")
        .eq("subject_type", "session")
        .eq("kind", "summary")
        .range(offset, offset + pageSize - 1);
      q = this.applyOwner(q);
      const { data, error } = await q;
      if (error) {
        console.warn(
          "[store/supabase] loadDistilledSessionIds:",
          error.message,
        );
        break;
      }
      const rows = data ?? [];
      for (const row of rows) {
        ids.add(
          String((row as { subject_id?: string }).subject_id ?? ""),
        );
      }
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    return ids;
  }

  async listSessionsForDistillate(
    limit = 50,
    options: { skipDistilled?: boolean } = {},
  ): Promise<SessionEnvelopeInput[]> {
    const capped = Math.max(1, Math.min(limit, 200));
    const skipDistilled = options.skipDistilled !== false;
    const distilledIds = skipDistilled
      ? await this.loadDistilledSessionIds()
      : new Set<string>();

    const picked: Record<string, unknown>[] = [];
    const pageSize = 100;
    let offset = 0;
    const maxScan = 5000;

    while (picked.length < capped && offset < maxScan) {
      let q = this.client
        .from("sessions")
        .select(
          "id, source_id, source_session_id, title, workspace, started_at, ended_at, metadata",
        )
        .order("started_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + pageSize - 1);
      q = this.applyOwner(q);
      const { data, error } = await q;
      if (error) {
        console.warn(
          "[store/supabase] listSessionsForDistillate:",
          error.message,
        );
        break;
      }
      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const id = String(row.id);
        if (!skipDistilled || !distilledIds.has(id)) {
          picked.push(row);
          if (picked.length >= capped) break;
        }
      }
      offset += pageSize;
      if (rows.length < pageSize) break;
    }

    const envelopes: SessionEnvelopeInput[] = [];
    for (const row of picked) {
      const s = row;
      const id = String(s.id);
      const [{ data: messages }, { data: tools }] = await Promise.all([
        this.client
          .from("messages")
          .select("id, content, role, created_at")
          .eq("session_id", id)
          .order("created_at", { ascending: true })
          .limit(500),
        this.client
          .from("tool_calls")
          .select("tool_name, args_summary")
          .eq("session_id", id)
          .order("created_at", { ascending: true })
          .limit(80),
      ]);

      const rawTurns: SampleTurn[] = (messages ?? []).map((m, i) => {
        const mr = m as Record<string, unknown>;
        const content =
          typeof mr.content === "string" ? mr.content.trim() : "";
        const role = typeof mr.role === "string" ? mr.role : "msg";
        return {
          index: i,
          role,
          content,
          messageId: typeof mr.id === "string" ? mr.id : undefined,
          toolHeavy: role === "tool",
        };
      }).filter((t) => t.content.length > 0);

      // Mark tool-adjacent assistant turns using tool call args as hints
      const toolSummaries = (tools ?? [])
        .map((t) => {
          const tr = t as Record<string, unknown>;
          const name =
            typeof tr.tool_name === "string" ? tr.tool_name : "tool";
          const args =
            typeof tr.args_summary === "string" ? tr.args_summary : "";
          return args ? `${name}(${args.slice(0, 120)})` : name;
        })
        .filter(Boolean);

      for (const t of rawTurns) {
        if (
          /\b(Write|Shell|Edit|ApplyPatch|Grep|Read|Bash)\b/.test(t.content) ||
          toolSummaries.some((ts) => t.content.includes(ts.slice(0, 24)))
        ) {
          t.toolHeavy = true;
        }
      }

      const sampled = sampleSessionTurns(rawTurns, DEFAULT_SAMPLE_STRATEGY);
      const excerpts = turnsToExcerpts(sampled.turns);
      const meta = asRecord(s.metadata);
      const pathsTouched = Array.isArray(meta.pathsTouched)
        ? meta.pathsTouched.filter((x): x is string => typeof x === "string")
        : [];
      const commands = Array.isArray(meta.commands)
        ? meta.commands.filter((x): x is string => typeof x === "string")
        : [];

      envelopes.push({
        sourceId: String(s.source_id),
        sourceSessionId: String(s.source_session_id),
        title: typeof s.title === "string" ? s.title : null,
        workspace: typeof s.workspace === "string" ? s.workspace : null,
        startedAt: typeof s.started_at === "string" ? s.started_at : null,
        endedAt: typeof s.ended_at === "string" ? s.ended_at : null,
        excerpts,
        toolSummaries,
        sampledTurns: sampled.turns,
        sampleStrategy: sampled.sampleStrategy,
        turnCount: sampled.totalTurnCount,
        pathsTouched,
        commands,
        metadata: {
          ...meta,
          sessionId: id,
          metadataOnly: sampled.metadataOnly,
        },
      });
    }
    return envelopes;
  }

  async upsertDistillate(
    row: Omit<DistillateRow, "id" | "createdAt" | "updatedAt" | "embedding"> & {
      id?: string;
      embedding?: number[] | null;
    },
  ): Promise<DistillateRow> {
    const now = new Date().toISOString();
    const ownerId =
      this.ownerId ?? "00000000-0000-4000-8000-000000000001";
    const payload: Record<string, unknown> = {
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
    if (row.embedding !== undefined) {
      payload.embedding =
        row.embedding === null
          ? null
          : `[${row.embedding.join(",")}]`;
    }

    const { data, error } = await this.client
      .from("distillates")
      .upsert(payload, { onConflict: "subject_type,subject_id,kind" })
      .select("*")
      .limit(1)
      .single();

    if (error) {
      console.warn("[store/supabase] upsertDistillate:", error.message);
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
        embedding: row.embedding ?? null,
      };
    }
    return mapDistillate(data as Record<string, unknown>);
  }

  async searchMemory(
    query: string,
    options: MemorySearchOptions = {},
  ): Promise<MemorySearchResult> {
    const capped = Math.max(1, Math.min(options.limit ?? 15, 50));
    const trimmed = query.trim();
    const hits: MemorySearchHit[] = [];
    const queryEmbedding = await this.tryEmbedQuery(trimmed);
    const effectiveKinds =
      options.kinds?.length ? options.kinds : kindsForMode(options.mode);

    // Prefer RPC hybrid when available (pass query embedding for vector path)
    const rpcArgs: Record<string, unknown> = {
      p_owner_id: this.ownerId ?? null,
      p_query: trimmed,
      p_limit: Math.min(capped * 3, 80),
      p_kinds: effectiveKinds?.length ? effectiveKinds : null,
      p_domains: options.domains?.length ? options.domains : null,
      p_topics: options.topics?.length ? options.topics : null,
      p_source_types: options.sourceTypes?.length ? options.sourceTypes : null,
      p_min_confidence:
        typeof options.minConfidence === "number"
          ? options.minConfidence
          : null,
    };
    if (queryEmbedding?.length) {
      rpcArgs.p_query_embedding = `[${queryEmbedding.join(",")}]`;
    }

    const { data: rpcData, error: rpcError } = await this.client.rpc(
      "cortex_search_memory",
      rpcArgs,
    );

    if (!rpcError && Array.isArray(rpcData)) {
      for (const row of rpcData as Record<string, unknown>[]) {
        hits.push({
          kind: String(row.kind) === "record" ? "record" : "distillate",
          id: String(row.id),
          score: Number(row.score ?? 0),
          title: String(row.title ?? ""),
          snippet: String(row.snippet ?? ""),
          sourceId:
            typeof row.source_id === "string" ? row.source_id : undefined,
          sessionId:
            typeof row.session_id === "string" ? row.session_id : undefined,
          recordId:
            typeof row.record_id === "string" ? row.record_id : undefined,
          recordType:
            typeof row.record_type === "string" ? row.record_type : undefined,
          distillateKind:
            typeof row.distillate_kind === "string"
              ? row.distillate_kind
              : undefined,
          subjectType:
            typeof row.subject_type === "string" ? row.subject_type : undefined,
          subjectId:
            typeof row.subject_id === "string" ? row.subject_id : undefined,
        });
      }
    } else {
      if (
        rpcError &&
        !/could not find the function|PGRST202/i.test(rpcError.message)
      ) {
        console.warn(
          "[store/supabase] cortex_search_memory:",
          rpcError.message,
        );
      }
      // Local hybrid: keyword distillates + records; vector re-rank when embeddings exist
      const distillates = trimmed
        ? await this.searchDistillates(trimmed, capped * 3, effectiveKinds)
        : await this.listDistillates({
            limit: capped * 3,
            kinds: effectiveKinds,
          });
      const records =
        this.credential === "mirror" || !trimmed
          ? { hits: [] as import("./types.js").RecordHit[], distillates: [] }
          : await this.searchRecords(trimmed, {
              limit: capped,
              since: options.since,
              until: options.until,
            });

      for (const d of distillates) {
        if (!distillateMatchesLenses(d, options)) continue;
        let score = trimmed
          ? textMatchesQuery(d.content, trimmed) ||
            textMatchesQuery(JSON.stringify(d.metadata), trimmed)
            ? 0.72
            : 0.4
          : 0.55;
        if (queryEmbedding && d.embedding?.length) {
          score = Math.max(
            score,
            cosineSimilarity(queryEmbedding, d.embedding),
          );
        }
        hits.push({
          kind: "distillate",
          id: d.id,
          score,
          title: `${d.kind}:${d.subjectType}/${d.subjectId}`,
          snippet: (d.content ?? "").slice(0, 280),
          sessionId: d.subjectType === "session" ? d.subjectId : undefined,
          distillateKind: d.kind,
          subjectType: d.subjectType,
          subjectId: d.subjectId,
        });
      }
      for (const r of records.hits) {
        hits.push({
          kind: "record",
          id: r.id,
          score: 0.48,
          title:
            (typeof r.payload.title === "string" && r.payload.title) ||
            (typeof r.payload.subject === "string" && r.payload.subject) ||
            `${r.recordType}:${r.sourceRecordId}`,
          snippet: JSON.stringify(r.payload).slice(0, 280),
          sourceId: r.sourceId,
          recordId: r.id,
          recordType: r.recordType,
        });
      }
    }

    // Post-filter RPC hits with metadata lenses when possible
    let filtered = hits;
    if (
      options.domains?.length ||
      options.topics?.length ||
      options.sourceTypes?.length ||
      typeof options.minConfidence === "number" ||
      options.mode
    ) {
      const distillateMeta = await this.listDistillates({
        limit: 100,
        kinds: effectiveKinds,
      });
      const byId = new Map(distillateMeta.map((d) => [d.id, d]));
      filtered = hits.filter((h) => {
        if (h.kind !== "distillate") {
          // operational mode drops interest keyword records unless both
          if (options.mode === "operational" && h.recordType?.startsWith("youtube_")) {
            return false;
          }
          if (options.mode === "reflective" && h.recordType?.startsWith("github_")) {
            return false;
          }
          return true;
        }
        const d = byId.get(h.id);
        if (!d) {
          if (effectiveKinds?.length && h.distillateKind) {
            return effectiveKinds.includes(h.distillateKind);
          }
          return true;
        }
        return distillateMatchesLenses(d, options);
      });
    }

    filtered.sort((a, b) => b.score - a.score);
    const sliced = filtered.slice(0, capped);
    return {
      hits: sliced,
      hint: sliced.length === 0 ? EMPTY_MEMORY_HINT : undefined,
    };
  }

  private async tryEmbedQuery(query: string): Promise<number[] | null> {
    if (!query.trim()) return null;
    if (!process.env.OPENAI_API_KEY?.trim()) return null;
    try {
      const { embedTexts } = await import("../llm.js");
      const [vec] = await embedTexts([query.slice(0, 8000)]);
      return vec ?? null;
    } catch (err) {
      console.warn(
        "[store/supabase] embed query failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  async listEntities(
    entityType?: string,
    limit = 50,
  ): Promise<EntityRow[]> {
    const capped = Math.max(1, Math.min(limit, 200));
    let q = this.client
      .from("entities")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (entityType) q = q.eq("entity_type", entityType);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listEntities:", error.message);
      return [];
    }
    return (data ?? []).map((row) => mapEntity(row as Record<string, unknown>));
  }

  async upsertEntity(input: UpsertEntityInput): Promise<EntityRow> {
    const ownerId =
      this.ownerId ?? "00000000-0000-4000-8000-000000000001";
    const payload = {
      owner_id: ownerId,
      entity_type: input.entityType,
      canonical_key: input.canonicalKey,
      display_name: input.displayName ?? null,
      metadata: input.metadata ?? {},
    };
    const { data, error } = await this.client
      .from("entities")
      .upsert(payload, { onConflict: "owner_id,entity_type,canonical_key" })
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] upsertEntity:", error.message);
      return {
        id: "noop",
        entityType: input.entityType,
        canonicalKey: input.canonicalKey,
        displayName: input.displayName ?? null,
        metadata: { ...(input.metadata ?? {}), writeError: error.message },
        createdAt: new Date().toISOString(),
      };
    }
    return mapEntity(data as Record<string, unknown>);
  }

  async linkEntity(input: LinkEntityInput): Promise<EntityLinkRow> {
    const ownerId =
      this.ownerId ?? "00000000-0000-4000-8000-000000000001";
    const payload = {
      owner_id: ownerId,
      entity_id: input.entityId,
      linked_type: input.linkedType,
      linked_id: input.linkedId,
      relation: input.relation ?? "related",
      metadata: input.metadata ?? {},
    };
    const { data, error } = await this.client
      .from("entity_links")
      .upsert(payload, {
        onConflict: "entity_id,linked_type,linked_id,relation",
      })
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] linkEntity:", error.message);
      return {
        id: "noop",
        entityId: input.entityId,
        linkedType: input.linkedType,
        linkedId: input.linkedId,
        relation: input.relation ?? "related",
        metadata: { ...(input.metadata ?? {}), writeError: error.message },
        createdAt: new Date().toISOString(),
      };
    }
    return mapEntityLink(data as Record<string, unknown>);
  }

  async listEntityLinks(entityId: string): Promise<EntityLinkRow[]> {
    let q = this.client
      .from("entity_links")
      .select("*")
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(200);
    q = this.applyOwner(q);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listEntityLinks:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapEntityLink(row as Record<string, unknown>),
    );
  }

  async upsertObservation(
    input: UpsertObservationInput,
  ): Promise<ObservationRow> {
    const now = new Date().toISOString();
    const ownerId =
      this.ownerId ?? "00000000-0000-4000-8000-000000000001";
    const payload = {
      owner_id: ownerId,
      epistemic_type: input.epistemicType,
      statement: input.statement,
      source_family: input.sourceFamily,
      independence_group: input.independenceGroup,
      occurred_at: input.occurredAt ?? null,
      record_id: input.recordId ?? null,
      distillate_id: input.distillateId ?? null,
      session_id: input.sessionId ?? null,
      support_kind: input.supportKind ?? "direct_observation",
      confidence: input.confidence ?? 0.5,
      metadata: input.metadata ?? {},
      content_hash: input.contentHash,
    };
    const { data, error } = await this.client
      .from("observations")
      .upsert(payload, { onConflict: "owner_id,content_hash" })
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] upsertObservation:", error.message);
      return {
        id: "noop",
        ownerId,
        epistemicType: input.epistemicType,
        statement: input.statement,
        sourceFamily: input.sourceFamily,
        independenceGroup: input.independenceGroup,
        occurredAt: input.occurredAt ?? null,
        capturedAt: now,
        recordId: input.recordId ?? null,
        distillateId: input.distillateId ?? null,
        sessionId: input.sessionId ?? null,
        supportKind: input.supportKind ?? "direct_observation",
        confidence: input.confidence ?? 0.5,
        metadata: { ...(input.metadata ?? {}), writeError: error.message },
        contentHash: input.contentHash,
      };
    }
    return mapObservation(data as Record<string, unknown>);
  }

  async listObservations(
    options: ListObservationsOptions = {},
  ): Promise<ObservationRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("observations")
      .select("*")
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.sourceFamily) {
      q = q.eq("source_family", options.sourceFamily);
    }
    if (options.distillateId) {
      q = q.eq("distillate_id", options.distillateId);
    }
    if (options.since) {
      q = q.gte("occurred_at", options.since);
    }
    if (options.until) {
      q = q.lte("occurred_at", options.until);
    }
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listObservations:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapObservation(row as Record<string, unknown>),
    );
  }

  async upsertInterest(input: UpsertInterestInput): Promise<InterestRow> {
    const now = new Date().toISOString();
    const ownerId =
      this.ownerId ?? "00000000-0000-4000-8000-000000000001";
    const payload = {
      owner_id: ownerId,
      canonical_key: input.canonicalKey,
      display_name: input.displayName ?? input.canonicalKey,
      class: input.class,
      status: input.status ?? "active",
      confidence: input.confidence ?? 0.5,
      summary: input.summary ?? "",
      first_seen_at: input.firstSeenAt ?? null,
      last_active_at: input.lastActiveAt ?? null,
      recurrence_score: input.recurrenceScore ?? 0,
      specificity_score: input.specificityScore ?? 0,
      voluntary_return_score: input.voluntaryReturnScore ?? 0,
      persistence_after_utility: input.persistenceAfterUtility ?? 0,
      energy_delta: input.energyDelta ?? null,
      metadata: input.metadata ?? {},
      updated_at: now,
    };
    const { data, error } = await this.client
      .from("interests")
      .upsert(payload, { onConflict: "owner_id,canonical_key" })
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] upsertInterest:", error.message);
      return {
        id: "noop",
        ownerId,
        canonicalKey: input.canonicalKey,
        displayName: input.displayName ?? input.canonicalKey,
        class: input.class,
        status: input.status ?? "active",
        confidence: input.confidence ?? 0.5,
        summary: input.summary ?? "",
        firstSeenAt: input.firstSeenAt ?? null,
        lastActiveAt: input.lastActiveAt ?? null,
        recurrenceScore: input.recurrenceScore ?? 0,
        specificityScore: input.specificityScore ?? 0,
        voluntaryReturnScore: input.voluntaryReturnScore ?? 0,
        persistenceAfterUtility: input.persistenceAfterUtility ?? 0,
        energyDelta: input.energyDelta ?? null,
        metadata: { ...(input.metadata ?? {}), writeError: error.message },
        createdAt: now,
        updatedAt: now,
      };
    }
    return mapInterest(data as Record<string, unknown>);
  }

  async listInterests(
    options: ListInterestsOptions = {},
  ): Promise<InterestRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("interests")
      .select("*")
      .order("confidence", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.class) q = q.eq("class", options.class);
    if (options.status) q = q.eq("status", options.status);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listInterests:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapInterest(row as Record<string, unknown>),
    );
  }

  async insertAffectSignal(
    input: InsertAffectSignalInput,
  ): Promise<AffectSignalRow> {
    const now = new Date().toISOString();
    const ownerId =
      this.ownerId ?? "00000000-0000-4000-8000-000000000001";
    const payload = {
      owner_id: ownerId,
      signal_type: input.signalType,
      value: input.value,
      source_family: input.sourceFamily,
      observation_id: input.observationId ?? null,
      context: input.context ?? {},
      occurred_at: input.occurredAt ?? null,
      capture_mode: input.captureMode ?? "inferred",
    };
    const { data, error } = await this.client
      .from("affect_signals")
      .insert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] insertAffectSignal:", error.message);
      return {
        id: "noop",
        ownerId,
        signalType: input.signalType,
        value: input.value,
        sourceFamily: input.sourceFamily,
        observationId: input.observationId ?? null,
        context: { ...(input.context ?? {}), writeError: error.message },
        occurredAt: input.occurredAt ?? null,
        captureMode: input.captureMode ?? "inferred",
        createdAt: now,
      };
    }
    return mapAffectSignal(data as Record<string, unknown>);
  }

  async listAffectSignals(options: {
    limit?: number;
    signalType?: string;
    since?: string;
  } = {}): Promise<AffectSignalRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("affect_signals")
      .select("*")
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.signalType) q = q.eq("signal_type", options.signalType);
    if (options.since) q = q.gte("occurred_at", options.since);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listAffectSignals:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapAffectSignal(row as Record<string, unknown>),
    );
  }
}
