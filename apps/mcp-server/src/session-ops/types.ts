/**
 * Coding ops intelligence (O0–O6) — shared contracts.
 * See docs/coding-ops-roadmap.md.
 */

export type SessionOpsEventType =
  | "file_edit"
  | "file_create"
  | "file_read"
  | "bash_command"
  | "git_commit"
  | "git_push"
  | "git_branch_switch"
  | "test_run"
  | "error_encountered"
  | "agent_proposal"
  | "agent_thinking"
  | "user_directive"
  | "subagent_dispatch"
  | "subagent_return";

export type CodingDecisionType =
  | "strategic_redirect"
  | "technical_catch"
  | "product_insight"
  | "option_selection";

export type CodingAxis =
  | "execution_leverage"
  | "steering"
  | "engineering_quality"
  | "product_thinking"
  | "planning";

export const CODING_AXES: CodingAxis[] = [
  "execution_leverage",
  "steering",
  "engineering_quality",
  "product_thinking",
  "planning",
];

export const CODING_BANDS = [
  { name: "WEAK", lo: 0, hi: 4 },
  { name: "LIMITED", lo: 4, hi: 6 },
  { name: "STRONG", lo: 6, hi: 8 },
  { name: "ELITE", lo: 8, hi: 9 },
  { name: "EXEMPLAR", lo: 9, hi: 10.0001 },
] as const;

export interface SessionOpsEvent {
  eventIndex: number;
  eventType: SessionOpsEventType;
  occurredAt: string | null;
  payload: Record<string, unknown>;
}

export interface SteeringTrace {
  text: string;
  eventIndex: number;
  kind: "redirect" | "constrain" | "short_directive";
}

export interface PlanFileVersion {
  filename: string;
  versionCount: number;
  content: string;
  hasVerification: boolean;
  hasAlternatives: boolean;
  hasEdgeCases: boolean;
}

export interface SessionSignals {
  killDecisions: number;
  selfCorrections: number;
  hypothesisDriven: number;
  domainCorrections: number;
  debuggingMessages: number;
  architectureDiscussions: number;
  productReferences: number;
  imperativePrompts: number;
  reviewChecks: number;
  critiques: number;
  userMessageCount: number;
  avgPromptWords: number;
}

export interface SessionOpsDigest {
  sessionId: string;
  sourceId: string;
  title: string | null;
  firstPrompt: string | null;
  sessionIntent: "shipping" | "exploration" | "ambiguous" | null;
  events: SessionOpsEvent[];
  steeringTraces: SteeringTrace[];
  planFiles: PlanFileVersion[];
  sessionSignals: SessionSignals;
  userHighlights: string;
  gitShas: string[];
  gitBranches: string[];
  prNumber: number | null;
  extractedAt: string;
}

export interface CodingDecision {
  sessionId: string;
  decisionType: CodingDecisionType;
  lawKey: string | null;
  significance: "strategic" | "moderate" | "tactical";
  domain: string;
  narrative: string;
  evidence: Record<string, unknown>;
  outcomeSignal: "positive" | "negative" | "mixed" | "neutral";
  confidence: number;
}

export interface CodingEpisode {
  id: string;
  episodeType: string;
  sessionIds: string[];
  title: string;
  linkConfidence: number;
  windowStart: string | null;
  windowEnd: string | null;
  commitShas: string[];
  insertions: number;
  deletions: number;
  sessionOnly: boolean;
}

export interface EpisodeScore {
  episodeId: string;
  title: string;
  facts: string;
  interpretation: string;
  counterweight: string;
  confidence: number;
  scores: Partial<Record<CodingAxis, number>>;
  model: string;
}

export interface CodingInsightCard {
  id: string;
  question: string;
  value: string;
  subtitle: string;
  evidenceSessionIds: string[];
}

export interface CodingBuilderProfile {
  versionKey: string;
  windowStart: string | null;
  windowEnd: string | null;
  axes: Partial<Record<CodingAxis, number>>;
  band: string | null;
  strengths: CodingInsightCard[];
  growthEdges: CodingInsightCard[];
  decisionSummary: {
    total: number;
    byType: Record<string, number>;
    topLaws: Array<{ key: string; count: number }>;
  };
  metrics: {
    sessionsScored: number;
    episodesScored: number;
    planSessionRate: number;
    redirectRate: number;
    avgPromptWords: number;
    productInsightShare: number;
  };
  generatedAt: string;
}

export function bandForScore(score: number): string {
  for (const b of CODING_BANDS) {
    if (score >= b.lo && score < b.hi) return b.name;
  }
  return score >= 9 ? "EXEMPLAR" : "WEAK";
}
