/**
 * LLM-ops pipeline — extract → episodes → decisions → scores → profile.
 * Distillates: llm_ops_digest, llm_episode_score, llm_operator_profile.
 */
import { isoWeekKey } from "../week-helpers.js";
import { stableSubjectUuid } from "../stable-id.js";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import { deriveLlmDecisions, extractLlmOps } from "./extract-events.js";
import { buildLlmEpisodes } from "./episodes.js";
import { buildLlmOperatorProfile } from "./profile.js";
import { scoreLlmEpisode } from "./score-episode.js";
import type {
  LlmDecision,
  LlmEpisodeScore,
  LlmOpsDigest,
  LlmOperatorProfile,
} from "./types.js";
import { isCodingOpsSource, isLlmOpsSource } from "./types.js";

export interface RunLlmOpsOptions {
  limit?: number;
  dryRun?: boolean;
  skipProfile?: boolean;
  sessionIds?: string[];
  /** When true, also attempt non-chatgpt sources that are not coding-ops (rare). */
  includeUnknownChatSources?: boolean;
}

export interface RunLlmOpsResult {
  dryRun: boolean;
  scanned: number;
  skipped: number;
  digestsWritten: number;
  decisions: number;
  episodes: number;
  scoresWritten: number;
  profileWritten: boolean;
  profile: LlmOperatorProfile | null;
  samples: Array<{
    sessionId: string;
    sourceId: string;
    context: string;
    skipReason: string | null;
    events: number;
  }>;
}

function digestContent(d: LlmOpsDigest): string {
  return [
    `LLM ops for ${d.title ?? d.sessionId} (${d.sourceId}).`,
    `context=${d.context} role=${d.llmRole} skip=${d.skipReason ?? "none"}`,
    `Events=${d.events.length} userTurns=${d.signals.userMessageCount}`,
    `First prompt: ${d.firstPrompt ?? "(none)"}`,
    `Signals: thin=${d.signals.thinBriefCount} redirects=${d.signals.redirectCount} proofs=${d.signals.proofDemandCount} closure=${d.signals.closureActCount}`,
  ].join("\n");
}

function shouldConsiderSource(
  sourceId: string,
  includeUnknown: boolean,
): boolean {
  if (isCodingOpsSource(sourceId)) return false;
  if (isLlmOpsSource(sourceId)) return true;
  return includeUnknown;
}

