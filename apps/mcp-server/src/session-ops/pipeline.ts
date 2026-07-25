/**
 * Coding ops pipeline — extract → narrative → decisions → episodes → scores → profile.
 * Persists compiled views as distillates (session_ops_digest, episode_score, coding_builder_profile).
 */
import { isoWeekKey } from "../week-helpers.js";
import { stableSubjectUuid } from "../stable-id.js";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import { classifySessionDecisions } from "./decisions.js";
import { extractSessionOps } from "./extract-events.js";
import { buildEpisodesFromDigests } from "./git-episodes.js";
import { generateSessionNarrative } from "./narrative.js";
import { buildCodingBuilderProfile } from "./profile.js";
import { scoreEpisode } from "./score-episode.js";
import type {
  CodingBuilderProfile,
  CodingDecision,
  EpisodeScore,
  SessionOpsDigest,
} from "./types.js";

export interface RunCodingOpsOptions {
  limit?: number;
  dryRun?: boolean;
  stubOnly?: boolean;
  skipProfile?: boolean;
  sessionIds?: string[];
}

export interface RunCodingOpsResult {
  dryRun: boolean;
  scanned: number;
  digestsWritten: number;
  decisions: number;
  episodes: number;
  scoresWritten: number;
  profileWritten: boolean;
  profile: CodingBuilderProfile | null;
  samples: Array<{ sessionId: string; events: number; decisions: number }>;
}

function digestContent(d: SessionOpsDigest): string {
  return [
    `Session ops for ${d.title ?? d.sessionId} (${d.sourceId}).`,
    `Events=${d.events.length}, steering=${d.steeringTraces.length}, plans=${d.planFiles.length}.`,
    `First prompt: ${d.firstPrompt ?? "(none)"}`,
    `Signals: product=${d.sessionSignals.productReferences} redirects≈${d.steeringTraces.filter((t) => t.kind === "redirect").length}`,
  ].join("\n");
}

