/**
 * Decision candidate extract + classify (catalog-backed).
 * LLM path when configured; heuristic fallback otherwise.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatJsonCompletion, openaiConfigured } from "../llm.js";
import type { CodingDecision, SessionOpsDigest } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface DecisionLaw {
  key: string;
  title: string;
  category: string;
  pattern: string;
}

let catalogCache: DecisionLaw[] | null = null;

export function loadDecisionCatalog(): DecisionLaw[] {
  if (catalogCache) return catalogCache;
  const raw = JSON.parse(
    readFileSync(join(HERE, "decision_catalog.json"), "utf8"),
  ) as DecisionLaw[] | { laws: DecisionLaw[] };
  catalogCache = Array.isArray(raw) ? raw : raw.laws;
  return catalogCache;
}

interface Candidate {
  eventIndex: number;
  proposalText: string;
  userResponse: string;
  unpaired: boolean;
}

function extractCandidates(digest: SessionOpsDigest): Candidate[] {
  const events = digest.events;
  const out: Candidate[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.eventType !== "agent_proposal") continue;
    const proposalText = String(e.payload.text ?? "");
    let userResponse = "";
    let unpaired = true;
    for (let j = i + 1; j < Math.min(i + 4, events.length); j++) {
      const n = events[j]!;
      if (n.eventType === "agent_proposal") break;
      if (n.eventType === "user_directive") {
        userResponse = String(n.payload.text ?? "");
        unpaired = false;
        break;
      }
    }
    if (!userResponse && unpaired) {
      // proactive insight: long user directive near thinking
      continue;
    }
    if (userResponse.trim().length < 2) continue;
    out.push({
      eventIndex: e.eventIndex,
      proposalText: proposalText.slice(0, 2000),
      userResponse: userResponse.slice(0, 2000),
      unpaired: false,
    });
  }

  // Unpaired long user directives as proactive candidates
  for (const e of events) {
    if (e.eventType !== "user_directive") continue;
    const text = String(e.payload.text ?? "");
    if (text.trim().split(/\s+/).length < 20) continue;
    if (/this session is being continued|implement the following plan/i.test(text)) {
      continue;
    }
    if (out.some((c) => c.eventIndex === e.eventIndex)) continue;
    out.push({
      eventIndex: e.eventIndex,
      proposalText: "",
      userResponse: text.slice(0, 2000),
      unpaired: true,
    });
  }
  return out.slice(0, 40);
}

function significanceFor(
  t: CodingDecision["decisionType"],
): CodingDecision["significance"] {
  if (t === "strategic_redirect" || t === "product_insight") return "strategic";
  if (t === "technical_catch") return "moderate";
  return "tactical";
}

function domainFor(text: string): string {
  if (/architect|schema|model|abstrac/i.test(text)) return "architecture";
  if (/user|ux|customer|copy|onboard/i.test(text)) return "product";
  if (/test|bug|error|debug/i.test(text)) return "debugging";
  if (/scope|cut|later|priority/i.test(text)) return "scope";
  if (/secret|auth|security|dry-?run/i.test(text)) return "quality";
  return "general";
}

function heuristicClassify(
  sessionId: string,
  candidates: Candidate[],
): CodingDecision[] {
  const laws = loadDecisionCatalog();
  const out: CodingDecision[] = [];
  for (const c of candidates) {
    const blob = `${c.proposalText}\n${c.userResponse}`;
    let decisionType: CodingDecision["decisionType"] = "option_selection";
    if (
      /\b(?:instead|rather|stop|don't|use .+ instead|change approach)\b/i.test(
        c.userResponse,
      )
    ) {
      decisionType = "strategic_redirect";
    } else if (
      /\b(?:bug|wrong|missing|race|leak|secret|hash|token)\b/i.test(
        c.userResponse,
      )
    ) {
      decisionType = "technical_catch";
    } else if (
      /\b(?:user|ux|customer|should see|should be able|copy|onboard)\b/i.test(
        c.userResponse,
      )
    ) {
      decisionType = "product_insight";
    } else if (c.unpaired && /\b(?:because|users?|need)\b/i.test(c.userResponse)) {
      decisionType = "product_insight";
    } else if (!/^(?:ok|lgtm|looks good|yes|go ahead)\b/i.test(c.userResponse.trim())) {
      // routine ack — skip
      if (/^(?:ok|lgtm|looks good|yes|go ahead|thanks)[.!]?$/i.test(
        c.userResponse.trim(),
      )) {
        continue;
      }
      decisionType = "strategic_redirect";
    } else {
      continue;
    }

    const law =
      laws.find((l) =>
        blob.toLowerCase().includes(l.title.toLowerCase().slice(0, 12)),
      ) ??
      (decisionType === "product_insight"
        ? laws.find((l) => l.key === "workflow-from-user-backwards")
        : decisionType === "technical_catch"
          ? laws.find((l) => l.key === "catch-the-state-bug")
          : /\b(?:secret|dry-?run|commit|read-only)\b/i.test(blob)
            ? laws.find((l) => l.key === "enforce-safety-rails")
            : laws.find((l) => l.key === "full-stop-and-investigate"));

    out.push({
      sessionId,
      decisionType,
      lawKey: law?.key ?? null,
      significance: significanceFor(decisionType),
      domain: domainFor(blob),
      narrative: truncNarrative(c.userResponse || c.proposalText),
      evidence: {
        eventIndex: c.eventIndex,
        proposal: c.proposalText.slice(0, 400),
        response: c.userResponse.slice(0, 400),
      },
      outcomeSignal: "neutral",
      confidence: c.unpaired ? 0.45 : 0.6,
    });
  }
  return out;
}

function truncNarrative(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= 220 ? t : `${t.slice(0, 217)}...`;
}

async function llmClassify(
  sessionId: string,
  candidates: Candidate[],
): Promise<CodingDecision[] | null> {
  if (!openaiConfigured() || candidates.length === 0) return null;
  try {
    const system = readFileSync(
      join(HERE, "prompts", "decision_classifier.md"),
      "utf8",
    );
    const user = JSON.stringify(
      {
        candidates: candidates.slice(0, 20).map((c, i) => ({
          index: i,
          proposal: c.proposalText,
          user_response: c.userResponse,
          unpaired: c.unpaired,
        })),
      },
      null,
      2,
    );
    const { text } = await chatJsonCompletion({ system, user, temperature: 0.1 });
    const parsed = JSON.parse(text) as {
      classifications?: Array<{
        index?: number;
        is_decision?: boolean;
        decision_type?: string;
        confidence?: string;
        narrative?: string;
        law_key?: string | null;
      }>;
    };
    const laws = new Set(loadDecisionCatalog().map((l) => l.key));
    const out: CodingDecision[] = [];
    for (const row of parsed.classifications ?? []) {
      if (!row.is_decision) continue;
      const idx = typeof row.index === "number" ? row.index : -1;
      const cand = candidates[idx];
      if (!cand) continue;
      const decisionType = (
        [
          "strategic_redirect",
          "technical_catch",
          "product_insight",
          "option_selection",
        ] as const
      ).includes(row.decision_type as CodingDecision["decisionType"])
        ? (row.decision_type as CodingDecision["decisionType"])
        : "strategic_redirect";
      const lawKey =
        row.law_key && laws.has(row.law_key) ? row.law_key : null;
      const conf =
        row.confidence === "high" ? 0.8 : row.confidence === "low" ? 0.45 : 0.6;
      out.push({
        sessionId,
        decisionType,
        lawKey,
        significance: significanceFor(decisionType),
        domain: domainFor(`${cand.proposalText}\n${cand.userResponse}`),
        narrative: truncNarrative(row.narrative || cand.userResponse),
        evidence: {
          eventIndex: cand.eventIndex,
          proposal: cand.proposalText.slice(0, 400),
          response: cand.userResponse.slice(0, 400),
        },
        outcomeSignal: "neutral",
        confidence: conf,
      });
    }
    return out;
  } catch (err) {
    console.warn(
      "[session-ops/decisions] LLM classify failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function classifySessionDecisions(
  digest: SessionOpsDigest,
  options: { stubOnly?: boolean } = {},
): Promise<CodingDecision[]> {
  const candidates = extractCandidates(digest);
  if (candidates.length === 0) return [];
  if (!options.stubOnly) {
    const llm = await llmClassify(digest.sessionId, candidates);
    if (llm && llm.length > 0) return llm;
  }
  return heuristicClassify(digest.sessionId, candidates);
}
