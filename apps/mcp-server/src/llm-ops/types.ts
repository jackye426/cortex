/**
 * LLM Work Mirror / llm-ops — shared contracts.
 * See docs/llm-work-mirror-roadmap.md
 */

export type LlmTaskContext =
  | "coding"
  | "research"
  | "planning"
  | "writing"
  | "reflection"
  | "administration"
  | "ambiguous";

export type LlmRole =
  | "executor"
  | "researcher"
  | "critic"
  | "tutor"
  | "synthesizer"
  | "decision_partner"
  | "mirror";

export type LlmActor =
  | "user"
  | "assistant"
  | "tool"
  | "system"
  | "unknown";

export type LlmOpsEventType =
  | "user_directive"
  | "agent_proposal"
  | "steering_redirect"
  | "steering_constrain"
  | "option_presented"
  | "option_selected"
  | "frame_challenge"
  | "scope_kill"
  | "scope_park"
  | "topic_shift"
  | "clarification_requested"
  | "proof_requested"
  | "counterexample_requested"
  | "commitment_stated"
  | "next_action_stated"
  | "synthesis_requested"
  | "artifact_pasted"
  | "artifact_produced"
  | "decision_recorded"
  | "error_or_refusal_encountered";

export type LlmAxis =
  | "outcome_leverage"
  | "problem_framing"
  | "steering"
  | "epistemic_discipline"
  | "verification"
  | "planning";

export const LLM_AXES: LlmAxis[] = [
  "outcome_leverage",
  "problem_framing",
  "steering",
  "epistemic_discipline",
  "verification",
  "planning",
];

export type LlmDecisionType =
  | "strategic_redirect"
  | "frame_challenge"
  | "option_selection"
  | "evidence_demand"
  | "scope_kill"
  | "scope_park"
  | "closure_act"
  | "domain_correction"
  | "product_insight"
  | "hypothesis_revision";

export type EpisodeTermination =
  | "decision"
  | "artifact"
  | "verified_outcome"
  | "next_action"
  | "explicit_park"
  | "unresolved"
  | "abandoned";

export interface LlmOpsEvent {
  eventIndex: number;
  eventType: LlmOpsEventType;
  actor: LlmActor;
  messageId: string | null;
  excerpt: string;
  payload: Record<string, unknown>;
}

export interface LlmSessionSignals {
  userMessageCount: number;
  assistantMessageCount: number;
  avgPromptWords: number;
  thinBriefCount: number;
  redirectCount: number;
  constrainCount: number;
  proofDemandCount: number;
  counterexampleCount: number;
  optionSelectionCount: number;
  closureActCount: number;
  topicShiftCount: number;
  firstProposalAccepted: number;
  commitmentCount: number;
  openQuestionLeftovers: number;
}

export interface LlmOpsDigest {
  sessionId: string;
  sourceId: string;
  title: string | null;
  startedAt: string | null;
  endedAt: string | null;
  context: LlmTaskContext;
  llmRole: LlmRole;
  skipReason: string | null;
  events: LlmOpsEvent[];
  signals: LlmSessionSignals;
  firstPrompt: string | null;
  userHighlights: string;
  coverage: {
    messageCount: number;
    sampled: boolean;
    stub: boolean;
  };
}

export interface LlmEpisode {
  id: string;
  sessionIds: string[];
  context: LlmTaskContext;
  title: string;
  termination: EpisodeTermination;
  windowStart: string | null;
  windowEnd: string | null;
  linkConfidence: number;
}

export interface LlmDecision {
  sessionId: string;
  episodeId: string | null;
  decisionType: LlmDecisionType;
  lawKey: string | null;
  narrative: string;
  evidenceEventIndexes: number[];
  significance: "strategic" | "moderate" | "tactical";
  confidence: number;
}

export interface LlmEpisodeScore {
  episodeId: string;
  title: string;
  facts: string;
  interpretation: string;
  counterweight: string;
  confidence: number;
  scores: Partial<Record<LlmAxis, number>>;
  omittedAxes: Array<{ axis: LlmAxis; reason: string }>;
  model: string;
  context: LlmTaskContext;
}

export interface LlmInsightCard {
  id: string;
  question: string;
  value: string;
  subtitle: string;
  evidenceSessionIds: string[];
  /** Optional full intrapersonal contract fields */
  contradiction?: string;
  rival?: string;
  falsifier?: string;
  experiment?: string;
}

export interface LlmOperatorProfile {
  versionKey: string;
  windowStart: string | null;
  windowEnd: string | null;
  axes: Partial<Record<LlmAxis, number>>;
  contextMix: Partial<Record<LlmTaskContext, number>>;
  roleMix: Partial<Record<LlmRole, number>>;
  strengths: LlmInsightCard[];
  growthEdges: LlmInsightCard[];
  decisionSummary: {
    total: number;
    byType: Record<string, number>;
  };
  metrics: {
    sessionsScanned: number;
    sessionsScored: number;
    episodesScored: number;
    skipped: number;
    thinBriefRate: number;
    redirectRate: number;
    proofDemandRate: number;
    closureRate: number;
    avgPromptWords: number;
  };
  generatedAt: string;
}

/** Sources owned by coding-ops (not llm-ops). */
export const CODING_OPS_SOURCES = new Set([
  "cursor",
  "claude-code",
  "codex",
]);

/** Sources owned by llm-ops. */
export const LLM_OPS_SOURCES = new Set([
  "chatgpt-export",
  "chatgpt",
]);

export function isCodingOpsSource(sourceId: string): boolean {
  return CODING_OPS_SOURCES.has(sourceId);
}

export function isLlmOpsSource(sourceId: string): boolean {
  return LLM_OPS_SOURCES.has(sourceId);
}
