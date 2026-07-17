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
import { distillateMatchesLenses, kindsForMode } from "./memory-lenses.js";
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
  AffectSignalRow,
  CalendarEventItem,
  CalendarStructureItem,
  ClaimEvidenceRow,
  CortexStore,
  DecisionOutcomeRow,
  DecisionRow,
  DistillateRow,
  EmailThread,
  EntityLinkRow,
  EntityRow,
  ExperimentRow,
  FileSummary,
  HypothesisRow,
  InsertAffectSignalInput,
  InsertClaimEvidenceInput,
  InsertDecisionOutcomeInput,
  InsertInsightVerdictInput,
  InsertSelfModelDiffInput,
  InsertSelfModelVersionInput,
  InsightVerdictRow,
  InterestRow,
  IntrapersonalRecordRow,
  LinkEntityInput,
  ListDecisionsOptions,
  ListExperimentsOptions,
  ListHypothesesOptions,
  ListInsightVerdictsOptions,
  ListInterestsOptions,
  ListIntrapersonalRecordsOptions,
  ListObservationsOptions,
  ListPredictionEventsOptions,
  ListRecentWorkOptions,
  ListSelfModelDiffsOptions,
  ListSelfModelVersionsOptions,
  MemorySearchHit,
  MemorySearchOptions,
  MemorySearchResult,
  ObservationRow,
  PredictionEventRow,
  RecentWorkItem,
  RecordHit,
  SearchRecordsOptions,
  SearchRecordsResult,
  SelfModelDiffRow,
  SelfModelVersionRow,
  SessionDetail,
  SessionEnvelopeInput,
  StoreCredential,
  UpsertDecisionInput,
  UpsertEntityInput,
  UpsertExperimentInput,
  UpsertHypothesisInput,
  UpsertInterestInput,
  UpsertIntrapersonalRecordInput,
  UpsertObservationInput,
  UpsertPredictionEventInput,
} from "./types.js";

const fixtureObservations: ObservationRow[] = [];
const fixtureInterests: InterestRow[] = [];
const fixtureAffectSignals: AffectSignalRow[] = [];
const fixtureHypotheses: HypothesisRow[] = [];
const fixtureIntrapersonalRecords: IntrapersonalRecordRow[] = [];
const fixtureSelfModelVersions: SelfModelVersionRow[] = [];
const fixtureInsightVerdicts: InsightVerdictRow[] = [];
const fixtureClaimEvidence: ClaimEvidenceRow[] = [];
const fixtureDecisions: DecisionRow[] = [];
const fixtureDecisionOutcomes: DecisionOutcomeRow[] = [];
const fixtureExperiments: ExperimentRow[] = [];
const fixturePredictionEvents: PredictionEventRow[] = [];
const fixtureSelfModelDiffs: SelfModelDiffRow[] = [];

/**
 * In-memory fixture store — used when Supabase is not configured.
 * Mutates fixture distillates in-process for distillate worker demos.
 */
export class FixtureStore implements CortexStore {
  readonly mode = "fixture" as const;
  readonly credential: StoreCredential = "fixture";

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

