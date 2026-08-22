import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { writeGbrainDelta } from "./post-ingest.mjs";
import { redactText, redactValue } from "./redact.mjs";

describe("hook redaction", () => {
  it("redacts OpenAI-style keys the same way as @cortex/redaction", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz012345";
    const result = redactText(`leaked ${secret}`);
    assert.ok(result.hitCount >= 1);
    assert.equal(result.text.includes(secret), false);
    assert.match(result.text, /\[REDACTED:openai_api_key\]/);
  });

  it("deep-redacts envelope bodies before GBrain write", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz012345";
    const dir = mkdtempSync(join(tmpdir(), "hook-redact-"));
    const prev = process.env.CORTEX_GBRAIN_DIR;
    process.env.CORTEX_GBRAIN_DIR = dir;
    try {
      const result = writeGbrainDelta({
        source: "claude-code",
        sourceRecordId: "hook-1",
        body: { kind: "claude_hook_delta", rawText: `token ${secret}` },
      });
      assert.equal(result.ok, true);
      assert.match(result.path, /^hooks[\\/]claude-code[\\/]hook-hook-1\.md$/);
      const md = readFileSync(join(dir, result.path), "utf8");
      assert.match(md, /cortex_schema: session-hook-delta-v1/);
      assert.equal(md.includes(secret), false);
      assert.ok(result.redactionHits >= 1);
    } finally {
      if (prev === undefined) delete process.env.CORTEX_GBRAIN_DIR;
      else process.env.CORTEX_GBRAIN_DIR = prev;
    }
  });

  it("redactValue walks nested objects", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz012345";
    const { value, hitCount } = redactValue({ a: { b: secret } });
    assert.ok(hitCount >= 1);
    assert.equal(JSON.stringify(value).includes(secret), false);
  });
});
