import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inWeek,
  isoWeekKey,
  sourceFingerprint,
  weekRange,
} from "./week-helpers.js";
import { driveSensitiveReasons } from "./source-adapters.js";
import type { RecordHit } from "./store/types.js";

describe("week-helpers", () => {
  it("formats ISO week keys", () => {
    // 2026-07-16 is Thursday → 2026-W29
    assert.equal(isoWeekKey(new Date("2026-07-16T12:00:00Z")), "2026-W29");
  });

  it("weekRange is half-open Monday→next Monday", () => {
    const { start, end } = weekRange("2026-W29");
    assert.equal(start.startsWith("2026-07-13"), true);
    assert.equal(end.startsWith("2026-07-20"), true);
    assert.equal(inWeek("2026-07-13T00:00:00.000Z", start, end), true);
    assert.equal(inWeek("2026-07-20T00:00:00.000Z", start, end), false);
  });

  it("sourceFingerprint changes when members or latest time change", () => {
    const a = sourceFingerprint([
      { sourceRecordId: "b", occurredAt: "2026-01-01T00:00:00Z" },
      { sourceRecordId: "a", occurredAt: "2026-01-02T00:00:00Z" },
    ]);
    const b = sourceFingerprint([
      { sourceRecordId: "a", occurredAt: "2026-01-02T00:00:00Z" },
      { sourceRecordId: "b", occurredAt: "2026-01-01T00:00:00Z" },
    ]);
    assert.equal(a, b);
    const c = sourceFingerprint([
      { sourceRecordId: "a", occurredAt: "2026-01-03T00:00:00Z" },
      { sourceRecordId: "b", occurredAt: "2026-01-01T00:00:00Z" },
    ]);
    assert.notEqual(a, c);
  });
});

describe("drive sensitivity gate", () => {
  function hit(payload: Record<string, unknown>): RecordHit {
    return {
      id: "r1",
      sourceId: "drive",
      sourceRecordId: "f1",
      recordType: "drive_file",
      payload,
      contentHash: "test",
      occurredAt: "2026-07-01T00:00:00Z",
    };
  }

  it("flags sensitive path/filename without logging content", () => {
    const reasons = driveSensitiveReasons(
      hit({ name: "passwords.xlsx", folderPath: "/Personal/passwords" }),
    );
    assert.ok(reasons.includes("path") || reasons.includes("filename"));
  });

  it("flags secret patterns in preview", () => {
    const reasons = driveSensitiveReasons(
      hit({
        name: "notes.md",
        textPreview: "token sk-ant-abcdefghijklmnopqrstuvwxyz123456",
      }),
    );
    assert.ok(reasons.includes("secret_pattern"));
  });

  it("allows ordinary specs", () => {
    const reasons = driveSensitiveReasons(
      hit({
        name: "Cortex memory spec.md",
        folderPath: "/Projects/Cortex",
        textPreview: "Operational digests use compilerVersion.",
      }),
    );
    assert.deepEqual(reasons, []);
  });
});
