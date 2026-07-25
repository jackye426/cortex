/**
 * Five-axis episode scoring. LLM when configured; heuristic stub otherwise.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatJsonCompletion, openaiConfigured } from "../llm.js";
import type {
  CodingAxis,
  CodingDecision,
  CodingEpisode,
  EpisodeScore,
  SessionOpsDigest,
} from "./types.js";
import { CODING_AXES } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function clamp(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n * 10) / 10));
}

function buildEpisodeInput(
  episode: CodingEpisode,
  digests: SessionOpsDigest[],
  narratives: Map<string, string>,
  decisions: CodingDecision[],
): string {
  const sess = digests.filter((d) => episode.sessionIds.includes(d.sessionId));
  const lines: string[] = [];
  lines.push(`Episode type: ${episode.episodeType}`);
  lines.push(
    `Sessions: ${episode.sessionIds.length}, Commit groups: ${episode.sessionOnly ? 0 : 1}`,
  );
  if (!episode.sessionOnly && episode.insertions + episode.deletions > 0) {
    lines.push(
      `Code volume: +${episode.insertions}/-${episode.deletions} lines (from this episode's commits)`,
    );
  }
  if (episode.sessionOnly) {
    const intents = sess.map((s) => s.sessionIntent).filter(Boolean);
    const dominant = intents[0] ?? "ambiguous";
    lines.push(`Session intent: ${dominant}`);
  }
  const prompts = [
    ...new Set(sess.map((s) => s.firstPrompt).filter(Boolean) as string[]),
  ].slice(0, 5);
  if (prompts.length) {
    lines.push("First prompts:");
    for (const p of prompts) lines.push(`- ${p}`);
  }
  lines.push("## Session Narratives");
  for (const s of sess) {
    const n = narratives.get(s.sessionId);
    if (n) lines.push(n.slice(0, 8000), "---");
  }
  lines.push("## User Highlights");
  lines.push(
    sess
      .map((s) => s.userHighlights)
      .join("\n---\n")
      .slice(0, 10000) || "(none)",
  );
  const decs = decisions.filter(
    (d) =>
      episode.sessionIds.includes(d.sessionId) && d.significance !== "tactical",
  );
  lines.push("## Decision Exchanges");
  if (decs.length === 0) lines.push("(none)");
  else {
    for (const d of decs.slice(0, 10)) {
      lines.push(`- [${d.decisionType}] ${d.narrative}`);
    }
  }
  lines.push("## Plan Files");
  for (const s of sess) {
    for (const p of s.planFiles) {
      lines.push(`- ${p.filename} v${p.versionCount}`);
    }
  }
  lines.push("## Session Signals");
  for (const s of sess) {
    const sig = s.sessionSignals;
    lines.push(
      `kill=${sig.killDecisions} self_corr=${sig.selfCorrections} product=${sig.productReferences} arch=${sig.architectureDiscussions} review=${sig.reviewChecks}`,
    );
  }
  return lines.join("\n");
}

function heuristicScore(
  episode: CodingEpisode,
  digests: SessionOpsDigest[],
  decisions: CodingDecision[],
): EpisodeScore {
  const sess = digests.filter((d) => episode.sessionIds.includes(d.sessionId));
  const steeringN = sess.reduce((n, s) => n + s.steeringTraces.length, 0);
  const productN = sess.reduce(
    (n, s) => n + s.sessionSignals.productReferences,
    0,
  );
  const productDec = decisions.filter(
    (d) =>
      episode.sessionIds.includes(d.sessionId) &&
      d.decisionType === "product_insight",
  ).length;
  const planN = sess.reduce((n, s) => n + s.planFiles.length, 0);
  const constrainN = sess.reduce(
    (n, s) =>
      n + s.steeringTraces.filter((t) => t.kind === "constrain").length,
    0,
  );
  const reviewN = sess.reduce((n, s) => n + s.sessionSignals.reviewChecks, 0);

  const scores: Partial<Record<CodingAxis, number>> = {};
  scores.steering = clamp(5.5 + Math.min(steeringN, 6) * 0.35 + constrainN * 0.2);
  scores.planning = clamp(5.2 + planN * 0.8 + (steeringN > 0 ? 0.3 : 0));
  scores.product_thinking = clamp(
    4.5 + productN * 0.5 + productDec * 0.7,
  );
  if (!episode.sessionOnly) {
    scores.execution_leverage = clamp(
      5.5 + Math.min(episode.insertions + episode.deletions, 500) / 250,
    );
    scores.engineering_quality = clamp(5.5 + reviewN * 0.35 + constrainN * 0.25);
  }

  // Thin product prompt penalty
  const thin = sess.some((s) => {
    const p = s.firstPrompt ?? "";
    return (
      /^goal:\s*add/i.test(p) ||
      (p.length < 40 && /^(add|make|fix)\b/i.test(p))
    );
  });
  if (thin && scores.product_thinking != null) {
    scores.product_thinking = clamp(scores.product_thinking - 1.2);
  }

  return {
    episodeId: episode.id,
    title: episode.title.slice(0, 140),
    facts: `Episode covers ${episode.sessionIds.length} session(s); session_only=${episode.sessionOnly}; steering=${steeringN}; product_refs=${productN}.`,
    interpretation:
      constrainN > 0
        ? "Developer sets safety/scope rails while directing the agent."
        : "Developer issues work directives with moderate mid-task steering evidence.",
    counterweight:
      "Heuristic scoring from grain signals; may under-read off-transcript product intent.",
    confidence: episode.sessionOnly ? 0.45 : 0.55,
    scores,
    model: "stub",
  };
}

export async function scoreEpisode(
  episode: CodingEpisode,
  digests: SessionOpsDigest[],
  narratives: Map<string, string>,
  decisions: CodingDecision[],
  options: { stubOnly?: boolean } = {},
): Promise<EpisodeScore> {
  if (options.stubOnly || !openaiConfigured()) {
    return heuristicScore(episode, digests, decisions);
  }
  try {
    const system = `${readFileSync(join(HERE, "prompts", "episode_scoring.md"), "utf8")}`;
    const user = buildEpisodeInput(episode, digests, narratives, decisions);
    const { text, model } = await chatJsonCompletion({
      system,
      user,
      temperature: 0.2,
    });
    const parsed = JSON.parse(text) as {
      title?: string;
      facts?: string;
      interpretation?: string;
      counterweight?: string;
      confidence?: number;
      scores?: Record<string, number>;
    };
    const scores: Partial<Record<CodingAxis, number>> = {};
    for (const axis of CODING_AXES) {
      const v = parsed.scores?.[axis];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (episode.sessionOnly && (axis === "execution_leverage" || axis === "engineering_quality")) {
          continue;
        }
        scores[axis] = clamp(v);
      }
    }
    if (Object.keys(scores).length === 0) {
      return heuristicScore(episode, digests, decisions);
    }
    return {
      episodeId: episode.id,
      title: (parsed.title || episode.title).slice(0, 140),
      facts: parsed.facts || "",
      interpretation: parsed.interpretation || "",
      counterweight: parsed.counterweight || "",
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      scores,
      model,
    };
  } catch (err) {
    console.warn(
      "[session-ops/score] LLM failed:",
      err instanceof Error ? err.message : err,
    );
    return heuristicScore(episode, digests, decisions);
  }
}
