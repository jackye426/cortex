import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSessionOps } from "../../../apps/mcp-server/src/session-ops/extract-events.js";
import { CLAUDE_FIXTURE_SESSION } from "./fixtures.js";
import { parseSessionPage } from "./parse.js";
import { renderSessionPage, renderSessionPageFull } from "./render.js";

describe("gbrain session-v1 roundtrip", () => {
  it("render → parse → extractSessionOps keeps rails, git_commit, plan, steering", () => {
    const markdown = renderSessionPage(CLAUDE_FIXTURE_SESSION);
    const parsed = parseSessionPage(markdown);
    assert.equal(parsed.sourceId, "claude-code");
    assert.equal(parsed.sourceSessionId, "fixture-claude-1");
    assert.equal(parsed.messages.length, CLAUDE_FIXTURE_SESSION.messages.length);
    assert.equal(parsed.toolCalls.length, CLAUDE_FIXTURE_SESSION.toolCalls.length);

    const digest = extractSessionOps(parsed);
    assert.ok(
      digest.events.some((e) => e.eventType === "user_directive"),
      "expected user_directive",
    );
    assert.ok(
      digest.events.some((e) => e.eventType === "git_commit"),
      "expected git_commit from Bash git commit",
    );
    assert.ok(
      digest.planFiles.length >= 1,
      "expected plan file from Write to .claude/plans",
    );
    assert.ok(
      digest.steeringTraces.length >= 1,
      "expected steering traces (dry-run / no secrets / do not commit)",
    );
  });

  it("redacts OpenAI-style keys from the written page", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz012345";
    const session = {
      ...CLAUDE_FIXTURE_SESSION,
      messages: [
        {
          id: "secret-user",
          role: "user",
          content: `Here is a leaked key ${secret} do not keep it.`,
        },
      ],
    };
    const rendered = renderSessionPageFull(session);
    assert.ok(rendered.redactionHitCount >= 1, "expected redaction hits");
    assert.equal(rendered.markdown.includes(secret), false);
    const parsed = parseSessionPage(rendered.markdown);
    const body = parsed.messages.map((m) => m.content ?? "").join("\n");
    assert.equal(body.includes(secret), false);
    assert.match(body, /\[REDACTED:openai_api_key\]/);
  });

  it("text-only gate: turns without ## Tools do not emit git_commit or plan files", () => {
    const full = renderSessionPage(CLAUDE_FIXTURE_SESSION);
    const cut = full.replace(/\n## Tools[\s\S]*$/, "\n");
    assert.equal(/^## Tools\s*$/m.test(cut), false, "tools section must be absent");
    const parsed = parseSessionPage(cut);
    assert.equal(parsed.toolCalls.length, 0);
    assert.ok(parsed.messages.length >= 1);
    const digest = extractSessionOps(parsed);
    assert.ok(
      digest.events.some((e) => e.eventType === "user_directive"),
      "turns still yield user_directive",
    );
    assert.equal(
      digest.events.some((e) => e.eventType === "git_commit"),
      false,
      "stock text-only ingest must not invent git_commit",
    );
    assert.equal(
      digest.planFiles.length,
      0,
      "stock text-only ingest must not invent plan files",
    );
  });
});
