/**
 * Source-balanced retrieval — prevent AI session flood from drowning quieter signals.
 */
import type { MemorySearchHit } from "../store/types.js";
import {
  familyFromDistillateKind,
  familyFromRecordType,
  familyFromSourceId,
  independenceGroupForHit,
  supportKindForDistillateKind,
} from "./source-family.js";
import type { AnnotatedMemoryHit, SourceFamily } from "./types.js";

export interface BalanceOptions {
  /** Final evidence budget. */
  limit?: number;
  /** Max items kept from each source family before fill. */
  perFamily?: number;
  /** Candidate pool size before balancing (caller may pass pre-trimmed hits). */
  candidateLimit?: number;
}

export function annotateMemoryHit(hit: MemorySearchHit): AnnotatedMemoryHit {
  const distillateKind = hit.distillateKind;
  const recordType = hit.recordType;
  let sourceFamily: SourceFamily = "other";
  if (distillateKind) {
    sourceFamily = familyFromDistillateKind(distillateKind);
  } else if (recordType) {
    sourceFamily = familyFromRecordType(recordType);
  } else if (hit.sourceId) {
    sourceFamily = familyFromSourceId(hit.sourceId);
  }

  const supportKind = distillateKind
    ? supportKindForDistillateKind(distillateKind)
    : "direct_observation";

  return {
    id: hit.id,
    kind: distillateKind ?? recordType ?? hit.kind,
    title: hit.title,
    snippet: hit.snippet,
    score: hit.score,
    evidenceStrength: hit.kind === "distillate" ? "distillate" : "keyword_only",
    sourceFamily,
    independenceGroup: independenceGroupForHit({
      sourceFamily,
      sourceId: hit.sourceId,
      distillateKind,
      subjectId: hit.subjectId,
    }),
    supportKind,
    distillateKind,
    recordType,
    subjectType: hit.subjectType,
    subjectId: hit.subjectId,
  };
}

/**
 * Bucket by source family, take top perFamily from each, then fill by score.
 */
export function balanceMemoryHits(
  hits: MemorySearchHit[],
  options: BalanceOptions = {},
): AnnotatedMemoryHit[] {
  const limit = options.limit ?? 12;
  const perFamily = options.perFamily ?? 3;
  const annotated = hits
    .slice(0, options.candidateLimit ?? 40)
    .map(annotateMemoryHit)
    .sort((a, b) => b.score - a.score);

  const byFamily = new Map<SourceFamily, AnnotatedMemoryHit[]>();
  for (const hit of annotated) {
    const bucket = byFamily.get(hit.sourceFamily) ?? [];
    bucket.push(hit);
    byFamily.set(hit.sourceFamily, bucket);
  }

  const selected: AnnotatedMemoryHit[] = [];
  const selectedIds = new Set<string>();

  for (const bucket of byFamily.values()) {
    for (const hit of bucket.slice(0, perFamily)) {
      if (selected.length >= limit) break;
      if (selectedIds.has(hit.id)) continue;
      selected.push(hit);
      selectedIds.add(hit.id);
    }
  }

  for (const hit of annotated) {
    if (selected.length >= limit) break;
    if (selectedIds.has(hit.id)) continue;
    selected.push(hit);
    selectedIds.add(hit.id);
  }

  return selected;
}

export function familyHistogram(
  hits: AnnotatedMemoryHit[],
): Record<string, number> {
  const hist: Record<string, number> = {};
  for (const h of hits) {
    hist[h.sourceFamily] = (hist[h.sourceFamily] ?? 0) + 1;
  }
  return hist;
}
