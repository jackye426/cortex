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

  ingestGithubWebhook(input: {
    eventName: string;
    deliveryId: string | undefined;
    rawBody: string;
    signatureHeader: string | undefined;
    payload: unknown;
  }): IngestResult {
    const mapped = mapGithubWebhook({ config: this.config, ...input });
    if (!mapped.ok) {
      return { accepted: false, code: mapped.code, detail: mapped.detail };
    }
    return this.commitMappedGithub(mapped.mapped, {
      deliveryId: input.deliveryId ?? mapped.mapped.externalEventId,
      eventName: input.eventName,
    });
  }

  private commitMappedGithub(
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
  ): IngestResult {
    const existing = this.store.findEventByExternalId(
      "github",
      mapped.externalEventId,
    );
    if (existing) {
      return { accepted: true, duplicate: true, stale: false, event: existing };
    }

    const latest = this.store.latestEventForEntity(mapped.entityKey);
    const stale = Boolean(
      latest && latest.sourceActionAt > mapped.sourceActionAt,
    );

    const event = this.store.insertEvent({
      source: "github",
      externalEventId: mapped.externalEventId,
      entityKey: mapped.entityKey,
      versionKey: mapped.versionKey,
      actorId: "eric",
      sourceActionAt: mapped.sourceActionAt,
      capturedAt: new Date().toISOString(),
      payload: mapped.payload,
      scopeDecision: "accepted",
      provenance: { ...provenance, repo: mapped.repoFullName },
      latestForEntity: !stale,
    });

    if (stale) {
      return { accepted: true, duplicate: false, stale: true, event };
    }

    const observation = this.store.insertObservation({
      statement: mapped.statement,
      epistemicClass: mapped.epistemicClass,
      eventId: event.id,
      topicKeys: [mapped.stateKey],
      actorId: "eric",
      createdAt: new Date().toISOString(),
    });

    if (mapped.autoApply && mapped.epistemicClass === "fact") {
      const appliedRevision = this.applyHardFact(
        mapped.stateKey,
        mapped.statement,
        [event.id, observation.id],
        mapped.sourceActionAt,
      );
      return {
        accepted: true,
        duplicate: false,
        stale: false,
        event,
        observation,
        appliedRevision,
      };
    }

    const proposal =
      mapped.classification === "observation" && mapped.stateKey === "engineering.working_on"
        ? this.store.insertProposal({
            status: "pending",
            stateKey: mapped.stateKey,
            statement: mapped.statement,
            epistemicClass: "interpretation",
            confidence: 0.4,
            proposerId: "ingest",
            evidenceIds: [event.id, observation.id],
            payload: { kind: "github_working_on", repo: mapped.repoFullName },
            createdAt: new Date().toISOString(),
          })
        : undefined;

    return {
      accepted: true,
      duplicate: false,
      stale: false,
      event,
      observation,
      proposal,
    };
  }

  private applyHardFact(
    stateKey: string,
    statement: string,
    evidenceIds: string[],
    effectiveAt: string,
  ): StateRevision {
    const current = this.store.getCurrent(stateKey);
    const previous = current
      ? this.store.getRevision(current.revisionId)
      : undefined;
    const revision = this.store.insertRevision({
      stateKey,
      statement,
      epistemicClass: "fact",
      confidence: 1,
      effectiveAt,
      supersedesId: previous?.id ?? null,
      evidenceIds,
      proposalId: null,
      verdictId: null,
      createdAt: new Date().toISOString(),
    });
    this.store.setCurrent(stateKey, revision.id);
    return revision;
  }

  proposeStateChange(input: {
    actor: Actor;
    stateKey: string;
    statement: string;
    evidenceIds: string[];
    confidence?: number;
  }): Proposal {
    if (input.actor.kind === "ingest") {
      throw new CompanyBrainError(
        "forbidden",
        "ingest identities cannot propose interpretations",
      );
    }
    this.assertEvidence(input.evidenceIds);
    return this.store.insertProposal({
      status: "pending",
      stateKey: input.stateKey,
      statement: input.statement,
      epistemicClass: "interpretation",
      confidence: input.confidence ?? 0.5,
      proposerId: input.actor.id,
      evidenceIds: input.evidenceIds,
      payload: { kind: "state_change" },
      createdAt: new Date().toISOString(),
    });
  }

  proposeObservation(input: {
    actor: Actor;
    statement: string;
    evidenceIds: string[];
    topicKeys: string[];
  }): Observation {
    if (input.actor.kind === "ingest") {
      throw new CompanyBrainError("forbidden", "ingest identities cannot write MCP observations");
    }
    this.assertEvidence(input.evidenceIds);
    const event = this.store.insertEvent({
      source: "mcp",
      externalEventId: `mcp-obs:${input.actor.id}:${Date.now()}`,
      entityKey: `mcp:${input.actor.id}`,
      versionKey: new Date().toISOString(),
      actorId: input.actor.id,
      sourceActionAt: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
      payload: { kind: "mcp_observation", statement: input.statement },
      scopeDecision: "accepted",
      provenance: { actorId: input.actor.id },
      latestForEntity: true,
    });
    return this.store.insertObservation({
      statement: input.statement,
      epistemicClass: "observation",
      eventId: event.id,
      topicKeys: input.topicKeys,
      actorId: input.actor.id,
      createdAt: new Date().toISOString(),
    });
  }

  proposeDecision(input: {
    actor: Actor;
    stateKey: string;
    statement: string;
    evidenceIds: string[];
  }): Proposal {
    return this.proposeStateChange(input);
  }

  decideProposal(input: {
    actor: Actor;
    proposalId: string;
    action: "approve" | "reject" | "refine";
    note?: string;
    refinementStatement?: string;
  }): { proposal: Proposal; revision?: StateRevision } {
    if (input.actor.kind !== "founder") {
      throw new CompanyBrainError(
        "forbidden",
        "only authenticated founders may approve, reject, or refine",
      );
    }
    const proposal = this.store.getProposal(input.proposalId);
    if (!proposal) {
      throw new CompanyBrainError("not_found", "proposal not found");
    }
    if (proposal.status !== "pending") {
      throw new CompanyBrainError(
        "stale_proposal",
        `proposal is ${proposal.status}`,
      );
    }

    const verdict = this.store.insertVerdict({
      proposalId: proposal.id,
      action: input.action,
      approverId: input.actor.id,
      note: input.note ?? null,
      refinementStatement: input.refinementStatement ?? null,
      createdAt: new Date().toISOString(),
    });

    if (input.action === "reject") {
      return {
        proposal: this.store.updateProposal(proposal.id, { status: "rejected" }),
      };
    }

    const statement =
      input.action === "refine"
        ? input.refinementStatement?.trim()
        : proposal.statement;
    if (!statement) {
      throw new CompanyBrainError(
        "invalid",
        "refine requires refinementStatement",
      );
    }

    for (const other of this.store.listProposals()) {
      if (
        other.id !== proposal.id &&
        other.stateKey === proposal.stateKey &&
        other.status === "pending"
      ) {
        this.store.updateProposal(other.id, { status: "superseded" });
      }
    }

    const current = this.store.getCurrent(proposal.stateKey);
    const previous = current
      ? this.store.getRevision(current.revisionId)
      : undefined;
    const revision = this.store.insertRevision({
      stateKey: proposal.stateKey,
      statement,
      epistemicClass: "interpretation",
      confidence: proposal.confidence,
      effectiveAt: new Date().toISOString(),
      supersedesId: previous?.id ?? null,
      evidenceIds: proposal.evidenceIds,
      proposalId: proposal.id,
      verdictId: verdict.id,
      createdAt: new Date().toISOString(),
    });
    this.store.setCurrent(proposal.stateKey, revision.id);
    return {
      proposal: this.store.updateProposal(proposal.id, { status: "approved" }),
      revision,
    };
  }

  currentState(): Array<StateRevision & { citations: Citation[] }> {
    return this.store.listCurrent().flatMap((pointer) => {
      const revision = this.store.getRevision(pointer.revisionId);
      if (!revision) return [];
      return [{ ...revision, citations: this.citationsFor(revision.evidenceIds) }];
    });
  }

  changes(): Array<{ at: string; statement: string; stateKey: string; kind: string }> {
    const revisions = this.store.listRevisions().map((row) => ({
      at: row.createdAt,
      statement: row.statement,
      stateKey: row.stateKey,
      kind: "revision",
    }));
    const events = this.store.listEvents().map((row) => ({
      at: row.sourceActionAt,
      statement: excerptFromPayload(row.payload),
      stateKey: row.entityKey,
      kind: "event",
    }));
    return [...revisions, ...events].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  evidence(actor: Actor, eventId: string): Citation & { raw?: Record<string, unknown> } {
    const event = this.store.getEvent(eventId);
    if (!event) throw new CompanyBrainError("not_found", "evidence not found");
    const citation = this.citationForEvent(event);
    if (actor.kind === "founder") {
      return { ...citation, raw: event.payload };
    }
    return citation;
  }

  context(): CompanyContext {
    const currentState = this.currentState();
    const pendingProposals = this.store
      .listProposals()
      .filter((row) => row.status === "pending");
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
      return [
        {
          stateKey,
          current: current?.statement,
          pending,
        },
      ];
    });
    return { currentState, pendingProposals, contradictions };
  }

  decisions(): StateRevision[] {
    return this.store
      .listRevisions()
      .filter((row) => row.proposalId != null)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  private assertEvidence(ids: string[]): void {
    for (const id of ids) {
      if (!this.store.getEvent(id) && !this.store.listObservations().some((row) => row.id === id)) {
        throw new CompanyBrainError("invalid_evidence", `unknown evidence id ${id}`);
      }
    }
  }

  private citationsFor(ids: string[]): Citation[] {
    const citations: Citation[] = [];
    for (const id of ids) {
      const event = this.store.getEvent(id);
      if (event) citations.push(this.citationForEvent(event));
      const observation = this.store.listObservations().find((row) => row.id === id);
      if (observation) {
        const observedEvent = this.store.getEvent(observation.eventId);
        if (observedEvent) {
          citations.push({
            ...this.citationForEvent(observedEvent),
            observationId: observation.id,
            excerpt: observation.statement.slice(0, 280),
          });
        }
      }
    }
    return citations;
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
