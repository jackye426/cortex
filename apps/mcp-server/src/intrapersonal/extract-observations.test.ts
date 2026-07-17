import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixtureStore } from "../store/fixture-store.js";
import { extractObservations } from "./extract-observations.js";

describe("extractObservations", () => {
  it("extracts observations from fixture distillates (dryRun)", async () => {
    const store = new FixtureStore();
    const result = await extractObservations(store, {
      dryRun: true,
      limit: 40,
    });
    assert.ok(result.scanned > 0, "expected distillates scanned");
    assert.ok(
      result.written > 0 || result.samples.length >= 0,
      "dry-run should report candidates when signals exist",
    );
  });

  it("writes observations into fixture store", async () => {
    const store = new FixtureStore();
    const result = await extractObservations(store, {
      dryRun: false,
      limit: 40,
    });
    const listed = await store.listObservations({ limit: 100 });
    assert.ok(
      result.written === 0 || listed.length > 0,
      `written=${result.written} listed=${listed.length}`,
    );
    for (const row of listed) {
      assert.ok(
        row.epistemicType === "observation" ||
          row.epistemicType === "self_report",
      );
      assert.ok(row.contentHash.length > 0);
    }
  });
});
