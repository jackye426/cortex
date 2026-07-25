/**
 * Build coding episodes from session ops digests (+ optional commit metadata).
 * Full git log collection can be layered later; v1 links via SHAs/PR/branch/time.
 */
import { createHash } from "node:crypto";
import { stableSubjectUuid } from "../stable-id.js";
import type { CodingEpisode, SessionOpsDigest } from "./types.js";

export interface CommitMeta {
  sha: string;
  subject: string;
  authorDate: string;
  insertions?: number;
  deletions?: number;
  branch?: string | null;
  prNumber?: number | null;
}

function episodeId(sessionIds: string[]): string {
  const key = [...sessionIds].sort().join(",");
  return stableSubjectUuid("coding-episode", key);
}

function classifyEpisode(title: string): string {
  const t = title.toLowerCase();
  if (t.startsWith("fix") || /\bfix\b/.test(t)) return "bugfix";
  if (t.includes("refactor")) return "refactor";
  if (t.startsWith("feat") || t.includes("add ")) return "feature";
  if (/\binfra\b|\bci\b|deploy/.test(t)) return "infrastructure";
  return "implementation";
}

function overlap(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null,
): boolean {
  if (!aStart || !bStart) return false;
  const as = Date.parse(aStart) - 60 * 60 * 1000;
  const ae = Date.parse(aEnd ?? aStart) + 60 * 60 * 1000;
  const bs = Date.parse(bStart);
  const be = Date.parse(bEnd ?? bStart);
  if (![as, ae, bs, be].every(Number.isFinite)) return false;
  return as <= be && bs <= ae;
}

export function buildEpisodesFromDigests(
  digests: SessionOpsDigest[],
  commits: CommitMeta[] = [],
): CodingEpisode[] {
  const episodes: CodingEpisode[] = [];
  const usedSessions = new Set<string>();

  // SHA / PR match first
  for (const digest of digests) {
    if (usedSessions.has(digest.sessionId)) continue;
    const shaHits = commits.filter((c) =>
      digest.gitShas.some(
        (s) => c.sha.startsWith(s) || s.startsWith(c.sha.slice(0, 7)),
      ),
    );
    const prHits =
      digest.prNumber != null
        ? commits.filter((c) => c.prNumber === digest.prNumber)
        : [];
    const hits = prHits.length ? prHits : shaHits;
    if (hits.length === 0) continue;

    const sessionIds = [digest.sessionId];
    usedSessions.add(digest.sessionId);
    const title =
      hits[0]?.subject || digest.title || digest.firstPrompt || "Episode";
    const insertions = hits.reduce((s, c) => s + (c.insertions ?? 0), 0);
    const deletions = hits.reduce((s, c) => s + (c.deletions ?? 0), 0);
    const dates = hits.map((c) => c.authorDate).filter(Boolean).sort();
    episodes.push({
      id: episodeId(sessionIds),
      episodeType: classifyEpisode(title),
      sessionIds,
      title: title.slice(0, 160),
      linkConfidence: prHits.length ? 1 : 0.9,
      windowStart: dates[0] ?? null,
      windowEnd: dates[dates.length - 1] ?? null,
      commitShas: hits.map((c) => c.sha),
      insertions,
      deletions,
      sessionOnly: false,
    });
  }

  // Branch / timestamp soft links for remaining
  for (const digest of digests) {
    if (usedSessions.has(digest.sessionId)) continue;
    const branchHits = commits.filter(
      (c) =>
        c.branch &&
        digest.gitBranches.some(
          (b) => b.toLowerCase() === c.branch!.toLowerCase(),
        ),
    );
    const timeHits = commits.filter((c) =>
      overlap(
        digest.extractedAt,
        digest.extractedAt,
        c.authorDate,
        c.authorDate,
      ),
    );
    // Prefer digest session window from title metadata — use extractedAt loosely
    const hits = branchHits.length ? branchHits.slice(0, 8) : timeHits.slice(0, 5);
    if (hits.length === 0) continue;
    // Only soft-link if we have branch match; skip pure time noise for v1
    if (!branchHits.length) continue;

    const sessionIds = [digest.sessionId];
    usedSessions.add(digest.sessionId);
    const title =
      hits[0]?.subject || digest.title || digest.firstPrompt || "Episode";
    episodes.push({
      id: episodeId(sessionIds),
      episodeType: classifyEpisode(title),
      sessionIds,
      title: title.slice(0, 160),
      linkConfidence: 0.7,
      windowStart: hits.map((c) => c.authorDate).sort()[0] ?? null,
      windowEnd:
        hits.map((c) => c.authorDate).sort().at(-1) ?? null,
      commitShas: hits.map((c) => c.sha),
      insertions: hits.reduce((s, c) => s + (c.insertions ?? 0), 0),
      deletions: hits.reduce((s, c) => s + (c.deletions ?? 0), 0),
      sessionOnly: false,
    });
  }

  // Orphan sessions → session_only episodes
  for (const digest of digests) {
    if (usedSessions.has(digest.sessionId)) continue;
    const title = digest.title || digest.firstPrompt || "Session-only episode";
    episodes.push({
      id: episodeId([digest.sessionId]),
      episodeType: classifyEpisode(title),
      sessionIds: [digest.sessionId],
      title: title.slice(0, 160),
      linkConfidence: 0.3,
      windowStart: null,
      windowEnd: null,
      commitShas: [],
      insertions: 0,
      deletions: 0,
      sessionOnly: true,
    });
  }

  return episodes;
}

/** Content hash for cache keys. */
export function hashDigests(digests: SessionOpsDigest[]): string {
  const h = createHash("sha256");
  for (const d of digests) {
    h.update(d.sessionId);
    h.update(String(d.events.length));
    h.update(d.extractedAt);
  }
  return h.digest("hex").slice(0, 16);
}
