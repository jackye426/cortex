import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixtureStore } from "../store/fixture-store.js";
import { auditSourceCoverage } from "./source-health.js";

describe("auditSourceCoverage", () => {
  it("returns rows for tracked sources", async () => {
    const store = new FixtureStore();
    const report = await auditSourceCoverage(store);
    assert.ok(report.sources.length >= 10);
    assert.ok(typeof report.aiSessionShareOfRecentDistillates === "number");
    assert.ok(report.generatedAt);
  });
});
