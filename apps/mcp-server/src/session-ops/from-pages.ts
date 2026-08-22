/**
 * Coding-ops compiler over GBrain L1 session-v1 pages.
 * Reads conversations/*.md; writes ops/ markdown. Schedule: gbrain dream && this CLI
 * — not a dream phase. ChatGPT pages are skipped via isCodingOpsSource.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parsePagesInDir,
  type SessionDetail as PageSession,
} from "@cortex/gbrain-session-page";
import { isoWeekKey } from "../week-helpers.js";
import { isCodingOpsSource } from "../llm-ops/types.js";
import type { SessionDetail } from "../store/types.js";
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

export interface RunCodingOpsFromPagesOptions {
  pagesDir: string;
  outDir?: string;
  dryRun?: boolean;
  stubOnly?: boolean;
  skipProfile?: boolean;
}

export interface RunCodingOpsFromPagesResult {
  dryRun: boolean;
  scanned: number;
  skipped: number;
  digestsWritten: number;
  episodes: number;
  scoresWritten: number;
  profileWritten: boolean;
  profile: CodingBuilderProfile | null;
  writtenPaths: string[];
  samples: Array<{ sessionId: string; slug: string; events: number }>;
}

function toStoreDetail(page: PageSession): SessionDetail {
  return {
    ...page,
    distillate: null,
  };
}

function sessionSlug(detail: PageSession, relativePath: string): string {
  return relativePath.replace(/\.md$/, "") ||
    `conversations/${detail.sourceId}/${detail.sourceSessionId}`;
}

function yamlQuote(s: string): string {
  return JSON.stringify(s);
}

function writeMd(abs: string, body: string, dryRun: boolean): void {
  if (dryRun) return;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

export async function runCodingOpsFromPages(
  options: RunCodingOpsFromPagesOptions,
): Promise<RunCodingOpsFromPagesResult> {
  const dryRun = Boolean(options.dryRun);
  const stubOnly = Boolean(options.stubOnly) || dryRun;
  const outDir = options.outDir ?? options.pagesDir;
  const pages = parsePagesInDir(options.pagesDir);

  const digests: SessionOpsDigest[] = [];
  const decisions: CodingDecision[] = [];
  const narratives = new Map<string, string>();
  const slugBySessionId = new Map<string, string>();
  const samples: RunCodingOpsFromPagesResult["samples"] = [];
  const writtenPaths: string[] = [];
  let skipped = 0;
  let digestsWritten = 0;

  for (const page of pages) {
    if (!isCodingOpsSource(page.detail.sourceId)) {
      skipped += 1;
      continue;
    }
    const detail = toStoreDetail(page.detail);
    const slug = sessionSlug(page.detail, page.relativePath);
    const digest = extractSessionOps(detail);
    const narrative = await generateSessionNarrative(digest, { stubOnly });
    digest.sessionIntent = narrative.sessionIntent;
    narratives.set(digest.sessionId, narrative.markdown);
    slugBySessionId.set(digest.sessionId, slug);

    const sessionDecisions = await classifySessionDecisions(digest, {
      stubOnly,
    });
    decisions.push(...sessionDecisions);
    digests.push(digest);
    samples.push({
      sessionId: digest.sessionId,
      slug,
      events: digest.events.length,
    });

    const rel = `ops/sessions/${page.detail.sourceId}/${page.detail.sourceSessionId}.md`;
    const md = [
      "---",
      "cortex_schema: coding-ops-session-v1",
      `slug: ${yamlQuote(slug)}`,
      `source_session_id: ${yamlQuote(page.detail.sourceSessionId)}`,
      `harness: ${page.detail.sourceId}`,
      "visibility: private",
      "---",
      "",
      `# Coding-ops ${page.detail.title ?? page.detail.sourceSessionId}`,
      "",
      `Cite this session as \`${slug}\` — never a dream reflection.`,
      "",
      `Events=${digest.events.length} steering=${digest.steeringTraces.length} plans=${digest.planFiles.length}`,
      "",
      `First prompt: ${digest.firstPrompt ?? "(none)"}`,
      "",
      narrative.markdown,
      "",
    ].join("\n");
    writeMd(join(outDir, rel), md, dryRun);
    writtenPaths.push(rel);
    digestsWritten += 1;
  }

  const episodes = buildEpisodesFromDigests(digests, []);
  const scores: EpisodeScore[] = [];
  let scoresWritten = 0;
  for (const ep of episodes) {
    const scored = await scoreEpisode(ep, digests, narratives, decisions, {
      stubOnly,
    });
    scores.push(scored);
    const evidenceSessionIds = ep.sessionIds.map(
      (id) => slugBySessionId.get(id) ?? id,
    );
    const rel = `ops/episodes/${ep.id}.md`;
    const axisLines = Object.entries(scored.scores)
      .map(([axis, n]) => `- ${axis}: ${n}`)
      .join("\n");
    const md = [
      "---",
      "cortex_schema: coding-ops-episode-v1",
      `episode_id: ${ep.id}`,
      "visibility: private",
      `evidenceSessionIds: ${yamlQuote(JSON.stringify(evidenceSessionIds))}`,
      "---",
      "",
      `# ${scored.title}`,
      "",
      "## Axes",
      "",
      axisLines || "_none_",
      "",
      "## Facts",
      "",
      scored.facts,
      "",
      "## Interpretation",
      "",
      scored.interpretation,
      "",
      "## Evidence slugs",
      "",
      evidenceSessionIds.map((s) => `- \`${s}\``).join("\n"),
      "",
    ].join("\n");
    writeMd(join(outDir, rel), md, dryRun);
    writtenPaths.push(rel);
    scoresWritten += 1;
  }

  let profile: CodingBuilderProfile | null = null;
  let profileWritten = false;
  if (!options.skipProfile && digests.length > 0) {
    profile = buildCodingBuilderProfile({ digests, decisions, scores });
    const weekKey = isoWeekKey();
    const rel = `ops/profile/${weekKey}.md`;
    const remapped = {
      ...profile,
      strengths: profile.strengths.map((c) => ({
        ...c,
        evidenceSessionIds: c.evidenceSessionIds.map(
          (id) => slugBySessionId.get(id) ?? id,
        ),
      })),
      growthEdges: profile.growthEdges.map((c) => ({
        ...c,
        evidenceSessionIds: c.evidenceSessionIds.map(
          (id) => slugBySessionId.get(id) ?? id,
        ),
      })),
    };
    const md = [
      "---",
      "cortex_schema: coding-builder-profile-v1",
      `week_key: ${weekKey}`,
      "visibility: private",
      "---",
      "",
      `# Coding builder profile ${weekKey}`,
      "",
      "```json",
      JSON.stringify(remapped, null, 2),
      "```",
      "",
    ].join("\n");
    writeMd(join(outDir, rel), md, dryRun);
    writtenPaths.push(rel);
    profileWritten = true;
  }

  return {
    dryRun,
    scanned: digests.length,
    skipped,
    digestsWritten,
    episodes: episodes.length,
    scoresWritten,
    profileWritten,
    profile,
    writtenPaths,
    samples,
  };
}
