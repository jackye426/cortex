/**
 * Connection candidate ranking tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankConnectionCandidates } from "./connection-candidates.js";
import { fixtureEmbedFromText } from "./store/search-helpers.js";

describe("rankConnectionCandidates", () => {
  it("ranks cross-source topic+semantic overlap above keyword coincidence", () => {
    const session = {
      id: "s1",
      kind: "summary",
      sourceType: "cursor",
      content: "Built agent memory retrieval for Cortex twin",
      topics: ["agent-memory", "cortex"],
      projects: ["cortex"],
      occurredAt: "2026-07-10T00:00:00.000Z",
      embedding: fixtureEmbedFromText("agent memory retrieval cortex twin"),
    };
    const youtube = {
      id: "y1",
      kind: "youtube_interest_digest",
      sourceType: "youtube",
      content: "Watched videos about agent memory and cognitive architectures",
      topics: ["agent-memory", "cognitive-architecture"],
      projects: [],
      occurredAt: "2026-07-11T00:00:00.000Z",
      embedding: fixtureEmbedFromText("agent memory cognitive architectures"),
    };
    const weak = {
      id: "y2",
      kind: "youtube_interest_digest",
      sourceType: "youtube",
      content: "Cooking pasta recipes",
      topics: ["cooking"],
      projects: [],
      occurredAt: "2026-07-11T00:00:00.000Z",
      embedding: fixtureEmbedFromText("cooking pasta recipes"),
    };
    const ranked = rankConnectionCandidates([session, youtube, weak]);
    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0]!.a.id === "s1" || ranked[0]!.b.id === "s1", true);
    assert.equal(
      ranked[0]!.a.id === "y1" || ranked[0]!.b.id === "y1",
      true,
    );
    assert.ok(ranked[0]!.score > 0.28);
    assert.ok(ranked[0]!.reasons.some((r) => /cross-source|topic|semantic/i.test(r)));
  });

  it("does not create high confidence from generic single-topic alone", () => {
    const a = {
      id: "a",
      kind: "summary",
      sourceType: "cursor",
      content: "misc",
      topics: ["ai"],
      projects: [],
      occurredAt: "2026-01-01T00:00:00.000Z",
    };
    const b = {
      id: "b",
      kind: "youtube_interest_digest",
      sourceType: "youtube",
      content: "misc",
      topics: ["ai"],
      projects: [],
      occurredAt: "2026-06-01T00:00:00.000Z",
    };
    const ranked = rankConnectionCandidates([a, b]);
    // Weak generic overlap + distant time should be filtered or low
    assert.ok(ranked.length === 0 || ranked[0]!.score < 0.45);
  });
});
