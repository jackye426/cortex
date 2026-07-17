/**
 * Detect assistant-derived / circular support for claims.
 */
import { ASSISTANT_DERIVED_KINDS } from "./source-family.js";
import {
  ASSISTANT_ONLY_CONFIDENCE_CAP,
  HIGH_CONFIDENCE_MIN_FAMILIES,
  HIGH_CONFIDENCE_THRESHOLD,
  type AnnotatedMemoryHit,
  type InsightQualityIssue,
  type ProvenanceClaim,
  type SourceFamily,
} from "./types.js";

export interface CircularAnalysis {
  assistantOnly: boolean;
  independentFamilies: SourceFamily[];
  cappedConfidence: number;
  issues: InsightQualityIssue[];
  provisional: boolean;
}

function evidenceForClaim(
  claim: ProvenanceClaim,
  evidenceById: Map<string, AnnotatedMemoryHit>,
): AnnotatedMemoryHit[] {
  return claim.evidenceRefs
    .map((id) => evidenceById.get(id))
    .filter((e): e is AnnotatedMemoryHit => Boolean(e));
}

export function analyzeClaimCircularity(
  claim: ProvenanceClaim,
  evidenceById: Map<string, AnnotatedMemoryHit>,
): CircularAnalysis {
  const issues: InsightQualityIssue[] = [];
  const refs = evidenceForClaim(claim, evidenceById);
  const claimType = claim.claimType;

  if (claimType !== "hypothesis" && refs.length === 0) {
    issues.push({
      code: "missing_provenance",
      message: "Material claim has no evidence refs.",
      claimText: claim.text,
    });
  }

  const independent = new Set<SourceFamily>();
  let nonAssistant = 0;
  for (const ref of refs) {
    const kind = ref.distillateKind ?? ref.kind;
    if (ASSISTANT_DERIVED_KINDS.has(kind) || ref.supportKind === "assistant_derived") {
      continue;
    }
    nonAssistant += 1;
    if (ref.sourceFamily !== "reflections" && ref.sourceFamily !== "other") {
      independent.add(ref.sourceFamily);
    }
  }

  const assistantOnly = refs.length > 0 && nonAssistant === 0;
  if (assistantOnly) {
    issues.push({
      code: "circular_evidence",
      message:
        "Claim support is only assistant-derived (portrait/self_model/prior synthesis).",
      claimText: claim.text,
    });
  }

  let confidence = claim.confidence;
  if (assistantOnly) {
    confidence = Math.min(confidence, ASSISTANT_ONLY_CONFIDENCE_CAP);
    if (claim.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      issues.push({
        code: "assistant_only_high_confidence",
        message: `Assistant-only claim confidence capped at ${ASSISTANT_ONLY_CONFIDENCE_CAP}.`,
        claimText: claim.text,
      });
    }
  }

  const provisional =
    confidence >= HIGH_CONFIDENCE_THRESHOLD &&
    independent.size < HIGH_CONFIDENCE_MIN_FAMILIES;

  if (provisional && claimType !== "hypothesis") {
    issues.push({
      code: "insufficient_source_diversity",
      message: `High-confidence claim cites ${independent.size} independent families (need ${HIGH_CONFIDENCE_MIN_FAMILIES}) — mark provisional.`,
      claimText: claim.text,
    });
    confidence = Math.min(confidence, 0.65);
  }

  return {
    assistantOnly,
    independentFamilies: [...independent],
    cappedConfidence: confidence,
    issues,
    provisional,
  };
}

export function enforceClaimEvidencePolicy(
  claims: ProvenanceClaim[],
  evidence: AnnotatedMemoryHit[],
): {
  claims: ProvenanceClaim[];
  issues: InsightQualityIssue[];
} {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const issues: InsightQualityIssue[] = [];
  const next: ProvenanceClaim[] = [];

  for (const claim of claims) {
    const analysis = analyzeClaimCircularity(claim, byId);
    issues.push(...analysis.issues);
    next.push({
      ...claim,
      confidence: analysis.cappedConfidence,
      provisional: analysis.provisional || claim.provisional,
      provenance: claim.evidenceRefs
        .map((id) => byId.get(id))
        .filter((e): e is AnnotatedMemoryHit => Boolean(e))
        .map((e) => ({
          sourceFamily: e.sourceFamily,
          evidenceType:
            claim.claimType === "hypothesis"
              ? ("hypothesis" as const)
              : claim.claimType === "fact"
                ? ("observation" as const)
                : claim.claimType === "observation"
                  ? ("observation" as const)
                  : ("interpretation" as const),
          supportKind: e.supportKind,
          distillateId: e.evidenceStrength === "distillate" ? e.id : undefined,
          recordId: e.evidenceStrength === "keyword_only" ? e.id : undefined,
          observedAt: undefined,
          independenceGroup: e.independenceGroup,
          excerpt: e.snippet.slice(0, 160),
          weight:
            e.supportKind === "assistant_derived"
              ? 0.25
              : e.evidenceStrength === "distillate"
                ? 0.85
                : 0.45,
        })),
    });
  }

  return { claims: next, issues };
}

/** Pure helpers for insight-quality fixtures / quality-gate. */
export function provenanceCoverage(
  claims: ProvenanceClaim[],
): { total: number; withProvenance: number; rate: number } {
  const material = claims.filter((c) => c.claimType !== "hypothesis");
  const withProvenance = material.filter((c) => c.evidenceRefs.length > 0);
  const total = material.length;
  return {
    total,
    withProvenance: withProvenance.length,
    rate: total === 0 ? 1 : withProvenance.length / total,
  };
}
