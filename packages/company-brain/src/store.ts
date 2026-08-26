import { randomUUID } from "node:crypto";
import type {
  CurrentStatePointer,
  Observation,
  Proposal,
  SourceEvent,
  StateRevision,
  Verdict,
  VerdictAction,
} from "./types.js";

export type Awaitable<T> = T | Promise<T>;

export interface DecideProposalInput {
  proposalId: string;
  approverId: string;
  action: VerdictAction;
  note: string | null;
  refinementStatement: string | null;
  decidedAt: string;
}

export interface ApplyHardFactInput {
  stateKey: string;
  statement: string;
  evidenceIds: string[];
  effectiveAt: string;
  createdAt: string;
}

export interface CompanyBrainStore {
  recordEvent(
    event: Omit<SourceEvent, "id" | "latestForEntity"> & { id?: string },
  ): Awaitable<{ event: SourceEvent; duplicate: boolean; stale: boolean }>;
  getEvent(id: string): Awaitable<SourceEvent | undefined>;
  findEventByExternalId(
    source: string,
    externalEventId: string,
  ): Awaitable<SourceEvent | undefined>;
  latestEventForEntity(entityKey: string): Awaitable<SourceEvent | undefined>;
  listEvents(): Awaitable<SourceEvent[]>;
  insertObservation(
    row: Omit<Observation, "id"> & { id?: string },
  ): Awaitable<Observation>;
  listObservations(): Awaitable<Observation[]>;
  insertProposal(row: Omit<Proposal, "id"> & { id?: string }): Awaitable<Proposal>;
  getProposal(id: string): Awaitable<Proposal | undefined>;
  findProposalByIdempotency(
    proposerId: string,
    idempotencyKey: string,
  ): Awaitable<Proposal | undefined>;
  updateProposal(id: string, patch: Partial<Proposal>): Awaitable<Proposal>;
  listProposals(): Awaitable<Proposal[]>;
  decideProposalAtomic(
    input: DecideProposalInput,
  ): Awaitable<{ proposal: Proposal; revision?: StateRevision }>;
  applyHardFactAtomic(input: ApplyHardFactInput): Awaitable<StateRevision>;
  listRevisions(): Awaitable<StateRevision[]>;
  getRevision(id: string): Awaitable<StateRevision | undefined>;
  getCurrent(stateKey: string): Awaitable<CurrentStatePointer | undefined>;
  listCurrent(): Awaitable<CurrentStatePointer[]>;
  countEvents(): Awaitable<number>;
}

export class MemoryCompanyBrainStore implements CompanyBrainStore {
  private events = new Map<string, SourceEvent>();
  private observations = new Map<string, Observation>();
  private proposals = new Map<string, Proposal>();
  private verdicts = new Map<string, Verdict>();
  private revisions = new Map<string, StateRevision>();
  private current = new Map<string, CurrentStatePointer>();

  recordEvent(
    event: Omit<SourceEvent, "id" | "latestForEntity"> & { id?: string },
  ): { event: SourceEvent; duplicate: boolean; stale: boolean } {
    const duplicate = this.findEventByExternalId(event.source, event.externalEventId);
    if (duplicate) {
      return { event: duplicate, duplicate: true, stale: false };
    }
    const latest = this.latestEventForEntity(event.entityKey);
    const stale = Boolean(
      latest && latest.sourceActionAt >= event.sourceActionAt,
    );
    const row: SourceEvent = {
      ...event,
      id: event.id ?? randomUUID(),
      latestForEntity: !stale,
    };
    if (!stale) {
      for (const existing of this.events.values()) {
        if (existing.entityKey === row.entityKey && existing.latestForEntity) {
          this.events.set(existing.id, { ...existing, latestForEntity: false });
        }
      }
    }
    this.events.set(row.id, row);
    return { event: row, duplicate: false, stale };
  }

  getEvent(id: string): SourceEvent | undefined {
    return this.events.get(id);
  }

  findEventByExternalId(
    source: string,
    externalEventId: string,
  ): SourceEvent | undefined {
    for (const event of this.events.values()) {
      if (event.source === source && event.externalEventId === externalEventId) {
        return event;
      }
    }
    return undefined;
  }

  latestEventForEntity(entityKey: string): SourceEvent | undefined {
    return [...this.events.values()].find(
      (event) => event.entityKey === entityKey && event.latestForEntity,
    );
  }

  listEvents(): SourceEvent[] {
    return [...this.events.values()];
  }

  insertObservation(
    row: Omit<Observation, "id"> & { id?: string },
  ): Observation {
    const observation: Observation = { ...row, id: row.id ?? randomUUID() };
    this.observations.set(observation.id, observation);
    return observation;
  }

