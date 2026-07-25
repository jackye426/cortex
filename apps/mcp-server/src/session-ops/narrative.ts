/**
 * Session narrative notes (human judgment). LLM when configured; stub otherwise.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatJsonCompletion, openaiConfigured } from "../llm.js";
import type { SessionOpsDigest } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface SessionNarrativeResult {
  markdown: string;
  sessionIntent: "shipping" | "exploration" | "ambiguous";
  model: string;
}

function stubNarrative(digest: SessionOpsDigest): SessionNarrativeResult {
  const redirects = digest.steeringTraces.filter((t) => t.kind !== "short_directive");
  const commits = digest.events.filter((e) => e.eventType === "git_commit").length;
  const intent: SessionNarrativeResult["sessionIntent"] =
    commits > 0 || /ship|implement|add|fix/i.test(digest.firstPrompt ?? "")
      ? "shipping"
      : /explor|investigat|understand|how does/i.test(digest.firstPrompt ?? "")
        ? "exploration"
        : "ambiguous";

  const md = [
    "## Goal",
    digest.firstPrompt
      ? `The developer aimed to: ${digest.firstPrompt}`
      : "Goal was not clearly stated in the first user turn.",
    "",
    "## What the Developer Decided",
    redirects.length
      ? redirects
          .slice(0, 4)
          .map((t) => `- Steering (${t.kind}): ${t.text}`)
          .join("\n")
      : "Mostly issued directives and accepted agent output without mid-course redirects.",
    "",
    "## Key Decisions",
    digest.planFiles.length
      ? `Plan artifacts present (${digest.planFiles.map((p) => p.filename).join(", ")}).`
      : "No plan-file artifact detected in tool events.",
    digest.sessionSignals.productReferences > 0
      ? "Product/user language appeared in user prompts."
      : "Little explicit product/user framing in user prompts.",
    "",
    "## Problems Encountered",
    digest.events.some((e) => e.eventType === "error_encountered")
      ? "Error signals appeared in assistant/tool output; resolution not fully established from grain."
      : "No clear error_encountered events in extracted grain.",
    "",
    "## Observations",
    `User messages=${digest.sessionSignals.userMessageCount}, avg words=${digest.sessionSignals.avgPromptWords}, steering traces=${digest.steeringTraces.length}. This may reflect clear upfront specs or light review — grain alone cannot distinguish.`,
    "",
    `<session_intent>${intent}</session_intent>`,
  ].join("\n");

  return { markdown: md, sessionIntent: intent, model: "stub" };
}

export async function generateSessionNarrative(
  digest: SessionOpsDigest,
  options: { stubOnly?: boolean } = {},
): Promise<SessionNarrativeResult> {
  if (options.stubOnly || !openaiConfigured()) {
    return stubNarrative(digest);
  }
  try {
    const system = `${readFileSync(join(HERE, "prompts", "session_narrative.md"), "utf8")}

Return a JSON object: { "markdown": string, "session_intent": "shipping"|"exploration"|"ambiguous" }.
The markdown must contain the five section headers from the instructions.`;
    const user = JSON.stringify(
      {
        title: digest.title,
        sourceId: digest.sourceId,
        firstPrompt: digest.firstPrompt,
        steeringTraces: digest.steeringTraces.slice(0, 20),
        userHighlights: digest.userHighlights.slice(0, 4000),
        signals: digest.sessionSignals,
        planFiles: digest.planFiles.map((p) => p.filename),
        eventSummary: {
          total: digest.events.length,
          byType: digest.events.reduce<Record<string, number>>((acc, e) => {
            acc[e.eventType] = (acc[e.eventType] ?? 0) + 1;
            return acc;
          }, {}),
        },
      },
      null,
      2,
    );
    const { text, model } = await chatJsonCompletion({
      system,
      user,
      temperature: 0.2,
    });
    const parsed = JSON.parse(text) as {
      markdown?: string;
      session_intent?: string;
    };
    const intent =
      parsed.session_intent === "shipping" ||
      parsed.session_intent === "exploration" ||
      parsed.session_intent === "ambiguous"
        ? parsed.session_intent
        : "ambiguous";
    let markdown = (parsed.markdown ?? "").trim();
    if (!markdown.includes("<session_intent>")) {
      markdown = `${markdown}\n\n<session_intent>${intent}</session_intent>`;
    }
    if (!markdown.includes("## Goal")) {
      return stubNarrative(digest);
    }
    return { markdown, sessionIntent: intent, model };
  } catch (err) {
    console.warn(
      "[session-ops/narrative] LLM failed:",
      err instanceof Error ? err.message : err,
    );
    return stubNarrative(digest);
  }
}
