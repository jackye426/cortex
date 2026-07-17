/**
 * Experiment designer + completion → hypothesis update (I4).
 */
import type { CortexStore } from "../store/index.js";
import { recordPredictionResolution } from "./calibration.js";
import type {
  ExperimentResultPolarity,
  ExperimentRow,
  HypothesisRow,
  ListExperimentsOptions,
} from "./types.js";

const PROTOCOL_TEMPLATES: Array<{
  title: string;
  protocol: (claim: string) => string;
  domains?: string[];
}> = [
  {
    title: "Energy before/after",
    protocol: (claim) =>
      `For 5 days, note energy (-1..1) before and after activities related to: "${claim}". Compare averages.`,
    domains: ["energy"],
  },
  {
    title: "Decision among motives",
    protocol: (claim) =>
      `When the pattern appears, make an explicit decision that would differ if the claim were false. Record choice + context for: "${claim}".`,
    domains: ["motive", "decision"],
  },
  {
    title: "Ship a simple version",
    protocol: (claim) =>
      `Ship the smallest concrete version that would support or contradict: "${claim}". Log outcome within 7 days.`,
    domains: ["strength", "attention"],
  },
  {
    title: "Interest without utility",
    protocol: (claim) =>
      `Spend 90 minutes on a related interest with no commercial/project purpose. Observe pull vs resistance for: "${claim}".`,
    domains: ["interest", "motive"],
  },
  {
    title: "Ask for examples",
    protocol: (claim) =>
      `Ask one collaborator for concrete examples for/against: "${claim}". Log their examples as evidence.`,
    domains: ["strength", "limitation"],
  },
];

function pickTemplate(h: HypothesisRow) {
  const domain = h.domains[0];
  const match = PROTOCOL_TEMPLATES.find(
    (t) => domain && t.domains?.includes(domain),
  );
  return match ?? PROTOCOL_TEMPLATES[0]!;
}

export async function proposeExperiment(
  store: CortexStore,
  input: {
    hypothesisId: string;
    title?: string;
    protocol?: string;
    dueAt?: string | null;
    activate?: boolean;
  },
): Promise<ExperimentRow | null> {
  const h = await store.getHypothesis(input.hypothesisId);
  if (!h) return null;
  const template = pickTemplate(h);
  const dueAt =
    input.dueAt ??
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return store.upsertExperiment({
    hypothesisId: h.id,
    title: input.title ?? template.title,
    protocol: input.protocol ?? template.protocol(h.claim),
    status: input.activate === false ? "proposed" : "active",
    dueAt,
    metadata: { template: template.title },
  });
}

export async function listExperiments(
  store: CortexStore,
  options: ListExperimentsOptions = {},
): Promise<ExperimentRow[]> {
  return store.listExperiments(options);
}

export async function requestExperimentResults(
  store: CortexStore,
): Promise<ExperimentRow[]> {
  const now = new Date().toISOString();
  const due = await store.listExperiments({
    status: "active",
    dueBefore: now,
    limit: 30,
  });
  const proposed = await store.listExperiments({
    status: "proposed",
    dueBefore: now,
    limit: 10,
  });
  return [...due, ...proposed];
}

export async function completeExperiment(
  store: CortexStore,
  input: {
    experimentId: string;
    resultSummary: string;
    resultPolarity: ExperimentResultPolarity;
    evidence?: Array<Record<string, unknown>>;
  },
): Promise<{
  experiment: ExperimentRow | null;
  hypothesis: HypothesisRow | null;
}> {
  const experiments = await store.listExperiments({ limit: 100 });
  const existing = experiments.find((e) => e.id === input.experimentId);
  if (!existing) return { experiment: null, hypothesis: null };

  const experiment = await store.upsertExperiment({
    id: existing.id,
    hypothesisId: existing.hypothesisId,
    title: existing.title,
    protocol: existing.protocol,
    status: "completed",
    proposedAt: existing.proposedAt,
    dueAt: existing.dueAt,
    completedAt: new Date().toISOString(),
    resultSummary: input.resultSummary,
    resultPolarity: input.resultPolarity,
    evidence: input.evidence ?? existing.evidence,
    metadata: existing.metadata,
  });

  const hyp = await store.getHypothesis(existing.hypothesisId);
  if (!hyp) return { experiment, hypothesis: null };

  let confidence = hyp.confidence;
  let state = hyp.state;
  if (input.resultPolarity === "supports") {
    confidence = Math.min(1, confidence + 0.2);
    if (confidence >= 0.7 && hyp.sourceDiversity >= 2) state = "supported";
    else if (state === "disputed") state = "emerging";
  } else if (input.resultPolarity === "contradicts") {
    confidence = Math.max(0.05, confidence * 0.45);
    state = "disputed";
  } else {
    confidence = Math.max(0.1, confidence - 0.05);
  }

  const hypothesis = await store.upsertHypothesis({
    id: hyp.id,
    claim: hyp.claim,
    whyItMatters: hyp.whyItMatters,
    state,
    confidence,
    sourceDiversity: hyp.sourceDiversity,
    falsifiers: hyp.falsifiers,
    alternativeExplanations: hyp.alternativeExplanations,
    domains: hyp.domains,
    lastTestedAt: new Date().toISOString(),
    origin: hyp.origin,
    assistantWeight: hyp.assistantWeight,
    priorHypothesisId: hyp.priorHypothesisId,
    metadata: {
      ...hyp.metadata,
      lastExperimentId: experiment.id,
      lastResultPolarity: input.resultPolarity,
    },
  });

  await recordPredictionResolution(store, {
    claimId: hyp.id,
    claimKind: "hypothesis",
    domain: hyp.domains[0] ?? null,
    predicted: "supports",
    actual: input.resultPolarity,
    correct: input.resultPolarity === "supports",
  });

  return { experiment, hypothesis };
}
