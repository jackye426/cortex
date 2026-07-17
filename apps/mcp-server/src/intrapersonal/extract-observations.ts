/**
 * Extract durable factual observations from distillates (no psychology).
 */
import { createHash } from "node:crypto";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import {
  familyFromDistillateKind,
  supportKindForDistillateKind,
} from "./source-family.js";
import type {
  ObservationRow,
  SourceFamily,
  UpsertObservationInput,
} from "./types.js";

export interface ExtractObservationsOptions {
  limit?: number;
  dryRun?: boolean;
  kinds?: string[];
}

export interface ExtractObservationsResult {
  scanned: number;
  written: number;
  skipped: number;
  dryRun: boolean;
  samples: Array<{ statement: string; sourceFamily: SourceFamily }>;
}

function hashStatement(
  statement: string,
  sourceFamily: string,
  distillateId: string,
): string {
  return createHash("sha256")
    .update(`${sourceFamily}\n${distillateId}\n${statement.trim().toLowerCase()}`)
    .digest("hex");
}

function asSignalTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const text = (item as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim()) out.push(text.trim());
    }
  }
  return out;
}

function topicsFromMeta(meta: Record<string, unknown>): string[] {
  if (!Array.isArray(meta.topics)) return [];
  return meta.topics.filter((t): t is string => typeof t === "string");
}

function candidatesFromDistillate(d: DistillateRow): UpsertObservationInput[] {
  const sourceFamily = familyFromDistillateKind(d.kind);
  const supportKind = supportKindForDistillateKind(d.kind);
  const sessionId = d.subjectType === "session" ? d.subjectId : null;
  const baseMeta = {
    distillateKind: d.kind,
    topics: topicsFromMeta(d.metadata),
  };
  const out: UpsertObservationInput[] = [];

  const push = (
    statement: string,
    epistemicType: "observation" | "self_report",
    confidence: number,
    extra?: Record<string, unknown>,
  ) => {
    const trimmed = statement.trim();
    if (trimmed.length < 8 || trimmed.length > 500) return;
    // Skip speculative / psychological language at extract time.
    if (
      /\b(maybe|might be|suggests that|personality|unconscious|trauma)\b/i.test(
        trimmed,
      )
    ) {
      return;
    }
    out.push({
      epistemicType,
      statement: trimmed,
      sourceFamily,
      independenceGroup: `${sourceFamily}:${d.kind}`,
      occurredAt: d.updatedAt,
      distillateId: d.id,
      sessionId,
      supportKind:
        epistemicType === "self_report" ? "self_report" : supportKind,
      confidence,
      metadata: { ...baseMeta, ...extra },
      contentHash: hashStatement(trimmed, sourceFamily, d.id),
    });
  };

  if (d.kind === "summary") {
    for (const text of asSignalTexts(d.metadata.explorationSignals)) {
      push(text, "observation", 0.6, { signal: "exploration" });
    }
    for (const text of asSignalTexts(d.metadata.demonstratedBehaviors)) {
      push(text, "observation", 0.65, { signal: "behavior" });
    }
    for (const text of asSignalTexts(d.metadata.frictionSignals)) {
      push(text, "observation", 0.6, { signal: "friction" });
    }
    for (const text of asSignalTexts(d.metadata.commitments)) {
      push(text, "self_report", 0.55, { signal: "commitment" });
    }
  }

  if (
    d.kind === "youtube_interest_digest" ||
    d.kind === "spotify_interest_digest" ||
    d.kind === "browser_interest_digest" ||
    d.kind === "reading_interest_digest"
  ) {
    for (const topic of topicsFromMeta(d.metadata).slice(0, 8)) {
      push(
        `Recurring ${d.kind.replace(/_interest_digest$/, "").replace(/_/g, " ")} theme: ${topic}`,
        "observation",
        typeof d.metadata.confidence === "number" ? d.metadata.confidence : 0.55,
        { signal: "interest_topic" },
      );
    }
    for (const text of asSignalTexts(d.metadata.recurring).slice(0, 6)) {
      push(text, "observation", 0.6, { signal: "recurring" });
    }
  }

  if (d.kind === "decision" || d.kind === "outcome") {
    const title =
      typeof d.metadata.title === "string" ? d.metadata.title : null;
    const firstLine = (d.content ?? "").split("\n").find((l) => l.trim());
    const statement = title ?? firstLine;
    if (statement) {
      push(
        statement,
        d.kind === "decision" ? "self_report" : "observation",
        0.7,
        { signal: d.kind },
      );
    }
  }

  if (d.kind === "github_outcome_digest") {
    const outcome =
      typeof d.metadata.outcome === "string" ? d.metadata.outcome : null;
    const firstLine = (d.content ?? "").split("\n").find((l) => l.trim());
    if (firstLine) {
      push(
        outcome ? `${firstLine} (outcome=${outcome})` : firstLine,
        "observation",
        0.65,
        { signal: "github_outcome" },
      );
    }
  }

  return out;
}

export async function extractObservations(
  store: CortexStore,
  options: ExtractObservationsOptions = {},
): Promise<ExtractObservationsResult> {
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit ?? 80;
  const kinds =
    options.kinds ??
    [
      "summary",
      "youtube_interest_digest",
      "spotify_interest_digest",
      "browser_interest_digest",
      "reading_interest_digest",
      "decision",
      "outcome",
      "github_outcome_digest",
    ];

  const distillates = await store.listDistillates({ limit, kinds });
  let written = 0;
  let skipped = 0;
  const samples: ExtractObservationsResult["samples"] = [];

  for (const d of distillates) {
    const candidates = candidatesFromDistillate(d);
    if (candidates.length === 0) {
      skipped += 1;
      continue;
    }
    for (const cand of candidates) {
      samples.push({
        statement: cand.statement,
        sourceFamily: cand.sourceFamily,
      });
      if (dryRun) {
        written += 1;
        continue;
      }
      const row: ObservationRow = await store.upsertObservation(cand);
      if (row) written += 1;
    }
  }

  return {
    scanned: distillates.length,
    written,
    skipped,
    dryRun,
    samples: samples.slice(0, 12),
  };
}
