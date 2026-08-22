/**
 * LLM-ops compiler over text transcript pages (ChatGPT). Separate from coding-ops.
 * Stock GBrain transcript ingest is OK here (no tools required).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parsePagesInDir,
  type SessionDetail as PageSession,
} from "@cortex/gbrain-session-page";
import { isoWeekKey } from "../week-helpers.js";
import type { SessionDetail } from "../store/types.js";
import { deriveLlmDecisions, extractLlmOps } from "./extract-events.js";
import { buildLlmEpisodes } from "./episodes.js";
import { buildLlmOperatorProfile } from "./profile.js";
import { scoreLlmEpisode } from "./score-episode.js";
import type { LlmDecision, LlmEpisodeScore, LlmOpsDigest } from "./types.js";
import { isCodingOpsSource, isLlmOpsSource } from "./types.js";

export interface RunLlmOpsFromPagesOptions {
  pagesDir: string;
  outDir?: string;
  dryRun?: boolean;
  skipProfile?: boolean;
}

export interface RunLlmOpsFromPagesResult {
  dryRun: boolean;
  scanned: number;
  skipped: number;
  digestsWritten: number;
  episodes: number;
  scoresWritten: number;
  profileWritten: boolean;
  writtenPaths: string[];
  samples: Array<{ sessionId: string; slug: string; sourceId: string }>;
}

function toStoreDetail(page: PageSession): SessionDetail {
  return { ...page, distillate: null };
}

function writeMd(abs: string, body: string, dryRun: boolean): void {
  if (dryRun) return;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

export async function runLlmOpsFromPages(
  options: RunLlmOpsFromPagesOptions,
): Promise<RunLlmOpsFromPagesResult> {
  const dryRun = Boolean(options.dryRun);
  const outDir = options.outDir ?? options.pagesDir;
  const pages = parsePagesInDir(options.pagesDir);
  const digests: LlmOpsDigest[] = [];
  const decisions: LlmDecision[] = [];
  const slugById = new Map<string, string>();
  const samples: RunLlmOpsFromPagesResult["samples"] = [];
  const writtenPaths: string[] = [];
  let skipped = 0;
  let digestsWritten = 0;

  for (const page of pages) {
    if (isCodingOpsSource(page.detail.sourceId)) {
      skipped += 1;
      continue;
    }
    if (!isLlmOpsSource(page.detail.sourceId)) {
      skipped += 1;
      continue;
    }
    const detail = toStoreDetail(page.detail);
    const slug = page.relativePath.replace(/\.md$/, "");
    const digest = extractLlmOps(detail);
    slugById.set(digest.sessionId, slug);
    samples.push({
      sessionId: digest.sessionId,
      slug,
      sourceId: digest.sourceId,
    });
    if (digest.skipReason) {
      skipped += 1;
      continue;
    }
    digests.push(digest);
    const rel = `ops/llm/sessions/${page.detail.sourceId}/${page.detail.sourceSessionId}.md`;
    writeMd(
      join(outDir, rel),
      [
        "---",
        "cortex_schema: llm-ops-session-v1",
        `slug: ${JSON.stringify(slug)}`,
        "visibility: private",
        "---",
        "",
        `# LLM-ops ${page.detail.title ?? page.detail.sourceSessionId}`,
        "",
        `Cite \`${slug}\`. Text-only transcripts are sufficient for llm-ops.`,
        "",
        `context=${digest.context} events=${digest.events.length}`,
        "",
      ].join("\n"),
      dryRun,
    );
    writtenPaths.push(rel);
    digestsWritten += 1;
  }

  const episodes = buildLlmEpisodes(digests);
  for (const d of digests) {
    const ep = episodes.find((e) => e.sessionIds.includes(d.sessionId));
    decisions.push(...deriveLlmDecisions(d, ep?.id ?? null));
  }

  const scores: LlmEpisodeScore[] = [];
  let scoresWritten = 0;
  for (const ep of episodes) {
    const scored = scoreLlmEpisode(ep, digests, decisions);
    scores.push(scored);
    const evidence = ep.sessionIds.map((id) => slugById.get(id) ?? id);
    const rel = `ops/llm/episodes/${ep.id}.md`;
    writeMd(
      join(outDir, rel),
      [
        "---",
        "cortex_schema: llm-ops-episode-v1",
        `evidenceSessionIds: ${JSON.stringify(JSON.stringify(evidence))}`,
        "visibility: private",
        "---",
        "",
        `# ${scored.title}`,
        "",
        "## Axes",
        "",
        Object.entries(scored.scores)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n"),
        "",
        "## Evidence slugs",
        "",
        evidence.map((s) => `- \`${s}\``).join("\n"),
        "",
      ].join("\n"),
      dryRun,
    );
    writtenPaths.push(rel);
    scoresWritten += 1;
  }

  let profileWritten = false;
  if (!options.skipProfile && digests.length > 0) {
    const profile = buildLlmOperatorProfile({
      digests,
      decisions,
      scores,
      skipped,
    });
    const weekKey = isoWeekKey();
    const rel = `ops/llm/profile/${weekKey}.md`;
    writeMd(
      join(outDir, rel),
      [
        "---",
        "cortex_schema: llm-operator-profile-v1",
        `week_key: ${weekKey}`,
        "visibility: private",
        "---",
        "",
        `# LLM operator profile ${weekKey}`,
        "",
        "```json",
        JSON.stringify(profile, null, 2),
        "```",
        "",
      ].join("\n"),
      dryRun,
    );
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
    writtenPaths,
    samples,
  };
}
