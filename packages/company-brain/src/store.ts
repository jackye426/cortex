import { randomUUID } from "node:crypto";
import type {
  CurrentStatePointer,
  Observation,
  Proposal,
  SourceEvent,
  StateRevision,
  Verdict,
} from "./types.js";

export interface CompanyBrainStore {
  insertEvent(event: Omit<SourceEvent, "id"> & { id?: string }): SourceEvent;
  getEvent(id: string): SourceEvent | undefined;
  findEventByExternalId(
    source: string,
    externalEventId: string,
  ): SourceEvent | undefined;
  latestEventForEntity(entityKey: string): SourceEvent | undefined;
  listEvents(): SourceEvent[];
  insertObservation(row: Omit<Observation, "id"> & { id?: string }): Observation;
  listObservations(): Observation[];
  insertProposal(row: Omit<Proposal, "id"> & { id?: string }): Proposal;
  getProposal(id: string): Proposal | undefined;
  updateProposal(id: string, patch: Partial<Proposal>): Proposal;
  listProposals(): Proposal[];
  insertVerdict(row: Omit<Verdict, "id"> & { id?: string }): Verdict;
  insertRevision(row: Omit<StateRevision, "id"> & { id?: string }): StateRevision;
  listRevisions(): StateRevision[];
  getRevision(id: string): StateRevision | undefined;
  setCurrent(stateKey: string, revisionId: string): CurrentStatePointer;
  getCurrent(stateKey: string): CurrentStatePointer | undefined;
  listCurrent(): CurrentStatePointer[];
  countCortexLikeRows(): number;
}

export class MemoryCompanyBrainStore implements CompanyBrainStore {
  private events = new Map<string, SourceEvent>();
  private observations = new Map<string, Observation>();
  private proposals = new Map<string, Proposal>();
  private verdicts = new Map<string, Verdict>();
  private revisions = new Map<string, StateRevision>();
  private current = new Map<string, CurrentStatePointer>();

  insertEvent(event: Omit<SourceEvent, "id"> & { id?: string }): SourceEvent {
    const row: SourceEvent = { ...event, id: event.id ?? randomUUID() };
    if (row.latestForEntity) {
      for (const existing of this.events.values()) {
        if (existing.entityKey === row.entityKey && existing.latestForEntity) {
          this.events.set(existing.id, { ...existing, latestForEntity: false });
        }
      }
    }
    this.events.set(row.id, row);
    return row;
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
    let latest: SourceEvent | undefined;
    for (const event of this.events.values()) {
      if (event.entityKey !== entityKey) continue;
      if (!latest || event.sourceActionAt > latest.sourceActionAt) latest = event;
    }
    return latest;
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
    const proposal: Proposal = { ...row, id: row.id ?? randomUUID() };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  getProposal(id: string): Proposal | undefined {
    return this.proposals.get(id);
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

  insertVerdict(row: Omit<Verdict, "id"> & { id?: string }): Verdict {
    const verdict: Verdict = { ...row, id: row.id ?? randomUUID() };
    this.verdicts.set(verdict.id, verdict);
    return verdict;
  }

  insertRevision(
    row: Omit<StateRevision, "id"> & { id?: string },
  ): StateRevision {
    const revision: StateRevision = { ...row, id: row.id ?? randomUUID() };
    this.revisions.set(revision.id, revision);
    return revision;
  }

  listRevisions(): StateRevision[] {
    return [...this.revisions.values()];
  }

  getRevision(id: string): StateRevision | undefined {
    return this.revisions.get(id);
  }

  setCurrent(stateKey: string, revisionId: string): CurrentStatePointer {
    const pointer = { stateKey, revisionId };
    this.current.set(stateKey, pointer);
    return pointer;
  }

  getCurrent(stateKey: string): CurrentStatePointer | undefined {
    return this.current.get(stateKey);
  }

  listCurrent(): CurrentStatePointer[] {
    return [...this.current.values()];
  }

  countCortexLikeRows(): number {
    return 0;
  }
}
