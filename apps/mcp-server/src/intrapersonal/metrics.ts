/**
 * Intrapersonal metrics — Validated Insight Rate + supporting measures (I6).
 */
import type { CortexStore } from "../store/index.js";
import type { InsightVerdictRow } from "./types.js";

export interface IntrapersonalMetrics {
  windowDays: number;
  since: string;
  validatedInsightRate: number | null;
  surfacedDenom: number;
  validatedNumer: number;
  provenanceCoverage: number | null;
  highConfidenceMultiFamilyRate: number | null;
  hypothesesWithContradictionRate: number | null;
  decisionsWithOutcomeRate: number | null;
  hypothesisRetirementRate: number | null;
  verdictCounts: Record<string, number>;
  notes: string[];
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function isValidated(v: InsightVerdictRow): boolean {
  if (v.verdict !== "confirm") return false;
  // Interim VIR: confirm ∧ (useful ∨ nonObvious). Full VIR later adds outcome support.
  if (v.useful === false) return false;
  if (v.useful === true || v.nonObvious === true) return true;
  // confirm without flags still counts interim if not explicitly useless
  return v.useful == null && v.nonObvious == null;
}

export async function computeIntrapersonalMetrics(
  store: CortexStore,
  options: { windowDays?: number } = {},
): Promise<IntrapersonalMetrics> {
  const windowDays = options.windowDays ?? 30;
  const since = sinceIso(windowDays);
  const notes: string[] = [];

  const [verdicts, hyps, decisions, outcomes, claimEvidence] = await Promise.all([
    store.listInsightVerdicts({ limit: 200, since }),
    store.listHypotheses({ limit: 200 }),
    store.listDecisionsTable({ limit: 100 }),
    store.listDecisionOutcomes({ limit: 100 }),
    store.listClaimEvidence({ limit: 200, claimKind: "hypothesis" }),
  ]);

  // Surfaced ≈ weekly mirror cards + open questions + verdicts denominator
  const mirrors = await store.listDistillates({
    limit: 20,
    kinds: ["weekly_mirror"],
  });
  let surfaced = 0;
  for (const m of mirrors) {
    if (m.createdAt < since) continue;
    const mirror = m.metadata.mirror as { cards?: unknown[] } | undefined;
    surfaced += Array.isArray(mirror?.cards) ? mirror!.cards!.length : 0;
  }
  if (surfaced === 0) {
    // Fall back to verdicts as surfaced count (interim)
    surfaced = verdicts.length;
    notes.push("VIR denominator fell back to verdict count (no weekly_mirror cards in window).");
  }

  const validated = verdicts.filter(isValidated);
  const validatedInsightRate =
    surfaced > 0 ? validated.length / surfaced : null;

  const verdictCounts: Record<string, number> = {};
  for (const v of verdicts) {
    verdictCounts[v.verdict] = (verdictCounts[v.verdict] ?? 0) + 1;
  }

  // Provenance: hypotheses with evidence metadata or claim_evidence
  const withEvidence = hyps.filter((h) => {
    const metaEv = Array.isArray(h.metadata.evidence)
      ? h.metadata.evidence.length
      : 0;
    return metaEv > 0 || claimEvidence.some((e) => e.claimId === h.id);
  });
  const provenanceCoverage = hyps.length
    ? withEvidence.length / hyps.length
    : null;

  const highConf = hyps.filter((h) => h.confidence >= 0.7);
  const highMulti = highConf.filter((h) => h.sourceDiversity >= 3);
  const highConfidenceMultiFamilyRate = highConf.length
    ? highMulti.length / highConf.length
    : null;

  const withContradictions = hyps.filter((h) => {
    const c = h.metadata.contradictingEvidence;
    return (
      (Array.isArray(c) && c.length > 0) ||
      h.metadata.noneFoundContradiction === true ||
      claimEvidence.some(
        (e) => e.claimId === h.id && e.polarity === "contradicts",
      )
    );
  });
  const hypothesesWithContradictionRate = hyps.length
    ? withContradictions.length / hyps.length
    : null;

  const decisionIdsWithOutcomes = new Set(outcomes.map((o) => o.decisionId));
  const decisionsWithOutcomeRate = decisions.length
    ? decisions.filter((d) => decisionIdsWithOutcomes.has(d.id)).length /
      decisions.length
    : null;

  const retired = hyps.filter((h) => h.state === "retired").length;
  const hypothesisRetirementRate = hyps.length ? retired / hyps.length : null;

  notes.push(
    "Interim VIR uses confirm∧(useful∨nonObvious∨unspecified); outcome-linked VIR lands with fuller I4 instrumentation.",
  );

  return {
    windowDays,
    since,
    validatedInsightRate,
    surfacedDenom: surfaced,
    validatedNumer: validated.length,
    provenanceCoverage,
    highConfidenceMultiFamilyRate,
    hypothesesWithContradictionRate,
    decisionsWithOutcomeRate,
    hypothesisRetirementRate,
    verdictCounts,
    notes,
  };
}