export async function runLlmOpsPipeline(
  store: CortexStore,
  options: RunLlmOpsOptions = {},
): Promise<RunLlmOpsResult> {
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit ?? 30;
  const includeUnknown = Boolean(options.includeUnknownChatSources);

  const envelopes = await store.listSessionsForDistillate(limit, {
    skipDistilled: false,
  });

  const digests: LlmOpsDigest[] = [];
  const decisions: LlmDecision[] = [];
  const samples: RunLlmOpsResult["samples"] = [];
  let digestsWritten = 0;
  let skipped = 0;

  for (const env of envelopes) {
    if (!shouldConsiderSource(env.sourceId, includeUnknown)) {
      skipped += 1;
      continue;
    }

    const meta = env.metadata ?? {};
    const sessionId =
      typeof meta.sessionId === "string"
        ? meta.sessionId
        : typeof meta.cortexSessionId === "string"
          ? meta.cortexSessionId
          : null;

    let detail = sessionId ? await store.getSession(sessionId) : null;
    if (!detail) {
      const turns = env.sampledTurns ?? [];
      detail = {
        id:
          sessionId ??
          stableSubjectUuid(
            "llm-ops",
            `${env.sourceId}:${env.sourceSessionId}`,
          ),
        sourceId: env.sourceId,
        sourceSessionId: env.sourceSessionId,
        title: env.title ?? null,
        workspace: env.workspace ?? null,
        startedAt: env.startedAt ?? null,
        endedAt: env.endedAt ?? null,
        metadata: env.metadata ?? {},
        messages: turns.map((t, i) => ({
          id: t.messageId ?? `turn-${i}`,
          role: t.role,
          content: t.content,
        })),
        toolCalls: [],
        distillate: null,
      };
    }

    if (
      options.sessionIds?.length &&
      !options.sessionIds.includes(detail.id)
    ) {
      continue;
    }

    const digest = extractLlmOps(detail);
    digests.push(digest);
    samples.push({
      sessionId: digest.sessionId,
      sourceId: digest.sourceId,
      context: digest.context,
      skipReason: digest.skipReason,
      events: digest.events.length,
    });

    if (digest.skipReason) {
      skipped += 1;
      continue;
    }

    if (!dryRun) {
      await store.upsertDistillate({
        subjectType: "session",
        subjectId: digest.sessionId,
        kind: "llm_ops_digest",
        content: digestContent(digest),
        embeddingRef: null,
        model: "llm-ops-v1",
        metadata: {
          ...digest,
          llmOpsVersion: 1,
        },
      });
      digestsWritten += 1;
    } else {
      digestsWritten += 1;
    }
  }

  const scoreable = digests.filter((d) => !d.skipReason);
  const episodes = buildLlmEpisodes(scoreable);
  for (const d of scoreable) {
    const ep = episodes.find((e) => e.sessionIds.includes(d.sessionId));
    decisions.push(...deriveLlmDecisions(d, ep?.id ?? null));
  }

  const scores: LlmEpisodeScore[] = [];
  let scoresWritten = 0;
  for (const ep of episodes) {
    const scored = scoreLlmEpisode(ep, scoreable, decisions);
    scores.push(scored);
    if (!dryRun) {
      await store.upsertDistillate({
        subjectType: "episode",
        subjectId: ep.id,
        kind: "llm_episode_score",
        content: [
          scored.title,
          scored.facts,
          scored.interpretation,
          `scores=${JSON.stringify(scored.scores)}`,
          `omitted=${JSON.stringify(scored.omittedAxes)}`,
        ].join("\n"),
        embeddingRef: null,
        model: scored.model,
        metadata: {
          episode: ep,
          score: scored,
          llmOpsVersion: 1,
        },
      });
      scoresWritten += 1;
    } else {
      scoresWritten += 1;
    }
  }

  let profile: LlmOperatorProfile | null = null;
  let profileWritten = false;
  if (!options.skipProfile && scoreable.length > 0) {
    profile = buildLlmOperatorProfile({
      digests,
      decisions,
      scores,
      skipped,
    });
    if (!dryRun) {
      const weekKey = isoWeekKey();
      const subjectId = stableSubjectUuid("llm-operator-profile", weekKey);
      await store.upsertDistillate({
        subjectType: "owner_week",
        subjectId,
        kind: "llm_operator_profile",
        content: [
          `LLM operator profile ${weekKey}.`,
          `Axes: ${JSON.stringify(profile.axes)}`,
          `Contexts: ${JSON.stringify(profile.contextMix)}`,
          ...profile.growthEdges.map(
            (g) => `Growth: ${g.question} — ${g.value}`,
          ),
          ...profile.strengths.map(
            (s) => `Strength: ${s.question} — ${s.value}`,
          ),
        ].join("\n"),
        embeddingRef: null,
        model: "llm-ops-v1",
        metadata: {
          profile,
          weekKey,
          llmOpsVersion: 1,
        },
      });
      profileWritten = true;
    } else {
      profileWritten = true;
    }
  }

  return {
    dryRun,
    scanned: digests.length,
    skipped,
    digestsWritten,
    decisions: decisions.length,
    episodes: episodes.length,
    scoresWritten,
    profileWritten,
    profile,
    samples: samples.slice(0, 12),
  };
}

export async function getLatestLlmOperatorProfile(
  store: CortexStore,
): Promise<{ distillate: DistillateRow; profile: LlmOperatorProfile } | null> {
  const rows = await store.listDistillates({
    limit: 5,
    kinds: ["llm_operator_profile"],
  });
  const row = rows[0];
  if (!row) return null;
  const profile = row.metadata.profile as LlmOperatorProfile | undefined;
  if (!profile) return null;
  return { distillate: row, profile };
}

export async function listLlmEpisodeScores(
  store: CortexStore,
  options: { limit?: number } = {},
): Promise<
  Array<{ distillate: DistillateRow; score: LlmEpisodeScore; episodeId: string }>
> {
  const rows = await store.listDistillates({
    limit: options.limit ?? 40,
    kinds: ["llm_episode_score"],
  });
  const out: Array<{
    distillate: DistillateRow;
    score: LlmEpisodeScore;
    episodeId: string;
  }> = [];
  for (const row of rows) {
    const score = row.metadata.score as LlmEpisodeScore | undefined;
    if (!score) continue;
    out.push({ distillate: row, score, episodeId: row.subjectId });
  }
  return out;
}

export async function listLlmOpsDigests(
  store: CortexStore,
  options: { limit?: number; sessionId?: string } = {},
): Promise<Array<{ distillate: DistillateRow; digest: LlmOpsDigest }>> {
  const rows = await store.listDistillates({
    limit: options.limit ?? 40,
    kinds: ["llm_ops_digest"],
  });
  const out: Array<{ distillate: DistillateRow; digest: LlmOpsDigest }> = [];
  for (const row of rows) {
    if (options.sessionId && row.subjectId !== options.sessionId) continue;
    const digest = row.metadata as unknown as LlmOpsDigest;
    if (!digest?.sessionId && !digest?.events) continue;
    out.push({
      distillate: row,
      digest: {
        ...digest,
        sessionId: digest.sessionId || row.subjectId,
      },
    });
  }
  return out;
}
