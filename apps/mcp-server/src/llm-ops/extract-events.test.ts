import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionDetail } from "../store/types.js";
import {
  extractLlmOps,
  isThinBrief,
  deriveLlmDecisions,
} from "./extract-events.js";
import { scoreLlmEpisode } from "./score-episode.js";
import { buildLlmEpisodes } from "./episodes.js";
import { isCodingOpsSource } from "./types.js";

function chatSession(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    sourceId: "chatgpt-export",
    sourceSessionId: "fixture-chatgpt-1",
    title: "Research LLM evaluation methods",
    workspace: null,
    startedAt: "2026-07-20T10:00:00.000Z",
    endedAt: "2026-07-20T11:00:00.000Z",
    metadata: { fixture: true },
    messages: [
      {
        id: "c1",
        role: "user",
        content:
          "Compare Paxel-style session evaluation vs plain chat summaries. Done when I have a 5-bullet decision brief. Out of scope: building a product UI.",
      },
      {
        id: "c2",
        role: "assistant",
        content:
          "Option A: event extract then score. Option B: summarize only. Which approach?",
      },
      {
        id: "c3",
        role: "user",
        content:
          "Go with option A. Cite two concrete differences and give a rival explanation for why summaries alone feel insightful but fail.",
      },
      {
        id: "c4",
        role: "assistant",
        content: "Here is a long synthesis with citations and tradeoffs...",
      },
      {
        id: "c5",
        role: "user",
        content:
          "Decision: we will use event→score→profile. Next action: write the axis list tonight.",
      },
    ],
    toolCalls: [],
    distillate: null,
    ...overrides,
  };
}

describe("llm-ops extract", () => {
  it("marks thin briefs", () => {
    assert.equal(isThinBrief("Goal: Add"), true);
    assert.equal(isThinBrief("Add"), true);
    assert.equal(
      isThinBrief(
        "User: Jack. Job: compare eval methods. Done when: 5-bullet brief. Out of scope: UI.",
      ),
      false,
    );
  });

  it("skips coding sources for llm-ops ownership", () => {
    assert.equal(isCodingOpsSource("cursor"), true);
    const digest = extractLlmOps({
      ...chatSession(),
      sourceId: "cursor",
      id: "44444444-4444-4444-8444-444444444444",
    });
    assert.equal(digest.skipReason, "owned_by_coding_ops");
    assert.equal(digest.events.length, 0);
  });

  it("extracts user-attributed steering and proof events", () => {
    const digest = extractLlmOps(chatSession());
    assert.equal(digest.skipReason, null);
    assert.ok(digest.signals.userMessageCount >= 3);
    assert.ok(digest.events.every((e) => e.actor !== "unknown"));
    assert.ok(
      digest.events.some(
        (e) => e.eventType === "proof_requested" && e.actor === "user",
      ),
    );
    assert.ok(
      digest.events.some(
        (e) => e.eventType === "decision_recorded" && e.actor === "user",
      ),
    );
    const decisions = deriveLlmDecisions(digest, "ep-1");
    assert.ok(decisions.some((d) => d.decisionType === "evidence_demand"));
    assert.ok(decisions.some((d) => d.decisionType === "closure_act"));
  });

  it("scores with omitted axes rather than invented lows", () => {
    const digest = extractLlmOps(chatSession());
    const episodes = buildLlmEpisodes([digest]);
    assert.ok(episodes.length >= 1);
    const score = scoreLlmEpisode(episodes[0]!, [digest], []);
    assert.ok(Object.keys(score.scores).length >= 2);
    // Assistant proposals must not become user steering credit by themselves
    assert.ok(
      !digest.events.some(
        (e) => e.eventType === "steering_redirect" && e.actor === "assistant",
      ),
    );
  });
});
