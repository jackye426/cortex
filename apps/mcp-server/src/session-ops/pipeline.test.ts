import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixtureStore } from "../store/fixture-store.js";
import {
  getLatestCodingBuilderProfile,
  listEpisodeScores,
  listSessionOpsDigests,
  runCodingOpsPipeline,
} from "./pipeline.js";

describe("runCodingOpsPipeline", () => {
  it("dry-run builds digests, scores, and profile", async () => {
    const store = new FixtureStore();
    const result = await runCodingOpsPipeline(store, {
      dryRun: true,
      stubOnly: true,
      limit: 10,
    });
    assert.ok(result.scanned >= 2, `scanned=${result.scanned}`);
    assert.ok(result.episodes >= 1);
    assert.ok(result.scoresWritten >= 1);
    assert.ok(result.profile);
    assert.ok(result.profile!.metrics.sessionsScored >= 2);
    assert.ok(
      (result.profile!.growthEdges.length > 0 ||
        result.profile!.strengths.length > 0),
      "expected insight cards",
    );
  });

  it("writes distillates and reads them back", async () => {
    const store = new FixtureStore();
    const result = await runCodingOpsPipeline(store, {
      dryRun: false,
      stubOnly: true,
      limit: 10,
    });
    assert.equal(result.profileWritten, true);
    const digests = await listSessionOpsDigests(store, { limit: 20 });
    assert.ok(digests.length >= 2, `digests=${digests.length}`);
    const scores = await listEpisodeScores(store, { limit: 20 });
    assert.ok(scores.length >= 1, `scores=${scores.length}`);
    const profile = await getLatestCodingBuilderProfile(store);
    assert.ok(profile, "expected coding_builder_profile distillate");
    assert.ok(profile!.profile.axes);
  });
});
