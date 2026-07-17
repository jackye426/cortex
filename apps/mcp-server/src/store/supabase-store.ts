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
import type {
  AffectSignalType,
  EvidenceSupportKind,
  ExperimentResultPolarity,
  ExperimentStatus,
  HypothesisState,
  InsightVerdictValue,
  InterestClass,
  InterestStatus,
  IntrapersonalRecordStatus,
  SelfModelItem,
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function asItemArray(value: unknown): SelfModelItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: typeof x.id === "string" ? x.id : undefined,
      title: String(x.title ?? ""),
      statement: String(x.statement ?? ""),
      confidence:
        typeof x.confidence === "number" ? x.confidence : Number(x.confidence) || 0.5,
      evidenceIds: asStringArray(x.evidenceIds ?? x.evidence_ids),
      hypothesisId:
        typeof x.hypothesisId === "string"
          ? x.hypothesisId
          : typeof x.hypothesis_id === "string"
            ? x.hypothesis_id
            : null,
      recordId:
        typeof x.recordId === "string"
          ? x.recordId
          : typeof x.record_id === "string"
            ? x.record_id
            : null,
      domains: asStringArray(x.domains),
      status: typeof x.status === "string" ? x.status : undefined,
    }));
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (x): x is Record<string, unknown> => !!x && typeof x === "object",
  );
}

function mapHypothesis(row: Record<string, unknown>): HypothesisRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    claim: String(row.claim ?? ""),
    whyItMatters: String(row.why_it_matters ?? ""),
    state: String(row.state ?? "emerging") as HypothesisState,
    confidence:
      typeof row.confidence === "number" ? row.confidence : Number(row.confidence) || 0.4,
    sourceDiversity:
      typeof row.source_diversity === "number" ? row.source_diversity : 0,
    falsifiers: asStringArray(row.falsifiers),
    alternativeExplanations: asStringArray(row.alternative_explanations),
    domains: asStringArray(row.domains),
    lastTestedAt:
      typeof row.last_tested_at === "string" ? row.last_tested_at : null,
    origin: String(row.origin ?? "ask_mirror"),
    assistantWeight:
      typeof row.assistant_weight === "number" ? row.assistant_weight : 0.5,
    priorHypothesisId:
      typeof row.prior_hypothesis_id === "string"
        ? row.prior_hypothesis_id
        : null,
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

function mapIntrapersonalRecord(
  row: Record<string, unknown>,
): IntrapersonalRecordRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    recordKind: String(row.record_kind ?? "motive"),
    title: String(row.title ?? ""),
    statement: String(row.statement ?? ""),
    epistemicType: String(row.epistemic_type ?? "interpretation"),
    confidence:
      typeof row.confidence === "number" ? row.confidence : Number(row.confidence) || 0.5,
    status: String(row.status ?? "active") as IntrapersonalRecordStatus,
    context: asRecord(row.context),
    behaviour: asRecord(row.behaviour),
    outcome: asRecord(row.outcome),
    origin: String(row.origin ?? "inference"),
    hypothesisId:
      typeof row.hypothesis_id === "string" ? row.hypothesis_id : null,
    interestId: typeof row.interest_id === "string" ? row.interest_id : null,
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

function mapSelfModelVersion(row: Record<string, unknown>): SelfModelVersionRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    version: typeof row.version === "number" ? row.version : Number(row.version) || 1,
    summary: String(row.summary ?? ""),
    compiledFrom: asRecord(row.compiled_from),
    strengths: asItemArray(row.strengths),
    limitations: asItemArray(row.limitations),
    motives: asItemArray(row.motives),
    tensions: asItemArray(row.tensions),
    identityDevelopment: asItemArray(row.identity_development),
    openQuestionIds: asStringArray(row.open_question_ids),
    supersedesId:
      typeof row.supersedes_id === "string" ? row.supersedes_id : null,
    userCorrections: asRecordArray(row.user_corrections),
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
  };
}

