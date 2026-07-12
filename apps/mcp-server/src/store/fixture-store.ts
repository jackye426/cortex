import { randomUUID } from "node:crypto";
import {
  CALENDAR_TYPE,
  EMPTY_MEMORY_HINT,
  EMPTY_SEARCH_HINT,
  cosineSimilarity,
  fixtureEmbedFromText,
  horizonCutoffIso,
  isWorkRecordType,
  resolveExcludeTypes,
  textMatchesQuery,
  withinHorizon,
} from "./search-helpers.js";
import {
  FIXTURE_RECORDS,
  FIXTURE_SESSIONS,
  calendarFromRecords,
  emailThreadFromRecords,
  fileFromRecords,
  fixtureDistillates,
  fixtureEntities,
  fixtureEntityLinks,
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
  EntityLinkRow,
  EntityRow,
  FileSummary,
  LinkEntityInput,
  ListRecentWorkOptions,
  MemorySearchHit,
  MemorySearchOptions,
  MemorySearchResult,
  RecentWorkItem,
  RecordHit,
  SearchRecordsOptions,
  SearchRecordsResult,
  SessionDetail,
  SessionEnvelopeInput,
  UpsertEntityInput,
} from "./types.js";

/**
 * In-memory fixture store — used when Supabase is not configured.
 * Mutates fixture distillates in-process for distillate worker demos.
 */
export class FixtureStore implements CortexStore {
  readonly mode = "fixture" as const;

  async searchRecords(
    query: string,
    options: SearchRecordsOptions = {},
  ): Promise<SearchRecordsResult> {
    const capped = Math.max(1, Math.min(options.limit ?? 20, 100));
    const excludeTypes = new Set(resolveExcludeTypes(options));
    const hits = FIXTURE_RECORDS.filter((r) => {
      if (excludeTypes.has(r.recordType)) return false;
      if (
        options.recordTypes?.length &&
        !options.recordTypes.includes(r.recordType)
      ) {
        return false;
      }
      if (
        options.sources?.length &&
        !options.sources.includes(r.sourceId)
      ) {
        return false;
      }
      if (options.since && (r.occurredAt ?? "") < options.since) return false;
      if (options.until && (r.occurredAt ?? "") > options.until) return false;
      return matchQuery(
        JSON.stringify({
          type: r.recordType,
          source: r.sourceId,
          id: r.sourceRecordId,
          payload: r.payload,
        }),
        query,
      );
    }).slice(0, capped);

    const distillates = await this.searchDistillates(query, Math.min(capped, 10));
    const hint =
      hits.length === 0 && distillates.length === 0
        ? EMPTY_SEARCH_HINT
        : undefined;
    return { hits, distillates, hint };
  }

  async searchDistillates(
    query: string,
    limit = 20,
    kinds?: string[],
  ): Promise<DistillateRow[]> {
    const capped = Math.max(1, Math.min(limit, 100));
    return fixtureDistillates
      .filter((d) => {
        if (kinds?.length && !kinds.includes(d.kind)) return false;
        return (
          textMatchesQuery(d.content, query) ||
          textMatchesQuery(JSON.stringify(d.metadata), query) ||
          textMatchesQuery(d.kind, query) ||
          !query.trim()
        );
      })
      .slice(0, capped);
  }

  async listDistillates(options: {
    limit?: number;
    kinds?: string[];
    missingEmbedding?: boolean;
  } = {}): Promise<DistillateRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureDistillates
      .filter((d) => {
        if (options.kinds?.length && !options.kinds.includes(d.kind)) {
          return false;
        }
        if (options.missingEmbedding && d.embedding?.length) return false;
        return true;
      })
      .slice(0, capped);
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

