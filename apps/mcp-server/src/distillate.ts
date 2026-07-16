import {
  chatJsonCompletion,
  distillateModel,
  embedTexts,
  openaiConfigured,
} from "./llm.js";
import { SESSION_COMPILER_VERSION } from "./eval/baseline.js";
import { normalizeTopic } from "./store/memory-lenses.js";
import type { CortexStore } from "./store/index.js";
import type {
  DistillateRow,
  SampledTurnInput,
  SessionEnvelopeInput,
} from "./store/types.js";
import { turnsToExcerpts } from "./session-sampler.js";

export interface DistillateRunOptions {
  /** Max sessions to process (default 20). */
  limit?: number;
  /** When true, skip store writes and only return computed rows. */
  dryRun?: boolean;
  /** Override model label stored on distillate rows. */
  model?: string;
  /** Force heuristic stub even when OPENAI_API_KEY is set. */
  stubOnly?: boolean;
  /** Skip sessions that already have kind=summary distillate (default true). */
  skipDistilled?: boolean;
}

export interface DistillateRunResult {
  mode: CortexStore["mode"];
  dryRun: boolean;
  processed: number;
  written: number;
  distillates: DistillateRow[];
  engine: "llm" | "stub";
}

export interface EvidencedSignal {
  text: string;
  evidenceIndices: number[];
  confidence: number;
}

export interface StructuredDistillate {
  summary: string;
  projects: string[];
  repos: string[];
  nextActions: string[];
  commercialVsTech: string;
  openQuestions: string[];
  topics: string[];
  explicitCommitments: string[];
  decisions: string[];
  explorationSignals: EvidencedSignal[];
  demonstratedBehaviors: EvidencedSignal[];
  frictionSignals: EvidencedSignal[];
}

const DISTILLATE_SYSTEM = `You distill an AI coding/work session into structured JSON for a personal executive twin.
Return ONLY a JSON object with keys:
- summary (string, 2-5 sentences, actionable)
- projects (string array)
- repos (string array)
- nextActions (string array)
- commercialVsTech (string: commercial | tech | mixed | unknown)
- openQuestions (string array)
- topics (string array of normalized themes)
- explicitCommitments (string array of explicit user commitments)
- decisions (string array of explicit decisions made)
- explorationSignals (array of { text, evidenceIndices, confidence })
- demonstratedBehaviors (array of { text, evidenceIndices, confidence })
- frictionSignals (array of { text, evidenceIndices, confidence })

Rules:
- Be faithful to the evidence; do not invent repos or projects not suggested by the text.
- evidenceIndices refer to the [#N] message indices in the prompt.
- Describe observable behavior only — do NOT infer avoidance, motivation, emotional state, or stable personality.
- Distinguish user behavior from assistant/tool behavior.
- Return empty arrays when evidence is weak.
- Messages are stratified samples (first/middle/last/tool-heavy), not the full transcript.`;

/**
 * Heuristic fallback when no OpenAI-compatible key is configured.
 */
export function summarizeSessionEnvelope(
  session: SessionEnvelopeInput,
): string {
  const title = session.title?.trim() || session.sourceSessionId;
  const bits: string[] = [
    `Session ${title} (${session.sourceId}/${session.sourceSessionId}).`,
  ];
  if (session.workspace) {
    bits.push(`Workspace: ${session.workspace}.`);
  }
  if (session.startedAt) {
    bits.push(`Started ${session.startedAt}.`);
  }
  if (session.endedAt) {
    bits.push(`Ended ${session.endedAt}.`);
  }
  const excerpts = (session.excerpts ?? [])
    .map((e) => e.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (excerpts.length) {
    bits.push(
      "Excerpts: " +
        excerpts.map((e) => e.slice(0, 160).replace(/\s+/g, " ")).join(" | "),
    );
  } else {
    bits.push("No message excerpts available; summary is metadata-only.");
  }
  return bits.join(" ");
}

function subjectIdFor(session: SessionEnvelopeInput): string {
  const meta = session.metadata ?? {};
  if (typeof meta.sessionId === "string" && meta.sessionId) {
    return meta.sessionId;
  }
  return `${session.sourceId}:${session.sourceSessionId}`;
}

/** Strip NUL + lone UTF-16 surrogates (break Morph/JSON upstream otherwise). */
function sanitizeUtf16(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i += 1;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += text[i]!;
  }
  return out;
}