  async getCalendarStructure(
    start: string,
    end: string,
  ): Promise<CalendarStructureItem[]> {
    const events = await this.getCalendarRange(start, end);
    const byId = new Map(FIXTURE_RECORDS.map((r) => [r.id, r]));
    return events.map((e) => {
      const raw = byId.get(e.id);
      const payload = raw?.payload ?? {};
      const attendees = payload.attendees;
      return {
        id: e.id,
        sourceRecordId: e.sourceRecordId,
        summary: e.summary,
        start: e.start,
        end: e.end,
        attendeeCount: Array.isArray(attendees) ? attendees.length : 0,
        hasDescription: Boolean(String(payload.description ?? "").trim()),
        hasAttachments:
          Array.isArray(payload.attachments) && payload.attachments.length > 0,
      };
    });
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
      Math.max(1, Math.min(limit, 500)),
    );
  }

  async listRecordsByTypeInRange(
    recordType: string,
    since: string,
    until: string,
    limit = 500,
  ): Promise<RecordHit[]> {
    const capped = Math.max(1, Math.min(limit, 2000));
    return FIXTURE_RECORDS.filter(
      (r) =>
        r.recordType === recordType &&
        Boolean(r.occurredAt) &&
        (r.occurredAt as string) >= since &&
        (r.occurredAt as string) < until,
    ).slice(0, capped);
  }

  async listSessionsForDistillate(
    limit = 50,
    _options: { skipDistilled?: boolean } = {},
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
    const effectiveKinds =
      options.kinds?.length ? options.kinds : kindsForMode(options.mode);
    const distillatesRaw = trimmed
      ? await this.searchDistillates(trimmed, capped * 3, effectiveKinds)
      : await this.listDistillates({
          limit: capped * 3,
          kinds: effectiveKinds,
        });
    const distillates = distillatesRaw.filter((d) =>
      distillateMatchesLenses(d, options),
    );
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
      ...records.hits
        .filter((r) => {
          if (
            options.mode === "operational" &&
            r.recordType.startsWith("youtube_")
          ) {
            return false;
          }
          return true;
        })
        .map((r) => ({
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

  async upsertObservation(
    input: UpsertObservationInput,
  ): Promise<ObservationRow> {
    const existing = fixtureObservations.find(
      (o) => o.contentHash === input.contentHash,
    );
    if (existing) {
      existing.statement = input.statement;
      existing.confidence = input.confidence ?? existing.confidence;
      existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
      existing.occurredAt = input.occurredAt ?? existing.occurredAt;
      return existing;
    }
    const created: ObservationRow = {
      id: randomUUID(),
      epistemicType: input.epistemicType,
      statement: input.statement,
      sourceFamily: input.sourceFamily,
      independenceGroup: input.independenceGroup,
      occurredAt: input.occurredAt ?? null,
      capturedAt: new Date().toISOString(),
      recordId: input.recordId ?? null,
      distillateId: input.distillateId ?? null,
      sessionId: input.sessionId ?? null,
      supportKind: input.supportKind ?? "direct_observation",
      confidence: input.confidence ?? 0.5,
      metadata: input.metadata ?? {},
      contentHash: input.contentHash,
    };
    fixtureObservations.push(created);
    return created;
  }

  async listObservations(
    options: ListObservationsOptions = {},
  ): Promise<ObservationRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureObservations
      .filter((o) => {
        if (options.sourceFamily && o.sourceFamily !== options.sourceFamily) {
          return false;
        }
        if (options.distillateId && o.distillateId !== options.distillateId) {
          return false;
        }
        if (options.since && (o.occurredAt ?? "") < options.since) return false;
        if (options.until && (o.occurredAt ?? "") > options.until) return false;
        return true;
      })
      .slice(0, limit);
  }

  async upsertInterest(input: UpsertInterestInput): Promise<InterestRow> {
    const now = new Date().toISOString();
    const existing = fixtureInterests.find(
      (i) => i.canonicalKey === input.canonicalKey,
    );
    if (existing) {
      existing.displayName = input.displayName ?? existing.displayName;
      existing.class = input.class;
      existing.status = input.status ?? existing.status;
      existing.confidence = input.confidence ?? existing.confidence;
      existing.summary = input.summary ?? existing.summary;
      existing.firstSeenAt = input.firstSeenAt ?? existing.firstSeenAt;
      existing.lastActiveAt = input.lastActiveAt ?? existing.lastActiveAt;
      existing.recurrenceScore =
        input.recurrenceScore ?? existing.recurrenceScore;
      existing.specificityScore =
        input.specificityScore ?? existing.specificityScore;
      existing.voluntaryReturnScore =
        input.voluntaryReturnScore ?? existing.voluntaryReturnScore;
      existing.persistenceAfterUtility =
        input.persistenceAfterUtility ?? existing.persistenceAfterUtility;
      existing.energyDelta =
        input.energyDelta !== undefined
          ? input.energyDelta
          : existing.energyDelta;
      existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
      existing.updatedAt = now;
      return existing;
    }
    const created: InterestRow = {
      id: randomUUID(),
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
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    fixtureInterests.push(created);
    return created;
  }

  async listInterests(
    options: ListInterestsOptions = {},
  ): Promise<InterestRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureInterests
      .filter((i) => {
        if (options.class && i.class !== options.class) return false;
        if (options.status && i.status !== options.status) return false;
        return true;
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  async insertAffectSignal(
    input: InsertAffectSignalInput,
  ): Promise<AffectSignalRow> {
    const created: AffectSignalRow = {
      id: randomUUID(),
      signalType: input.signalType,
      value: input.value,
      sourceFamily: input.sourceFamily,
      observationId: input.observationId ?? null,
      context: input.context ?? {},
      occurredAt: input.occurredAt ?? null,
      captureMode: input.captureMode ?? "inferred",
      createdAt: new Date().toISOString(),
    };
    fixtureAffectSignals.push(created);
    return created;
  }

  async listAffectSignals(options: {
    limit?: number;
    signalType?: string;
    since?: string;
  } = {}): Promise<AffectSignalRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureAffectSignals
      .filter((s) => {
        if (options.signalType && s.signalType !== options.signalType) {
          return false;
        }
        if (options.since && (s.occurredAt ?? "") < options.since) return false;
        return true;
      })
      .slice(0, limit);
  }

  async upsertHypothesis(input: UpsertHypothesisInput): Promise<HypothesisRow> {
    const now = new Date().toISOString();
    if (input.id) {
      const existing = fixtureHypotheses.find((h) => h.id === input.id);
      if (existing) {
        existing.claim = input.claim;
        existing.whyItMatters = input.whyItMatters ?? existing.whyItMatters;
        existing.state = input.state ?? existing.state;
        existing.confidence = input.confidence ?? existing.confidence;
        existing.sourceDiversity =
          input.sourceDiversity ?? existing.sourceDiversity;
        existing.falsifiers = input.falsifiers ?? existing.falsifiers;
        existing.alternativeExplanations =
          input.alternativeExplanations ?? existing.alternativeExplanations;
        existing.domains = input.domains ?? existing.domains;
        existing.lastTestedAt =
          input.lastTestedAt !== undefined
            ? input.lastTestedAt
            : existing.lastTestedAt;
        existing.origin = input.origin ?? existing.origin;
        existing.assistantWeight =
          input.assistantWeight ?? existing.assistantWeight;
        existing.priorHypothesisId =
          input.priorHypothesisId !== undefined
            ? input.priorHypothesisId
            : existing.priorHypothesisId;
        existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
        existing.updatedAt = now;
        return existing;
      }
    }
    const created: HypothesisRow = {
      id: input.id ?? randomUUID(),
      claim: input.claim,
      whyItMatters: input.whyItMatters ?? "",
      state: input.state ?? "emerging",
      confidence: input.confidence ?? 0.4,
      sourceDiversity: input.sourceDiversity ?? 0,
      falsifiers: input.falsifiers ?? [],
      alternativeExplanations: input.alternativeExplanations ?? [],
      domains: input.domains ?? [],
      lastTestedAt: input.lastTestedAt ?? null,
      origin: input.origin ?? "user",
      assistantWeight: input.assistantWeight ?? 0.5,
      priorHypothesisId: input.priorHypothesisId ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    fixtureHypotheses.push(created);
    return created;
  }

  async getHypothesis(id: string): Promise<HypothesisRow | null> {
    return fixtureHypotheses.find((h) => h.id === id) ?? null;
  }

  async listHypotheses(
    options: ListHypothesesOptions = {},
  ): Promise<HypothesisRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureHypotheses
      .filter((h) => {
        if (options.state && h.state !== options.state) return false;
        if (options.origin && h.origin !== options.origin) return false;
        if (
          options.minConfidence != null &&
          h.confidence < options.minConfidence
        ) {
          return false;
        }
        if (options.domain && !h.domains.includes(options.domain)) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async upsertIntrapersonalRecord(
    input: UpsertIntrapersonalRecordInput,
  ): Promise<IntrapersonalRecordRow> {
    const now = new Date().toISOString();
    if (input.id) {
      const existing = fixtureIntrapersonalRecords.find((r) => r.id === input.id);
      if (existing) {
        existing.recordKind = input.recordKind;
        existing.title = input.title;
        existing.statement = input.statement;
        existing.epistemicType = input.epistemicType ?? existing.epistemicType;
        existing.confidence = input.confidence ?? existing.confidence;
        existing.status = input.status ?? existing.status;
        existing.context = input.context ?? existing.context;
        existing.behaviour = input.behaviour ?? existing.behaviour;
        existing.outcome = input.outcome ?? existing.outcome;
        existing.origin = input.origin ?? existing.origin;
        existing.hypothesisId =
          input.hypothesisId !== undefined
            ? input.hypothesisId
            : existing.hypothesisId;
        existing.interestId =
          input.interestId !== undefined ? input.interestId : existing.interestId;
        existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
        existing.updatedAt = now;
        return existing;
      }
    }
    const created: IntrapersonalRecordRow = {
      id: input.id ?? randomUUID(),
      recordKind: input.recordKind,
      title: input.title,
      statement: input.statement,
      epistemicType: input.epistemicType ?? "interpretation",
      confidence: input.confidence ?? 0.5,
      status: input.status ?? "active",
      context: input.context ?? {},
      behaviour: input.behaviour ?? {},
      outcome: input.outcome ?? {},
      origin: input.origin ?? "inference",
      hypothesisId: input.hypothesisId ?? null,
      interestId: input.interestId ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    fixtureIntrapersonalRecords.push(created);
    return created;
  }

  async listIntrapersonalRecords(
    options: ListIntrapersonalRecordsOptions = {},
  ): Promise<IntrapersonalRecordRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureIntrapersonalRecords
      .filter((r) => {
        if (options.recordKind && r.recordKind !== options.recordKind) {
          return false;
        }
        if (options.status && r.status !== options.status) return false;
        if (options.hypothesisId && r.hypothesisId !== options.hypothesisId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async insertSelfModelVersion(
    input: InsertSelfModelVersionInput,
  ): Promise<SelfModelVersionRow> {
    const created: SelfModelVersionRow = {
      id: randomUUID(),
      version: input.version,
      summary: input.summary,
      compiledFrom: input.compiledFrom ?? {},
      strengths: input.strengths ?? [],
      limitations: input.limitations ?? [],
      motives: input.motives ?? [],
      tensions: input.tensions ?? [],
      identityDevelopment: input.identityDevelopment ?? [],
      openQuestionIds: input.openQuestionIds ?? [],
      supersedesId: input.supersedesId ?? null,
      userCorrections: input.userCorrections ?? [],
      createdAt: new Date().toISOString(),
    };
    fixtureSelfModelVersions.push(created);
    return created;
  }

  async listSelfModelVersions(
    options: ListSelfModelVersionsOptions = {},
  ): Promise<SelfModelVersionRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    return [...fixtureSelfModelVersions]
      .sort((a, b) => b.version - a.version)
      .slice(0, limit);
  }

  async getLatestSelfModelVersion(): Promise<SelfModelVersionRow | null> {
    const rows = await this.listSelfModelVersions({ limit: 1 });
    return rows[0] ?? null;
  }

  async insertInsightVerdict(
    input: InsertInsightVerdictInput,
  ): Promise<InsightVerdictRow> {
    const created: InsightVerdictRow = {
      id: randomUUID(),
      insightId: input.insightId,
      insightKind: input.insightKind,
      verdict: input.verdict,
      note: input.note ?? null,
      nonObvious: input.nonObvious ?? null,
      useful: input.useful ?? null,
      createdAt: new Date().toISOString(),
    };
    fixtureInsightVerdicts.push(created);
    return created;
  }

  async listInsightVerdicts(
    options: ListInsightVerdictsOptions = {},
  ): Promise<InsightVerdictRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureInsightVerdicts
      .filter((v) => {
        if (options.insightId && v.insightId !== options.insightId) return false;
        if (options.since && v.createdAt < options.since) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async insertClaimEvidence(
    input: InsertClaimEvidenceInput,
  ): Promise<ClaimEvidenceRow> {
    const created: ClaimEvidenceRow = {
      id: randomUUID(),
      claimId: input.claimId,
      claimKind: input.claimKind,
      observationId: input.observationId ?? null,
      evidence: input.evidence,
      polarity: input.polarity,
      createdAt: new Date().toISOString(),
    };
    fixtureClaimEvidence.push(created);
    return created;
  }

  async listClaimEvidence(options: {
    claimId?: string;
    claimKind?: string;
    limit?: number;
  } = {}): Promise<ClaimEvidenceRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureClaimEvidence
      .filter((e) => {
        if (options.claimId && e.claimId !== options.claimId) return false;
        if (options.claimKind && e.claimKind !== options.claimKind) return false;
        return true;
      })
      .slice(0, limit);
  }

  async upsertDecision(input: UpsertDecisionInput): Promise<DecisionRow> {
    const now = new Date().toISOString();
    if (input.id) {
      const existing = fixtureDecisions.find((d) => d.id === input.id);
      if (existing) {
        existing.title = input.title;
        existing.statement = input.statement ?? existing.statement;
        existing.decidedAt = input.decidedAt ?? existing.decidedAt;
        existing.expectedOutcome =
          input.expectedOutcome !== undefined
            ? input.expectedOutcome
            : existing.expectedOutcome;
        existing.relatedHypothesisIds =
          input.relatedHypothesisIds ?? existing.relatedHypothesisIds;
        existing.relatedEntityKeys =
          input.relatedEntityKeys ?? existing.relatedEntityKeys;
        existing.source = input.source ?? existing.source;
        existing.distillateId =
          input.distillateId !== undefined
            ? input.distillateId
            : existing.distillateId;
        existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
        return existing;
      }
    }
    const created: DecisionRow = {
      id: input.id ?? randomUUID(),
      title: input.title,
      statement: input.statement ?? "",
      decidedAt: input.decidedAt ?? now,
      expectedOutcome: input.expectedOutcome ?? null,
      relatedHypothesisIds: input.relatedHypothesisIds ?? [],
      relatedEntityKeys: input.relatedEntityKeys ?? [],
      source: input.source ?? "user",
      distillateId: input.distillateId ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
    };
    fixtureDecisions.push(created);
    return created;
  }

  async listDecisionsTable(
    options: ListDecisionsOptions = {},
  ): Promise<DecisionRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureDecisions
      .filter((d) => {
        if (options.since && d.decidedAt < options.since) return false;
        return true;
      })
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
      .slice(0, limit);
  }

  async insertDecisionOutcome(
    input: InsertDecisionOutcomeInput,
  ): Promise<DecisionOutcomeRow> {
    const created: DecisionOutcomeRow = {
      id: randomUUID(),
      decisionId: input.decisionId,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
      actualOutcome: input.actualOutcome,
      alignedWithExpected: input.alignedWithExpected ?? null,
      evidence: input.evidence ?? [],
      learning: input.learning ?? null,
      metadata: input.metadata ?? {},
    };
    fixtureDecisionOutcomes.push(created);
    return created;
  }

  async listDecisionOutcomes(options: {
    decisionId?: string;
    limit?: number;
  } = {}): Promise<DecisionOutcomeRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureDecisionOutcomes
      .filter((o) => {
        if (options.decisionId && o.decisionId !== options.decisionId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, limit);
  }

  async upsertExperiment(
    input: UpsertExperimentInput,
  ): Promise<ExperimentRow> {
    const now = new Date().toISOString();
    if (input.id) {
      const existing = fixtureExperiments.find((e) => e.id === input.id);
      if (existing) {
        existing.hypothesisId = input.hypothesisId;
        existing.title = input.title;
        existing.protocol = input.protocol;
        existing.status = input.status ?? existing.status;
        existing.proposedAt = input.proposedAt ?? existing.proposedAt;
        existing.dueAt =
          input.dueAt !== undefined ? input.dueAt : existing.dueAt;
        existing.completedAt =
          input.completedAt !== undefined
            ? input.completedAt
            : existing.completedAt;
        existing.resultSummary =
          input.resultSummary !== undefined
            ? input.resultSummary
            : existing.resultSummary;
        existing.resultPolarity =
          input.resultPolarity !== undefined
            ? input.resultPolarity
            : existing.resultPolarity;
        existing.evidence = input.evidence ?? existing.evidence;
        existing.metadata = { ...existing.metadata, ...(input.metadata ?? {}) };
        return existing;
      }
    }
    const created: ExperimentRow = {
      id: input.id ?? randomUUID(),
      hypothesisId: input.hypothesisId,
      title: input.title,
      protocol: input.protocol,
      status: input.status ?? "proposed",
      proposedAt: input.proposedAt ?? now,
      dueAt: input.dueAt ?? null,
      completedAt: input.completedAt ?? null,
      resultSummary: input.resultSummary ?? null,
      resultPolarity: input.resultPolarity ?? null,
      evidence: input.evidence ?? [],
      metadata: input.metadata ?? {},
    };
    fixtureExperiments.push(created);
    return created;
  }

  async listExperiments(
    options: ListExperimentsOptions = {},
  ): Promise<ExperimentRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixtureExperiments
      .filter((e) => {
        if (options.status && e.status !== options.status) return false;
        if (options.hypothesisId && e.hypothesisId !== options.hypothesisId) {
          return false;
        }
        if (options.dueBefore && (e.dueAt ?? "9999") > options.dueBefore) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt))
      .slice(0, limit);
  }

  async upsertPredictionEvent(
    input: UpsertPredictionEventInput,
  ): Promise<PredictionEventRow> {
    const now = new Date().toISOString();
    if (input.id) {
      const existing = fixturePredictionEvents.find((p) => p.id === input.id);
      if (existing) {
        existing.claimId = input.claimId;
        existing.claimKind = input.claimKind ?? existing.claimKind;
        existing.domain =
          input.domain !== undefined ? input.domain : existing.domain;
        existing.predicted = input.predicted;
        existing.actual =
          input.actual !== undefined ? input.actual : existing.actual;
        existing.correct =
          input.correct !== undefined ? input.correct : existing.correct;
        existing.resolvedAt =
          input.resolvedAt !== undefined
            ? input.resolvedAt
            : existing.resolvedAt;
        return existing;
      }
    }
    const created: PredictionEventRow = {
      id: input.id ?? randomUUID(),
      claimId: input.claimId,
      claimKind: input.claimKind ?? "hypothesis",
      domain: input.domain ?? null,
      predicted: input.predicted,
      actual: input.actual ?? null,
      correct: input.correct ?? null,
      createdAt: now,
      resolvedAt: input.resolvedAt ?? null,
    };
    fixturePredictionEvents.push(created);
    return created;
  }

  async listPredictionEvents(
    options: ListPredictionEventsOptions = {},
  ): Promise<PredictionEventRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return fixturePredictionEvents
      .filter((p) => {
        if (options.claimId && p.claimId !== options.claimId) return false;
        if (options.since && p.createdAt < options.since) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async insertSelfModelDiff(
    input: InsertSelfModelDiffInput,
  ): Promise<SelfModelDiffRow> {
    const created: SelfModelDiffRow = {
      id: randomUUID(),
      fromVersionId: input.fromVersionId ?? null,
      toVersionId: input.toVersionId,
      stable: input.stable ?? [],
      emerging: input.emerging ?? [],
      fading: input.fading ?? [],
      environmentShifts: input.environmentShifts ?? [],
      confirmedPredictions: input.confirmedPredictions ?? [],
      disprovedPredictions: input.disprovedPredictions ?? [],
      eventAnchors: input.eventAnchors ?? [],
      createdAt: new Date().toISOString(),
    };
    fixtureSelfModelDiffs.push(created);
    return created;
  }

  async listSelfModelDiffs(
    options: ListSelfModelDiffsOptions = {},
  ): Promise<SelfModelDiffRow[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    return fixtureSelfModelDiffs
      .filter((d) => {
        if (options.toVersionId && d.toVersionId !== options.toVersionId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
