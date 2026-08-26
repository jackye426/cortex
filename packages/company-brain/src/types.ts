export type ActorKind = "founder" | "agent" | "ingest";
export type EpistemicClass = "fact" | "observation" | "interpretation";
export type ProposalStatus = "pending" | "approved" | "rejected" | "superseded";
export type VerdictAction = "approve" | "reject" | "refine";
export type SourceName = "github" | "granola" | "codex" | "gmail" | "mcp";

export interface Actor {
  id: string;
  kind: ActorKind;
  displayName: string;
  founderKey?: "jack" | "eric";
}

export interface SourceEvent {
  id: string;
  source: SourceName;
  externalEventId: string;
  entityKey: string;
  versionKey: string;
  actorId: string | null;
  sourceActionAt: string;
  capturedAt: string;
  payload: Record<string, unknown>;
  scopeDecision: "accepted" | "rejected";
  rejectReason?: string;
  provenance: Record<string, unknown>;
  latestForEntity: boolean;
}

export interface Observation {
  id: string;
  statement: string;
  epistemicClass: EpistemicClass;
  eventId: string;
  evidenceIds: string[];
  topicKeys: string[];
  actorId: string | null;
  createdAt: string;
}

export interface Proposal {
  id: string;
  status: ProposalStatus;
  stateKey: string;
  statement: string;
  epistemicClass: EpistemicClass;
  confidence: number;
  proposerId: string;
  idempotencyKey: string;
  evidenceIds: string[];
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Verdict {
  id: string;
  proposalId: string;
  action: VerdictAction;
  approverId: string;
  note: string | null;
  refinementStatement: string | null;
  createdAt: string;
}

export interface StateRevision {
  id: string;
  stateKey: string;
  statement: string;
  epistemicClass: EpistemicClass;
  confidence: number;
  effectiveAt: string;
  supersedesId: string | null;
  evidenceIds: string[];
  proposalId: string | null;
  verdictId: string | null;
  createdAt: string;
}

export interface CurrentStatePointer {
  stateKey: string;
  revisionId: string;
}

export interface Citation {
  eventId: string;
  observationId?: string;
  source: SourceName;
  entityKey: string;
  sourceActionAt: string;
  excerpt: string;
}

export interface CompanyContext {
  currentState: Array<StateRevision & { citations: Citation[] }>;
  pendingProposals: Proposal[];
  contradictions: Array<{
    stateKey: string;
    current?: string;
    pending: string[];
  }>;
}

export interface IngestAccepted {
  accepted: true;
  duplicate: boolean;
  stale: boolean;
  event: SourceEvent;
  observation?: Observation;
  appliedRevision?: StateRevision;
  proposal?: Proposal;
}

export interface IngestRejected {
  accepted: false;
  code:
    | "unsigned"
    | "bad_signature"
    | "out_of_scope"
    | "pre_cutover"
    | "missing_timestamp"
    | "unsupported";
  detail: string;
}

export type IngestResult = IngestAccepted | IngestRejected;