function buildUserPrompt(session: SessionEnvelopeInput): string {
  const sampled = session.sampledTurns ?? [];
  const excerpts =
    sampled.length > 0
      ? turnsToExcerpts(sampled)
      : (session.excerpts ?? []).slice(0, 30);

  const parts = [
    `source: ${session.sourceId}`,
    `sourceSessionId: ${session.sourceSessionId}`,
    `title: ${session.title ?? ""}`,
    `workspace: ${session.workspace ?? ""}`,
    `startedAt: ${session.startedAt ?? ""}`,
    `endedAt: ${session.endedAt ?? ""}`,
    `turnCount: ${session.turnCount ?? sampled.length ?? ""}`,
    `sampleStrategy: ${JSON.stringify(session.sampleStrategy ?? null)}`,
    `pathsTouched: ${(session.pathsTouched ?? []).slice(0, 30).join(", ")}`,
    `commands: ${(session.commands ?? []).slice(0, 20).join(", ")}`,
    "",
    "Messages / excerpts (indexed):",
    ...excerpts.map((e, i) => `${i + 1}. ${e}`),
    "",
    "Tools:",
    ...(session.toolSummaries ?? []).slice(0, 25).map((t, i) => `${i + 1}. ${t}`),
  ];
  return sanitizeUtf16(parts.join("\n").slice(0, 24000));
}

function parseEvidencedSignals(v: unknown): EvidencedSignal[] {
  if (!Array.isArray(v)) return [];
  const out: EvidencedSignal[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) continue;
    const evidenceIndices = Array.isArray(row.evidenceIndices)
      ? row.evidenceIndices.filter((n): n is number => typeof n === "number")
      : [];
    const confidence =
      typeof row.confidence === "number"
        ? row.confidence
        : Number(row.confidence ?? 0.5);
    out.push({
      text,
      evidenceIndices,
      confidence: Number.isFinite(confidence) ? confidence : 0.5,
    });
  }
  return out;
}

function parseStructured(raw: string): StructuredDistillate {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {
      summary: raw.slice(0, 2000) || "Unparseable distillate.",
      projects: [],
      repos: [],
      nextActions: [],
      commercialVsTech: "unknown",
      openQuestions: [],
      topics: [],
      explicitCommitments: [],
      decisions: [],
      explorationSignals: [],
      demonstratedBehaviors: [],
      frictionSignals: [],
    };
  }
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  return {
    summary:
      typeof parsed.summary === "string"
        ? parsed.summary
        : "Session distillate missing summary field.",
    projects: asStringArray(parsed.projects),
    repos: asStringArray(parsed.repos),
    nextActions: asStringArray(parsed.nextActions),
    commercialVsTech:
      typeof parsed.commercialVsTech === "string"
        ? parsed.commercialVsTech
        : "unknown",
    openQuestions: asStringArray(parsed.openQuestions),
    topics: asStringArray(parsed.topics).map(normalizeTopic).filter(Boolean),
    explicitCommitments: asStringArray(parsed.explicitCommitments),
    decisions: asStringArray(parsed.decisions),
    explorationSignals: parseEvidencedSignals(parsed.explorationSignals),
    demonstratedBehaviors: parseEvidencedSignals(parsed.demonstratedBehaviors),
    frictionSignals: parseEvidencedSignals(parsed.frictionSignals),
  };
}