  async listRecentWork(
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

    const items: RecentWorkItem[] = [];

    if (includeSessions) {
      for (const s of FIXTURE_SESSIONS) {
        const recent = sessionToRecent(s);
        if (!withinHorizon(recent.occurredAt, cutoff)) continue;
        const d = fixtureDistillates.find(
          (x) =>
            x.subjectType === "session" &&
            x.subjectId === s.id &&
            x.kind === "summary",
        );
        recent.distillateSummary = d?.content?.slice(0, 180) ?? null;
        items.push(recent);
      }
    }

    if (includeRecords) {
      for (const r of FIXTURE_RECORDS) {
        if (excludeTypes.has(r.recordType)) continue;
        if (
          options.recordTypes?.length &&
          !options.recordTypes.includes(r.recordType)
        ) {
          continue;
        }
        if (
          workMode &&
          !options.recordTypes?.length &&
          !isWorkRecordType(r.recordType)
        ) {
          continue;
        }
        if (!withinHorizon(r.occurredAt, cutoff)) continue;
        items.push(recordToRecent(r));
      }
    }

    items.sort((a, b) =>
      (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""),
    );
    return items.slice(0, capped);
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
    row: Omit<DistillateRow, "id" | "createdAt" | "updatedAt" | "embedding"> & {
      id?: string;
      embedding?: number[] | null;
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
        embedding: row.embedding ?? prev.embedding ?? null,
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
      embedding: row.embedding ?? null,
      createdAt: now,
      updatedAt: now,
    };
    fixtureDistillates.push(created);
    return created;
  }

  async searchMemory(
    query: string,
    options: MemorySearchOptions = {},
  ): Promise<MemorySearchResult> {
    const capped = Math.max(1, Math.min(options.limit ?? 15, 50));
    const trimmed = query.trim();
    const distillates = trimmed
      ? await this.searchDistillates(trimmed, capped * 2, options.kinds)
      : await this.listDistillates({ limit: capped * 2, kinds: options.kinds });
    const records = trimmed
      ? await this.searchRecords(trimmed, {
          limit: capped,
          since: options.since,
          until: options.until,
        })
      : { hits: [] as RecordHit[], distillates: [] };

    const queryVec = trimmed ? fixtureEmbedFromText(trimmed) : null;
    const hits: MemorySearchHit[] = [
      ...distillates.map((d) => {
        let score =
          trimmed &&
          (textMatchesQuery(d.content, trimmed) ||
            textMatchesQuery(JSON.stringify(d.metadata), trimmed))
            ? 0.72
            : 0.55;
        const emb = d.embedding?.length
          ? d.embedding
          : fixtureEmbedFromText(d.content ?? "");
        if (queryVec) {
          score = Math.max(score, cosineSimilarity(queryVec, emb));
        }
        return {
          kind: "distillate" as const,
          id: d.id,
          score,
          title: `${d.kind}:${d.subjectType}/${d.subjectId}`,
          snippet: (d.content ?? "").slice(0, 280),
          sessionId: d.subjectType === "session" ? d.subjectId : undefined,
          distillateKind: d.kind,
          subjectType: d.subjectType,
          subjectId: d.subjectId,
        };
      }),
      ...records.hits.map((r) => ({
        kind: "record" as const,
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
      })),
    ];
    hits.sort((a, b) => b.score - a.score);
    const sliced = hits.slice(0, capped);
    return {
      hits: sliced,
      hint: sliced.length === 0 ? EMPTY_MEMORY_HINT : undefined,
    };
  }

  async listEntities(
    entityType?: string,
    limit = 50,
  ): Promise<EntityRow[]> {
    return fixtureEntities
      .filter((e) => !entityType || e.entityType === entityType)
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  async upsertEntity(input: UpsertEntityInput): Promise<EntityRow> {
    const existing = fixtureEntities.find(
      (e) =>
        e.entityType === input.entityType &&
        e.canonicalKey === input.canonicalKey,
    );
    if (existing) {
      existing.displayName = input.displayName ?? existing.displayName;
      existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
      return existing;
    }
    const created: EntityRow = {
      id: randomUUID(),
      entityType: input.entityType,
      canonicalKey: input.canonicalKey,
      displayName: input.displayName ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    fixtureEntities.push(created);
    return created;
  }

  async linkEntity(input: LinkEntityInput): Promise<EntityLinkRow> {
    const existing = fixtureEntityLinks.find(
      (l) =>
        l.entityId === input.entityId &&
        l.linkedType === input.linkedType &&
        l.linkedId === input.linkedId &&
        l.relation === (input.relation ?? "related"),
    );
    if (existing) {
      existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
      return existing;
    }
    const created: EntityLinkRow = {
      id: randomUUID(),
      entityId: input.entityId,
      linkedType: input.linkedType,
      linkedId: input.linkedId,
      relation: input.relation ?? "related",
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    fixtureEntityLinks.push(created);
    return created;
  }

  async listEntityLinks(entityId: string): Promise<EntityLinkRow[]> {
    return fixtureEntityLinks.filter((l) => l.entityId === entityId);
  }
}