function mapInsightVerdict(row: Record<string, unknown>): InsightVerdictRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    insightId: String(row.insight_id),
    insightKind: String(row.insight_kind ?? "hypothesis"),
    verdict: String(row.verdict ?? "confirm") as InsightVerdictValue,
    note: typeof row.note === "string" ? row.note : null,
    nonObvious:
      typeof row.non_obvious === "boolean" ? row.non_obvious : null,
    useful: typeof row.useful === "boolean" ? row.useful : null,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
  };
}

function mapClaimEvidence(row: Record<string, unknown>): ClaimEvidenceRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    claimId: String(row.claim_id),
    claimKind: String(row.claim_kind ?? "hypothesis"),
    observationId:
      typeof row.observation_id === "string" ? row.observation_id : null,
    evidence: asRecord(row.evidence),
    polarity: row.polarity === "contradicts" ? "contradicts" : "supports",
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
  };
}

function mapDecision(row: Record<string, unknown>): DecisionRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    title: String(row.title ?? ""),
    statement: String(row.statement ?? ""),
    decidedAt:
      typeof row.decided_at === "string"
        ? row.decided_at
        : new Date().toISOString(),
    expectedOutcome:
      typeof row.expected_outcome === "string" ? row.expected_outcome : null,
    relatedHypothesisIds: asStringArray(row.related_hypothesis_ids),
    relatedEntityKeys: asStringArray(row.related_entity_keys),
    source: String(row.source ?? "user"),
    distillateId:
      typeof row.distillate_id === "string" ? row.distillate_id : null,
    metadata: asRecord(row.metadata),
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
  };
}

function mapDecisionOutcome(row: Record<string, unknown>): DecisionOutcomeRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    decisionId: String(row.decision_id),
    recordedAt:
      typeof row.recorded_at === "string"
        ? row.recorded_at
        : new Date().toISOString(),
    actualOutcome: String(row.actual_outcome ?? ""),
    alignedWithExpected:
      typeof row.aligned_with_expected === "boolean"
        ? row.aligned_with_expected
        : null,
    evidence: asRecordArray(row.evidence),
    learning: typeof row.learning === "string" ? row.learning : null,
    metadata: asRecord(row.metadata),
  };
}

function mapExperiment(row: Record<string, unknown>): ExperimentRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    hypothesisId: String(row.hypothesis_id),
    title: String(row.title ?? ""),
    protocol: String(row.protocol ?? ""),
    status: String(row.status ?? "proposed") as ExperimentStatus,
    proposedAt:
      typeof row.proposed_at === "string"
        ? row.proposed_at
        : new Date().toISOString(),
    dueAt: typeof row.due_at === "string" ? row.due_at : null,
    completedAt:
      typeof row.completed_at === "string" ? row.completed_at : null,
    resultSummary:
      typeof row.result_summary === "string" ? row.result_summary : null,
    resultPolarity: (row.result_polarity == null
      ? null
      : String(row.result_polarity)) as ExperimentResultPolarity | null,
    evidence: asRecordArray(row.evidence),
    metadata: asRecord(row.metadata),
  };
}

function mapPredictionEvent(row: Record<string, unknown>): PredictionEventRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    claimId: String(row.claim_id),
    claimKind: String(row.claim_kind ?? "hypothesis"),
    domain: typeof row.domain === "string" ? row.domain : null,
    predicted: String(row.predicted ?? ""),
    actual: typeof row.actual === "string" ? row.actual : null,
    correct: typeof row.correct === "boolean" ? row.correct : null,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
    resolvedAt:
      typeof row.resolved_at === "string" ? row.resolved_at : null,
  };
}

