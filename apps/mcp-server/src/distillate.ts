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
}

export interface DistillateRunResult {
  mode: CortexStore["mode"];
  dryRun: boolean;
  processed: number;
  written: number;
  distillates: DistillateRow[];
}

/**
 * Stub distillate worker: turn session envelopes into distillates-table-shaped
 * summaries. Uses a cheap heuristic (title + first excerpts) — no LLM call yet.
 * When the store cannot write (no DB / RLS errors), upsert still returns a row.
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
  // Fixture / pre-DB: stable synthetic id from source pair
  return `${session.sourceId}:${session.sourceSessionId}`;
}

export async function runDistillateWorker(
  store: CortexStore,
  options: DistillateRunOptions = {},
): Promise<DistillateRunResult> {
  const limit = options.limit ?? 20;
  const dryRun = Boolean(options.dryRun);
  const model = options.model ?? "cortex-distillate-stub";

  const sessions = await store.listSessionsForDistillate(limit);
  const distillates: DistillateRow[] = [];
  let written = 0;

  for (const session of sessions) {
    const content = summarizeSessionEnvelope(session);
    const draft = {
      subjectType: "session",
      subjectId: subjectIdFor(session),
      kind: "summary",
      content,
      embeddingRef: null as string | null,
      model,
      metadata: {
        sourceId: session.sourceId,
        sourceSessionId: session.sourceSessionId,
        stub: true,
      },
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
  };
}
