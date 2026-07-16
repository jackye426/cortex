import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  _resetCapabilitiesForTests,
  classifyEvidenceRequest,
  mintCapability,
  retrieveSupportingEvidence,
} from "./evidence-broker.js";
import { FixtureStore } from "./store/fixture-store.js";

describe("evidence broker policy", () => {
  beforeEach(() => {
    _resetCapabilitiesForTests();
  });

  it("classifies routine vs sensitive vs restricted fields", () => {
    assert.equal(
      classifyEvidenceRequest(["email"], ["timestamp", "subject", "sender"]),
      "routine",
    );
    assert.equal(
      classifyEvidenceRequest(["email"], ["body_excerpt"]),
      "sensitive",
    );
    assert.equal(
      classifyEvidenceRequest(["session"], ["title"]),
      "sensitive",
    );
    assert.equal(
      classifyEvidenceRequest(["drive"], ["full_body"]),
      "restricted",
    );
  });

  it("denies sensitive retrieve without capability", async () => {
    const store = new FixtureStore();
    const result = await retrieveSupportingEvidence(
      store,
      "mirror",
      {
        purpose: "test",
        sourceTypes: ["email"],
        permittedFields: ["body_excerpt"],
        maxResults: 3,
      },
      "test-token",
    );
    assert.equal(result.ok, false);
    assert.equal(result.denied, "needs_capability");
  });

  it("mints sensitive capability and allows scoped retrieve", async () => {
    const store = new FixtureStore();
    const since = "2026-07-01T00:00:00.000Z";
    const until = "2026-07-15T00:00:00.000Z";
    const minted = mintCapability({
      purpose: "docmap email check",
      class: "sensitive",
      sourceTypes: ["email"],
      dateRange: { since, until },
      maxResults: 5,
      permittedFields: ["timestamp", "subject", "snippet"],
      issuedBy: "mirror",
    });
    assert.equal(minted.ok, true);
    if (!minted.ok) return;

    const result = await retrieveSupportingEvidence(
      store,
      "mirror",
      {
        purpose: "docmap email check",
        sourceTypes: ["email"],
        dateRange: { since, until },
        permittedFields: ["timestamp", "subject", "snippet"],
        capabilityId: minted.capability.id,
        maxResults: 5,
      },
      "test-token",
    );
    assert.equal(result.ok, true);
    assert.equal(result.ephemeral, true);
  });

  it("rejects restricted mint from mirror", () => {
    const minted = mintCapability({
      purpose: "need passwords folder",
      class: "restricted",
      sourceTypes: ["drive"],
      dateRange: {
        since: "2026-07-01T00:00:00.000Z",
        until: "2026-07-10T00:00:00.000Z",
      },
      maxResults: 2,
      permittedFields: ["text_preview"],
      issuedBy: "mirror",
    });
    assert.equal(minted.ok, false);
    if (minted.ok) return;
    assert.equal(minted.denied, "ops_only");
  });
});
