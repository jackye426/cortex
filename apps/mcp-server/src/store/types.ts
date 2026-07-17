/** Shared shapes for MCP tool backends (Supabase or fixture mode). */

import type {
  AffectSignalRow,
  InsertAffectSignalInput,
  InterestRow,
  ListInterestsOptions,
  ListObservationsOptions,
  ObservationRow,
  UpsertInterestInput,
  UpsertObservationInput,
} from "../intrapersonal/types.js";

export type {
  AffectSignalRow,
  InsertAffectSignalInput,
  InterestRow,
  ListInterestsOptions,
  ListObservationsOptions,
  ObservationRow,
  UpsertInterestInput,
  UpsertObservationInput,
};

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
  /** One-line distillate summary when available (sessions). */
  distillateSummary?: string | null;
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
  /** Present when pgvector column is populated (Track C). */
  embedding?: number[] | null;
}

export interface SampledTurnInput {
  index: number;
  role: string;
  content: string;
  toolHeavy?: boolean;
  messageId?: string;
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
  /** Tool name summaries for distillate context. */
  toolSummaries?: string[];
  /** Stratified sampled turns (first/mid/last/tool-heavy). */
  sampledTurns?: SampledTurnInput[];
  sampleStrategy?: import("../session-sampler.js").SampleStrategy | Record<string, unknown>;
  turnCount?: number;
  pathsTouched?: string[];
  commands?: string[];
  metadata?: Record<string, unknown>;
}

/** Filters for search_records / search memory keyword path. */
export interface SearchRecordsOptions {
  limit?: number;
  recordTypes?: string[];
  sources?: string[];
  excludeTypes?: string[];
  since?: string;
  until?: string;
  /**
   * When true (default), exclude calendar_event unless recordTypes explicitly
   * includes it or excludeTypes overrides.
   */
  excludeCalendarDefault?: boolean;
}

export interface SearchRecordsResult {
  hits: RecordHit[];
  distillates: DistillateRow[];
  hint?: string;
}

export interface ListRecentWorkOptions {
  limit?: number;
  /** When omitted, both kinds are considered (work-biased). */
  kinds?: Array<"session" | "record">;
  recordTypes?: string[];
  excludeTypes?: string[];
  /**
   * Drop items with occurred_at / start after now + N days.
   * Default 7. Pass null to disable.
   */
  horizonDays?: number | null;
  /**
   * Prefer sessions + github_* + email_message for records.
   * Default true when kinds omitted.
   */
  workMode?: boolean;
}

export type MemorySearchMode = "operational" | "reflective" | "both";

export interface MemorySearchOptions {
  limit?: number;
  kinds?: string[];
  since?: string;
  until?: string;
  /** operational | reflective | both — filters distillate kinds via lenses. */
  mode?: MemorySearchMode;
  domains?: string[];
  topics?: string[];
  sourceTypes?: string[];
  minConfidence?: number;
}

export interface MemorySearchHit {
  kind: "distillate" | "record";
  id: string;
  score: number;
  title: string;
  snippet: string;
  sourceId?: string;
  sessionId?: string;
  recordId?: string;
  recordType?: string;
  distillateKind?: string;
  subjectType?: string;
  subjectId?: string;
}

export interface MemorySearchResult {
  hits: MemorySearchHit[];
  hint?: string;
}

export interface EntityRow {
  id: string;
  entityType: string;
  canonicalKey: string;
  displayName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EntityLinkRow {
  id: string;
  entityId: string;
  linkedType: string;
  linkedId: string;
  relation: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UpsertEntityInput {
  entityType: string;
  canonicalKey: string;
  displayName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LinkEntityInput {
  entityId: string;
  linkedType: string;
  linkedId: string;
  relation?: string;
  metadata?: Record<string, unknown>;
}

export type StoreCredential = "vault" | "mirror" | "fixture";

export interface CalendarStructureItem {
  id: string;
  sourceRecordId: string;
  summary: string | null;
  start: string | null;
  end: string | null;
  attendeeCount: number;
  hasDescription: boolean;
  hasAttachments: boolean;
}

export interface CortexStore {
  readonly mode: "supabase" | "fixture";
  /** Which DB credential this store uses (mirror = limited JWT when configured). */
  readonly credential: StoreCredential;
  searchRecords(
    query: string,
    options?: SearchRecordsOptions,
  ): Promise<SearchRecordsResult>;
  getSession(sessionId: string): Promise<SessionDetail | null>;
  listRecentWork(options?: ListRecentWorkOptions): Promise<RecentWorkItem[]>;
  getEmailThread(threadId: string): Promise<EmailThread | null>;
  getCalendarRange(start: string, end: string): Promise<CalendarEventItem[]>;
  /**
   * Mirror-safe calendar rows from `cortex_calendar_structure`
   * (no description / attachment payloads).
   */
  getCalendarStructure(
    start: string,
    end: string,
  ): Promise<CalendarStructureItem[]>;
  getFileSummary(fileId: string): Promise<FileSummary | null>;
  /** List recent records of a given record_type (ebook, bookmark, spotify_*, youtube_*). */
  listRecordsByType(
    recordType: string,
    limit?: number,
  ): Promise<RecordHit[]>;
  /**
   * List records of a type with occurred_at in [since, until) (ISO strings).
   * Used by week-scoped compilers so they are not blinded by a global top-N cap.
   */
  listRecordsByTypeInRange(
    recordType: string,
    since: string,
    until: string,
    limit?: number,
  ): Promise<RecordHit[]>;
  listSessionsForDistillate(
    limit?: number,
    options?: { skipDistilled?: boolean },
  ): Promise<SessionEnvelopeInput[]>;
  upsertDistillate(
    row: Omit<DistillateRow, "id" | "createdAt" | "updatedAt" | "embedding"> & {
      id?: string;
      embedding?: number[] | null;
    },
  ): Promise<DistillateRow>;
  searchDistillates(
    query: string,
    limit?: number,
    kinds?: string[],
  ): Promise<DistillateRow[]>;
  /**
   * Distillates missing `embedding` (for embed-backfill without re-LLM).
   * When `missingEmbedding` is false/undefined, returns recent by kinds.
   */
  listDistillates(options?: {
    limit?: number;
    kinds?: string[];
    missingEmbedding?: boolean;
  }): Promise<DistillateRow[]>;
  searchMemory(
    query: string,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult>;
  listEntities(entityType?: string, limit?: number): Promise<EntityRow[]>;
  upsertEntity(input: UpsertEntityInput): Promise<EntityRow>;
  linkEntity(input: LinkEntityInput): Promise<EntityLinkRow>;
  listEntityLinks(entityId: string): Promise<EntityLinkRow[]>;
  /** Durable factual intrapersonal atoms (I1). */
  upsertObservation(input: UpsertObservationInput): Promise<ObservationRow>;
  listObservations(options?: ListObservationsOptions): Promise<ObservationRow[]>;
  /** Interest entities (I2). */
  upsertInterest(input: UpsertInterestInput): Promise<InterestRow>;
  listInterests(options?: ListInterestsOptions): Promise<InterestRow[]>;
  /** Affect proxies / reflections (I2). */
  insertAffectSignal(input: InsertAffectSignalInput): Promise<AffectSignalRow>;
  listAffectSignals(options?: {
    limit?: number;
    signalType?: string;
    since?: string;
  }): Promise<AffectSignalRow[]>;
}
