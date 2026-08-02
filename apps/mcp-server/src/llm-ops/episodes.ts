/**
 * Episode reconstruction for LLM sessions (topic/thread units, no git).
 */
import { createHash } from "node:crypto";
import type { LlmEpisode, LlmOpsDigest, EpisodeTermination } from "./types.js";

function episodeId(sessionId: string, part: number): string {
  const h = createHash("sha256")
    .update(`llm-ep:${sessionId}:${part}`)
    .digest("hex")
    .slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function inferTermination(d: LlmOpsDigest): EpisodeTermination {
  if (d.signals.closureActCount > 0) return "decision";
  if (
    d.events.some(
      (e) => e.eventType === "artifact_produced" && e.actor === "assistant",
    ) &&
    d.signals.userMessageCount >= 2
  ) {
    return "artifact";
  }
  if (d.events.some((e) => e.eventType === "scope_park")) return "explicit_park";
  if (d.events.some((e) => e.eventType === "next_action_stated")) {
    return "next_action";
  }
  if (d.signals.userMessageCount <= 1) return "abandoned";
  return "unresolved";
}

/**
 * Build episodes from digests. v1: one episode per scored session;
 * split on topic_shift when ≥2 user turns after the shift.
 */
export function buildLlmEpisodes(digests: LlmOpsDigest[]): LlmEpisode[] {
  const episodes: LlmEpisode[] = [];

  for (const d of digests) {
    if (d.skipReason) continue;

    const shifts = d.events.filter((e) => e.eventType === "topic_shift");
    if (shifts.length === 0 || d.signals.userMessageCount < 6) {
      episodes.push({
        id: episodeId(d.sessionId, 0),
        sessionIds: [d.sessionId],
        context: d.context,
        title: d.title ?? d.firstPrompt?.slice(0, 80) ?? d.sessionId,
        termination: inferTermination(d),
        windowStart: d.startedAt,
        windowEnd: d.endedAt,
        linkConfidence: 0.85,
      });
      continue;
    }

    // Split into parts at topic shifts (still same session ids for v1 evidence)
    let part = 0;
    episodes.push({
      id: episodeId(d.sessionId, part++),
      sessionIds: [d.sessionId],
      context: d.context,
      title: `${(d.title ?? "thread").slice(0, 60)} (part 1)`,
      termination: "unresolved",
      windowStart: d.startedAt,
      windowEnd: d.endedAt,
      linkConfidence: 0.7,
    });
    for (const _ of shifts) {
      episodes.push({
        id: episodeId(d.sessionId, part),
        sessionIds: [d.sessionId],
        context: d.context,
        title: `${(d.title ?? "thread").slice(0, 60)} (part ${part + 1})`,
        termination: part === shifts.length ? inferTermination(d) : "unresolved",
        windowStart: d.startedAt,
        windowEnd: d.endedAt,
        linkConfidence: 0.65,
      });
      part += 1;
    }
  }

  return episodes;
}
