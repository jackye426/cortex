import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemorySearchHit } from "../store/types.js";
import { balanceMemoryHits, familyHistogram } from "./balanced-retrieve.js";

function hit(
  id: string,
  kind: string,
  score: number,
  opts?: { recordType?: string; sourceId?: string },
): MemorySearchHit {
  return {
    kind: opts?.recordType ? "record" : "distillate",
    id,
    score,
    title: kind,
    snippet: kind,
    distillateKind: opts?.recordType ? undefined : kind,
    recordType: opts?.recordType,
    sourceId: opts?.sourceId,
  };
}

describe("balanceMemoryHits", () => {
  it("prevents ai_sessions from monopolizing top-k", () => {
    const hits: MemorySearchHit[] = [
      hit("s1", "summary", 0.99),
      hit("s2", "summary", 0.98),
      hit("s3", "summary", 0.97),
      hit("s4", "summary", 0.96),
      hit("s5", "summary", 0.95),
      hit("y1", "youtube_interest_digest", 0.7),
      hit("b1", "browser_interest_digest", 0.68),
      hit("g1", "github_outcome_digest", 0.66),
    ];
    const balanced = balanceMemoryHits(hits, { limit: 6, perFamily: 2 });
    const hist = familyHistogram(balanced);
    // First pass takes ≤perFamily per bucket; remainder may add one more high-score family.
    assert.ok(
      (hist.ai_sessions ?? 0) <= 3,
      `expected ai_sessions not to dominate, got ${JSON.stringify(hist)}`,
    );
    assert.ok(
      (hist.ai_sessions ?? 0) < balanced.length,
      "expected non-AI families present",
    );
    assert.ok((hist.media_youtube ?? 0) >= 1, "expected youtube family");
    assert.ok((hist.browser ?? 0) >= 1, "expected browser family");
    assert.ok((hist.github ?? 0) >= 1, "expected github family");
  });

  it("annotates supportKind for portrait as assistant_derived", () => {
    const balanced = balanceMemoryHits(
      [hit("p1", "portrait", 0.8)],
      { limit: 3 },
    );
    assert.equal(balanced[0]?.supportKind, "assistant_derived");
    assert.equal(balanced[0]?.sourceFamily, "reflections");
  });
});
