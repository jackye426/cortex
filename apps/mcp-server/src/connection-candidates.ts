/**
 * Sparse cross-source connection candidates (ephemeral ranking).
 */

import { cosineSimilarity } from "./store/search-helpers.js";
import { normalizeTopic } from "./store/memory-lenses.js";

export interface CandidateMemory {
  id: string;
  kind: string;
  sourceType: string;
  content: string;
  topics: string[];
  projects: string[];
  occurredAt?: string | null;
  embedding?: number[] | null;
  domain?: string;
}

export interface ConnectionCandidate {
  a: CandidateMemory;
  b: CandidateMemory;
  score: number;
  reasons: string[];
  components: {
    topicOverlap: number;
    semantic: number;
    temporal: number;
    projectOverlap: number;
    crossSource: number;
  };
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a.map(normalizeTopic).filter(Boolean));
  const B = new Set(b.map(normalizeTopic).filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function temporalScore(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  const days = Math.abs(da - db) / (1000 * 60 * 60 * 24);
  if (days <= 3) return 1;
  if (days <= 14) return 0.6;
  if (days <= 45) return 0.3;
  return 0;
}

/**
 * Rank pairs across different source types by default.
 * Generic single-topic overlap alone stays low-confidence.
 */
export function rankConnectionCandidates(
  items: CandidateMemory[],
  options: { limit?: number; requireCrossSource?: boolean } = {},
): ConnectionCandidate[] {
  const limit = options.limit ?? 12;
  const requireCross = options.requireCrossSource !== false;
  const out: ConnectionCandidate[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const crossSource = a.sourceType !== b.sourceType ? 1 : 0;
      if (requireCross && !crossSource) continue;

      const topicOverlap = jaccard(a.topics, b.topics);
      const projectOverlap = jaccard(a.projects, b.projects);
      const semantic =
        a.embedding?.length && b.embedding?.length
          ? Math.max(0, cosineSimilarity(a.embedding, b.embedding))
          : 0;
      const temporal = temporalScore(a.occurredAt, b.occurredAt);

      // Generic topic alone should not dominate
      let topicWeight = topicOverlap >= 0.34 ? topicOverlap : topicOverlap * 0.35;
      const sharedTopics = a.topics
        .map(normalizeTopic)
        .filter((t) => t && b.topics.map(normalizeTopic).includes(t));
      // Single shared topic with no other corroboration stays low-confidence
      if (
        sharedTopics.length <= 1 &&
        semantic < 0.35 &&
        projectOverlap === 0 &&
        temporal < 0.3
      ) {
        topicWeight *= 0.2;
      }

      const score =
        topicWeight * 0.35 +
        semantic * 0.3 +
        temporal * 0.15 +
        projectOverlap * 0.15 +
        crossSource * 0.15;

      const reasons: string[] = [];
      if (topicOverlap > 0) {
        reasons.push(`shared topics (${topicOverlap.toFixed(2)})`);
      }
      if (semantic > 0.35) reasons.push(`semantic similarity ${semantic.toFixed(2)}`);
      if (temporal > 0) reasons.push(`temporal proximity ${temporal.toFixed(2)}`);
      if (projectOverlap > 0) reasons.push(`shared projects`);
      if (crossSource) reasons.push(`cross-source ${a.sourceType}↔${b.sourceType}`);

      // Require more than a single weak signal
      if (score < 0.28) continue;
      if (topicOverlap > 0 && topicOverlap < 0.2 && semantic < 0.4 && projectOverlap === 0) {
        continue;
      }
      if (
        sharedTopics.length <= 1 &&
        semantic < 0.35 &&
        projectOverlap === 0 &&
        temporal < 0.3
      ) {
        continue;
      }

      out.push({
        a,
        b,
        score,
        reasons,
        components: {
          topicOverlap,
          semantic,
          temporal,
          projectOverlap,
          crossSource,
        },
      });
    }
  }

  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}
