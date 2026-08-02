/**
 * Roll LLM episode scores into an operator profile + insight cards.
 */
import { isoWeekKey } from "../week-helpers.js";
import { isThinBrief } from "./extract-events.js";
import type {
  LlmAxis,
  LlmDecision,
  LlmEpisodeScore,
  LlmInsightCard,
  LlmOpsDigest,
  LlmOperatorProfile,
  LlmRole,
  LlmTaskContext,
} from "./types.js";
import { LLM_AXES } from "./types.js";

function axisMeans(
  scores: LlmEpisodeScore[],
): Partial<Record<LlmAxis, number>> {
  const out: Partial<Record<LlmAxis, number>> = {};
  for (const axis of LLM_AXES) {
    let num = 0;
    let den = 0;
    for (const ep of scores) {
      const v = ep.scores[axis];
      if (typeof v !== "number") continue;
      const w = typeof ep.confidence === "number" ? ep.confidence : 0.5;
      num += v * w;
      den += w;
    }
    if (den > 0) out[axis] = Math.round((num / den) * 100) / 100;
  }
  return out;
}

function card(
  id: string,
  question: string,
  value: string,
  subtitle: string,
  evidenceSessionIds: string[],
  extra: Partial<LlmInsightCard> = {},
): LlmInsightCard {
  return { id, question, value, subtitle, evidenceSessionIds, ...extra };
}

