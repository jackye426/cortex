/**
 * Session sampler unit tests.
 * Run: pnpm --filter @cortex/mcp-server test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SAMPLE_STRATEGY,
  sampleSessionTurns,
  type SampleTurn,
} from "./session-sampler.js";

function makeTurns(n: number, opts?: { toolAt?: number[]; endDecision?: boolean }): SampleTurn[] {
  const turns: SampleTurn[] = [];
  for (let i = 0; i < n; i++) {
    const toolHeavy = opts?.toolAt?.includes(i) ?? false;
    let content = `turn-${i} ordinary discussion about wiring the API`;
    if (i === 0) content = "user goal: build twin pipeline";
    if (opts?.endDecision && i === n - 1) {
      content = "FINAL DECISION: ship twin-pipeline with YouTube digests first";
    }
    if (toolHeavy) content = `tool Write apps/mcp-server/src/file-${i}.ts`;
    turns.push({
      index: i,
      role: toolHeavy ? "assistant" : i % 2 === 0 ? "user" : "assistant",
      content,
      toolHeavy,
    });
  }
  return turns;
}

describe("sampleSessionTurns", () => {
  it("preserves all turns for short sessions", () => {
    const turns = makeTurns(12);
    const result = sampleSessionTurns(turns);
    assert.equal(result.turns.length, 12);
    assert.equal(result.metadataOnly, false);
    assert.deepEqual(result.indices, [...Array(12).keys()]);
  });

  it("keeps first, last decision, and tool-heavy middle on long sessions", () => {
    const toolAt = [20, 21, 22, 23, 24, 25];
    const turns = makeTurns(80, { toolAt, endDecision: true });
    const result = sampleSessionTurns(turns);
    assert.ok(result.turns.length <= DEFAULT_SAMPLE_STRATEGY.maxTotal);
    assert.ok(result.indices.includes(0));
    assert.ok(result.indices.includes(79));
    const texts = result.turns.map((t) => t.content).join("\n");
    assert.match(texts, /FINAL DECISION/);
    assert.match(texts, /tool Write/);
    // first framing present
    assert.match(texts, /twin pipeline/);
  });

  it("does not duplicate overlapping category indices", () => {
    const turns = makeTurns(50, { toolAt: [0, 1, 48, 49] });
    const result = sampleSessionTurns(turns);
    assert.equal(result.indices.length, new Set(result.indices).size);
    assert.deepEqual(result.indices, [...result.indices].sort((a, b) => a - b));
  });

  it("marks empty sessions as metadata-only", () => {
    const result = sampleSessionTurns([]);
    assert.equal(result.metadataOnly, true);
    assert.equal(result.turns.length, 0);
  });

  it("truncates excerpt characters deterministically", () => {
    const long = "x".repeat(2000);
    const result = sampleSessionTurns([
      { index: 0, role: "user", content: long },
    ]);
    assert.equal(result.turns[0]!.content.length, DEFAULT_SAMPLE_STRATEGY.excerptChars);
  });
});
