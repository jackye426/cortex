/**
 * Phase 0 baseline evaluation set for Unified Memory Substrate.
 * Used by fixture tests and ask_mirror / quality-gate harnesses.
 */

export const MEMORY_EVAL_QUESTIONS = [
  {
    id: "next-actions-cortex",
    question: "What were my next actions on Cortex?",
    mode: "operational" as const,
    expectsEvidence: true,
  },
  {
    id: "failed-to-finish",
    question: "What did I repeatedly fail to finish?",
    mode: "reflective" as const,
    expectsEvidence: true,
  },
  {
    id: "recurring-domains",
    question: "Which problem domains keep recurring?",
    mode: "both" as const,
    expectsEvidence: true,
  },
  {
    id: "approaches-that-work",
    question: "What approaches appear to work well for me?",
    mode: "reflective" as const,
    expectsEvidence: true,
  },
  {
    id: "friction-weakness",
    question: "What evidence suggests a weakness or recurring friction?",
    mode: "reflective" as const,
    expectsEvidence: true,
  },
  {
    id: "explore-outside-work",
    question: "What am I exploring outside active work?",
    mode: "reflective" as const,
    expectsEvidence: true,
  },
  {
    id: "youtube-work-overlap",
    question: "How do my YouTube interests overlap with my agent work?",
    mode: "both" as const,
    expectsEvidence: true,
  },
  {
    id: "weak-overlap",
    question: "Where is the apparent overlap weak or unsupported?",
    mode: "both" as const,
    expectsEvidence: true,
  },
  {
    id: "period-change",
    question: "What changed between two time periods?",
    mode: "both" as const,
    expectsEvidence: true,
  },
  {
    id: "cite-everything",
    question: "Show the source evidence for every conclusion.",
    mode: "both" as const,
    expectsEvidence: true,
  },
  {
    id: "insufficient-evidence",
    question: "What is my relationship with underwater basket weaving?",
    mode: "reflective" as const,
    expectsEvidence: false,
    notes: "Intentionally insufficient — Analyst must refuse or report gaps.",
  },
] as const;

/** Representative session shapes for sampling / distillate tests. */
export const EVAL_SESSION_SHAPES = [
  "short_successful",
  "long_with_end_decision",
  "long_tool_heavy_middle",
  "abandoned_usage_limited",
  "repeated_topic_a",
  "repeated_topic_b",
] as const;

export const EVAL_YOUTUBE_SHAPES = [
  "related_agent_memory",
  "unrelated_cooking",
] as const;

export const SESSION_COMPILER_VERSION = "session-v2";
export const YOUTUBE_COMPILER_VERSION = "youtube-interest-v1";
export const PORTRAIT_COMPILER_VERSION = "portrait-v2";
