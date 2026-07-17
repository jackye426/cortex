/**
 * Hypothesis ledger — propose / promote / confirm / reject / refine (I3).
 */
import type { CortexStore } from "../store/index.js";
import type {
  EvidenceRef,
  HypothesisOrigin,
  HypothesisRow,
  HypothesisState,
  ListHypothesesOptions,
  ProvenanceClaim,
} from "./types.js";
import { ASSISTANT_ONLY_CONFIDENCE_CAP } from "./types.js";

export interface ProposeHypothesisInput {
  claim: string;
  whyItMatters?: string;
  domains?: string[];
  falsifiers?: string[];
  alternativeExplanations?: string[];
  confidence?: number;
  origin?: HypothesisOrigin | string;
  assistantWeight?: number;
  evidence?: EvidenceRef[];
  contradictingEvidence?: EvidenceRef[];
  metadata?: Record<string, unknown>;
}

export interface PromoteMirrorClaimsInput {
  claims: ProvenanceClaim[];
  whyItMatters?: string;
  domains?: string[];
}

function ensureRival(alts: string[] | undefined, claim: string): string[] {
  if (alts?.length) return alts;
  return [
    `Situational pressure or timing, not a stable pattern: "${claim.slice(0, 80)}"`,
  ];
}

function diversityFromEvidence(evidence: EvidenceRef[]): number {
  return new Set(evidence.map((e) => e.independenceGroup || e.sourceFamily))
    .size;
}

export async function proposeHypothesis(
  store: CortexStore,
  input: ProposeHypothesisInput,
): Promise<HypothesisRow> {
  const evidence = input.evidence ?? [];
  const contradictions = input.contradictingEvidence ?? [];
  const alts = ensureRival(input.alternativeExplanations, input.claim);
  const diversity = diversityFromEvidence([...evidence, ...contradictions]);
  let confidence = input.confidence ?? 0.4;
  const assistantWeight = input.assistantWeight ?? 0.5;
  if (assistantWeight >= 0.7 && diversity < 2) {
    confidence = Math.min(confidence, ASSISTANT_ONLY_CONFIDENCE_CAP);
  }

  const row = await store.upsertHypothesis({
    claim: input.claim.trim(),
    whyItMatters: input.whyItMatters ?? "",
    state: "emerging",
    confidence,
    sourceDiversity: diversity,
    falsifiers: input.falsifiers ?? [],
    alternativeExplanations: alts,
    domains: input.domains ?? [],
    origin: input.origin ?? "user",
    assistantWeight,
    metadata: {
      ...(input.metadata ?? {}),
      evidence,
      contradictingEvidence: contradictions,
      noneFoundContradiction: contradictions.length === 0,
    },
  });

  for (const ev of evidence) {
    await store.insertClaimEvidence({
      claimId: row.id,
      claimKind: "hypothesis",
      polarity: "supports",
      evidence: ev,
    });
  }
  for (const ev of contradictions) {
    await store.insertClaimEvidence({
      claimId: row.id,
      claimKind: "hypothesis",
      polarity: "contradicts",
      evidence: ev,
    });
  }
  return row;
}

export async function listHypotheses(
  store: CortexStore,
  options: ListHypothesesOptions = {},
): Promise<HypothesisRow[]> {
  return store.listHypotheses(options);
}

export async function getHypothesis(
  store: CortexStore,
  id: string,
): Promise<HypothesisRow | null> {
  return store.getHypothesis(id);
}

export async function promoteMirrorClaims(
  store: CortexStore,
  input: PromoteMirrorClaimsInput,
): Promise<HypothesisRow[]> {
  const out: HypothesisRow[] = [];
  for (const claim of input.claims) {
    const type = String(claim.claimType);
    if (type !== "hypothesis" && type !== "interpretation") continue;
    const evidence = claim.provenance ?? [];
    const diversity = diversityFromEvidence(evidence);
    let confidence = Math.min(claim.confidence ?? 0.35, ASSISTANT_ONLY_CONFIDENCE_CAP);
    if (diversity >= 2) {
      confidence = Math.min(claim.confidence ?? 0.45, 0.55);
    }
    const row = await proposeHypothesis(store, {
      claim: claim.text,
      whyItMatters: input.whyItMatters ?? "Promoted from ask_mirror",
      domains: input.domains ?? [],
      alternativeExplanations: claim.alternativeExplanations,
      confidence,
      origin: "ask_mirror",
      assistantWeight: 0.85,
      evidence,
      metadata: {
        provisional: claim.provisional ?? true,
        promotedFrom: "ask_mirror",
        evidenceRefs: claim.evidenceRefs,
      },
    });
    out.push(row);
  }
  return out;
}

