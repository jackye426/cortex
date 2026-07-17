import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixtureStore } from "../store/fixture-store.js";
import { classifyInterest, mineInterests } from "./interest-mine.js";
import type { InterestCandidate } from "./interest-mine.js";
import { refreshInterestMap } from "./interest-map.js";

function candidate(
  partial: Partial<InterestCandidate> & Pick<InterestCandidate, "canonicalKey">,
): InterestCandidate {
  return {
    displayName: partial.displayName ?? partial.canonicalKey,
    families: partial.families ?? new Set(["media_youtube", "browser"]),
    distillateIds: partial.distillateIds ?? ["d1", "d2"],
    projectKeys: partial.projectKeys ?? new Set(),
    dates: partial.dates ?? [
      "2026-06-01T00:00:00.000Z",
      "2026-07-10T00:00:00.000Z",
    ],
    recurringMentions: partial.recurringMentions ?? 2,
    topicMentions: partial.topicMentions ?? 4,
    fromWorkProject: partial.fromWorkProject ?? false,
    aspirationalLanguage: partial.aspirationalLanguage ?? false,
    ...partial,
  };
}

describe("classifyInterest", () => {
  it("marks multi-family voluntary return as terminal", () => {
    const result = classifyInterest(
      candidate({ canonicalKey: "architecture" }),
      new Date("2026-07-12T00:00:00.000Z"),
    );
    assert.equal(result.class, "terminal");
    assert.ok(result.voluntaryReturnScore >= 0.4);
  });

  it("marks work-only single-family as instrumental/situational", () => {
    const result = classifyInterest(
      candidate({
        canonicalKey: "cortex-mcp",
        families: new Set(["ai_sessions"]),
        fromWorkProject: true,
        projectKeys: new Set(["cortex"]),
        recurringMentions: 0,
        topicMentions: 2,
        dates: ["2026-07-11T00:00:00.000Z"],
      }),
      new Date("2026-07-12T00:00:00.000Z"),
    );
    assert.ok(
      result.class === "instrumental" || result.class === "situational",
      result.class,
    );
  });

  it("marks long-inactive recurring interest as dormant", () => {
    const result = classifyInterest(
      candidate({
        canonicalKey: "underwater-basket",
        dates: [
          "2025-01-01T00:00:00.000Z",
          "2025-02-01T00:00:00.000Z",
        ],
        topicMentions: 3,
        recurringMentions: 1,
      }),
      new Date("2026-07-12T00:00:00.000Z"),
    );
    assert.equal(result.class, "dormant");
    assert.equal(result.status, "dormant");
  });
});

describe("mineInterests + interest map", () => {
  it("mines multi-source architecture interest from fixtures", async () => {
    const store = new FixtureStore();
    const mined = await mineInterests(store, { dryRun: false, limit: 80 });
    assert.ok(mined.upserted > 0, "expected interests upserted");
    const listed = await store.listInterests({ limit: 50 });
    const architecture = listed.find((i) =>
      i.canonicalKey.includes("architecture"),
    );
    assert.ok(architecture, "expected architecture interest");
    const families = architecture.metadata.sourceFamilies;
    assert.ok(
      Array.isArray(families) && families.length >= 2,
      `expected multi-family evidence, got ${JSON.stringify(families)}`,
    );
  });

  it("compiles interest map with class sections", async () => {
    const store = new FixtureStore();
    const result = await refreshInterestMap(store, {
      dryRun: false,
      weekKey: "2026-W28",
    });
    assert.equal(result.written, true);
    assert.ok(result.map.sections.length === 5);
    const terminal = result.map.sections.find((s) => s.class === "terminal");
    assert.ok(terminal);
    const got = await store.listDistillates({
      limit: 5,
      kinds: ["interest_map"],
    });
    assert.ok(got.some((d) => d.kind === "interest_map"));
  });
});
