import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIXTURE_SESSIONS } from "../store/fixtures.js";
import {
  extractSessionOps,
  isThinProductPrompt,
} from "./extract-events.js";

describe("extractSessionOps", () => {
  it("extracts events, steering, and plan files from rich fixture session", () => {
    const session = FIXTURE_SESSIONS[0]!;
    const digest = extractSessionOps(session);
    assert.equal(digest.sessionId, session.id);
    assert.ok(digest.events.length >= 4, `events=${digest.events.length}`);
    assert.ok(
      digest.events.some((e) => e.eventType === "user_directive"),
      "expected user_directive",
    );
    assert.ok(
      digest.events.some((e) => e.eventType === "git_commit"),
      "expected git_commit",
    );
    assert.ok(
      digest.steeringTraces.length >= 1,
      "expected steering traces from rails/redirect",
    );
    assert.ok(
      digest.planFiles.length >= 1,
      "expected plan file from Write to .claude/plans",
    );
    assert.ok(digest.firstPrompt && digest.firstPrompt.length > 10);
  });

  it("flags thin product prompts", () => {
    const thin = FIXTURE_SESSIONS[1]!;
    const digest = extractSessionOps(thin);
    assert.ok(isThinProductPrompt(digest.firstPrompt));
    assert.equal(isThinProductPrompt("Add bearer auth with acceptance tests for returning users"), false);
  });
});
