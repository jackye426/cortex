/**
 * Diff self_model_versions → self_model_diffs + howHaveIChanged (I5).
 */
import { stableSubjectUuid } from "../stable-id.js";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import type {
  SelfModelDiffRow,
  SelfModelItem,
  SelfModelVersionRow,
} from "./types.js";

function itemKey(item: SelfModelItem): string {
  return (item.statement || item.title).trim().toLowerCase();
}

function classifyItems(
  from: SelfModelItem[],
  to: SelfModelItem[],
): {
  stable: Array<Record<string, unknown>>;
  emerging: Array<Record<string, unknown>>;
  fading: Array<Record<string, unknown>>;
} {
  const fromMap = new Map(from.map((i) => [itemKey(i), i]));
  const toMap = new Map(to.map((i) => [itemKey(i), i]));
  const stable: Array<Record<string, unknown>> = [];
  const emerging: Array<Record<string, unknown>> = [];
  const fading: Array<Record<string, unknown>> = [];

  for (const [key, item] of toMap) {
    const prev = fromMap.get(key);
    if (!prev) {
      emerging.push({
        kind: "item",
        title: item.title,
        statement: item.statement,
        confidence: item.confidence,
      });
    } else {
      stable.push({
        kind: "item",
        title: item.title,
        statement: item.statement,
        confidenceDelta: item.confidence - prev.confidence,
      });
    }
  }
  for (const [key, item] of fromMap) {
    if (!toMap.has(key)) {
      fading.push({
        kind: "item",
        title: item.title,
        statement: item.statement,
        confidence: item.confidence,
      });
    }
  }
  return { stable, emerging, fading };
}

export function diffSelfModelVersions(
  from: SelfModelVersionRow | null,
  to: SelfModelVersionRow,
): Omit<SelfModelDiffRow, "id" | "ownerId" | "createdAt"> {
  const buckets = ["strengths", "limitations", "motives", "tensions"] as const;
  const stable: Array<Record<string, unknown>> = [];
  const emerging: Array<Record<string, unknown>> = [];
  const fading: Array<Record<string, unknown>> = [];

  for (const bucket of buckets) {
    const classified = classifyItems(from?.[bucket] ?? [], to[bucket] ?? []);
    for (const row of classified.stable) {
      stable.push({ bucket, ...row });
    }
    for (const row of classified.emerging) {
      emerging.push({ bucket, ...row });
    }
    for (const row of classified.fading) {
      fading.push({ bucket, ...row });
    }
  }

  return {
    fromVersionId: from?.id ?? null,
    toVersionId: to.id,
    stable,
    emerging,
    fading,
    environmentShifts: [],
    confirmedPredictions: [],
    disprovedPredictions: [],
    eventAnchors: [],
  };
}

export async function compileSelfModelDiff(
  store: CortexStore,
  options: { toVersionId?: string; dryRun?: boolean } = {},
): Promise<SelfModelDiffRow | null> {
  const versions = await store.listSelfModelVersions({ limit: 10 });
  if (!versions.length) return null;
  const to =
    (options.toVersionId
      ? versions.find((v) => v.id === options.toVersionId)
      : versions[0]) ?? null;
  if (!to) return null;
  const from =
    versions.find((v) => v.id === to.supersedesId) ??
    versions.find((v) => v.version === to.version - 1) ??
    null;

  const draft = diffSelfModelVersions(from, to);
  if (options.dryRun) {
    return {
      id: "dry-run",
      ...draft,
      createdAt: new Date().toISOString(),
    };
  }
  return store.insertSelfModelDiff(draft);
}

