import type { CompanyBrainConfig } from "./env.js";
import { mapGithubWebhook } from "./github.js";
import type { CompanyBrainStore } from "./store.js";
import type {
  Actor,
  Citation,
  CompanyContext,
  IngestResult,
  Observation,
  Proposal,
  SourceEvent,
  StateRevision,
} from "./types.js";

export class CompanyBrainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CompanyBrainError";
  }
}

function excerptFromPayload(payload: Record<string, unknown>): string {
  const statement = payload.statement;
  if (typeof statement === "string" && statement) return statement.slice(0, 280);
  const title = payload.title;
  if (typeof title === "string" && title) return title.slice(0, 280);
  const kind = payload.kind;
  if (typeof kind === "string") return kind;
  return "source event";
}

export class CompanyBrain {
  constructor(
    readonly config: CompanyBrainConfig,
    readonly store: CompanyBrainStore,
  ) {}

  async ingestGithubWebhook(input: {
    eventName: string;
    deliveryId: string | undefined;
    rawBody: string;
    signatureHeader: string | undefined;
    payload: unknown;
  }): Promise<IngestResult> {
    const mapped = mapGithubWebhook({ config: this.config, ...input });
    if (!mapped.ok) {
      return { accepted: false, code: mapped.code, detail: mapped.detail };
    }
    return this.commitMappedGithub(mapped.mapped, {
      deliveryId: input.deliveryId ?? mapped.mapped.externalEventId,
      eventName: input.eventName,
    });
  }

  private async commitMappedGithub(
    mapped: {
      externalEventId: string;
      entityKey: string;
      versionKey: string;
      repoFullName: string;
      sourceActionAt: string;
      payload: Record<string, unknown>;
      classification: "hard_fact" | "observation";
      statement: string;
      stateKey: string;
      epistemicClass: "fact" | "observation";
      autoApply: boolean;
    },
    provenance: { deliveryId: string; eventName: string },
  ): Promise<IngestResult> {
    const capturedAt = new Date().toISOString();
    const result = await this.store.ingestMappedEventAtomic({
      event: {
        source: "github",
        externalEventId: mapped.externalEventId,
        entityKey: mapped.entityKey,
        versionKey: mapped.versionKey,
        actorId: "ingest",
        sourceActionAt: mapped.sourceActionAt,
        capturedAt,
        payload: mapped.payload,
        scopeDecision: "accepted",
        provenance: { ...provenance, repo: mapped.repoFullName },
      },
      statement: mapped.statement,
      epistemicClass: mapped.epistemicClass,
      stateKey: mapped.stateKey,
      autoApply: mapped.autoApply,
      proposal:
        mapped.classification === "observation"
          ? {
              idempotencyKey: `github:${mapped.externalEventId}:state`,
              statement: mapped.statement,
              confidence: 0.4,
              payload: {
                kind: "github_working_on",
                repo: mapped.repoFullName,
              },
            }
          : null,
    });
    return {
      accepted: true,
      duplicate: result.duplicate,
      stale: result.stale,
      event: result.event,
      observation: result.observation,
      proposal: result.proposal,
      appliedRevision: result.appliedRevision,
    };
  }

  async proposeStateChange(input: {
    actor: Actor;
    requestId: string;
    stateKey: string;
    statement: string;
    evidenceIds: string[];
    confidence?: number;
  }): Promise<Proposal> {
    if (input.actor.kind === "ingest") {
      throw new CompanyBrainError(
        "forbidden",
        "ingest identities cannot propose interpretations",
      );
    }
    await this.assertEvidence(input.evidenceIds, true);
    const existing = await this.store.findProposalByIdempotency(
      input.actor.id,
      input.requestId,
    );
    if (existing) return existing;
    return this.store.insertProposal({
      status: "pending",
      stateKey: input.stateKey,
      statement: input.statement,
      epistemicClass: "interpretation",
      confidence: input.confidence ?? 0.5,
      proposerId: input.actor.id,
      idempotencyKey: input.requestId,
      evidenceIds: input.evidenceIds,
      payload: { kind: "state_change" },
      createdAt: new Date().toISOString(),
    });
  }