export async function runCodingOpsPipeline(
  store: CortexStore,
  options: RunCodingOpsOptions = {},
): Promise<RunCodingOpsResult> {
  const dryRun = Boolean(options.dryRun);
  const stubOnly = Boolean(options.stubOnly) || dryRun;
  const limit = options.limit ?? 20;

  const envelopes = await store.listSessionsForDistillate(limit, {
    skipDistilled: false,
  });

  const digests: SessionOpsDigest[] = [];
  const decisions: CodingDecision[] = [];
  const narratives = new Map<string, string>();
  const samples: RunCodingOpsResult["samples"] = [];
  let digestsWritten = 0;

  for (const env of envelopes) {
    const meta = env.metadata ?? {};
    const sessionId =
      typeof meta.sessionId === "string"
        ? meta.sessionId
        : typeof meta.cortexSessionId === "string"
          ? meta.cortexSessionId
          : null;

    // Prefer getSession when we have a uuid; else synthesize from envelope
    let detail = sessionId ? await store.getSession(sessionId) : null;
    if (!detail) {
      // Build a minimal SessionDetail from envelope sampled turns
      const turns = env.sampledTurns ?? [];
      detail = {
        id:
          sessionId ??
          stableSubjectUuid(
            "session-ops",
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
        toolCalls: (env.toolSummaries ?? []).map((t, i) => ({
          id: `tool-${i}`,
          toolName: t.split(/\s+/)[0] || "Tool",
          argsSummary: t,
          status: "ok",
        })),
        distillate: null,
      };
    }

    if (
      options.sessionIds?.length &&
      !options.sessionIds.includes(detail.id)
    ) {
      continue;
    }

    const digest = extractSessionOps(detail);
    const narrative = await generateSessionNarrative(digest, { stubOnly });
    digest.sessionIntent = narrative.sessionIntent;
    narratives.set(digest.sessionId, narrative.markdown);

    const sessionDecisions = await classifySessionDecisions(digest, {
      stubOnly,
    });
    decisions.push(...sessionDecisions);
    digests.push(digest);
    samples.push({
      sessionId: digest.sessionId,
      events: digest.events.length,
      decisions: sessionDecisions.length,
    });

    if (!dryRun) {
      await store.upsertDistillate({
        subjectType: "session",
        subjectId: digest.sessionId,
        kind: "session_ops_digest",
        content: digestContent(digest),
        embeddingRef: null,
        model: narrative.model,
        metadata: {
          ...digest,
          narrativeMarkdown: narrative.markdown,
          decisions: sessionDecisions,
          codingOpsVersion: 1,
        },
      });
      digestsWritten += 1;
    } else {
      digestsWritten += 1;
    }
  }

  const episodes = buildEpisodesFromDigests(digests, []);
  const scores: EpisodeScore[] = [];
  let scoresWritten = 0;
  for (const ep of episodes) {
    const scored = await scoreEpisode(ep, digests, narratives, decisions, {
      stubOnly,
    });
    scores.push(scored);
    if (!dryRun) {
      await store.upsertDistillate({
        subjectType: "episode",
        subjectId: ep.id,
        kind: "episode_score",
        content: [
          scored.title,
          scored.facts,
          scored.interpretation,
          `scores=${JSON.stringify(scored.scores)}`,
        ].join("\n"),
        embeddingRef: null,
        model: scored.model,
        metadata: {
          episode: ep,
          score: scored,
          codingOpsVersion: 1,
        },
      });
      scoresWritten += 1;
    } else {
      scoresWritten += 1;
    }
  }

  let profile: CodingBuilderProfile | null = null;
  let profileWritten = false;
  if (!options.skipProfile && digests.length > 0) {
    profile = buildCodingBuilderProfile({ digests, decisions, scores });
    if (!dryRun) {
      const weekKey = isoWeekKey();
      const subjectId = stableSubjectUuid("coding-builder-profile", weekKey);
      await store.upsertDistillate({
        subjectType: "owner_week",
        subjectId,
        kind: "coding_builder_profile",
        content: [
          `Coding builder profile ${weekKey} band=${profile.band ?? "?"}.`,
          `Axes: ${JSON.stringify(profile.axes)}`,
          ...profile.growthEdges.map((g) => `Growth: ${g.question} — ${g.value}`),
          ...profile.strengths.map((s) => `Strength: ${s.question} — ${s.value}`),
        ].join("\n"),
        embeddingRef: null,
        model: "coding-ops-v1",
        metadata: {
          profile,
          weekKey,
          codingOpsVersion: 1,
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
    digestsWritten,
    decisions: decisions.length,
    episodes: episodes.length,
    scoresWritten,
    profileWritten,
    profile,
    samples: samples.slice(0, 12),
  };
}

export async function getLatestCodingBuilderProfile(
  store: CortexStore,
): Promise<{ distillate: DistillateRow; profile: CodingBuilderProfile } | null> {
  const rows = await store.listDistillates({
    limit: 5,
    kinds: ["coding_builder_profile"],
  });
  const row = rows[0];
  if (!row) return null;
  const profile = row.metadata.profile as CodingBuilderProfile | undefined;
  if (!profile) return null;
  return { distillate: row, profile };
}

export async function listEpisodeScores(
  store: CortexStore,
  options: { limit?: number } = {},
): Promise<
  Array<{ distillate: DistillateRow; score: EpisodeScore; episodeId: string }>
> {
  const rows = await store.listDistillates({
    limit: options.limit ?? 40,
    kinds: ["episode_score"],
  });
  const out: Array<{
    distillate: DistillateRow;
    score: EpisodeScore;
    episodeId: string;
  }> = [];
  for (const row of rows) {
    const score = row.metadata.score as EpisodeScore | undefined;
    if (!score) continue;
    out.push({ distillate: row, score, episodeId: row.subjectId });
  }
  return out;
}

export async function listSessionOpsDigests(
  store: CortexStore,
  options: { limit?: number; sessionId?: string } = {},
): Promise<Array<{ distillate: DistillateRow; digest: SessionOpsDigest }>> {
  const rows = await store.listDistillates({
    limit: options.limit ?? 40,
    kinds: ["session_ops_digest"],
  });
  const out: Array<{ distillate: DistillateRow; digest: SessionOpsDigest }> =
    [];
  for (const row of rows) {
    if (options.sessionId && row.subjectId !== options.sessionId) continue;
    const digest = row.metadata as unknown as SessionOpsDigest;
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
