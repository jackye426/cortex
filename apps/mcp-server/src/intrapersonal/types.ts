/**
 * Shared contracts for intrapersonal intelligence (I0+).
 * See docs/intrapersonal-roadmap.md.
 */

export type EpistemicType =
  | "observation"
  | "self_report"
  | "interpretation"
  | "hypothesis"
  | "outcome";

export type EvidenceSupportKind =
  | "direct_observation"
  | "self_report"
  | "assistant_derived"
  | "external_feedback"
  | "inferred_proxy";

export type SourceFamily =
  | "ai_sessions"
  | "calendar"
  | "email"
  | "github"
  | "drive"
  | "media_youtube"
  | "media_spotify"
  | "browser"
  | "reading"
  | "decisions"
  | "reflections"
  | "people_feedback"
  | "other";

export type HypothesisState =
  | "emerging"
  | "supported"
  | "disputed"
  | "retired";

export type InterestClass =
  | "terminal"
  | "instrumental"
  | "aspirational"
  | "situational"
  | "dormant";

/** Max confidence when support is only assistant-derived / circular. */
export const ASSISTANT_ONLY_CONFIDENCE_CAP = 0.4;

/** High-confidence insights need this many independent source families. */
export const HIGH_CONFIDENCE_MIN_FAMILIES = 3;

/** Confidence at/above this threshold is treated as high-confidence. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

export interface EvidenceRef {
  sourceFamily: SourceFamily;
  evidenceType: EpistemicType;
  supportKind: EvidenceSupportKind;
  distillateId?: string;
  recordId?: string;
  entityId?: string;
  observedAt?: string;
  independenceGroup: string;
  excerpt?: string;
  weight: number;
}

export interface ObservationRow {
  id: string;
  ownerId?: string;
  epistemicType: "observation" | "self_report";
  statement: string;
  sourceFamily: SourceFamily;
  independenceGroup: string;
  occurredAt: string | null;
  capturedAt: string;
  recordId: string | null;
  distillateId: string | null;
  sessionId: string | null;
  supportKind: EvidenceSupportKind;
  confidence: number;
  metadata: Record<string, unknown>;
  contentHash: string;
}

export interface UpsertObservationInput {
  epistemicType: "observation" | "self_report";
  statement: string;
  sourceFamily: SourceFamily;
  independenceGroup: string;
  occurredAt?: string | null;
  recordId?: string | null;
  distillateId?: string | null;
  sessionId?: string | null;
  supportKind?: EvidenceSupportKind;
  confidence?: number;
  metadata?: Record<string, unknown>;
  contentHash: string;
}

export interface ListObservationsOptions {
  limit?: number;
  sourceFamily?: SourceFamily;
  since?: string;
  until?: string;
  distillateId?: string;
}

export interface AnnotatedMemoryHit {
  id: string;
  kind: string;
  title: string;
  snippet: string;
  score: number;
  evidenceStrength: "distillate" | "keyword_only";
  sourceFamily: SourceFamily;
  independenceGroup: string;
  supportKind: EvidenceSupportKind;
  distillateKind?: string;
  recordType?: string;
  subjectType?: string;
  subjectId?: string;
}

export interface ProvenanceClaim {
  text: string;
  /** Back-compat with ask_mirror: fact | observation | hypothesis */
  claimType: "fact" | "observation" | "hypothesis" | EpistemicType;
  confidence: number;
  evidenceRefs: string[];
  provenance?: EvidenceRef[];
  alternativeExplanations?: string[];
  provisional?: boolean;
}

export interface InsightQualityIssue {
  code:
    | "missing_provenance"
    | "circular_evidence"
    | "assistant_only_high_confidence"
    | "insufficient_source_diversity"
    | "missing_contradiction"
    | "untyped_claim";
  message: string;
  claimText?: string;
}

export interface SourceCoverageRow {
  sourceId: string;
  sourceFamily: SourceFamily;
  recordCount7d: number;
  recordCount30d: number;
  distillateCount: number;
  embedCoverage: number;
  lastDistillateAt: string | null;
  drowningRisk: number;
}

export interface SourceCoverageReport {
  generatedAt: string;
  sources: SourceCoverageRow[];
  reflectiveShare: number;
  operationalShare: number;
  aiSessionShareOfRecentDistillates: number;
  notes: string[];
}
