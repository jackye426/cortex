/**
 * Insight-quality fixtures for evidence integrity (Slice S0/S1).
 */
import {
  enforceClaimEvidencePolicy,
  provenanceCoverage,
} from "../intrapersonal/circular-evidence.js";
import type {
  AnnotatedMemoryHit,
  InsightQualityIssue,
  ProvenanceClaim,
} from "../intrapersonal/types.js";

export interface InsightFixture {
  id: string;
  description: string;
  evidence: AnnotatedMemoryHit[];
  claims: ProvenanceClaim[];
  /** Issue codes that must appear after policy enforcement. */
  expectIssueCodes: Array<InsightQualityIssue["code"]>;
  /** Require 100% provenance coverage on material claims after filter? */
  expectFullProvenance?: boolean;
}

function hit(
  partial: Partial<AnnotatedMemoryHit> &
    Pick<AnnotatedMemoryHit, "id" | "kind" | "sourceFamily">,
): AnnotatedMemoryHit {
  return {
    title: partial.title ?? partial.kind,
    snippet: partial.snippet ?? "snippet",
    score: partial.score ?? 0.7,
    evidenceStrength: partial.evidenceStrength ?? "distillate",
    independenceGroup:
      partial.independenceGroup ?? `${partial.sourceFamily}:test`,
    supportKind: partial.supportKind ?? "direct_observation",
    distillateKind: partial.distillateKind ?? partial.kind,
    ...partial,
  };
}

export const INSIGHT_QUALITY_FIXTURES: InsightFixture[] = [
  {
    id: "missing-provenance",
    description: "Non-hypothesis claim without evidence refs fails.",
    evidence: [
      hit({
        id: "d1",
        kind: "summary",
        sourceFamily: "ai_sessions",
      }),
    ],
    claims: [
      {
        text: "Jack always finishes Cortex work.",
        claimType: "observation",
        confidence: 0.8,
        evidenceRefs: [],
      },
    ],
    expectIssueCodes: ["missing_provenance"],
    expectFullProvenance: false,
  },
  {
    id: "circular-portrait-only",
    description: "Portrait-only support is circular / assistant-derived.",
    evidence: [
      hit({
        id: "p1",
        kind: "portrait",
        distillateKind: "portrait",
        sourceFamily: "reflections",
        supportKind: "assistant_derived",
      }),
      hit({
        id: "s1",
        kind: "self_model",
        distillateKind: "self_model",
        sourceFamily: "reflections",
        supportKind: "assistant_derived",
      }),
    ],
    claims: [
      {
        text: "Aesthetic discrimination is a core identity trait.",
        claimType: "observation",
        confidence: 0.85,
        evidenceRefs: ["p1", "s1"],
      },
    ],
    expectIssueCodes: [
      "circular_evidence",
      "assistant_only_high_confidence",
    ],
  },
  {
    id: "insufficient-diversity",
    description: "High confidence with a single family is provisional.",
    evidence: [
      hit({
        id: "y1",
        kind: "youtube_interest_digest",
        sourceFamily: "media_youtube",
      }),
      hit({
        id: "y2",
        kind: "youtube_interest_digest",
        sourceFamily: "media_youtube",
        independenceGroup: "media_youtube:week2",
      }),
    ],
    claims: [
      {
        text: "Architecture is a terminal interest.",
        claimType: "observation",
        confidence: 0.9,
        evidenceRefs: ["y1", "y2"],
      },
    ],
    expectIssueCodes: ["insufficient_source_diversity"],
  },
  {
    id: "good-multi-source",
    description: "Multi-family cited observation passes cleanly.",
    evidence: [
      hit({
        id: "y1",
        kind: "youtube_interest_digest",
        sourceFamily: "media_youtube",
      }),
      hit({
        id: "b1",
        kind: "browser_interest_digest",
        sourceFamily: "browser",
      }),
      hit({
        id: "s1",
        kind: "summary",
        sourceFamily: "ai_sessions",
      }),
    ],
    claims: [
      {
        text: "Returned to gallery and architecture questions across contexts.",
        claimType: "observation",
        confidence: 0.75,
        evidenceRefs: ["y1", "b1", "s1"],
      },
    ],
    expectIssueCodes: [],
    expectFullProvenance: true,
  },
];

export interface InsightFixtureResult {
  id: string;
  pass: boolean;
  issues: InsightQualityIssue[];
  missingCodes: string[];
  unexpectedFatal: boolean;
  provenanceRate: number;
}

export function runInsightQualityFixtures(
  fixtures: InsightFixture[] = INSIGHT_QUALITY_FIXTURES,
): {
  passed: number;
  total: number;
  results: InsightFixtureResult[];
} {
  const results: InsightFixtureResult[] = [];
  let passed = 0;

  for (const fixture of fixtures) {
    const { claims, issues } = enforceClaimEvidencePolicy(
      fixture.claims,
      fixture.evidence,
    );
    const codes = new Set(issues.map((i) => i.code));
    const missingCodes = fixture.expectIssueCodes.filter((c) => !codes.has(c));
    const coverage = provenanceCoverage(claims);
    const provenanceOk =
      fixture.expectFullProvenance === true ? coverage.rate === 1 : true;

    const pass = missingCodes.length === 0 && provenanceOk;
    if (pass) passed += 1;
    results.push({
      id: fixture.id,
      pass,
      issues,
      missingCodes,
      unexpectedFatal: false,
      provenanceRate: coverage.rate,
    });
  }

  return { passed, total: fixtures.length, results };
}
