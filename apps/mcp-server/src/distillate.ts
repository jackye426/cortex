import {
  chatJsonCompletion,
  distillateModel,
  embedTexts,
  openaiConfigured,
} from "./llm.js";
import type { CortexStore } from "./store/index.js";
import type {
  DistillateRow,
  SessionEnvelopeInput,
} from "./store/types.js";

export interface DistillateRunOptions {
  /** Max sessions to process (default 20). */
  limit?: number;
  /** When true, skip store writes and only return computed rows. */
  dryRun?: boolean;
  /** Override model label stored on distillate rows. */
  model?: string;
  /** Force heuristic stub even when OPENAI_API_KEY is set. */
  stubOnly?: boolean;
}

export interface DistillateRunResult {
  mode: CortexStore["mode"];
  dryRun: boolean;
  processed: number;
  written: number;
  distillates: DistillateRow[];
  engine: "llm" | "stub";
}

export interface StructuredDistillate {
  summary: string;
  projects: string[];
  repos: string[];
  nextActions: string[];
  commercialVsTech: string;
  openQuestions: string[];
}

const DISTILLATE_SYSTEM = `You distill an AI coding/work session into structured JSON for a personal executive twin.
Return ONLY a JSON object with keys:
- summary (string, 2-5 sentences, actionable)
- projects (string array)
- repos (string array)
- nextActions (string array)
- commercialVsTech (string: commercial | tech | mixed | unknown)
- openQuestions (string array)
Be faithful to the evidence; do not invent repos or projects not suggested by the text.`;

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

function buildUserPrompt(session: SessionEnvelopeInput): string {
  const parts = [
    `source: ${session.sourceId}`,
    `sourceSessionId: ${session.sourceSessionId}`,
    `title: ${session.title ?? ""}`,
    `workspace: ${session.workspace ?? ""}`,
    `startedAt: ${session.startedAt ?? ""}`,
    `endedAt: ${session.endedAt ?? ""}`,
    "",
    "Messages / excerpts:",
    ...(session.excerpts ?? []).slice(0, 30).map((e, i) => `${i + 1}. ${e}`),
    "",
    "Tools:",
    ...(session.toolSummaries ?? []).slice(0, 25).map((t, i) => `${i + 1}. ${t}`),
  ];
  return parts.join("\n").slice(0, 24000);
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
  if (!useLlm) {
    const content = summarizeSessionEnvelope(session);
    return {
      content,
      metadata: {
        sourceId: session.sourceId,
        sourceSessionId: session.sourceSessionId,
        stub: true,
        projects: [],
        repos: [],
        nextActions: [],
        commercialVsTech: "unknown",
        openQuestions: [],
      },
      model: options.model ?? "cortex-distillate-stub",
      engine: "stub",
    };
  }

  const { text, model } = await chatJsonCompletion({
    system: DISTILLATE_SYSTEM,
    user: buildUserPrompt(session),
    model: options.model ?? distillateModel(),
  });
  const structured = parseStructured(text);
  return {
    content: structured.summary,
    metadata: {
      sourceId: session.sourceId,
      sourceSessionId: session.sourceSessionId,
      stub: false,
      projects: structured.projects,
      repos: structured.repos,
      nextActions: structured.nextActions,
      commercialVsTech: structured.commercialVsTech,
      openQuestions: structured.openQuestions,
    },
    model,
    engine: "llm",
  };
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

  const sessions = await store.listSessionsForDistillate(limit);
  const distillates: DistillateRow[] = [];
  let written = 0;

  for (const session of sessions) {
    const distilled = await distillSession(session, {
      model: options.model,
      stubOnly: options.stubOnly,
    });
    const { embedding, embeddingRef } = dryRun
      ? { embedding: null, embeddingRef: null }
      : await maybeEmbed(distilled.content);

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
