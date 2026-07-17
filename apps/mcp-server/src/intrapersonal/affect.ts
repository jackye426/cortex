/**
 * Affect proxies from session signals + optional self-report reflections.
 */
import type { CortexStore } from "../store/index.js";
import type {
  AffectSignalRow,
  AffectSignalType,
  InsertAffectSignalInput,
  SourceFamily,
} from "./types.js";

export interface ExtractAffectOptions {
  limit?: number;
  dryRun?: boolean;
}

export interface ExtractAffectResult {
  scanned: number;
  written: number;
  dryRun: boolean;
  samples: Array<{ signalType: AffectSignalType; value: number }>;
}

function asSignals(value: unknown): Array<{ text: string; confidence: number }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ text: string; confidence: number }> = [];
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const text = (item as Record<string, unknown>).text;
      const confidence = (item as Record<string, unknown>).confidence;
      if (typeof text === "string" && text.trim()) {
        out.push({
          text: text.trim(),
          confidence: typeof confidence === "number" ? confidence : 0.5,
        });
      }
    }
  }
  return out;
}

export async function extractAffectProxies(
  store: CortexStore,
  options: ExtractAffectOptions = {},
): Promise<ExtractAffectResult> {
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit ?? 60;
  const summaries = await store.listDistillates({
    limit,
    kinds: ["summary"],
  });
  let written = 0;
  const samples: ExtractAffectResult["samples"] = [];

  for (const d of summaries) {
    const friction = asSignals(d.metadata.frictionSignals);
    const exploration = asSignals(d.metadata.explorationSignals);
    const behaviors = asSignals(d.metadata.demonstratedBehaviors);

    const push = async (
      signalType: AffectSignalType,
      value: number,
      text: string,
      confidence: number,
    ) => {
      samples.push({ signalType, value });
      if (dryRun) {
        written += 1;
        return;
      }
      await store.insertAffectSignal({
        signalType,
        value,
        sourceFamily: "ai_sessions" satisfies SourceFamily,
        occurredAt: d.updatedAt,
        captureMode: "inferred",
        context: {
          distillateId: d.id,
          text: text.slice(0, 240),
          confidence,
          sessionId: d.subjectType === "session" ? d.subjectId : null,
        },
      });
      written += 1;
    };

    for (const s of friction.slice(0, 3)) {
      await push("friction", Math.min(1, 0.4 + s.confidence * 0.5), s.text, s.confidence);
      await push("energy", -Math.min(1, 0.3 + s.confidence * 0.4), s.text, s.confidence);
    }
    for (const s of exploration.slice(0, 3)) {
      await push("flow", Math.min(1, 0.35 + s.confidence * 0.5), s.text, s.confidence);
      await push("valence", Math.min(1, 0.25 + s.confidence * 0.4), s.text, s.confidence);
    }
    for (const s of behaviors.slice(0, 2)) {
      await push("energy", Math.min(1, 0.2 + s.confidence * 0.3), s.text, s.confidence);
    }
  }

  return {
    scanned: summaries.length,
    written,
    dryRun,
    samples: samples.slice(0, 20),
  };
}

export async function logReflection(
  store: CortexStore,
  input: {
    text: string;
    energy?: number;
    valence?: number;
    interestKey?: string;
    occurredAt?: string;
  },
): Promise<{
  observationId: string;
  signals: AffectSignalRow[];
}> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const { createHash } = await import("node:crypto");
  const contentHash = createHash("sha256")
    .update(`reflection\n${input.text.trim().toLowerCase()}\n${occurredAt}`)
    .digest("hex");

  const observation = await store.upsertObservation({
    epistemicType: "self_report",
    statement: input.text.trim().slice(0, 500),
    sourceFamily: "reflections",
    independenceGroup: "reflections:self",
    occurredAt,
    supportKind: "self_report",
    confidence: 0.8,
    metadata: {
      capture: "log_reflection",
      interestKey: input.interestKey ?? null,
    },
    contentHash,
  });

  const signals: AffectSignalRow[] = [];
  const base: Omit<InsertAffectSignalInput, "signalType" | "value"> = {
    sourceFamily: "reflections",
    observationId: observation.id,
    occurredAt,
    captureMode: "self_report",
    context: {
      interestKey: input.interestKey ?? null,
      text: input.text.slice(0, 240),
    },
  };

  if (typeof input.energy === "number") {
    signals.push(
      await store.insertAffectSignal({
        ...base,
        signalType: "energy",
        value: Math.max(-1, Math.min(1, input.energy)),
      }),
    );
  }
  if (typeof input.valence === "number") {
    signals.push(
      await store.insertAffectSignal({
        ...base,
        signalType: "valence",
        value: Math.max(-1, Math.min(1, input.valence)),
      }),
    );
  }

  return { observationId: observation.id, signals };
}
