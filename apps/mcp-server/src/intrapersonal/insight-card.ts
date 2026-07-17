/**
 * Serialize insight cards — shared DTO for weekly mirror / open questions (I6).
 */
import type {
  EvidenceRef,
  HypothesisRow,
  InsightCard,
  SourceFamily,
} from "./types.js";

export interface InsightCardInput {
  id: string;
  theme?: string;
  notice: string;
  why?: string;
  evidence?: EvidenceRef[];
  confidence?: number;
  contradictions?: string[];
  rival?: string;
  test?: string;
  hypothesisId?: string | null;
  provisional?: boolean;
  metadata?: Record<string, unknown>;
}

function stubEvidence(
  family: SourceFamily,
  excerpt: string,
): EvidenceRef {
  return {
    sourceFamily: family,
    evidenceType: "observation",
    supportKind: "inferred_proxy",
    independenceGroup: family,
    excerpt,
    weight: 0.4,
  };
}

export function cardFromHypothesis(
  h: HypothesisRow,
  theme?: string,
): InsightCard {
  const evidence = Array.isArray(h.metadata.evidence)
    ? (h.metadata.evidence as EvidenceRef[])
    : [];
  const contradicting = Array.isArray(h.metadata.contradictingEvidence)
    ? (h.metadata.contradictingEvidence as EvidenceRef[])
    : [];
  const contradictions =
    contradicting.map((e) => e.excerpt ?? `${e.sourceFamily} contradiction`) ||
    [];
  if (!contradictions.length && h.metadata.noneFoundContradiction) {
    contradictions.push("none_found (low confidence)");
  }
  const rival =
    h.alternativeExplanations[0] ??
    "Timing or situational load rather than a stable personal pattern.";
  const test =
    h.falsifiers[0] ??
    `Track one concrete behaviour for 7 days that would falsify: "${h.claim.slice(0, 100)}"`;

  return serializeInsightCard({
    id: h.id,
    theme,
    notice: h.claim,
    why: h.whyItMatters || "May shape energy, attention, or decision quality.",
    evidence:
      evidence.length > 0
        ? evidence
        : [stubEvidence("reflections", "Ledger hypothesis without attached refs")],
    confidence: h.confidence,
    contradictions:
      contradictions.length > 0
        ? contradictions
        : ["No contradictory observations attached yet."],
    rival,
    test,
    hypothesisId: h.id,
    provisional: h.state === "emerging" || h.confidence < 0.55,
    metadata: { state: h.state, domains: h.domains, origin: h.origin },
  });
}

export function serializeInsightCard(input: InsightCardInput): InsightCard {
  const evidence = input.evidence?.length
    ? input.evidence
    : [stubEvidence("other", "Evidence pending")];
  const contradictions = input.contradictions?.length
    ? input.contradictions
    : ["No contradictory evidence attached yet."];
  const rival =
    input.rival?.trim() ||
    "This may be situational rather than a durable pattern.";
  const test =
    input.test?.trim() ||
    "Propose a one-week behavioural test and record the outcome.";

  return {
    id: input.id,
    theme: input.theme,
    notice: input.notice.trim(),
    why:
      input.why?.trim() ||
      "Surfaced because it may affect how you allocate energy or attention.",
    evidence,
    confidence:
      typeof input.confidence === "number"
        ? Math.max(0, Math.min(1, input.confidence))
        : 0.4,
    contradictions,
    rival,
    test,
    controls: {
      confirm: true,
      reject: true,
      refine: true,
    },
    hypothesisId: input.hypothesisId ?? null,
    provisional:
      input.provisional ??
      (input.confidence != null && input.confidence < 0.55),
    metadata: input.metadata,
  };
}

export function assertInsightCardComplete(card: InsightCard): string[] {
  const missing: string[] = [];
  if (!card.notice) missing.push("notice");
  if (!card.why) missing.push("why");
  if (!card.evidence?.length) missing.push("evidence");
  if (card.confidence == null) missing.push("confidence");
  if (!card.contradictions?.length) missing.push("contradictions");
  if (!card.rival) missing.push("rival");
  if (!card.test) missing.push("test");
  if (!card.controls?.confirm || !card.controls?.reject || !card.controls?.refine) {
    missing.push("controls");
  }
  return missing;
}
