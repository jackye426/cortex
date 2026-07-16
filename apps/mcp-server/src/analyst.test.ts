/**
 * Analyst citation validation tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { _validateClaimsForTest } from "./analyst.js";

describe("ask_mirror claim validation", () => {
  it("drops fabricated evidence ids from non-hypothesis claims", () => {
    const validated = _validateClaimsForTest(
      [
        {
          text: "ok",
          claimType: "fact",
          confidence: 0.9,
          evidenceRefs: ["real-1", "fake-9"],
        },
        {
          text: "guess",
          claimType: "hypothesis",
          confidence: 0.4,
          evidenceRefs: [],
        },
      ],
      ["real-1"],
    );
    assert.equal(validated.length, 2);
    assert.deepEqual(validated[0]!.evidenceRefs, ["real-1"]);
    assert.equal(validated[1]!.claimType, "hypothesis");
  });

  it("removes fact claims that lose all evidence refs", () => {
    const validated = _validateClaimsForTest(
      [
        {
          text: "unsupported",
          claimType: "fact",
          confidence: 0.9,
          evidenceRefs: ["nope"],
        },
      ],
      ["real-1"],
    );
    assert.equal(validated.length, 0);
  });
});
