/**
 * Six-axis LLM episode scoring (heuristic stub; LLM path optional later).
 */
import type {
  LlmAxis,
  LlmDecision,
  LlmEpisode,
  LlmEpisodeScore,
  LlmOpsDigest,
} from "./types.js";
import { LLM_AXES } from "./types.js";
import { isThinBrief } from "./extract-events.js";

function clamp(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n * 10) / 10));
}

function digestsFor(
  episode: LlmEpisode,
  digests: LlmOpsDigest[],
): LlmOpsDigest[] {
  return digests.filter((d) => episode.sessionIds.includes(d.sessionId));
}

export function scoreLlmEpisode(
  episode: LlmEpisode,
  digests: LlmOpsDigest[],
  decisions: LlmDecision[],
): LlmEpisodeScore {
  const sess = digestsFor(episode, digests);
  const omitted: LlmEpisodeScore["omittedAxes"] = [];
  const scores: Partial<Record<LlmAxis, number>> = {};

  const userTurns = sess.reduce((n, s) => n + s.signals.userMessageCount, 0);
  const redirects = sess.reduce((n, s) => n + s.signals.redirectCount, 0);
  const constrains = sess.reduce((n, s) => n + s.signals.constrainCount, 0);
  const proofs = sess.reduce(
    (n, s) => n + s.signals.proofDemandCount + s.signals.counterexampleCount,
    0,
  );
  const closures = sess.reduce((n, s) => n + s.signals.closureActCount, 0);
  const thin = sess.reduce((n, s) => n + s.signals.thinBriefCount, 0);
  const firstPrompt = sess.map((s) => s.firstPrompt).find(Boolean) ?? null;
  const epDecisions = decisions.filter(
    (d) =>
      episode.sessionIds.includes(d.sessionId) &&
      d.significance !== "tactical",
  );

  // Steering — opportunity-aware: omit if too few user turns
  if (userTurns < 2) {
    omitted.push({ axis: "steering", reason: "fewer than 2 user turns" });
  } else {
    const rate = redirects / userTurns;
    let s = 5.5 + constrains * 0.4 + Math.min(rate, 0.5) * 6;
    // Passive accept of first proposal without redirects lowers slightly
    const passive = sess.reduce((n, x) => n + x.signals.firstProposalAccepted, 0);
    if (passive > 0 && redirects === 0) s -= 1.2;
    scores.steering = clamp(s);
  }

  // Problem framing
  if (!firstPrompt && userTurns === 0) {
    omitted.push({ axis: "problem_framing", reason: "no user framing" });
  } else {
    let s = 6;
    if (isThinBrief(firstPrompt)) s -= 2.5;
    if (thin > 0) s -= Math.min(1.5, thin * 0.5);
    if (
      firstPrompt &&
      (/\bdone when\b|\bacceptance\b|\buser\b|\bout of scope\b/i.test(
        firstPrompt,
      ))
    ) {
      s += 2;
    }
    scores.problem_framing = clamp(s);
  }

  // Epistemic discipline — omit if research/reflection not in play and no proof events
  if (proofs === 0 && episode.context === "writing") {
    omitted.push({
      axis: "epistemic_discipline",
      reason: "writing episode without evidence demands",
    });
  } else if (proofs === 0 && episode.context === "ambiguous") {
    omitted.push({
      axis: "epistemic_discipline",
      reason: "no evidence-seeking behavior observed",
    });
  } else {
    scores.epistemic_discipline = clamp(5 + Math.min(4, proofs * 1.2));
  }

  // Outcome leverage / closure
  if (episode.termination === "abandoned" && userTurns <= 1) {
    omitted.push({
      axis: "outcome_leverage",
      reason: "low-signal oneshot; not an outcome loop",
    });
  } else {
    let s = 5;
    if (closures > 0 || episode.termination === "decision") s += 2.5;
    if (episode.termination === "artifact") s += 1.5;
    if (episode.termination === "next_action") s += 1;
    if (episode.termination === "unresolved") s -= 1;
    if (episode.termination === "abandoned") s -= 2;
    if (epDecisions.some((d) => d.decisionType === "closure_act")) s += 0.5;
    scores.outcome_leverage = clamp(s);
  }

  // Verification — omit when no consequential claims
  if (proofs === 0 && episode.context === "research") {
    scores.verification = clamp(4.5); // research without checks is weak
  } else if (proofs === 0) {
    omitted.push({
      axis: "verification",
      reason: "no verification or proof requests observed",
    });
  } else {
    scores.verification = clamp(5.5 + Math.min(3.5, proofs));
  }

  // Planning
  const synthesis = sess.reduce(
    (n, s) =>
      n + s.events.filter((e) => e.eventType === "synthesis_requested").length,
    0,
  );
  if (episode.context === "planning" || synthesis > 0 || userTurns >= 4) {
    let s = 5.5 + synthesis * 0.8;
    if (episode.context === "planning" && closures === 0) s -= 1;
    scores.planning = clamp(s);
  } else {
    omitted.push({
      axis: "planning",
      reason: "no planning/synthesis signal for this episode",
    });
  }

  const facts = [
    `context=${episode.context} termination=${episode.termination}`,
    `userTurns=${userTurns} redirects=${redirects} proofs=${proofs} closures=${closures} thinBriefs=${thin}`,
    `decisions=${epDecisions.length}`,
  ].join("; ");

  const interpretation = [
    scores.steering != null
      ? `Steering ${scores.steering}: redirects/constraints relative to ${userTurns} user turns.`
      : "Steering omitted.",
    scores.problem_framing != null
      ? `Framing ${scores.problem_framing}: ${isThinBrief(firstPrompt) ? "thin first prompt" : "usable first prompt"}.`
      : "Framing omitted.",
    scores.outcome_leverage != null
      ? `Closure ${scores.outcome_leverage}: ended as ${episode.termination}.`
      : "Closure omitted.",
  ].join(" ");

  const counterweight =
    redirects > 0 && isThinBrief(firstPrompt)
      ? "Redirects after a thin brief may indicate recovery, not strong initial framing."
      : proofs === 0 && episode.context === "research"
        ? "Research without evidence demands may amplify confident mush."
        : "Uneven axes are expected; omission is preferred over invented lows.";

  const scoredCount = LLM_AXES.filter((a) => scores[a] != null).length;

  return {
    episodeId: episode.id,
    title: episode.title.slice(0, 140),
    facts,
    interpretation,
    counterweight,
    confidence: scoredCount >= 3 ? 0.55 : 0.4,
    scores,
    omittedAxes: omitted,
    model: "llm-ops-heuristic-v1",
    context: episode.context,
  };
}
