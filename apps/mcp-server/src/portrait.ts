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

/**
 * Build a versioned portrait from repeated evidence. Does not overwrite prior versions.
 */
export async function refreshPortrait(
  store: CortexStore,
  options: PortraitOptions = {},
): Promise<PortraitResult> {
  const dryRun = Boolean(options.dryRun);
  const [summaries, interests, decisions, briefs, d2] = await Promise.all([
    store.listDistillates({ limit: 40, kinds: ["summary"] }),
    store.listDistillates({
      limit: 20,
      kinds: ["youtube_interest_digest", "spotify_interest_digest"],
    }),
    store.listDistillates({ limit: 15, kinds: ["decision", "outcome"] }),
    store.listDistillates({ limit: 10, kinds: ["project_brief"] }),
    store.listDistillates({ limit: 3, kinds: ["priority_vs_actual"] }),
  ]);

  const evidenceBlock = [
    "Session summaries:",
    ...summaries.slice(0, 20).map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 180)}`),
    "Interest digests:",
    ...interests.map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 180)}`),
    "Decisions/outcomes:",
    ...decisions.map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 160)}`),
    "Briefs:",
    ...briefs.map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 140)}`),
    "Priority vs actual:",
    ...d2.map((d) => `- ${d.id}: ${(d.content ?? "").slice(0, 200)}`),
  ].join("\n");

  let content: string;
  let structured: Record<string, unknown> = {};
  let model = "cortex-portrait-stub";

  if (openaiConfigured() && !dryRun) {
    try {
      const { text, model: m } = await chatJsonCompletion({
        system: `Synthesize a versioned self-portrait JSON from evidence.
Return ONLY JSON: {
  strengths: string[],
  weaknesses: string[],
  explorationAreas: string[],
  tendencies: string[],
  frameworks: string[],
  contradictions: string[],
  coverage: string,
  summary: string,
  evidenceRefs: string[]
}
Rules: every non-empty list item must be grounded; prefer recurring multi-window evidence; label weak items carefully; include coverage limitations.`,
        user: evidenceBlock.slice(0, 20000),
        model: distillateModel(),
      });
      model = m;
      structured = JSON.parse(text) as Record<string, unknown>;
      content =
        typeof structured.summary === "string"
          ? structured.summary
          : "Portrait snapshot.";
    } catch {
      content = `Portrait heuristic. Sessions=${summaries.length}; interests=${interests.length}; decisions=${decisions.length}.`;
      structured = {
        strengths: [],
        weaknesses: [],
        explorationAreas: interests
          .flatMap((d) =>
            Array.isArray(d.metadata.topics) ? d.metadata.topics : [],
          )
          .filter((x): x is string => typeof x === "string")
          .slice(0, 8),
        tendencies: [],
        frameworks: [],
        contradictions: [],
        coverage: "heuristic-fallback",
        evidenceRefs: [...summaries, ...interests].slice(0, 10).map((d) => d.id),
      };
    }
  } else {
    content = `Portrait heuristic. Sessions=${summaries.length}; interests=${interests.length}.`;
    structured = {
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
      sensitivity: "private",
      ...structured,
      twin: "portrait",
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
