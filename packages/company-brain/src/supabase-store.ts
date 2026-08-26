import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  CurrentStatePointer,
  Observation,
  Proposal,
  SourceEvent,
  StateRevision,
} from "./types.js";
import type {
  ApplyHardFactInput,
  CompanyBrainStore,
  DecideProposalInput,
  IngestMappedEventInput,
  IngestMappedEventResult,
} from "./store.js";

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return String(value ?? "");
}

function nullableStr(value: unknown): string | null {
  return value == null ? null : String(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function eventFrom(row: Row): SourceEvent {
  return {
    id: str(row.id),
    source: str(row.source) as SourceEvent["source"],
    externalEventId: str(row.external_event_id),
    entityKey: str(row.entity_key),
    versionKey: str(row.version_key),
    actorId: nullableStr(row.actor_id),
    sourceActionAt: str(row.source_action_at),
    capturedAt: str(row.captured_at),
    payload: object(row.payload),
    scopeDecision: str(row.scope_decision) as SourceEvent["scopeDecision"],
    rejectReason: nullableStr(row.reject_reason) ?? undefined,
    provenance: object(row.provenance),
    latestForEntity: row.latest_for_entity === true,
  };
}

function observationFrom(row: Row): Observation {
  return {
    id: str(row.id),
    statement: str(row.statement),
    epistemicClass: str(row.epistemic_class) as Observation["epistemicClass"],
    eventId: str(row.event_id),
    evidenceIds: stringArray(row.evidence_ids),
    topicKeys: stringArray(row.topic_keys),
    actorId: nullableStr(row.actor_id),
    createdAt: str(row.created_at),
  };
}

function proposalFrom(row: Row): Proposal {
  return {
    id: str(row.id),
    status: str(row.status) as Proposal["status"],
    stateKey: str(row.state_key),
    statement: str(row.statement),
    epistemicClass: str(row.epistemic_class) as Proposal["epistemicClass"],
    confidence: Number(row.confidence ?? 0.5),
    proposerId: str(row.proposer_id),
    idempotencyKey: str(row.idempotency_key),
    evidenceIds: stringArray(row.evidence_ids),
    payload: object(row.payload),
    createdAt: str(row.created_at),
  };
}

function revisionFrom(row: Row): StateRevision {
  return {
    id: str(row.id),
    stateKey: str(row.state_key),
    statement: str(row.statement),
    epistemicClass: str(row.epistemic_class) as StateRevision["epistemicClass"],
    confidence: Number(row.confidence ?? 0.5),
    effectiveAt: str(row.effective_at),
    supersedesId: nullableStr(row.supersedes_id),
    evidenceIds: stringArray(row.evidence_ids),
    proposalId: nullableStr(row.proposal_id),
    verdictId: nullableStr(row.verdict_id),
    createdAt: str(row.created_at),
  };
}

function throwIf(error: { message: string } | null, label: string): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export class SupabaseCompanyBrainStore implements CompanyBrainStore {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async recordEvent(
    event: Omit<SourceEvent, "id" | "latestForEntity"> & { id?: string },
  ): Promise<{ event: SourceEvent; duplicate: boolean; stale: boolean }> {
    const { data, error } = await this.client.rpc("cb_record_source_event", {
      p_id: event.id ?? null,
      p_source: event.source,
      p_external_event_id: event.externalEventId,
      p_entity_key: event.entityKey,
      p_version_key: event.versionKey,
      p_actor_id: event.actorId,
      p_source_action_at: event.sourceActionAt,
      p_captured_at: event.capturedAt,
      p_payload: event.payload,
      p_scope_decision: event.scopeDecision,
      p_reject_reason: event.rejectReason ?? null,
      p_provenance: event.provenance,
    });
    throwIf(error, "record source event");
    const result = object(data);
    return {
      event: eventFrom(object(result.event)),
      duplicate: result.duplicate === true,
      stale: result.stale === true,
    };
  }

  async ingestMappedEventAtomic(
    input: IngestMappedEventInput,
  ): Promise<IngestMappedEventResult> {
    const { data, error } = await this.client.rpc("cb_ingest_mapped_event", {
      p_id: input.event.id ?? null,
      p_source: input.event.source,
      p_external_event_id: input.event.externalEventId,
      p_entity_key: input.event.entityKey,
      p_version_key: input.event.versionKey,
      p_actor_id: input.event.actorId,
      p_source_action_at: input.event.sourceActionAt,
      p_captured_at: input.event.capturedAt,
      p_payload: input.event.payload,
      p_scope_decision: input.event.scopeDecision,
      p_reject_reason: input.event.rejectReason ?? null,
      p_provenance: input.event.provenance,
      p_statement: input.statement,
      p_epistemic_class: input.epistemicClass,
      p_state_key: input.stateKey,
      p_auto_apply: input.autoApply,
      p_proposal_idempotency_key: input.proposal?.idempotencyKey ?? null,
      p_proposal_statement: input.proposal?.statement ?? null,
      p_proposal_confidence: input.proposal?.confidence ?? null,
      p_proposal_payload: input.proposal?.payload ?? null,
    });
    throwIf(error, "ingest mapped event");
    const result = object(data);
    return {
      event: eventFrom(object(result.event)),
      duplicate: result.duplicate === true,
      stale: result.stale === true,
      ...(result.observation
        ? { observation: observationFrom(object(result.observation)) }
        : {}),
      ...(result.proposal
        ? { proposal: proposalFrom(object(result.proposal)) }
        : {}),
      ...(result.applied_revision
        ? {
            appliedRevision: revisionFrom(object(result.applied_revision)),
          }
        : {}),
    };
  }

  async getEvent(id: string): Promise<SourceEvent | undefined> {
    const { data, error } = await this.client
      .from("cb_source_events")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "get source event");
    return data ? eventFrom(data as Row) : undefined;
  }

  async findEventByExternalId(
    source: string,
    externalEventId: string,
  ): Promise<SourceEvent | undefined> {
    const { data, error } = await this.client
      .from("cb_source_events")
      .select("*")
      .eq("source", source)
      .eq("external_event_id", externalEventId)
      .maybeSingle();
    throwIf(error, "find source event");
    return data ? eventFrom(data as Row) : undefined;
  }

  async latestEventForEntity(entityKey: string): Promise<SourceEvent | undefined> {
    const { data, error } = await this.client
      .from("cb_source_events")
      .select("*")
      .eq("entity_key", entityKey)
      .eq("latest_for_entity", true)
      .maybeSingle();
    throwIf(error, "get latest source event");
    return data ? eventFrom(data as Row) : undefined;
  }

  async listEvents(): Promise<SourceEvent[]> {
    const { data, error } = await this.client
      .from("cb_source_events")
      .select("*")
      .order("source_action_at", { ascending: false });
    throwIf(error, "list source events");
    return (data ?? []).map((row) => eventFrom(row as Row));
  }

  async insertObservation(
    row: Omit<Observation, "id"> & { id?: string },
  ): Promise<Observation> {
    const { data, error } = await this.client
      .from("cb_observations")
      .insert({
        ...(row.id ? { id: row.id } : {}),
        statement: row.statement,
        epistemic_class: row.epistemicClass,
        event_id: row.eventId,
        evidence_ids: row.evidenceIds,
        topic_keys: row.topicKeys,
        actor_id: row.actorId,
        created_at: row.createdAt,
      })
      .select("*")
      .single();
    if (error) {
      const { data: existing, error: findError } = await this.client
        .from("cb_observations")
        .select("*")
        .eq("event_id", row.eventId)
        .maybeSingle();
      throwIf(findError, "find observation after insert race");
      if (existing) return observationFrom(existing as Row);
      throw new Error(`insert observation: ${error.message}`);
    }
    return observationFrom(data as Row);
  }

  async listObservations(): Promise<Observation[]> {
    const { data, error } = await this.client
      .from("cb_observations")
      .select("*")
      .order("created_at", { ascending: false });
    throwIf(error, "list observations");
    return (data ?? []).map((row) => observationFrom(row as Row));
  }

  async insertProposal(
    row: Omit<Proposal, "id"> & { id?: string },
  ): Promise<Proposal> {
    const existing = await this.findProposalByIdempotency(
      row.proposerId,
      row.idempotencyKey,
    );
    if (existing) return existing;
    const { data, error } = await this.client
      .from("cb_proposals")
      .insert({
        ...(row.id ? { id: row.id } : {}),
        status: row.status,
        state_key: row.stateKey,
        statement: row.statement,
        epistemic_class: row.epistemicClass,
        confidence: row.confidence,
        proposer_id: row.proposerId,
        idempotency_key: row.idempotencyKey,
        evidence_ids: row.evidenceIds,
        payload: row.payload,
        created_at: row.createdAt,
      })
      .select("*")
      .single();
    if (error) {
      const raced = await this.findProposalByIdempotency(
        row.proposerId,
        row.idempotencyKey,
      );
      if (raced) return raced;
      throw new Error(`insert proposal: ${error.message}`);
    }
    return proposalFrom(data as Row);
  }

  async getProposal(id: string): Promise<Proposal | undefined> {
    const { data, error } = await this.client
      .from("cb_proposals")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "get proposal");
    return data ? proposalFrom(data as Row) : undefined;
  }

  async findProposalByIdempotency(
    proposerId: string,
    idempotencyKey: string,
  ): Promise<Proposal | undefined> {
    const { data, error } = await this.client
      .from("cb_proposals")
      .select("*")
      .eq("proposer_id", proposerId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    throwIf(error, "find proposal idempotency key");
    return data ? proposalFrom(data as Row) : undefined;
  }

  async updateProposal(id: string, patch: Partial<Proposal>): Promise<Proposal> {
    const update: Row = {};
    if (patch.status) update.status = patch.status;
    if (patch.statement) update.statement = patch.statement;
    const { data, error } = await this.client
      .from("cb_proposals")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    throwIf(error, "update proposal");
    return proposalFrom(data as Row);
  }

  async listProposals(): Promise<Proposal[]> {
    const { data, error } = await this.client
      .from("cb_proposals")
      .select("*")
      .order("created_at", { ascending: false });
    throwIf(error, "list proposals");
    return (data ?? []).map((row) => proposalFrom(row as Row));
  }

  async decideProposalAtomic(
    input: DecideProposalInput,
  ): Promise<{ proposal: Proposal; revision?: StateRevision }> {
    const { data, error } = await this.client.rpc("cb_decide_proposal", {
      p_proposal_id: input.proposalId,
      p_approver_id: input.approverId,
      p_action: input.action,
      p_note: input.note,
      p_refinement_statement: input.refinementStatement,
      p_decided_at: input.decidedAt,
    });
    throwIf(error, "decide proposal");
    const result = object(data);
    const proposal = proposalFrom(object(result.proposal));
    const revisionRow = result.revision ? object(result.revision) : null;
    return {
      proposal,
      ...(revisionRow ? { revision: revisionFrom(revisionRow) } : {}),
    };
  }

  async applyHardFactAtomic(input: ApplyHardFactInput): Promise<StateRevision> {
    const { data, error } = await this.client.rpc("cb_apply_hard_fact", {
      p_state_key: input.stateKey,
      p_statement: input.statement,
      p_evidence_ids: input.evidenceIds,
      p_effective_at: input.effectiveAt,
      p_created_at: input.createdAt,
    });
    throwIf(error, "apply hard fact");
    return revisionFrom(object(data));
  }

  async listRevisions(): Promise<StateRevision[]> {
    const { data, error } = await this.client
      .from("cb_state_revisions")
      .select("*")
      .order("created_at", { ascending: false });
    throwIf(error, "list revisions");
    return (data ?? []).map((row) => revisionFrom(row as Row));
  }

  async getRevision(id: string): Promise<StateRevision | undefined> {
    const { data, error } = await this.client
      .from("cb_state_revisions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "get revision");
    return data ? revisionFrom(data as Row) : undefined;
  }

  async getCurrent(stateKey: string): Promise<CurrentStatePointer | undefined> {
    const { data, error } = await this.client
      .from("cb_current_state")
      .select("*")
      .eq("state_key", stateKey)
      .maybeSingle();
    throwIf(error, "get current state");
    return data
      ? { stateKey: str(data.state_key), revisionId: str(data.revision_id) }
      : undefined;
  }

  async listCurrent(): Promise<CurrentStatePointer[]> {
    const { data, error } = await this.client
      .from("cb_current_state")
      .select("*");
    throwIf(error, "list current state");
    return (data ?? []).map((row) => ({
      stateKey: str(row.state_key),
      revisionId: str(row.revision_id),
    }));
  }

  async countEvents(): Promise<number> {
    const { count, error } = await this.client
      .from("cb_source_events")
      .select("id", { count: "exact", head: true });
    throwIf(error, "count Company Brain events");
    return count ?? 0;
  }
}
