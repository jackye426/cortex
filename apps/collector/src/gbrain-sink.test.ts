import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { RawEnvelope } from "@cortex/core";
import {
  flushDigests,
  sinkEnvelope,
  type DigestAccumulator,
} from "./gbrain-sink.js";

function codingEnvelope(): RawEnvelope {
  return {
    source: "claude-code",
    sourceRecordId: "fixture-claude-1",
    occurredAt: "2026-07-10T14:00:00.000Z",
    body: { kind: "claude_code_session", sessionId: "fixture-claude-1" },
    provenance: {
      collector: "test",
      workspace: "Cortex",
      extra: {
        kind: "claude_code_session_summary",
        summary: {
          sessionId: "fixture-claude-1",
          title: "Wire Cortex ingest API",
          cwd: "Cortex",
          occurredAt: "2026-07-10T14:00:00.000Z",
          turns: [
            {
              role: "user",
              uuid: "m1",
              textPreview:
                "Add bearer auth. Dry-run first, no secrets, do not commit.",
            },
            {
              role: "assistant",
              uuid: "m2",
              textPreview: "Adding middleware.",
              tools: [
                {
                  name: "Write",
                  id: "t1",
                  argsPreview: "file_path=.claude/plans/INGEST_AUTH_PLAN.md",
                },
                {
                  name: "Bash",
                  id: "t2",
                  argsPreview: 'git commit -m "feat: bearer auth on ingest"',
                },
              ],
            },
          ],
        },
      },
    },
  };
}

describe("gbrain-dir sink", () => {
  it("writes session-v1 with cortex_schema and ## Tools", () => {
    const brainDir = mkdtempSync(join(tmpdir(), "gbrain-sink-"));
    const buckets = new Map<string, DigestAccumulator>();
    const result = sinkEnvelope(
      codingEnvelope(),
      { brainDir, dryRun: false },
      buckets,
    );
    assert.equal(result.kind, "session");
    assert.ok(result.path?.includes("conversations/claude-code/"));
    assert.equal(result.written, true);
    const abs = join(brainDir, result.path!);
    const md = readFileSync(abs, "utf8");
    assert.match(md, /cortex_schema: session-v1/);
    assert.match(md, /## Tools/);
    assert.match(md, /git commit/);
  });

  it("dry-run prints path contract without writing", () => {
    const brainDir = mkdtempSync(join(tmpdir(), "gbrain-dry-"));
    const buckets = new Map<string, DigestAccumulator>();
    const result = sinkEnvelope(
      codingEnvelope(),
      { brainDir, dryRun: true },
      buckets,
    );
    assert.equal(result.written, false);
    assert.ok(result.path?.endsWith(".md"));
    let names: string[] = [];
    try {
      names = readdirSync(join(brainDir, "conversations"));
    } catch {
      names = [];
    }
    assert.equal(names.length, 0);
  });

  it("does not emit per-track pages for youtube — one digest per ISO week", () => {
    const brainDir = mkdtempSync(join(tmpdir(), "gbrain-yt-"));
    const buckets = new Map<string, DigestAccumulator>();
    const watches: RawEnvelope[] = [
      {
        source: "youtube",
        sourceRecordId: "vid-1",
        occurredAt: "2026-07-10T20:00:00.000Z",
        body: { kind: "youtube_watch", title: "Agent memory" },
        provenance: {
          collector: "test",
          extra: { summary: { title: "Agent memory" } },
        },
      },
      {
        source: "youtube",
        sourceRecordId: "vid-2",
        occurredAt: "2026-07-11T21:00:00.000Z",
        body: { kind: "youtube_watch", title: "Cognitive architectures" },
        provenance: {
          collector: "test",
          extra: { summary: { title: "Cognitive architectures" } },
        },
      },
    ];
    for (const env of watches) {
      const r = sinkEnvelope(env, { brainDir, dryRun: false }, buckets);
      assert.equal(r.kind, "digest");
      assert.equal(r.written, false);
    }
    const flushed = flushDigests(buckets, { brainDir, dryRun: false });
    assert.equal(flushed.length, 1);
    assert.ok(flushed[0]!.path?.includes("digests/youtube/"));
    const md = readFileSync(join(brainDir, flushed[0]!.path!), "utf8");
    assert.match(md, /one page per ISO week|Not a per-event page/i);
    assert.match(md, /vid-1/);
    assert.match(md, /vid-2/);
  });

  it("skips sensitivity-flagged Drive files", () => {
    const brainDir = mkdtempSync(join(tmpdir(), "gbrain-drive-"));
    const env: RawEnvelope = {
      source: "drive",
      sourceRecordId: "file-secret",
      occurredAt: "2026-07-08T12:00:00.000Z",
      body: {
        kind: "drive_file",
        name: "passwords.xlsx",
        folderPath: "/Personal/passwords",
      },
      provenance: { collector: "test" },
    };
    const r = sinkEnvelope(env, { brainDir, dryRun: false }, new Map());
    assert.equal(r.kind, "skip");
    assert.match(r.reason ?? "", /sensitivity/);
  });

  it("skips GitHub as GBrain native", () => {
    const env: RawEnvelope = {
      source: "github",
      sourceRecordId: "pr-42",
      body: { kind: "github_pr" },
      provenance: { collector: "test" },
    };
    const r = sinkEnvelope(env, { brainDir: "/tmp/x", dryRun: true }, new Map());
    assert.equal(r.kind, "skip");
    assert.match(r.reason ?? "", /GBrain native/);
  });
});
