/**
 * Decision capture v2 — first-class decisions table + distillate projection (I4).
 */
import { randomUUID } from "node:crypto";
import { embedTexts, embeddingModel, openaiConfigured } from "../llm.js";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import type {
  DecisionOutcomeRow,
  DecisionRow,
  EvidenceRef,
} from "./types.js";

export interface CaptureDecisionInput {
  title: string;
  statement?: string;
  expectedOutcome?: string | null;
  relatedHypothesisIds?: string[];
  relatedEntityKeys?: string[];
  decidedAt?: string;
  projectToDistillate?: boolean;
}

export interface CaptureOutcomeInput {
  decisionId: string;
  actualOutcome: string;
  alignedWithExpected?: boolean | null;
  learning?: string | null;
  evidence?: EvidenceRef[];
  projectToDistillate?: boolean;
}

async function maybeEmbed(text: string): Promise<{
  embedding: number[] | null;
  embeddingRef: string | null;
}> {
  if (!openaiConfigured()) return { embedding: null, embeddingRef: null };
  try {
    const [vec] = await embedTexts([text]);
    return {
      embedding: vec ?? null,
      embeddingRef: vec ? `openai:${embeddingModel()}` : null,
    };
  } catch {
    return { embedding: null, embeddingRef: null };
  }
}

export async function captureDecision(
  store: CortexStore,
  input: CaptureDecisionInput,
): Promise<{ decision: DecisionRow; distillate: DistillateRow | null }> {
  const statement = input.statement ?? "";
  const body = `${input.title}\n\n${statement}${
    input.expectedOutcome ? `\n\nExpected: ${input.expectedOutcome}` : ""
  }`;

  let distillate: DistillateRow | null = null;
  if (input.projectToDistillate !== false) {
    const { embedding, embeddingRef } = await maybeEmbed(body);
    distillate = await store.upsertDistillate({
      subjectType: "note",
      subjectId: randomUUID(),
      kind: "decision",
      content: body,
      embeddingRef,
      embedding,
      model: "mcp-capture-v2",
      metadata: {
        title: input.title,
        capture: true,
        extension: "I4",
        relatedEntityKey: input.relatedEntityKeys?.[0] ?? null,
        expectedOutcome: input.expectedOutcome ?? null,
        relatedHypothesisIds: input.relatedHypothesisIds ?? [],
      },
    });
    for (const key of input.relatedEntityKeys ?? []) {
      const entity = await store.upsertEntity({
        entityType: "project",
        canonicalKey: key,
        displayName: key,
      });
      await store.linkEntity({
        entityId: entity.id,
        linkedType: "distillate",
        linkedId: distillate.id,
        relation: "decision",
      });
    }
  }

  const decision = await store.upsertDecision({
    title: input.title,
    statement,
    decidedAt: input.decidedAt,
    expectedOutcome: input.expectedOutcome ?? null,
    relatedHypothesisIds: input.relatedHypothesisIds ?? [],
    relatedEntityKeys: input.relatedEntityKeys ?? [],
    source: "user",
    distillateId: distillate?.id ?? null,
    metadata: { projected: Boolean(distillate) },
  });

  return { decision, distillate };
}

export async function captureOutcome(
  store: CortexStore,
  input: CaptureOutcomeInput,
): Promise<{
  outcome: DecisionOutcomeRow;
  decision: DecisionRow | null;
  distillate: DistillateRow | null;
}> {
  const decisions = await store.listDecisionsTable({ limit: 100 });
  const decision = decisions.find((d) => d.id === input.decisionId) ?? null;

  const outcome = await store.insertDecisionOutcome({
    decisionId: input.decisionId,
    actualOutcome: input.actualOutcome,
    alignedWithExpected: input.alignedWithExpected ?? null,
    learning: input.learning ?? null,
    evidence: input.evidence ?? [],
  });

  let distillate: DistillateRow | null = null;
  if (input.projectToDistillate !== false) {
    const title = decision?.title ?? "Outcome";
    const body = `${title}\n\n${input.actualOutcome}${
      input.learning ? `\n\nLearning: ${input.learning}` : ""
    }`;
    const { embedding, embeddingRef } = await maybeEmbed(body);
    distillate = await store.upsertDistillate({
      subjectType: "note",
      subjectId: randomUUID(),
      kind: "outcome",
      content: body,
      embeddingRef,
      embedding,
      model: "mcp-capture-v2",
      metadata: {
        title,
        capture: true,
        extension: "I4",
        decisionId: input.decisionId,
        alignedWithExpected: input.alignedWithExpected ?? null,
      },
    });
  }

  return { outcome, decision, distillate };
}