export async function howHaveIChanged(
  store: CortexStore,
  options: { sinceVersion?: number; writeReport?: boolean } = {},
): Promise<{
  fromVersion: number | null;
  toVersion: number | null;
  diff: SelfModelDiffRow | null;
  narrative: string;
  confidence: number;
  gaps: string[];
  distillate: DistillateRow | null;
}> {
  const versions = await store.listSelfModelVersions({ limit: 20 });
  if (versions.length < 2) {
    return {
      fromVersion: versions[0]?.version ?? null,
      toVersion: versions[0]?.version ?? null,
      diff: null,
      narrative:
        "Need at least two self-model versions to answer how you have changed with evidence.",
      confidence: 0.2,
      gaps: ["insufficient_versions"],
      distillate: null,
    };
  }

  const to = versions[0]!;
  const from =
    options.sinceVersion != null
      ? (versions.find((v) => v.version === options.sinceVersion) ??
        versions[1]!)
      : versions[1]!;

  let diff =
    (await store.listSelfModelDiffs({ toVersionId: to.id, limit: 1 }))[0] ??
    null;
  if (!diff) {
    diff = await store.insertSelfModelDiff(diffSelfModelVersions(from, to));
  }

  // Enrich with prediction confirm/disprove if available
  const preds = await store.listPredictionEvents({ limit: 40 });
  const confirmed = preds
    .filter((p) => p.correct === true)
    .slice(0, 5)
    .map((p) => ({
      claimId: p.claimId,
      predicted: p.predicted,
      actual: p.actual,
    }));
  const disproved = preds
    .filter((p) => p.correct === false)
    .slice(0, 5)
    .map((p) => ({
      claimId: p.claimId,
      predicted: p.predicted,
      actual: p.actual,
    }));

  const gaps: string[] = [];
  if (!diff.emerging.length && !diff.fading.length) {
    gaps.push("no_structural_churn");
  }
  if (diff.emerging.length && !diff.stable.length) {
    gaps.push("little_stable_anchor");
  }

  const narrative = [
    `From self-model v${from.version} → v${to.version}.`,
    diff.emerging.length
      ? `Emerging: ${diff.emerging
          .slice(0, 5)
          .map((e) => String(e.title ?? e.statement ?? "").slice(0, 80))
          .filter(Boolean)
          .join("; ")}.`
      : "No clear emerging items.",
    diff.fading.length
      ? `Fading: ${diff.fading
          .slice(0, 5)
          .map((e) => String(e.title ?? e.statement ?? "").slice(0, 80))
          .filter(Boolean)
          .join("; ")}.`
      : "No clear fading items.",
    diff.stable.length
      ? `Stable: ${diff.stable
          .slice(0, 4)
          .map((e) => String(e.title ?? "").slice(0, 60))
          .filter(Boolean)
          .join("; ")}.`
      : "",
    confirmed.length
      ? `Confirmed predictions: ${confirmed.length}.`
      : "",
    disproved.length ? `Disproved predictions: ${disproved.length}.` : "",
    gaps.length
      ? `Gaps: ${gaps.join(", ")} — narrative confidence kept low.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const confidence = gaps.length ? 0.35 : 0.65;

  let distillate: DistillateRow | null = null;
  if (options.writeReport !== false) {
    const weekKey = `v${from.version}-v${to.version}`;
    distillate = await store.upsertDistillate({
      subjectType: "self",
      subjectId: stableSubjectUuid("change-report", weekKey),
      kind: "change_report",
      content: narrative.slice(0, 4000),
      embeddingRef: null,
      embedding: null,
      model: "change-explain-v1",
      metadata: {
        twin: "I5",
        fromVersion: from.version,
        toVersion: to.version,
        diffId: diff.id,
        emerging: diff.emerging.slice(0, 10),
        fading: diff.fading.slice(0, 10),
        stable: diff.stable.slice(0, 10),
        confirmedPredictions: confirmed,
        disprovedPredictions: disproved,
        sensitivity: "reflective_sensitive",
      },
    });
  }

  return {
    fromVersion: from.version,
    toVersion: to.version,
    diff: {
      ...diff,
      confirmedPredictions: confirmed,
      disprovedPredictions: disproved,
    },
    narrative,
    confidence,
    gaps,
    distillate,
  };
}
