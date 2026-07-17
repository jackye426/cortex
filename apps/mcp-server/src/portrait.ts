/**
 * Versioned portrait snapshots (post quality-gate productization).
 */
import { randomUUID } from "node:crypto";
import {
  chatJsonCompletion,
  distillateModel,
  embedTexts,
  openaiConfigured,
} from "./llm.js";
import { PORTRAIT_COMPILER_VERSION } from "./eval/baseline.js";
import { stableSubjectUuid } from "./stable-id.js";
import type { CortexStore } from "./store/index.js";
import type { DistillateRow } from "./store/types.js";

export interface PortraitOptions {
  dryRun?: boolean;
  /** When true, write even if a recent portrait exists. */
  force?: boolean;
}

export interface PortraitResult {
  mode: CortexStore["mode"];
  dryRun: boolean;
  written: boolean;
  portrait: DistillateRow | null;
}

async function maybeEmbed(content: string): Promise<{
  embedding: number[] | null;
  embeddingRef: string | null;
}> {
  if (!openaiConfigured() || !content.trim()) {
    return { embedding: null, embeddingRef: null };
  }
  try {
    const [vec] = await embedTexts([content]);
    if (!vec?.length) return { embedding: null, embeddingRef: null };
    return {
      embedding: vec,
      embeddingRef: `openai:${process.env.CORTEX_EMBEDDING_MODEL?.trim() || "text-embedding-3-small"}`,
    };
  } catch {
    return { embedding: null, embeddingRef: null };
  }
}

export async function listPortraitVersions(
  store: CortexStore,
  limit = 10,
): Promise<DistillateRow[]> {
  const rows = await store.listDistillates({
    limit: Math.max(limit, 20),
    kinds: ["portrait"],
  });
  return rows
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    .slice(0, limit);
}

export async function getLatestPortrait(
  store: CortexStore,
): Promise<DistillateRow | null> {
  const versions = await listPortraitVersions(store, 1);
  return versions[0] ?? null;
}

function asItemTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const row = item as Record<string, unknown>;
      const text =
        (typeof row.statement === "string" && row.statement) ||
        (typeof row.title === "string" && row.title) ||
        (typeof row.text === "string" && row.text) ||
        "";
      if (text.trim()) out.push(text.trim());
    }
  }
  return out.slice(0, 12);
}

/**
 * Build a versioned portrait from structured self-model (v2) + supporting digests.
 * Does not overwrite prior versions.
 */
export async function refreshPortrait(
  store: CortexStore,
  options: PortraitOptions = {},
): Promise<PortraitResult> {
  const dryRun = Boolean(options.dryRun);
  const [selfModels, summaries, interests, decisions, briefs, d2, diffs] =
    await Promise.all([
      store.listSelfModelVersions({ limit: 2 }),
      store.listDistillates({ limit: 40, kinds: ["summary"] }),
      store.listDistillates({
        limit: 20,
        kinds: [
          "youtube_interest_digest",
          "spotify_interest_digest",
          "browser_interest_digest",
          "reading_interest_digest",
          "interest_map",
        ],
      }),
      store.listDistillates({ limit: 15, kinds: ["decision", "outcome"] }),
      store.listDistillates({ limit: 10, kinds: ["project_brief"] }),
      store.listDistillates({ limit: 3, kinds: ["priority_vs_actual"] }),
      store.listSelfModelDiffs({ limit: 1 }),
    ]);

  const latestModel = selfModels[0] ?? null;
  const latestDiff = diffs[0] ?? null;

  const structuredFromModel = latestModel
    ? {
        strengths: asItemTexts(latestModel.strengths),
        weaknesses: asItemTexts(latestModel.limitations),
        explorationAreas: asItemTexts(latestModel.identityDevelopment),
        tendencies: asItemTexts(latestModel.motives),
        frameworks: [],
        contradictions: asItemTexts(latestModel.tensions),
        coverage: `self-model-v${latestModel.version}`,
        summary: latestModel.summary || "Portrait from structured self-model.",
        evidenceRefs: [
          ...(Array.isArray(latestModel.compiledFrom.hypothesisIds)
            ? latestModel.compiledFrom.hypothesisIds.map(String)
            : []),
          ...summaries.slice(0, 5).map((d) => d.id),
        ].slice(0, 20),
        selfModelVersionId: latestModel.id,
        selfModelVersion: latestModel.version,
        sinceLastPortrait: latestDiff
          ? {
              emerging: latestDiff.emerging,
              fading: latestDiff.fading,
              stable: latestDiff.stable,
            }
          : null,
      }
    : null;

  const evidenceBlock = [
    latestModel
      ? `Structured self-model v${latestModel.version}:\n${latestModel.summary}\nStrengths: ${asItemTexts(latestModel.strengths).join("; ")}\nLimitations: ${asItemTexts(latestModel.limitations).join("; ")}\nMotives: ${asItemTexts(latestModel.motives).join("; ")}\nTensions: ${asItemTexts(latestModel.tensions).join("; ")}`
      : "No structured self-model yet.",
    latestDiff
      ? `Since prior version — emerging: ${JSON.stringify(latestDiff.emerging).slice(0, 300)}; fading: ${JSON.stringify(latestDiff.fading).slice(0, 300)}`
      : "",
    "Session summaries:",
    ...summaries.slice(0, 12).map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 160)}`),
    "Interest digests:",
    ...interests.map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 160)}`),
    "Decisions/outcomes:",
    ...decisions.map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 140)}`),
    "Briefs:",
    ...briefs.map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 120)}`),
    "Priority vs actual:",
    ...d2.map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 160)}`),
  ]
    .filter(Boolean)
    .join("\n");

  let content: string;
  let structured: Record<string, unknown> = structuredFromModel ?? {};
  let model = "cortex-portrait-v2-stub";

  if (openaiConfigured() && !dryRun) {
    try {
      const { text, model: m } = await chatJsonCompletion({
        system: `Synthesize a versioned self-portrait JSON from the structured self-model and evidence.