export function buildLlmOperatorProfile(input: {
  digests: LlmOpsDigest[];
  decisions: LlmDecision[];
  scores: LlmEpisodeScore[];
  skipped: number;
  weekKey?: string;
}): LlmOperatorProfile {
  const weekKey = input.weekKey ?? isoWeekKey();
  const scoredDigests = input.digests.filter((d) => !d.skipReason);
  const axes = axisMeans(input.scores);

  const contextMix: Partial<Record<LlmTaskContext, number>> = {};
  const roleMix: Partial<Record<LlmRole, number>> = {};
  for (const d of scoredDigests) {
    contextMix[d.context] = (contextMix[d.context] ?? 0) + 1;
    roleMix[d.llmRole] = (roleMix[d.llmRole] ?? 0) + 1;
  }

  const byType: Record<string, number> = {};
  for (const d of input.decisions) {
    byType[d.decisionType] = (byType[d.decisionType] ?? 0) + 1;
  }

  const sessionIds = scoredDigests.map((d) => d.sessionId);
  const strengths: LlmInsightCard[] = [];
  const growthEdges: LlmInsightCard[] = [];

  const ranked = LLM_AXES.map((a) => ({ axis: a, score: axes[a] }))
    .filter((x): x is { axis: LlmAxis; score: number } => typeof x.score === "number")
    .sort((a, b) => b.score - a.score);

  for (const r of ranked.slice(0, 2)) {
    strengths.push(
      card(
        `strength-${r.axis}`,
        `Strength: ${r.axis.replace(/_/g, " ")}`,
        r.score.toFixed(1),
        r.axis === "steering"
          ? "You redirect and constrain chats rather than accepting the first frame."
          : r.axis === "epistemic_discipline"
            ? "You ask for sources, rivals, or counterexamples in research threads."
            : r.axis === "outcome_leverage"
              ? "Threads often end in a decision, artifact, or next action."
              : `Evidence supports above-median ${r.axis.replace(/_/g, " ")}.`,
        sessionIds.slice(0, 5),
      ),
    );
  }

  const weakest = ranked[ranked.length - 1];
  if (weakest && weakest.score < 7) {
    growthEdges.push(
      card(
        `growth-${weakest.axis}`,
        `Growth edge: ${weakest.axis.replace(/_/g, " ")}`,
        weakest.score.toFixed(1),
        weakest.axis === "problem_framing"
          ? "Name job, done-when, and out-of-scope before long generation."
          : weakest.axis === "outcome_leverage"
            ? "End substantial threads with a decision line, artifact, or explicit park."
            : weakest.axis === "epistemic_discipline"
              ? "Demand a citation or rival explanation before accepting confident synthesis."
              : `Raise evidenced ${weakest.axis.replace(/_/g, " ")} with concrete in-session acts.`,
        sessionIds.slice(0, 5),
        {
          contradiction:
            "Some episodes may already show this behavior in another context.",
          rival:
            "Missing transcript context (off-chat decisions) can look like weak closure.",
          falsifier:
            "If the next five comparable episodes show clear framing/closure/proof without coaching, retire this edge.",
          experiment:
            "On the next three research/planning chats: write job + done-when first, then force a decision or park line at the end.",
        },
      ),
    );
  }

  const thinSessions = scoredDigests.filter((d) => isThinBrief(d.firstPrompt));
  if (thinSessions.length > 0) {
    growthEdges.push(
      card(
        "growth-thin-brief",
        "Tighten briefs before long generation",
        `${thinSessions.length} thin brief(s)`,
        "Short or hollow first prompts without job/done-when under-credit framing.",
        thinSessions.map((d) => d.sessionId),
        {
          rival: "Short prompts can be fine when continuing a clear prior thread.",
          falsifier:
            "If thin-looking prompts still produce high closure without rework, loosen this detector.",
          experiment:
            "Add one sentence: who it's for, done-when, and what not to do.",
        },
      ),
    );
  }

  const unresolved = input.scores.filter(
    (s) =>
      s.scores.outcome_leverage != null &&
      s.scores.outcome_leverage < 5.5,
  );
  if (unresolved.length >= 2) {
    growthEdges.push(
      card(
        "growth-closure-debt",
        "Closure debt in research/planning",
        `${unresolved.length} low-closure episode(s)`,
        "Multiple threads ended without a decision, artifact, or explicit park.",
        sessionIds.slice(0, 5),
        {
          contradiction: "Exploration without a decision can still be valuable.",
          rival: "External dependency may correctly block the decision.",
          falsifier:
            "If each revisit adds decision-relevant evidence, this is not debt.",
          experiment:
            "Record a reversible decision + expected outcome + 7-day review.",
        },
      ),
    );
  }

  if (strengths.length === 0) {
    strengths.push(
      card(
        "strength-volume",
        "LLM-ops profile warming up",
        `${scoredDigests.length} sessions`,
        "Need more ChatGPT/export sessions with full grain to score deeply.",
        sessionIds.slice(0, 3),
      ),
    );
  }

  const totalUser = scoredDigests.reduce(
    (n, d) => n + d.signals.userMessageCount,
    0,
  );
  const redirects = scoredDigests.reduce(
    (n, d) => n + d.signals.redirectCount,
    0,
  );
  const proofs = scoredDigests.reduce(
    (n, d) => n + d.signals.proofDemandCount + d.signals.counterexampleCount,
    0,
  );
  const closures = scoredDigests.reduce(
    (n, d) => n + d.signals.closureActCount,
    0,
  );
  const thin = scoredDigests.reduce((n, d) => n + d.signals.thinBriefCount, 0);
  const avgPrompt =
    scoredDigests.length > 0
      ? scoredDigests.reduce((n, d) => n + d.signals.avgPromptWords, 0) /
        scoredDigests.length
      : 0;

  return {
    versionKey: weekKey,
    windowStart: null,
    windowEnd: null,
    axes,
    contextMix,
    roleMix,
    strengths: strengths.slice(0, 6),
    growthEdges: growthEdges.slice(0, 3),
    decisionSummary: {
      total: input.decisions.length,
      byType,
    },
    metrics: {
      sessionsScanned: input.digests.length,
      sessionsScored: scoredDigests.length,
      episodesScored: input.scores.length,
      skipped: input.skipped,
      thinBriefRate:
        scoredDigests.length > 0 ? thin / scoredDigests.length : 0,
      redirectRate: totalUser > 0 ? redirects / totalUser : 0,
      proofDemandRate: totalUser > 0 ? proofs / totalUser : 0,
      closureRate: scoredDigests.length > 0 ? closures / scoredDigests.length : 0,
      avgPromptWords: Math.round(avgPrompt * 10) / 10,
    },
    generatedAt: new Date().toISOString(),
  };
}