function mapSelfModelDiff(row: Record<string, unknown>): SelfModelDiffRow {
  return {
    id: String(row.id),
    ownerId: typeof row.owner_id === "string" ? row.owner_id : undefined,
    fromVersionId:
      typeof row.from_version_id === "string" ? row.from_version_id : null,
    toVersionId: String(row.to_version_id),
    stable: asRecordArray(row.stable),
    emerging: asRecordArray(row.emerging),
    fading: asRecordArray(row.fading),
    environmentShifts: asRecordArray(row.environment_shifts),
    confirmedPredictions: asRecordArray(row.confirmed_predictions),
    disprovedPredictions: asRecordArray(row.disproved_predictions),
    eventAnchors: asRecordArray(row.event_anchors),
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

  private defaultOwnerId(): string {
    return this.ownerId ?? "00000000-0000-4000-8000-000000000001";
  }

  async upsertHypothesis(input: UpsertHypothesisInput): Promise<HypothesisRow> {
    const now = new Date().toISOString();
    const ownerId = this.defaultOwnerId();
    const payload: Record<string, unknown> = {
      owner_id: ownerId,
      claim: input.claim,
      why_it_matters: input.whyItMatters ?? "",
      state: input.state ?? "emerging",
      confidence: input.confidence ?? 0.4,
      source_diversity: input.sourceDiversity ?? 0,
      falsifiers: input.falsifiers ?? [],
      alternative_explanations: input.alternativeExplanations ?? [],
      domains: input.domains ?? [],
      last_tested_at: input.lastTestedAt ?? null,
      origin: input.origin ?? "user",
      assistant_weight: input.assistantWeight ?? 0.5,
      prior_hypothesis_id: input.priorHypothesisId ?? null,
      metadata: input.metadata ?? {},
      updated_at: now,
    };
    if (input.id) payload.id = input.id;
    const { data, error } = await this.client
      .from("hypotheses")
      .upsert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] upsertHypothesis:", error.message);
      return {
        id: input.id ?? "noop",
        ownerId,
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
        metadata: { ...(input.metadata ?? {}), writeError: error.message },
        createdAt: now,
        updatedAt: now,
      };
    }
    return mapHypothesis(data as Record<string, unknown>);
  }

  async getHypothesis(id: string): Promise<HypothesisRow | null> {
    let q = this.client.from("hypotheses").select("*").eq("id", id).limit(1);
    q = this.applyOwner(q);
    const { data, error } = await q.maybeSingle();
    if (error) {
      console.warn("[store/supabase] getHypothesis:", error.message);
      return null;
    }
    return data ? mapHypothesis(data as Record<string, unknown>) : null;
  }

  async listHypotheses(
    options: ListHypothesesOptions = {},
  ): Promise<HypothesisRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("hypotheses")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.state) q = q.eq("state", options.state);
    if (options.origin) q = q.eq("origin", options.origin);
    if (options.minConfidence != null) {
      q = q.gte("confidence", options.minConfidence);
    }
    if (options.domain) q = q.contains("domains", [options.domain]);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listHypotheses:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapHypothesis(row as Record<string, unknown>),
    );
  }

  async upsertIntrapersonalRecord(
    input: UpsertIntrapersonalRecordInput,
  ): Promise<IntrapersonalRecordRow> {
    const now = new Date().toISOString();
    const ownerId = this.defaultOwnerId();
    const payload: Record<string, unknown> = {
      owner_id: ownerId,
      record_kind: input.recordKind,
      title: input.title,
      statement: input.statement,
      epistemic_type: input.epistemicType ?? "interpretation",
      confidence: input.confidence ?? 0.5,
      status: input.status ?? "active",
      context: input.context ?? {},
      behaviour: input.behaviour ?? {},
      outcome: input.outcome ?? {},
      origin: input.origin ?? "inference",
      hypothesis_id: input.hypothesisId ?? null,
      interest_id: input.interestId ?? null,
      metadata: input.metadata ?? {},
      updated_at: now,
    };
    if (input.id) payload.id = input.id;
    const { data, error } = await this.client
      .from("intrapersonal_records")
      .upsert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn(
        "[store/supabase] upsertIntrapersonalRecord:",
        error.message,
      );
      return {
        id: input.id ?? "noop",
        ownerId,
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
        metadata: { ...(input.metadata ?? {}), writeError: error.message },
        createdAt: now,
        updatedAt: now,
      };
    }
    return mapIntrapersonalRecord(data as Record<string, unknown>);
  }

  async listIntrapersonalRecords(
    options: ListIntrapersonalRecordsOptions = {},
  ): Promise<IntrapersonalRecordRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("intrapersonal_records")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.recordKind) q = q.eq("record_kind", options.recordKind);
    if (options.status) q = q.eq("status", options.status);
    if (options.hypothesisId) q = q.eq("hypothesis_id", options.hypothesisId);
    const { data, error } = await q;
    if (error) {
      console.warn(
        "[store/supabase] listIntrapersonalRecords:",
        error.message,
      );
      return [];
    }
    return (data ?? []).map((row) =>
      mapIntrapersonalRecord(row as Record<string, unknown>),
    );
  }

  async insertSelfModelVersion(
    input: InsertSelfModelVersionInput,
  ): Promise<SelfModelVersionRow> {
    const ownerId = this.defaultOwnerId();
    const payload = {
      owner_id: ownerId,
      version: input.version,
      summary: input.summary,
      compiled_from: input.compiledFrom ?? {},
      strengths: input.strengths ?? [],
      limitations: input.limitations ?? [],
      motives: input.motives ?? [],
      tensions: input.tensions ?? [],
      identity_development: input.identityDevelopment ?? [],
      open_question_ids: input.openQuestionIds ?? [],
      supersedes_id: input.supersedesId ?? null,
      user_corrections: input.userCorrections ?? [],
    };
    const { data, error } = await this.client
      .from("self_model_versions")
      .insert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] insertSelfModelVersion:", error.message);
      return {
        id: "noop",
        ownerId,
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
    }
    return mapSelfModelVersion(data as Record<string, unknown>);
  }

  async listSelfModelVersions(
    options: ListSelfModelVersionsOptions = {},
  ): Promise<SelfModelVersionRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 20, 100));
    let q = this.client
      .from("self_model_versions")
      .select("*")
      .order("version", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listSelfModelVersions:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapSelfModelVersion(row as Record<string, unknown>),
    );
  }

  async getLatestSelfModelVersion(): Promise<SelfModelVersionRow | null> {
    const rows = await this.listSelfModelVersions({ limit: 1 });
    return rows[0] ?? null;
  }

  async insertInsightVerdict(
    input: InsertInsightVerdictInput,
  ): Promise<InsightVerdictRow> {
    const ownerId = this.defaultOwnerId();
    const payload = {
      owner_id: ownerId,
      insight_id: input.insightId,
      insight_kind: input.insightKind,
      verdict: input.verdict,
      note: input.note ?? null,
      non_obvious: input.nonObvious ?? null,
      useful: input.useful ?? null,
    };
    const { data, error } = await this.client
      .from("insight_verdicts")
      .insert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] insertInsightVerdict:", error.message);
      return {
        id: "noop",
        ownerId,
        insightId: input.insightId,
        insightKind: input.insightKind,
        verdict: input.verdict,
        note: input.note ?? null,
        nonObvious: input.nonObvious ?? null,
        useful: input.useful ?? null,
        createdAt: new Date().toISOString(),
      };
    }
    return mapInsightVerdict(data as Record<string, unknown>);
  }

  async listInsightVerdicts(
    options: ListInsightVerdictsOptions = {},
  ): Promise<InsightVerdictRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("insight_verdicts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.insightId) q = q.eq("insight_id", options.insightId);
    if (options.since) q = q.gte("created_at", options.since);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listInsightVerdicts:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapInsightVerdict(row as Record<string, unknown>),
    );
  }

  async insertClaimEvidence(
    input: InsertClaimEvidenceInput,
  ): Promise<ClaimEvidenceRow> {
    const ownerId = this.defaultOwnerId();
    const payload = {
      owner_id: ownerId,
      claim_id: input.claimId,
      claim_kind: input.claimKind,
      observation_id: input.observationId ?? null,
      evidence: input.evidence,
      polarity: input.polarity,
    };
    const { data, error } = await this.client
      .from("claim_evidence")
      .insert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] insertClaimEvidence:", error.message);
      return {
        id: "noop",
        ownerId,
        claimId: input.claimId,
        claimKind: input.claimKind,
        observationId: input.observationId ?? null,
        evidence: input.evidence,
        polarity: input.polarity,
        createdAt: new Date().toISOString(),
      };
    }
    return mapClaimEvidence(data as Record<string, unknown>);
  }

  async listClaimEvidence(options: {
    claimId?: string;
    claimKind?: string;
    limit?: number;
  } = {}): Promise<ClaimEvidenceRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("claim_evidence")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.claimId) q = q.eq("claim_id", options.claimId);
    if (options.claimKind) q = q.eq("claim_kind", options.claimKind);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listClaimEvidence:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapClaimEvidence(row as Record<string, unknown>),
    );
  }

  async upsertDecision(input: UpsertDecisionInput): Promise<DecisionRow> {
    const now = new Date().toISOString();
    const ownerId = this.defaultOwnerId();
    const payload: Record<string, unknown> = {
      owner_id: ownerId,
      title: input.title,
      statement: input.statement ?? "",
      decided_at: input.decidedAt ?? now,
      expected_outcome: input.expectedOutcome ?? null,
      related_hypothesis_ids: input.relatedHypothesisIds ?? [],
      related_entity_keys: input.relatedEntityKeys ?? [],
      source: input.source ?? "user",
      distillate_id: input.distillateId ?? null,
      metadata: input.metadata ?? {},
    };
    if (input.id) payload.id = input.id;
    const { data, error } = await this.client
      .from("decisions")
      .upsert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] upsertDecision:", error.message);
      return {
        id: input.id ?? "noop",
        ownerId,
        title: input.title,
        statement: input.statement ?? "",
        decidedAt: input.decidedAt ?? now,
        expectedOutcome: input.expectedOutcome ?? null,
        relatedHypothesisIds: input.relatedHypothesisIds ?? [],
        relatedEntityKeys: input.relatedEntityKeys ?? [],
        source: input.source ?? "user",
        distillateId: input.distillateId ?? null,
        metadata: { ...(input.metadata ?? {}), writeError: error.message },
        createdAt: now,
      };
    }
    return mapDecision(data as Record<string, unknown>);
  }

  async listDecisionsTable(
    options: ListDecisionsOptions = {},
  ): Promise<DecisionRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("decisions")
      .select("*")
      .order("decided_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.since) q = q.gte("decided_at", options.since);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listDecisionsTable:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapDecision(row as Record<string, unknown>),
    );
  }

  async insertDecisionOutcome(
    input: InsertDecisionOutcomeInput,
  ): Promise<DecisionOutcomeRow> {
    const ownerId = this.defaultOwnerId();
    const payload = {
      owner_id: ownerId,
      decision_id: input.decisionId,
      recorded_at: input.recordedAt ?? new Date().toISOString(),
      actual_outcome: input.actualOutcome,
      aligned_with_expected: input.alignedWithExpected ?? null,
      evidence: input.evidence ?? [],
      learning: input.learning ?? null,
      metadata: input.metadata ?? {},
    };
    const { data, error } = await this.client
      .from("decision_outcomes")
      .insert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] insertDecisionOutcome:", error.message);
      return {
        id: "noop",
        ownerId,
        decisionId: input.decisionId,
        recordedAt: input.recordedAt ?? new Date().toISOString(),
        actualOutcome: input.actualOutcome,
        alignedWithExpected: input.alignedWithExpected ?? null,
        evidence: input.evidence ?? [],
        learning: input.learning ?? null,
        metadata: { ...(input.metadata ?? {}), writeError: error.message },
      };
    }
    return mapDecisionOutcome(data as Record<string, unknown>);
  }

  async listDecisionOutcomes(options: {
    decisionId?: string;
    limit?: number;
  } = {}): Promise<DecisionOutcomeRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("decision_outcomes")
      .select("*")
      .order("recorded_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.decisionId) q = q.eq("decision_id", options.decisionId);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listDecisionOutcomes:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapDecisionOutcome(row as Record<string, unknown>),
    );
  }

  async upsertExperiment(
    input: UpsertExperimentInput,
  ): Promise<ExperimentRow> {
    const now = new Date().toISOString();
    const ownerId = this.defaultOwnerId();
    const payload: Record<string, unknown> = {
      owner_id: ownerId,
      hypothesis_id: input.hypothesisId,
      title: input.title,
      protocol: input.protocol,
      status: input.status ?? "proposed",
      proposed_at: input.proposedAt ?? now,
      due_at: input.dueAt ?? null,
      completed_at: input.completedAt ?? null,
      result_summary: input.resultSummary ?? null,
      result_polarity: input.resultPolarity ?? null,
      evidence: input.evidence ?? [],
      metadata: input.metadata ?? {},
    };
    if (input.id) payload.id = input.id;
    const { data, error } = await this.client
      .from("experiments")
      .upsert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] upsertExperiment:", error.message);
      return {
        id: input.id ?? "noop",
        ownerId,
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
        metadata: { ...(input.metadata ?? {}), writeError: error.message },
      };
    }
    return mapExperiment(data as Record<string, unknown>);
  }

  async listExperiments(
    options: ListExperimentsOptions = {},
  ): Promise<ExperimentRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("experiments")
      .select("*")
      .order("proposed_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.status) q = q.eq("status", options.status);
    if (options.hypothesisId) q = q.eq("hypothesis_id", options.hypothesisId);
    if (options.dueBefore) q = q.lte("due_at", options.dueBefore);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listExperiments:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapExperiment(row as Record<string, unknown>),
    );
  }

  async upsertPredictionEvent(
    input: UpsertPredictionEventInput,
  ): Promise<PredictionEventRow> {
    const now = new Date().toISOString();
    const ownerId = this.defaultOwnerId();
    const payload: Record<string, unknown> = {
      owner_id: ownerId,
      claim_id: input.claimId,
      claim_kind: input.claimKind ?? "hypothesis",
      domain: input.domain ?? null,
      predicted: input.predicted,
      actual: input.actual ?? null,
      correct: input.correct ?? null,
      resolved_at: input.resolvedAt ?? null,
    };
    if (input.id) payload.id = input.id;
    const { data, error } = await this.client
      .from("prediction_events")
      .upsert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] upsertPredictionEvent:", error.message);
      return {
        id: input.id ?? "noop",
        ownerId,
        claimId: input.claimId,
        claimKind: input.claimKind ?? "hypothesis",
        domain: input.domain ?? null,
        predicted: input.predicted,
        actual: input.actual ?? null,
        correct: input.correct ?? null,
        createdAt: now,
        resolvedAt: input.resolvedAt ?? null,
      };
    }
    return mapPredictionEvent(data as Record<string, unknown>);
  }

  async listPredictionEvents(
    options: ListPredictionEventsOptions = {},
  ): Promise<PredictionEventRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 50, 200));
    let q = this.client
      .from("prediction_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.claimId) q = q.eq("claim_id", options.claimId);
    if (options.since) q = q.gte("created_at", options.since);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listPredictionEvents:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapPredictionEvent(row as Record<string, unknown>),
    );
  }

  async insertSelfModelDiff(
    input: InsertSelfModelDiffInput,
  ): Promise<SelfModelDiffRow> {
    const ownerId = this.defaultOwnerId();
    const payload = {
      owner_id: ownerId,
      from_version_id: input.fromVersionId ?? null,
      to_version_id: input.toVersionId,
      stable: input.stable ?? [],
      emerging: input.emerging ?? [],
      fading: input.fading ?? [],
      environment_shifts: input.environmentShifts ?? [],
      confirmed_predictions: input.confirmedPredictions ?? [],
      disproved_predictions: input.disprovedPredictions ?? [],
      event_anchors: input.eventAnchors ?? [],
    };
    const { data, error } = await this.client
      .from("self_model_diffs")
      .insert(payload)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.warn("[store/supabase] insertSelfModelDiff:", error.message);
      return {
        id: "noop",
        ownerId,
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
    }
    return mapSelfModelDiff(data as Record<string, unknown>);
  }

  async listSelfModelDiffs(
    options: ListSelfModelDiffsOptions = {},
  ): Promise<SelfModelDiffRow[]> {
    const capped = Math.max(1, Math.min(options.limit ?? 20, 100));
    let q = this.client
      .from("self_model_diffs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(capped);
    q = this.applyOwner(q);
    if (options.toVersionId) q = q.eq("to_version_id", options.toVersionId);
    const { data, error } = await q;
    if (error) {
      console.warn("[store/supabase] listSelfModelDiffs:", error.message);
      return [];
    }
    return (data ?? []).map((row) =>
      mapSelfModelDiff(row as Record<string, unknown>),
    );
  }
}
