/**
 * ask_mirror source-aware boost spot-checks (fixture store).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askMirror } from "./analyst.js";
import { FixtureStore } from "./store/fixture-store.js";

describe("ask_mirror source boosts", () => {
  const store = new FixtureStore();

  it("cites github_outcome_digest for shipped/stalled questions", async () => {
    const result = await askMirror(store, {
      query: "What PRs shipped or stalled on GitHub?",
      mode: "operational",
      limit: 10,
    });
    assert.ok(
      result.evidence.some((e) => e.kind === "github_outcome_digest"),
      `expected github_outcome_digest in ${result.evidence.map((e) => e.kind).join(",")}`,
    );
  });

  it("cites calendar_event_digest for meeting questions", async () => {
    const result = await askMirror(store, {
      query: "Which calendar meetings relate to Cortex?",
      mode: "operational",
      limit: 10,
    });
    assert.ok(
      result.evidence.some((e) => e.kind === "calendar_event_digest"),
      `expected calendar_event_digest in ${result.evidence.map((e) => e.kind).join(",")}`,
    );
  });

  it("cites drive_file_digest for doc/spec questions", async () => {
    const result = await askMirror(store, {
      query: "What Drive docs or specs did I revise for Cortex?",
      mode: "operational",
      limit: 10,
    });
    assert.ok(
      result.evidence.some((e) => e.kind === "drive_file_digest"),
      `expected drive_file_digest in ${result.evidence.map((e) => e.kind).join(",")}`,
    );
  });

  it("cites youtube_interest_digest when asking about watching", async () => {
    const result = await askMirror(store, {
      query: "What YouTube themes recur in my watching?",
      mode: "reflective",
      limit: 10,
    });
    assert.ok(
      result.evidence.some((e) => e.kind === "youtube_interest_digest"),
      `expected youtube_interest_digest in ${result.evidence.map((e) => e.kind).join(",")}`,
    );
  });
});
