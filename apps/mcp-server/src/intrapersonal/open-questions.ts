/**
 * Rank unresolved hypotheses + due experiments (I6 Open Questions).
 */
import { isoWeekKey } from "../week-helpers.js";
import { stableSubjectUuid } from "../stable-id.js";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import { requestExperimentResults } from "./experiments.js";
import { cardFromHypothesis, serializeInsightCard } from "./insight-card.js";
import type { ExperimentRow, HypothesisRow, InsightCard } from "./types.js";

export interface OpenQuestionItem {
  score: number;
  kind: "hypothesis" | "experiment";
  hypothesis?: HypothesisRow;
  experiment?: ExperimentRow;
  card: InsightCard;
  reasons: string[];
}

export interface OpenQuestionsPayload {
  generatedAt: string;
  weekKey?: string;
  items: OpenQuestionItem[];
}

function scoreHypothesis(h: HypothesisRow): {
  score: number;
  reasons: string[];
} {
  const uncertainty = 1 - h.confidence;
  const testability = h.falsifiers.length > 0 || h.alternativeExplanations.length > 0 ? 0.8 : 0.45;
  const personalValue =
    h.domains.some((d) =>
      ["energy", "motive", "avoidance", "identity", "interest"].includes(d),
    )
      ? 0.85
      : 0.55;
  const sourceGap = h.sourceDiversity < 2 ? 0.25 : 0;
  const score =
    personalValue * uncertainty * testability * (1 + sourceGap);
  const reasons: string[] = [];
  if (uncertainty > 0.4) reasons.push("high_uncertainty");
  if (testability > 0.6) reasons.push("testable");
  if (sourceGap) reasons.push("source_gap");
  if (h.state === "emerging") reasons.push("emerging");
  return { score, reasons };
}

export async function listOpenQuestions(
  store: CortexStore,
  options: { limit?: number } = {},
): Promise<OpenQuestionsPayload> {
  const limit = options.limit ?? 12;
  const [hyps, due] = await Promise.all([
    store.listHypotheses({ limit: 60 }),
    requestExperimentResults(store),
  ]);

  const items: OpenQuestionItem[] = [];

  for (const h of hyps) {
    if (h.state === "retired" || h.state === "supported") continue;
    if (h.metadata.userRejected) continue;
    const { score, reasons } = scoreHypothesis(h);
    items.push({
      score,
      kind: "hypothesis",
      hypothesis: h,
      card: cardFromHypothesis(h, h.domains[0] ?? "open"),
      reasons,
    });
  }

  for (const exp of due) {
    const h = await store.getHypothesis(exp.hypothesisId);
    items.push({
      score: 0.9,
      kind: "experiment",
      experiment: exp,
      hypothesis: h ?? undefined,
      card: serializeInsightCard({
        id: exp.id,
        theme: "experiment",
        notice: `Report results: ${exp.title}`,
        why: "Due experiment — closes the insight → test → outcome loop.",
        evidence: [
          {
            sourceFamily: "reflections",
            evidenceType: "hypothesis",
            supportKind: "assistant_derived",
            independenceGroup: "experiments",
            excerpt: exp.protocol.slice(0, 160),
            weight: 0.5,
          },
        ],
        confidence: 0.5,
        contradictions: ["Experiment may be inconclusive."],
        rival: "The underlying hypothesis may already be stale.",
        test: exp.protocol,
        hypothesisId: exp.hypothesisId,
      }),
      reasons: ["due_experiment", "testability"],
    });
  }

  items.sort((a, b) => b.score - a.score);

  return {
    generatedAt: new Date().toISOString(),
    weekKey: isoWeekKey(),
    items: items.slice(0, limit),
  };
}

export async function snapshotOpenQuestions(
  store: CortexStore,
  options: { dryRun?: boolean } = {},
): Promise<{
  dryRun: boolean;
  written: boolean;
  distillate: DistillateRow | null;
  payload: OpenQuestionsPayload;
}> {
  const payload = await listOpenQuestions(store, { limit: 15 });
  const content = [
    `Open questions ${payload.weekKey ?? ""}.`,
    ...payload.items
      .slice(0, 8)
      .map(
        (i, idx) =>
          `${idx + 1}. (${i.kind}, score=${i.score.toFixed(2)}) ${i.card.notice.slice(0, 140)}`,
      ),
  ].join("\n");

  if (options.dryRun) {
    const now = new Date().toISOString();
    return {
      dryRun: true,
      written: false,
      payload,
      distillate: {
        id: "dry-run",
        subjectType: "week",
        subjectId: stableSubjectUuid(
          "open-questions",
          payload.weekKey ?? "now",
        ),
        kind: "open_questions_snapshot",
        content,
        embeddingRef: null,
        embedding: null,
        model: "open-questions-v1",
        metadata: { payload, twin: "I6" },
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  const distillate = await store.upsertDistillate({
    subjectType: "week",
    subjectId: stableSubjectUuid(
      "open-questions",
      payload.weekKey ?? isoWeekKey(),
    ),
    kind: "open_questions_snapshot",
    content: content.slice(0, 4000),
    embeddingRef: null,
    embedding: null,
    model: "open-questions-v1",
    metadata: {
      twin: "I6",
      sensitivity: "reflective_sensitive",
      payload,
      count: payload.items.length,
    },
  });

  return { dryRun: false, written: true, distillate, payload };
}
