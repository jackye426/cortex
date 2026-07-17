/**
 * Self-model compiler v2 — versioned structured model + distillate projection (I3).
 */
import { embedTexts, openaiConfigured } from "../llm.js";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import { compileAbilityModel } from "./ability-model.js";
import type {
  HypothesisRow,
  SelfModelItem,
  SelfModelVersionRow,
} from "./types.js";

const SELF_SUBJECT = "00000000-0000-4000-8000-0000000000d4";
const COMPILER = "self-model-v2";

export interface CompileSelfModelOptions {
  dryRun?: boolean;
  skipAbility?: boolean;
}

export interface CompileSelfModelResult {
  dryRun: boolean;
  version: SelfModelVersionRow | null;
  distillate: DistillateRow | null;
  written: boolean;
}

function hypToItem(h: HypothesisRow): SelfModelItem {
  return {
    id: h.id,
    title: h.domains[0] ?? "hypothesis",
    statement: h.claim,
    confidence: h.confidence,
    hypothesisId: h.id,
    domains: h.domains,
    status: h.state,
    evidenceIds: Array.isArray(h.metadata.evidenceIds)
      ? (h.metadata.evidenceIds as string[])
      : [],
  };
}

function rejectedClaimKeys(hypotheses: HypothesisRow[]): Set<string> {
  const keys = new Set<string>();
  for (const h of hypotheses) {
    if (h.state === "retired" || h.state === "disputed" || h.metadata.userRejected) {
      keys.add(h.claim.trim().toLowerCase());
    }
  }
  return keys;
}

function isRejected(
  claim: string,
  rejected: Set<string>,
  corrections: Array<Record<string, unknown>>,
): boolean {
  const key = claim.trim().toLowerCase();
  if (rejected.has(key)) return true;
  for (const c of corrections) {
    const text = String(c.claim ?? c.statement ?? "").trim().toLowerCase();
    if (text && (key.includes(text) || text.includes(key))) return true;
    if (c.verdict === "reject" && String(c.insightId ?? "") && key) {
      // handled via hypothesis state primarily
    }
  }
  return false;
}