  listObservations(): Observation[] {
    return [...this.observations.values()];
  }

  insertProposal(row: Omit<Proposal, "id"> & { id?: string }): Proposal {
    const existing = this.findProposalByIdempotency(
      row.proposerId,
      row.idempotencyKey,
    );
    if (existing) return existing;
    const proposal: Proposal = { ...row, id: row.id ?? randomUUID() };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  getProposal(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  findProposalByIdempotency(
    proposerId: string,
    idempotencyKey: string,
  ): Proposal | undefined {
    return [...this.proposals.values()].find(
      (row) =>
        row.proposerId === proposerId && row.idempotencyKey === idempotencyKey,
    );
  }

  updateProposal(id: string, patch: Partial<Proposal>): Proposal {
    const current = this.proposals.get(id);
    if (!current) throw new Error(`proposal ${id} not found`);
    const next = { ...current, ...patch, id: current.id };
    this.proposals.set(id, next);
    return next;
  }

  listProposals(): Proposal[] {
    return [...this.proposals.values()];
  }

  decideProposalAtomic(
    input: DecideProposalInput,
  ): { proposal: Proposal; revision?: StateRevision } {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal) throw new Error("proposal_not_found");
    if (proposal.status !== "pending") {
      throw new Error(`stale_proposal:${proposal.status}`);
    }
    if (input.action === "refine" && !input.refinementStatement?.trim()) {
      throw new Error("refinement_required");
    }

    const verdict: Verdict = {
      id: randomUUID(),
      proposalId: proposal.id,
      action: input.action,
      approverId: input.approverId,
      note: input.note,
      refinementStatement: input.refinementStatement,
      createdAt: input.decidedAt,
    };

    if (input.action === "reject") {
      this.verdicts.set(verdict.id, verdict);
      const rejected = { ...proposal, status: "rejected" as const };
      this.proposals.set(proposal.id, rejected);
      return { proposal: rejected };
    }

    const statement =
      input.action === "refine"
        ? input.refinementStatement!.trim()
        : proposal.statement;
    const current = this.current.get(proposal.stateKey);
    const revision: StateRevision = {
      id: randomUUID(),
      stateKey: proposal.stateKey,
      statement,
      epistemicClass: "interpretation",
      confidence: proposal.confidence,
      effectiveAt: input.decidedAt,
      supersedesId: current?.revisionId ?? null,
      evidenceIds: proposal.evidenceIds,
      proposalId: proposal.id,
      verdictId: verdict.id,
      createdAt: input.decidedAt,
    };

    // No failure-prone validation or lookup remains below this point. Apply as
    // one synchronous critical section so callers cannot observe partial state.
    this.verdicts.set(verdict.id, verdict);
    for (const other of this.proposals.values()) {
      if (
        other.id !== proposal.id &&
        other.stateKey === proposal.stateKey &&
        other.status === "pending"
      ) {
        this.proposals.set(other.id, { ...other, status: "superseded" });
      }
    }
    const approved = { ...proposal, status: "approved" as const };
    this.proposals.set(proposal.id, approved);
    this.revisions.set(revision.id, revision);
    this.current.set(proposal.stateKey, {
      stateKey: proposal.stateKey,
      revisionId: revision.id,
    });
    return { proposal: approved, revision };
  }

  applyHardFactAtomic(input: ApplyHardFactInput): StateRevision {
    const current = this.current.get(input.stateKey);
    const revision: StateRevision = {
      id: randomUUID(),
      stateKey: input.stateKey,
      statement: input.statement,
      epistemicClass: "fact",
      confidence: 1,
      effectiveAt: input.effectiveAt,
      supersedesId: current?.revisionId ?? null,
      evidenceIds: input.evidenceIds,
      proposalId: null,
      verdictId: null,
      createdAt: input.createdAt,
    };
    for (const proposal of this.proposals.values()) {
      if (proposal.stateKey === input.stateKey && proposal.status === "pending") {
        this.proposals.set(proposal.id, {
          ...proposal,
          status: "superseded",
        });
      }
    }
    this.revisions.set(revision.id, revision);
    this.current.set(input.stateKey, {
      stateKey: input.stateKey,
      revisionId: revision.id,
    });
    return revision;
  }

  listRevisions(): StateRevision[] {
    return [...this.revisions.values()];
  }

  getRevision(id: string): StateRevision | undefined {
    return this.revisions.get(id);
  }

  getCurrent(stateKey: string): CurrentStatePointer | undefined {
    return this.current.get(stateKey);
  }

  listCurrent(): CurrentStatePointer[] {
    return [...this.current.values()];
  }

  countEvents(): number {
    return this.events.size;
  }
}
