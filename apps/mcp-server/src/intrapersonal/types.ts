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

export type InterestStatus = "active" | "dormant" | "retired";

export interface InterestRow {
  id: string;
  ownerId?: string;
  canonicalKey: string;
  displayName: string;
  class: InterestClass;
  status: InterestStatus;
  confidence: number;
  summary: string;
  firstSeenAt: string | null;
  lastActiveAt: string | null;
  recurrenceScore: number;
  specificityScore: number;
  voluntaryReturnScore: number;
  persistenceAfterUtility: number;
  energyDelta: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertInterestInput {
  canonicalKey: string;
  displayName?: string;
  class: InterestClass;
  status?: InterestStatus;
  confidence?: number;
  summary?: string;
  firstSeenAt?: string | null;
  lastActiveAt?: string | null;
  recurrenceScore?: number;
  specificityScore?: number;
  voluntaryReturnScore?: number;
  persistenceAfterUtility?: number;
  energyDelta?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ListInterestsOptions {
  limit?: number;
  class?: InterestClass;
  status?: InterestStatus;
}

export type AffectSignalType = "energy" | "valence" | "friction" | "flow";

export interface AffectSignalRow {
  id: string;
  ownerId?: string;
  signalType: AffectSignalType;
  value: number;
  sourceFamily: SourceFamily;
  observationId: string | null;
  context: Record<string, unknown>;
  occurredAt: string | null;
  captureMode: "inferred" | "self_report";
  createdAt: string;
}

export interface InsertAffectSignalInput {
  signalType: AffectSignalType;
  value: number;
  sourceFamily: SourceFamily;
  observationId?: string | null;
  context?: Record<string, unknown>;
  occurredAt?: string | null;
  captureMode?: "inferred" | "self_report";
}

export interface InterestMapSection {
  class: InterestClass;
  interests: Array<{
    canonicalKey: string;
    displayName: string;
    confidence: number;
    summary: string;
    sourceFamilies: SourceFamily[];
    evidenceCount: number;
  }>;
}

export interface InterestMapPayload {
  weekKey?: string;
  generatedAt: string;
  sections: InterestMapSection[];
  notes: string[];
}

/** Intrapersonal record kinds (self-model atoms). */
export type IntrapersonalRecordKind =
  | "interest_ref"
  | "value"
  | "energy_pattern"
  | "strength"
  | "limitation"
  | "motive"
  | "avoidance_pattern"
  | "emotional_trigger"
  | "relationship_pattern"
  | "identity_aspiration"
  | "decision_tendency"
  | "coping_strategy"
  | "recurring_conflict"
  | "conviction_change"
  | "environment_condition";

export type IntrapersonalRecordStatus = "active" | "disputed" | "retired";

export type HypothesisOrigin =
  | "ask_mirror"
  | "weekly_job"
  | "user"
  | "interest_mine"
  | "cycle_detect"
  | "ability_model";

export interface HypothesisRow {
  id: string;
  ownerId?: string;
  claim: string;
  whyItMatters: string;
  state: HypothesisState;
  confidence: number;
  sourceDiversity: number;
  falsifiers: string[];
  alternativeExplanations: string[];
  domains: string[];
  lastTestedAt: string | null;
  origin: HypothesisOrigin | string;
  assistantWeight: number;
  priorHypothesisId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertHypothesisInput {
  id?: string;
  claim: string;
  whyItMatters?: string;
  state?: HypothesisState;
  confidence?: number;
  sourceDiversity?: number;
  falsifiers?: string[];
  alternativeExplanations?: string[];
  domains?: string[];
  lastTestedAt?: string | null;
  origin?: HypothesisOrigin | string;
  assistantWeight?: number;
  priorHypothesisId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListHypothesesOptions {
  limit?: number;
  state?: HypothesisState;
  domain?: string;
  minConfidence?: number;
  origin?: string;
}

export interface IntrapersonalRecordRow {
  id: string;
  ownerId?: string;
  recordKind: IntrapersonalRecordKind | string;
  title: string;
  statement: string;
  epistemicType: EpistemicType | string;
  confidence: number;
  status: IntrapersonalRecordStatus;
  context: Record<string, unknown>;
  behaviour: Record<string, unknown>;
  outcome: Record<string, unknown>;
  origin: "self_report" | "inference" | string;
  hypothesisId: string | null;
  interestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertIntrapersonalRecordInput {
  id?: string;
  recordKind: IntrapersonalRecordKind | string;
  title: string;
  statement: string;
  epistemicType?: EpistemicType | string;
  confidence?: number;
  status?: IntrapersonalRecordStatus;
  context?: Record<string, unknown>;
  behaviour?: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  origin?: "self_report" | "inference" | string;
  hypothesisId?: string | null;
  interestId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListIntrapersonalRecordsOptions {
  limit?: number;
  recordKind?: string;
  status?: IntrapersonalRecordStatus;
  hypothesisId?: string;
}

export interface SelfModelItem {
  id?: string;
  title: string;
  statement: string;
  confidence: number;
  evidenceIds?: string[];
  hypothesisId?: string | null;
  recordId?: string | null;
  domains?: string[];
  status?: string;
}

export interface SelfModelVersionRow {
  id: string;
  ownerId?: string;
  version: number;
  summary: string;
  compiledFrom: Record<string, unknown>;
  strengths: SelfModelItem[];
  limitations: SelfModelItem[];
  motives: SelfModelItem[];
  tensions: SelfModelItem[];
  identityDevelopment: SelfModelItem[];
  openQuestionIds: string[];
  supersedesId: string | null;
  userCorrections: Array<Record<string, unknown>>;
  createdAt: string;
}

export interface InsertSelfModelVersionInput {
  version: number;
  summary: string;
  compiledFrom?: Record<string, unknown>;
  strengths?: SelfModelItem[];
  limitations?: SelfModelItem[];
  motives?: SelfModelItem[];
  tensions?: SelfModelItem[];
  identityDevelopment?: SelfModelItem[];
  openQuestionIds?: string[];
  supersedesId?: string | null;
  userCorrections?: Array<Record<string, unknown>>;
}

export interface ListSelfModelVersionsOptions {
  limit?: number;
}

export type InsightVerdictKind =
  | "hypothesis"
  | "mirror_item"
  | "interest"
  | "self_model_item";

export type InsightVerdictValue = "confirm" | "reject" | "refine";

export interface InsightVerdictRow {
  id: string;
  ownerId?: string;
  insightId: string;
  insightKind: InsightVerdictKind | string;
  verdict: InsightVerdictValue;
  note: string | null;
  nonObvious: boolean | null;
  useful: boolean | null;
  createdAt: string;
}

export interface InsertInsightVerdictInput {
  insightId: string;
  insightKind: InsightVerdictKind | string;
  verdict: InsightVerdictValue;
  note?: string | null;
  nonObvious?: boolean | null;
  useful?: boolean | null;
}

export interface ListInsightVerdictsOptions {
  limit?: number;
  insightId?: string;
  since?: string;
}

export type DecisionSource = "user" | "mined" | "migrated_distillate";

export interface DecisionRow {
  id: string;
  ownerId?: string;
  title: string;
  statement: string;
  decidedAt: string;
  expectedOutcome: string | null;
  relatedHypothesisIds: string[];
  relatedEntityKeys: string[];
  source: DecisionSource | string;
  distillateId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UpsertDecisionInput {
  id?: string;
  title: string;
  statement?: string;
  decidedAt?: string;
  expectedOutcome?: string | null;
  relatedHypothesisIds?: string[];
  relatedEntityKeys?: string[];
  source?: DecisionSource | string;
  distillateId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListDecisionsOptions {
  limit?: number;
  since?: string;
}

export interface DecisionOutcomeRow {
  id: string;
  ownerId?: string;
  decisionId: string;
  recordedAt: string;
  actualOutcome: string;
  alignedWithExpected: boolean | null;
  evidence: EvidenceRef[] | Array<Record<string, unknown>>;
  learning: string | null;
  metadata: Record<string, unknown>;
}

export interface InsertDecisionOutcomeInput {
  decisionId: string;
  actualOutcome: string;
  recordedAt?: string;
  alignedWithExpected?: boolean | null;
  evidence?: EvidenceRef[] | Array<Record<string, unknown>>;
  learning?: string | null;
  metadata?: Record<string, unknown>;
}

export type ExperimentStatus =
  | "proposed"
  | "active"
  | "completed"
  | "abandoned";

export type ExperimentResultPolarity =
  | "supports"
  | "contradicts"
  | "inconclusive";

export interface ExperimentRow {
  id: string;
  ownerId?: string;
  hypothesisId: string;
  title: string;
  protocol: string;
  status: ExperimentStatus;
  proposedAt: string;
  dueAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  resultPolarity: ExperimentResultPolarity | null;
  evidence: EvidenceRef[] | Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
}

export interface UpsertExperimentInput {
  id?: string;
  hypothesisId: string;
  title: string;
  protocol: string;
  status?: ExperimentStatus;
  proposedAt?: string;
  dueAt?: string | null;
  completedAt?: string | null;
  resultSummary?: string | null;
  resultPolarity?: ExperimentResultPolarity | null;
  evidence?: EvidenceRef[] | Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface ListExperimentsOptions {
  limit?: number;
  status?: ExperimentStatus;
  hypothesisId?: string;
  dueBefore?: string;
}

export interface PredictionEventRow {
  id: string;
  ownerId?: string;
  claimId: string;
  claimKind: string;
  domain: string | null;
  predicted: string;
  actual: string | null;
  correct: boolean | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface UpsertPredictionEventInput {
  id?: string;
  claimId: string;
  claimKind?: string;
  domain?: string | null;
  predicted: string;
  actual?: string | null;
  correct?: boolean | null;
  resolvedAt?: string | null;
}

export interface ListPredictionEventsOptions {
  limit?: number;
  claimId?: string;
  since?: string;
}

export interface SelfModelDiffRow {
  id: string;
  ownerId?: string;
  fromVersionId: string | null;
  toVersionId: string;
  stable: Array<Record<string, unknown>>;
  emerging: Array<Record<string, unknown>>;
  fading: Array<Record<string, unknown>>;
  environmentShifts: Array<Record<string, unknown>>;
  confirmedPredictions: Array<Record<string, unknown>>;
  disprovedPredictions: Array<Record<string, unknown>>;
  eventAnchors: Array<Record<string, unknown>>;
  createdAt: string;
}

export interface InsertSelfModelDiffInput {
  fromVersionId?: string | null;
  toVersionId: string;
  stable?: Array<Record<string, unknown>>;
  emerging?: Array<Record<string, unknown>>;
  fading?: Array<Record<string, unknown>>;
  environmentShifts?: Array<Record<string, unknown>>;
  confirmedPredictions?: Array<Record<string, unknown>>;
  disprovedPredictions?: Array<Record<string, unknown>>;
  eventAnchors?: Array<Record<string, unknown>>;
}

export interface ListSelfModelDiffsOptions {
  limit?: number;
  toVersionId?: string;
}

export type ClaimEvidencePolarity = "supports" | "contradicts";

export interface ClaimEvidenceRow {
  id: string;
  ownerId?: string;
  claimId: string;
  claimKind: string;
  observationId: string | null;
  evidence: EvidenceRef | Record<string, unknown>;
  polarity: ClaimEvidencePolarity;
  createdAt: string;
}

export interface InsertClaimEvidenceInput {
  claimId: string;
  claimKind: string;
  observationId?: string | null;
  evidence: EvidenceRef | Record<string, unknown>;
  polarity: ClaimEvidencePolarity;
}

/** Insight card DTO — required contract for product surfaces. */
export interface InsightCard {
  id: string;
  theme?: string;
  notice: string;
  why: string;
  evidence: EvidenceRef[];
  confidence: number;
  contradictions: string[];
  rival: string;
  test: string;
  controls: {
    confirm: boolean;
    reject: boolean;
    refine: boolean;
  };
  hypothesisId?: string | null;
  provisional?: boolean;
  metadata?: Record<string, unknown>;
}
