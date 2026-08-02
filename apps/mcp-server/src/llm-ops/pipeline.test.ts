import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixtureStore } from "../store/fixture-store.js";
import { runCodingOpsPipeline } from "../session-ops/pipeline.js";
import {
  getLatestLlmOperatorProfile,
  listLlmEpisodeScores,
  listLlmOpsDigests,
  runLlmOpsPipeline,
} from "./pipeline.js";

describe("runLlmOpsPipeline", () => {
  it("scores chatgpt fixture and skips coding sources", async () => {
    const store = new FixtureStore();
    const result = await runLlmOpsPipeline(store, {
      dryRun: true,
      limit: 20,
    });
    assert.ok(result.scanned >= 1, `scanned=${result.scanned}`);
    assert.ok(result.episodes >= 1, `episodes=${result.episodes}`);
    assert.ok(result.profile);
    assert.ok(
      result.samples.every((s) => s.sourceId !== "cursor"),
      "coding sessions must not appear as llm-ops samples when filtered",
    );
    // coding sources are skipped before scan; chatgpt should be present
    assert.ok(
      result.samples.some((s) => s.sourceId === "chatgpt-export"),
      "expected chatgpt-export sample",
    );
  });

  it("writes llm distillates", async () => {
    const store = new FixtureStore();
    const result = await runLlmOpsPipeline(store, {
      dryRun: false,
      limit: 20,
    });
    assert.equal(result.profileWritten, true);
    const digests = await listLlmOpsDigests(store, { limit: 20 });
    assert.ok(digests.length >= 1, `digests=${digests.length}`);
    const scores = await listLlmEpisodeScores(store, { limit: 20 });
    assert.ok(scores.length >= 1);
    const profile = await getLatestLlmOperatorProfile(store);
    assert.ok(profile);
    assert.ok(profile!.profile.axes);
  });

  it("coding-ops ignores chatgpt-export", async () => {
    const store = new FixtureStore();
    const coding = await runCodingOpsPipeline(store, {
      dryRun: true,
      stubOnly: true,
      limit: 20,
    });
    assert.ok(
      coding.samples.every((s) => s.sessionId !== "33333333-3333-4333-8333-333333333333"),
    );
    assert.ok(coding.scanned >= 2);
  });
});