  async proposeObservation(input: {
    actor: Actor;
    requestId: string;
    statement: string;
    evidenceIds: string[];
    topicKeys: string[];
  }): Promise<Observation> {
    if (input.actor.kind === "ingest") {
      throw new CompanyBrainError(
        "forbidden",
        "ingest identities cannot write MCP observations",
      );
    }
    await this.assertEvidence(input.evidenceIds, false);
    const externalEventId = `mcp-obs:${input.actor.id}:${input.requestId}`;
    const existingEvent = await this.store.findEventByExternalId(
      "mcp",
      externalEventId,
    );
    if (existingEvent) {
      const observations = await this.store.listObservations();
      const existingObservation = observations.find(
        (row) => row.eventId === existingEvent.id,
      );
      if (existingObservation) return existingObservation;
    }

    const now = new Date().toISOString();
    const recorded = await this.store.recordEvent({
      source: "mcp",
      externalEventId,
      entityKey: `mcp:${input.actor.id}:${input.requestId}`,
      versionKey: input.requestId,
      actorId: input.actor.id,
      sourceActionAt: now,
      capturedAt: now,
      payload: {
        kind: "mcp_observation",
        statement: input.statement,
        evidenceIds: input.evidenceIds,
      },
      scopeDecision: "accepted",
      provenance: {
        actorId: input.actor.id,
        requestId: input.requestId,
      },
    });
    const event = recorded.event;
    return this.store.insertObservation({
      statement: input.statement,
      epistemicClass: "observation",
      eventId: event.id,
      evidenceIds: input.evidenceIds,
      topicKeys: input.topicKeys,
      actorId: input.actor.id,
      createdAt: now,
    });
  }

  async proposeDecision(input: {
    actor: Actor;
    requestId: string;
    stateKey: string;
    statement: string;
    evidenceIds: string[];
  }): Promise<Proposal> {
    return this.proposeStateChange(input);
  }