export async function compileSelfModelVersion(
  store: CortexStore,
  options: CompileSelfModelOptions = {},
): Promise<CompileSelfModelResult> {
  const dryRun = Boolean(options.dryRun);

  if (!options.skipAbility) {
    await compileAbilityModel(store, { dryRun });
  }

  const [hypotheses, interests, records, prior, verdicts] = await Promise.all([
    store.listHypotheses({ limit: 80 }),
    store.listInterests({ limit: 60 }),
    store.listIntrapersonalRecords({ limit: 80, status: "active" }),
    store.getLatestSelfModelVersion(),
    store.listInsightVerdicts({ limit: 40 }),
  ]);

  const rejected = rejectedClaimKeys(hypotheses);
  const corrections: Array<Record<string, unknown>> = [
    ...(prior?.userCorrections ?? []),
    ...verdicts
      .filter((v) => v.verdict === "reject" || v.verdict === "refine")
      .map((v) => ({
        insightId: v.insightId,
        verdict: v.verdict,
        note: v.note,
        at: v.createdAt,
      })),
  ];

  const activeHyps = hypotheses.filter(
    (h) =>
      h.state !== "retired" &&
      h.state !== "disputed" &&
      !h.metadata.userRejected &&
      !isRejected(h.claim, rejected, corrections),
  );

  const strengths: SelfModelItem[] = records
    .filter((r) => r.recordKind === "strength")
    .filter((r) => !isRejected(r.statement, rejected, corrections))
    .map((r) => ({
      id: r.id,
      title: r.title,
      statement: r.statement,
      confidence: r.confidence,
      recordId: r.id,
      status: r.status,
    }));

  const limitations: SelfModelItem[] = records
    .filter((r) => r.recordKind === "limitation")
    .filter((r) => !isRejected(r.statement, rejected, corrections))
    .map((r) => ({
      id: r.id,
      title: r.title,
      statement: r.statement,
      confidence: r.confidence,
      recordId: r.id,
      status: r.status,
    }));

  const motives: SelfModelItem[] = [
    ...activeHyps
      .filter((h) => h.domains.includes("motive") || h.domains.includes("energy"))
      .map(hypToItem),
    ...interests
      .filter((i) => i.class === "terminal" || i.class === "aspirational")
      .slice(0, 8)
      .map((i) => ({
        id: i.id,
        title: i.displayName,
        statement: i.summary || `${i.class} interest: ${i.displayName}`,
        confidence: i.confidence,
        domains: ["interest", i.class],
        status: i.status,
      })),
  ];

  const tensions: SelfModelItem[] = activeHyps
    .filter(
      (h) =>
        h.domains.includes("tension") ||
        h.domains.includes("avoidance") ||
        h.state === "emerging",
    )
    .slice(0, 10)
    .map(hypToItem);

  const identityDevelopment: SelfModelItem[] = interests
    .filter((i) => i.class === "aspirational")
    .slice(0, 6)
    .map((i) => ({
      id: i.id,
      title: i.displayName,
      statement: i.summary || `Aspirational interest: ${i.displayName}`,
      confidence: i.confidence,
      domains: ["identity", "aspirational"],
      status: i.status,
    }));

  const openQuestionIds = activeHyps
    .filter((h) => h.state === "emerging" && h.confidence < 0.65)
    .slice(0, 12)
    .map((h) => h.id);

  const summaryParts = [
    "Self-model v2.",
    strengths.length
      ? `Strengths: ${strengths.map((s) => s.title).join("; ")}.`
      : "",
    limitations.length
      ? `Limitations: ${limitations.map((s) => s.title).join("; ")}.`
      : "",
    motives.length
      ? `Motives/interests: ${motives
          .slice(0, 6)
          .map((m) => m.title)
          .join("; ")}.`
      : "",
    tensions.length
      ? `Open tensions: ${tensions
          .slice(0, 5)
          .map((t) => t.statement.slice(0, 80))
          .join("; ")}.`
      : "No active tensions in ledger.",
    corrections.length
      ? `Applied ${corrections.length} user correction(s); rejected claims excluded.`
      : "",
  ].filter(Boolean);
  const summary = summaryParts.join(" ").slice(0, 4000);

  const nextVersion = (prior?.version ?? 0) + 1;
  const compiledFrom = {
    hypothesisIds: activeHyps.map((h) => h.id),
    recordIds: records.map((r) => r.id),
    interestIds: interests.map((i) => i.id),
    priorVersionId: prior?.id ?? null,
    compiler: COMPILER,
  };

  if (dryRun) {
    const now = new Date().toISOString();
    const version: SelfModelVersionRow = {
      id: "dry-run",
      version: nextVersion,
      summary,
      compiledFrom,
      strengths,
      limitations,
      motives,
      tensions,
      identityDevelopment,
      openQuestionIds,
      supersedesId: prior?.id ?? null,
      userCorrections: corrections,
      createdAt: now,
    };
    return {
      dryRun: true,
      version,
      distillate: {
        id: "dry-run",
        subjectType: "self",
        subjectId: SELF_SUBJECT,
        kind: "self_model",
        content: summary,
        embeddingRef: null,
        embedding: null,
        model: COMPILER,
        metadata: {
          twin: "I3",
          compilerVersion: COMPILER,
          version: nextVersion,
          structured: true,
        },
        createdAt: now,
        updatedAt: now,
      },
      written: false,
    };
  }

  const version = await store.insertSelfModelVersion({
    version: nextVersion,
    summary,
    compiledFrom,
    strengths,
    limitations,
    motives,
    tensions,
    identityDevelopment,
    openQuestionIds,
    supersedesId: prior?.id ?? null,
    userCorrections: corrections,
  });

  let embedding: number[] | null = null;
  let embeddingRef: string | null = null;
  if (openaiConfigured() && summary.trim()) {
    try {
      const [vec] = await embedTexts([summary]);
      embedding = vec ?? null;
      embeddingRef = embedding
        ? `openai:${process.env.CORTEX_EMBEDDING_MODEL?.trim() || "text-embedding-3-small"}`
        : null;
    } catch {
      // projection without embed is fine
    }
  }

  const distillate = await store.upsertDistillate({
    subjectType: "self",
    subjectId: SELF_SUBJECT,
    kind: "self_model",
    content: summary,
    embeddingRef,
    embedding,
    model: COMPILER,
    metadata: {
      twin: "I3",
      compilerVersion: COMPILER,
      versionId: version.id,
      version: version.version,
      structured: true,
      strengthCount: strengths.length,
      limitationCount: limitations.length,
      openQuestionCount: openQuestionIds.length,
      sensitivity: "reflective_sensitive",
    },
  });

  return { dryRun: false, version, distillate, written: true };
}

export async function getLatestSelfModel(store: CortexStore): Promise<{
  version: SelfModelVersionRow | null;
  distillate: DistillateRow | null;
}> {
  const [version, distillates] = await Promise.all([
    store.getLatestSelfModelVersion(),
    store.listDistillates({ limit: 1, kinds: ["self_model"] }),
  ]);
  return { version, distillate: distillates[0] ?? null };
}