Return ONLY JSON: {
  strengths: string[],
  weaknesses: string[],
  explorationAreas: string[],
  tendencies: string[],
  frameworks: string[],
  contradictions: string[],
  coverage: string,
  summary: string,
  evidenceRefs: string[],
  deltaSinceLast: string
}
Rules: prefer structured self-model fields over free invention; every non-empty list item must be grounded; include coverage limitations; deltaSinceLast should cite emerging/fading when provided.`,
        user: evidenceBlock.slice(0, 20000),
        model: distillateModel(),
      });
      model = m;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      structured = {
        ...(structuredFromModel ?? {}),
        ...parsed,
        selfModelVersionId: latestModel?.id ?? null,
        selfModelVersion: latestModel?.version ?? null,
        sinceLastPortrait: structuredFromModel?.sinceLastPortrait ?? null,
      };
      content =
        typeof parsed.summary === "string"
          ? parsed.summary
          : structuredFromModel?.summary ?? "Portrait snapshot.";
    } catch {
      content =
        structuredFromModel?.summary ??
        `Portrait heuristic. Sessions=${summaries.length}; interests=${interests.length}; decisions=${decisions.length}.`;
      structured = structuredFromModel ?? {
        strengths: [],
        weaknesses: [],
        explorationAreas: [],
        tendencies: [],
        frameworks: [],
        contradictions: [],
        coverage: "heuristic-fallback",
        evidenceRefs: [...summaries, ...interests].slice(0, 10).map((d) => d.id),
      };
      model = "cortex-portrait-v2-heuristic";
    }
  } else {
    content =
      structuredFromModel?.summary ??
      `Portrait heuristic. Sessions=${summaries.length}; interests=${interests.length}.`;
    structured = structuredFromModel ?? {
      strengths: [],
      weaknesses: [],
      explorationAreas: [],
      tendencies: [],
      frameworks: [],
      contradictions: [],
      coverage: dryRun ? "dry-run" : "stub",
      evidenceRefs: summaries.slice(0, 5).map((d) => d.id),
    };
  }

  const versionKey = `portrait-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const subjectId = stableSubjectUuid("portrait", versionKey);
  const latest = await getLatestPortrait(store);
  const { embedding, embeddingRef } =
    dryRun || !openaiConfigured()
      ? { embedding: null, embeddingRef: null }
      : await maybeEmbed(content);

  const draft = {
    subjectType: "self",
    subjectId,
    kind: "portrait",
    content,
    embeddingRef,
    embedding,
    model,
    metadata: {
      domains: ["work", "interest"],
      sourceType: "portrait",
      compilerVersion: PORTRAIT_COMPILER_VERSION,
      version: versionKey,
      supersedesId: latest?.id ?? null,
      /** Stronger than ordinary distillates — see mirror-privilege-plan. */
      sensitivity: "reflective_sensitive",
      evidenceClasses: ["distillate", "self_model_version"],
      excludesBrokerExcerpts: true,
      ...structured,
      twin: "portrait",
      portraitFromSelfModel: Boolean(latestModel),
    },
  };

  if (dryRun) {
    const now = new Date().toISOString();
    return {
      mode: store.mode,
      dryRun,
      written: false,
      portrait: { id: "dry-run", ...draft, createdAt: now, updatedAt: now },
    };
  }

  const row = await store.upsertDistillate(draft);
  return { mode: store.mode, dryRun, written: true, portrait: row };
}