  async decideProposal(input: {
    actor: Actor;
    proposalId: string;
    action: "approve" | "reject" | "refine";
    note?: string;
    refinementStatement?: string;
  }): Promise<{ proposal: Proposal; revision?: StateRevision }> {
    if (input.actor.kind !== "founder") {
      throw new CompanyBrainError(
        "forbidden",
        "only authenticated founders may approve, reject, or refine",
      );
    }
    const proposal = await this.store.getProposal(input.proposalId);
    if (!proposal) {
      throw new CompanyBrainError("not_found", "proposal not found");
    }
    if (proposal.status !== "pending") {
      throw new CompanyBrainError(
        "stale_proposal",
        `proposal is ${proposal.status}`,
      );
    }
    if (input.action !== "reject") {
      await this.assertEvidence(proposal.evidenceIds, true);
    }
    const refinement =
      input.action === "refine" ? input.refinementStatement?.trim() : null;
    if (input.action === "refine" && !refinement) {
      throw new CompanyBrainError(
        "invalid",
        "refine requires refinementStatement",
      );
    }
    try {
      return await this.store.decideProposalAtomic({
        proposalId: proposal.id,
        action: input.action,
        approverId: input.actor.id,
        note: input.note ?? null,
        refinementStatement: refinement ?? null,
        decidedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("stale_proposal")) {
        throw new CompanyBrainError("stale_proposal", message);
      }
      if (message.includes("proposal_not_found")) {
        throw new CompanyBrainError("not_found", "proposal not found");
      }
      throw error;
    }
  }

  async currentState(): Promise<
    Array<StateRevision & { citations: Citation[] }>
  > {
    const pointers = await this.store.listCurrent();
    const out: Array<StateRevision & { citations: Citation[] }> = [];
    for (const pointer of pointers) {
      const revision = await this.store.getRevision(pointer.revisionId);
      if (!revision) continue;
      out.push({
        ...revision,
        citations: await this.citationsFor(revision.evidenceIds),
      });
    }
    return out;
  }

  async changes(): Promise<
    Array<{ at: string; statement: string; stateKey: string; kind: string }>
  > {
    const [storedRevisions, storedEvents] = await Promise.all([
      this.store.listRevisions(),
      this.store.listEvents(),
    ]);
    const revisions = storedRevisions.map((row) => ({
      at: row.createdAt,
      statement: row.statement,
      stateKey: row.stateKey,
      kind: "revision",
    }));
    const events = storedEvents.map((row) => ({
      at: row.sourceActionAt,
      statement: excerptFromPayload(row.payload),
      stateKey: row.entityKey,
      kind: "event",
    }));
    return [...revisions, ...events].sort((a, b) =>
      a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
    );
  }

  async evidence(eventId: string): Promise<Citation> {
    const event = await this.store.getEvent(eventId);
    if (!event) throw new CompanyBrainError("not_found", "evidence not found");
    return this.citationForEvent(event);
  }

  async context(): Promise<CompanyContext> {
    const [currentState, allProposals] = await Promise.all([
      this.currentState(),
      this.store.listProposals(),
    ]);
    const pendingProposals = allProposals.filter(
      (row) => row.status === "pending",
    );
    const keys = new Set([
      ...currentState.map((row) => row.stateKey),
      ...pendingProposals.map((row) => row.stateKey),
    ]);
    const contradictions = [...keys].flatMap((stateKey) => {
      const current = currentState.find((row) => row.stateKey === stateKey);
      const pending = pendingProposals
        .filter((row) => row.stateKey === stateKey)
        .map((row) => row.statement);
      const distinct = new Set([
        ...(current ? [current.statement] : []),
        ...pending,
      ]);
      if (distinct.size < 2) return [];
      return [{ stateKey, current: current?.statement, pending }];
    });
    return { currentState, pendingProposals, contradictions };
  }

  async decisions(): Promise<StateRevision[]> {
    const revisions = await this.store.listRevisions();
    return revisions
      .filter((row) => row.proposalId != null)
      .sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      );
  }

  private async assertEvidence(
    ids: string[],
    required: boolean,
  ): Promise<void> {
    if (required && ids.length === 0) {
      throw new CompanyBrainError(
        "evidence_required",
        "interpretive proposals require at least one evidence id",
      );
    }
    const observations = await this.store.listObservations();
    for (const id of ids) {
      if (
        !(await this.store.getEvent(id)) &&
        !observations.some((row) => row.id === id)
      ) {
        throw new CompanyBrainError(
          "invalid_evidence",
          `unknown evidence id ${id}`,
        );
      }
    }
  }

  private async citationsFor(ids: string[]): Promise<Citation[]> {
    const observations = await this.store.listObservations();
    const citations = new Map<string, Citation>();
    const visit = async (id: string, visited: Set<string>): Promise<void> => {
      if (visited.has(id)) return;
      visited.add(id);
      const event = await this.store.getEvent(id);
      if (event) {
        const citation = this.citationForEvent(event);
        citations.set(`${citation.eventId}:`, citation);
      }
      const observation = observations.find((row) => row.id === id);
      if (!observation) return;
      const observedEvent = await this.store.getEvent(observation.eventId);
      if (observedEvent) {
        const citation: Citation = {
          ...this.citationForEvent(observedEvent),
          observationId: observation.id,
          excerpt: observation.statement.slice(0, 280),
        };
        citations.set(`${citation.eventId}:${observation.id}`, citation);
      }
      for (const parentId of observation.evidenceIds) {
        await visit(parentId, visited);
      }
    };
    const visited = new Set<string>();
    for (const id of ids) await visit(id, visited);
    return [...citations.values()];
  }

  private citationForEvent(event: SourceEvent): Citation {
    return {
      eventId: event.id,
      source: event.source,
      entityKey: event.entityKey,
      sourceActionAt: event.sourceActionAt,
      excerpt: excerptFromPayload(event.payload),
    };
  }
}