export async function distillSession(
  session: SessionEnvelopeInput,
  options: { model?: string; stubOnly?: boolean } = {},
): Promise<{
  content: string;
  metadata: Record<string, unknown>;
  model: string;
  engine: "llm" | "stub";
}> {
  const useLlm = openaiConfigured() && !options.stubOnly;
  const sampleMeta = {
    sampleStrategy: session.sampleStrategy ?? null,
    turnCount: session.turnCount ?? session.sampledTurns?.length ?? null,
    sampledIndices: (session.sampledTurns ?? []).map((t) => t.index),
    metadataOnly: Boolean(session.metadata?.metadataOnly),
  };

  if (!useLlm) {
    const content = summarizeSessionEnvelope(session);
    return {
      content,
      metadata: {
        sourceId: session.sourceId,
        sourceSessionId: session.sourceSessionId,
        sourceType: session.sourceId,
        domains: ["work"],
        domain: "work",
        stub: true,
        projects: [],
        repos: [],
        nextActions: [],
        commercialVsTech: "unknown",
        openQuestions: [],
        topics: [],
        explicitCommitments: [],
        decisions: [],
        explorationSignals: [],
        demonstratedBehaviors: [],
        frictionSignals: [],
        compilerVersion: SESSION_COMPILER_VERSION,
        confidence: 0.4,
        ...sampleMeta,
      },
      model: options.model ?? "cortex-distillate-stub",
      engine: "stub",
    };
  }

  try {
    const { text, model } = await chatJsonCompletion({
      system: DISTILLATE_SYSTEM,
      user: buildUserPrompt(session),
      model: options.model ?? distillateModel(),
    });
    const structured = parseStructured(text);
    const embedTopics = structured.topics.slice(0, 8);

    return {
      content: structured.summary,
      metadata: {
        sourceId: session.sourceId,
        sourceSessionId: session.sourceSessionId,
        sourceType: session.sourceId,
        domains: ["work"],
        domain: "work",
        stub: false,
        projects: structured.projects,
        repos: structured.repos,
        nextActions: structured.nextActions,
        commercialVsTech: structured.commercialVsTech,
        openQuestions: structured.openQuestions,
        topics: structured.topics,
        explicitCommitments: structured.explicitCommitments,
        decisions: structured.decisions,
        explorationSignals: structured.explorationSignals,
        demonstratedBehaviors: structured.demonstratedBehaviors,
        frictionSignals: structured.frictionSignals,
        compilerVersion: SESSION_COMPILER_VERSION,
        confidence: 0.75,
        embedAugment: embedTopics,
        ...sampleMeta,
      },
      model,
      engine: "llm",
    };
  } catch (err) {
    console.warn(
      `[distillate] LLM failed for ${session.sourceId}:${session.sourceSessionId}; using stub:`,
      err instanceof Error ? err.message : err,
    );
    const content = summarizeSessionEnvelope(session);
    return {
      content,
      metadata: {
        sourceId: session.sourceId,
        sourceSessionId: session.sourceSessionId,
        sourceType: session.sourceId,
        domains: ["work"],
        domain: "work",
        stub: true,
        llmError: true,
        projects: [],
        repos: [],
        nextActions: [],
        commercialVsTech: "unknown",
        openQuestions: [],
        topics: [],
        explicitCommitments: [],
        decisions: [],
        explorationSignals: [],
        demonstratedBehaviors: [],
        frictionSignals: [],
        compilerVersion: SESSION_COMPILER_VERSION,
        confidence: 0.35,
        ...sampleMeta,
      },
      model: options.model ?? "cortex-distillate-stub",
      engine: "stub",
    };
  }
}

async function maybeEmbed(
  content: string,
): Promise<{ embedding: number[] | null; embeddingRef: string | null }> {
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
  } catch (err) {
    console.warn(
      "[distillate] embed failed:",
      err instanceof Error ? err.message : err,
    );
    return { embedding: null, embeddingRef: null };
  }
}

export async function runDistillateWorker(
  store: CortexStore,
  options: DistillateRunOptions = {},
): Promise<DistillateRunResult> {
  const limit = options.limit ?? 20;
  const dryRun = Boolean(options.dryRun);
  const engine: "llm" | "stub" =
    openaiConfigured() && !options.stubOnly ? "llm" : "stub";

  const sessions = await store.listSessionsForDistillate(limit, {
    skipDistilled: options.skipDistilled !== false,
  });
  const distillates: DistillateRow[] = [];
  let written = 0;

  for (const session of sessions) {
    const distilled = await distillSession(session, {
      model: options.model,
      stubOnly: options.stubOnly,
    });
    const embedSource = [
      distilled.content,
      ...((distilled.metadata.embedAugment as string[] | undefined) ?? []).map(
        (t) => `topic:${t}`,
      ),
    ].join("\n");
    const { embedding, embeddingRef } = dryRun
      ? { embedding: null, embeddingRef: null }
      : await maybeEmbed(embedSource);

    const draft = {
      subjectType: "session",
      subjectId: subjectIdFor(session),
      kind: "summary",
      content: distilled.content,
      embeddingRef,
      embedding,
      model: distilled.model,
      metadata: distilled.metadata,
    };

    if (dryRun) {
      const now = new Date().toISOString();
      distillates.push({
        id: "dry-run",
        ...draft,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    const row = await store.upsertDistillate(draft);
    distillates.push(row);
    written += 1;

    // Topic hubs from session distillate
    const topics = Array.isArray(row.metadata.topics)
      ? row.metadata.topics.filter((x): x is string => typeof x === "string")
      : [];
    for (const topic of topics.slice(0, 8)) {
      const entity = await store.upsertEntity({
        entityType: "topic",
        canonicalKey: topic,
        displayName: topic.replace(/-/g, " "),
        metadata: { twin: "session", source: session.sourceId },
      });
      await store.linkEntity({
        entityId: entity.id,
        linkedType: "session",
        linkedId: subjectIdFor(session),
        relation: "mentions",
      });
    }
  }

  return {
    mode: store.mode,
    dryRun,
    processed: sessions.length,
    written,
    distillates,
    engine,
  };
}

export type { SampledTurnInput };
