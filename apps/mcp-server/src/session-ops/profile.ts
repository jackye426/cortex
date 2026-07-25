/**
 * Roll episode scores into a coding builder profile + insight cards.
 */
import { isoWeekKey } from "../week-helpers.js";
import { isThinProductPrompt } from "./extract-events.js";
import type {
  CodingAxis,
  CodingBuilderProfile,
  CodingDecision,
  CodingInsightCard,
  EpisodeScore,
  SessionOpsDigest,
} from "./types.js";
import { CODING_AXES, bandForScore } from "./types.js";

function axisMeans(
  scores: EpisodeScore[],
): Partial<Record<CodingAxis, number>> {
  const out: Partial<Record<CodingAxis, number>> = {};
  for (const axis of CODING_AXES) {
    let num = 0;
    let den = 0;
    for (const ep of scores) {
      const v = ep.scores[axis];
      if (typeof v !== "number") continue;
      const w = typeof ep.confidence === "number" ? ep.confidence : 0.8;
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
): CodingInsightCard {
  return { id, question, value, subtitle, evidenceSessionIds };
}

export function buildCodingBuilderProfile(input: {
  digests: SessionOpsDigest[];
  decisions: CodingDecision[];
  scores: EpisodeScore[];
  weekKey?: string;
}): CodingBuilderProfile {
  const weekKey = input.weekKey ?? isoWeekKey();
  const axes = axisMeans(input.scores);
  const axisValues = Object.values(axes);
  const overall =
    axisValues.length > 0
      ? axisValues.reduce((a, b) => a + b, 0) / axisValues.length
      : null;

  const byType: Record<string, number> = {};
  const lawCounts = new Map<string, number>();
  for (const d of input.decisions) {
    byType[d.decisionType] = (byType[d.decisionType] ?? 0) + 1;
    if (d.lawKey) {
      lawCounts.set(d.lawKey, (lawCounts.get(d.lawKey) ?? 0) + 1);
    }
  }
  const topLaws = [...lawCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ key, count }));

  const planSessions = input.digests.filter((d) => d.planFiles.length > 0).length;
  const redirectTraces = input.digests.reduce(
    (n, d) => n + d.steeringTraces.filter((t) => t.kind === "redirect").length,
    0,
  );
  const totalUser = input.digests.reduce(
    (n, d) => n + d.sessionSignals.userMessageCount,
    0,
  );
  const avgPrompt =
    input.digests.length > 0
      ? input.digests.reduce((n, d) => n + d.sessionSignals.avgPromptWords, 0) /
        input.digests.length
      : 0;
  const productInsights = input.decisions.filter(
    (d) => d.decisionType === "product_insight",
  ).length;

  const sessionIds = input.digests.map((d) => d.sessionId);
  const strengths: CodingInsightCard[] = [];
  const growthEdges: CodingInsightCard[] = [];

  const ranked = CODING_AXES.map((a) => ({
    axis: a,
    score: axes[a],
  })).filter((x): x is { axis: CodingAxis; score: number } => typeof x.score === "number")
    .sort((a, b) => b.score - a.score);

  for (const r of ranked.slice(0, 2)) {
    strengths.push(
      card(
        `strength-${r.axis}`,
        `Strength: ${r.axis.replace(/_/g, " ")}`,
        r.score.toFixed(1),
        r.axis === "steering"
          ? "You set rails and redirects while directing agents."
          : r.axis === "engineering_quality"
            ? "Verification and safety constraints show up in sessions."
            : r.axis === "execution_leverage"
              ? "Sessions tend to close loops toward shipped work."
              : r.axis === "planning"
                ? "Planning effort appears calibrated in several episodes."
                : "User/product framing appears in some decision exchanges.",
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
        weakest.axis === "product_thinking"
          ? "Put user, behavior change, and acceptance test in the first prompt before safety rails."
          : `Raise evidenced ${weakest.axis.replace(/_/g, " ")} with concrete in-session decisions.`,
        sessionIds.slice(0, 5),
      ),
    );
  }

  const thinSessions = input.digests.filter((d) =>
    isThinProductPrompt(d.firstPrompt),
  );
  if (thinSessions.length > 0) {
    growthEdges.push(
      card(
        "growth-thin-product-prompt",
        "Tighten product targets on small features",
        `${thinSessions.length} thin prompt(s)`,
        "Sessions like “Goal: Add” or short feature asks without user/acceptance criteria under-credit product thinking.",
        thinSessions.map((d) => d.sessionId),
      ),
    );
  }

  if (strengths.length === 0) {
    strengths.push(
      card(
        "strength-volume",
        "How much did you ship?",
        `${input.digests.length} sessions analyzed`,
        "Coding-ops profile is warming up — keep extracting sessions.",
        sessionIds.slice(0, 3),
      ),
    );
  }

  // Style cards
  strengths.push(
    card(
      "style-prompts",
      "How do you work with your agent?",
      avgPrompt > 80
        ? "A thinking partner"
        : avgPrompt > 25
          ? "Balanced director"
          : "Terse operator",
      `Average prompt length ~${avgPrompt.toFixed(0)} words across ${input.digests.length} sessions.`,
      sessionIds.slice(0, 3),
    ),
  );

  return {
    versionKey: weekKey,
    windowStart: null,
    windowEnd: null,
    axes,
    band: overall == null ? null : bandForScore(overall),
    strengths: strengths.slice(0, 6),
    growthEdges: growthEdges.slice(0, 4),
    decisionSummary: {
      total: input.decisions.length,
      byType,
      topLaws,
    },
    metrics: {
      sessionsScored: input.digests.length,
      episodesScored: input.scores.length,
      planSessionRate:
        input.digests.length > 0 ? planSessions / input.digests.length : 0,
      redirectRate: totalUser > 0 ? redirectTraces / totalUser : 0,
      avgPromptWords: Math.round(avgPrompt * 10) / 10,
      productInsightShare:
        input.decisions.length > 0
          ? productInsights / input.decisions.length
          : 0,
    },
    generatedAt: new Date().toISOString(),
  };
}
