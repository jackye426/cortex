import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInsightQualityFixtures } from "../eval/insight-quality.js";
import {
  enforceClaimEvidencePolicy,
  provenanceCoverage,
} from "./circular-evidence.js";
import type { AnnotatedMemoryHit } from "./types.js";

describe("circular evidence policy", () => {
  it("passes all insight-quality fixtures", () => {
    const { passed, total, results } = runInsightQualityFixtures();
    assert.equal(
      passed,
      total,
      results
        .filter((r) => !r.pass)
        .map((r) => `${r.id}: missing=${r.missingCodes.join(",")}`)
        .join("; "),
    );
  });

  it("caps assistant-only high confidence", () => {
    const evidence: AnnotatedMemoryHit[] = [
      {
        id: "p1",
        kind: "portrait",
        distillateKind: "portrait",
        title: "portrait",
        snippet: "x",
        score: 0.9,
        evidenceStrength: "distillate",
        sourceFamily: "reflections",
        independenceGroup: "reflections:portrait",
        supportKind: "assistant_derived",
      },
    ];
    const { claims, issues } = enforceClaimEvidencePolicy(
      [
        {
          text: "Core trait X",
          claimType: "observation",
          confidence: 0.9,
          evidenceRefs: ["p1"],
        },
      ],
      evidence,
    );
    assert.ok(claims[0]!.confidence <= 0.4);
    assert.ok(issues.some((i) => i.code === "circular_evidence"));
  });

  it("reports full provenance coverage when refs present", () => {
    const cov = provenanceCoverage([
      {
        text: "a",
        claimType: "observation",
        confidence: 0.5,
        evidenceRefs: ["d1"],
      },
      {
        text: "h",
        claimType: "hypothesis",
        confidence: 0.5,
        evidenceRefs: [],
      },
    ]);
    assert.equal(cov.rate, 1);
    assert.equal(cov.total, 1);
  });
});