export async function confirmHypothesis(
  store: CortexStore,
  id: string,
  note?: string,
  options: { useful?: boolean; nonObvious?: boolean } = {},
): Promise<HypothesisRow | null> {
  const existing = await store.getHypothesis(id);
  if (!existing) return null;
  const nextConfidence = Math.min(1, existing.confidence + 0.15);
  const state: HypothesisState =
    nextConfidence >= 0.7 && existing.sourceDiversity >= 2
      ? "supported"
      : existing.state === "disputed"
        ? "emerging"
        : existing.state === "retired"
          ? "emerging"
          : existing.state;
  const updated = await store.upsertHypothesis({
    id: existing.id,
    claim: existing.claim,
    whyItMatters: existing.whyItMatters,
    state,
    confidence: nextConfidence,
    sourceDiversity: existing.sourceDiversity,
    falsifiers: existing.falsifiers,
    alternativeExplanations: existing.alternativeExplanations,
    domains: existing.domains,
    lastTestedAt: existing.lastTestedAt,
    origin: existing.origin,
    assistantWeight: existing.assistantWeight,
    priorHypothesisId: existing.priorHypothesisId,
    metadata: {
      ...existing.metadata,
      lastConfirmNote: note ?? null,
      userConfirmed: true,
    },
  });
  await store.insertInsightVerdict({
    insightId: id,
    insightKind: "hypothesis",
    verdict: "confirm",
    note: note ?? null,
    useful: options.useful ?? true,
    nonObvious: options.nonObvious ?? null,
  });
  return updated;
}

export async function rejectHypothesis(
  store: CortexStore,
  id: string,
  note?: string,
  options: { retire?: boolean } = {},
): Promise<HypothesisRow | null> {
  const existing = await store.getHypothesis(id);
  if (!existing) return null;
  const state: HypothesisState = options.retire ? "retired" : "disputed";
  const updated = await store.upsertHypothesis({
    id: existing.id,
    claim: existing.claim,
    whyItMatters: existing.whyItMatters,
    state,
    confidence: Math.max(0.05, existing.confidence * 0.4),
    sourceDiversity: existing.sourceDiversity,
    falsifiers: existing.falsifiers,
    alternativeExplanations: existing.alternativeExplanations,
    domains: existing.domains,
    lastTestedAt: existing.lastTestedAt,
    origin: existing.origin,
    assistantWeight: existing.assistantWeight,
    priorHypothesisId: existing.priorHypothesisId,
    metadata: {
      ...existing.metadata,
      rejectionNote: note ?? null,
      userRejected: true,
      rejectedAt: new Date().toISOString(),
    },
  });
  await store.insertInsightVerdict({
    insightId: id,
    insightKind: "hypothesis",
    verdict: "reject",
    note: note ?? null,
    useful: false,
    nonObvious: null,
  });
  return updated;
}

export async function refineHypothesis(
  store: CortexStore,
  id: string,
  refinement: {
    claim?: string;
    whyItMatters?: string;
    note?: string;
    domains?: string[];
    alternativeExplanations?: string[];
  },
): Promise<HypothesisRow | null> {
  const existing = await store.getHypothesis(id);
  if (!existing) return null;
  // Retire prior, create refined child
  await store.upsertHypothesis({
    id: existing.id,
    claim: existing.claim,
    whyItMatters: existing.whyItMatters,
    state: "retired",
    confidence: existing.confidence,
    sourceDiversity: existing.sourceDiversity,
    falsifiers: existing.falsifiers,
    alternativeExplanations: existing.alternativeExplanations,
    domains: existing.domains,
    lastTestedAt: existing.lastTestedAt,
    origin: existing.origin,
    assistantWeight: existing.assistantWeight,
    priorHypothesisId: existing.priorHypothesisId,
    metadata: {
      ...existing.metadata,
      refinedIntoPending: true,
      refineNote: refinement.note ?? null,
    },
  });
  const refined = await store.upsertHypothesis({
    claim: (refinement.claim ?? existing.claim).trim(),
    whyItMatters: refinement.whyItMatters ?? existing.whyItMatters,
    state: "emerging",
    confidence: Math.min(existing.confidence, 0.55),
    sourceDiversity: existing.sourceDiversity,
    falsifiers: existing.falsifiers,
    alternativeExplanations:
      refinement.alternativeExplanations ?? existing.alternativeExplanations,
    domains: refinement.domains ?? existing.domains,
    origin: "user",
    assistantWeight: Math.min(existing.assistantWeight, 0.4),
    priorHypothesisId: existing.id,
    metadata: {
      refinedFrom: existing.id,
      refineNote: refinement.note ?? null,
      evidence: existing.metadata.evidence ?? [],
    },
  });
  await store.insertInsightVerdict({
    insightId: existing.id,
    insightKind: "hypothesis",
    verdict: "refine",
    note: refinement.note ?? null,
  });
  return refined;
}
