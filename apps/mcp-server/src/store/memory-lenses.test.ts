/**
 * Memory lens filter tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  distillateMatchesLenses,
  kindsForMode,
} from "./memory-lenses.js";

describe("memory lenses", () => {
  it("maps operational mode to work kinds", () => {
    const kinds = kindsForMode("operational");
    assert.ok(kinds?.includes("summary"));
    assert.ok(kinds?.includes("project_brief"));
    assert.ok(kinds?.includes("drive_file_digest"));
    assert.equal(kinds?.includes("youtube_interest_digest"), false);
  });

  it("includes interest digests and intrapersonal views in reflective mode", () => {
    const kinds = kindsForMode("reflective");
    assert.ok(kinds?.includes("youtube_interest_digest"));
    assert.ok(kinds?.includes("weekly_mirror"));
    assert.ok(kinds?.includes("open_questions_snapshot"));
    assert.ok(kinds?.includes("change_report"));
    assert.ok(kinds?.includes("summary"));
  });

  it("filters by domain and topic metadata", () => {
    const d = {
      kind: "youtube_interest_digest",
      metadata: {
        domains: ["interest"],
        topics: ["agent-memory"],
        sourceType: "youtube",
        confidence: 0.8,
      },
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    assert.equal(
      distillateMatchesLenses(d, { domains: ["interest"], topics: ["agent"] }),
      true,
    );
    assert.equal(
      distillateMatchesLenses(d, { domains: ["work"] }),
      false,
    );
    assert.equal(
      distillateMatchesLenses(d, { minConfidence: 0.9 }),
      false,
    );
  });
});
