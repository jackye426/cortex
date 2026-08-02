/**
 * Deterministic LLM-ops event extract from session grain (no git/file taxonomy).
 */
import type { SessionDetail } from "../store/types.js";
import type {
  LlmActor,
  LlmOpsDigest,
  LlmOpsEvent,
  LlmOpsEventType,
  LlmSessionSignals,
  LlmTaskContext,
  LlmRole,
} from "./types.js";
import { isCodingOpsSource, isLlmOpsSource } from "./types.js";

const MAX_EXCERPT = 400;
const MAX_EVENTS = 500;

const REDIRECT_RE =
  /\b(?:stop|don't|do not|instead|rather|no,|actually|change (?:that|it|approach)|not that|wrong (?:frame|approach))\b/i;
const CONSTRAINT_RE =
  /\b(?:must|never|only|do not|don't|without|limit|cap|out of scope|not in scope)\b/i;
const PROOF_RE =
  /\b(?:cite|citation|source|evidence|show (?:me )?(?:the )?(?:quote|number|diff|data)|prove|verify|ground(?:ed|ing)?|where (?:does|did) .+ (?:say|come))\b/i;
const COUNTER_RE =
  /\b(?:counter(?:example|-?example)|contradict|rival|alternative explanation|what (?:if|about) the opposite|devil.?s advocate)\b/i;
const OPTION_PICK_RE =
  /\b(?:go with|pick|choose|option\s*[A-C1-3]|prefer|let.?s do)\b/i;
const FRAME_RE =
  /\b(?:wrong (?:question|premise|frame)|reframe|the real (?:job|problem|question) is|why (?:are we|do we))\b/i;
const SCOPE_KILL_RE =
  /\b(?:kill|drop|cut|cancel|remove that|not needed|out of scope)\b/i;
const PARK_RE =
  /\b(?:park|defer|later|todo|backlog|not now|circle back)\b/i;
const CLOSURE_RE =
  /\b(?:decision:|we(?:'| a)re going with|final(?:ize| decision)|next action:|ship it|done when|acceptance)\b/i;
const COMMITMENT_RE =
  /\b(?:i will|i'll|we will|we'll|commit to|promise to|by (?:friday|monday|tomorrow|next week))\b/i;
const NEXT_ACTION_RE =
  /\b(?:next (?:step|action)|action item|follow[- ]?up|then (?:i|we) (?:will|should))\b/i;
const SYNTHESIS_RE =
  /\b(?:summarize|synthesis|brief|write (?:up|a)|draft|consolidate|pull together)\b/i;
const CLARIFY_RE =
  /\b(?:what (?:do you|does that) mean|can you clarify|which|ambiguous|underdefined)\b/i;
const TOPIC_SHIFT_RE =
  /\b(?:new topic|switching|different question|unrelated|anyway[,:]|on another note)\b/i;
const PROPOSAL_RE =
  /(?:option|approach|alternative)\s*(?:\d|[A-C])|(?:we could|you could|options are)|(?:would you (?:like|prefer)|which (?:option|approach))/i;
const DONE_WHEN_RE =
  /\b(?:done when|acceptance|success (?:looks|criteria)|definition of done|observable)\b/i;
const USER_JOB_RE =
  /\b(?:user|customer|audience|for (?:people|readers|operators)|job(?: to be done)?)\b/i;
const OUT_OF_SCOPE_RE =
  /\b(?:out of scope|not in scope|do not (?:touch|edit)|only (?:touch|edit))\b/i;

function trunc(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, Math.max(n - 3, 0))}...`;
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function emptySignals(): LlmSessionSignals {
  return {
    userMessageCount: 0,
    assistantMessageCount: 0,
    avgPromptWords: 0,
    thinBriefCount: 0,
    redirectCount: 0,
    constrainCount: 0,
    proofDemandCount: 0,
    counterexampleCount: 0,
    optionSelectionCount: 0,
    closureActCount: 0,
    topicShiftCount: 0,
    firstProposalAccepted: 0,
    commitmentCount: 0,
    openQuestionLeftovers: 0,
  };
}

/** Thin brief: short / hollow ask without job, done-when, or out-of-scope. */
export function isThinBrief(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  if (/^goal:\s*add\b/i.test(t)) return true;
  if (wordCount(t) < 12 && /^(?:add|make|fix|build|write|help|explain)\b/i.test(t)) {
    return true;
  }
  if (wordCount(t) < 40) {
    const hasTarget =
      DONE_WHEN_RE.test(t) || USER_JOB_RE.test(t) || OUT_OF_SCOPE_RE.test(t);
    if (!hasTarget && /^(?:add|make|fix|build|write|help|explain|goal:)/i.test(t)) {
      return true;
    }
  }
  return false;
}

export function classifyContext(session: SessionDetail): LlmTaskContext {
  const blob = [
    session.title ?? "",
    ...session.messages.map((m) => m.content).slice(0, 12),
  ]
    .join("\n")
    .toLowerCase();

  if (
    isCodingOpsSource(session.sourceId) ||
    /\b(?:pr|commit|refactor|typescript|pytest|migration|repo)\b/.test(blob)
  ) {
    return "coding";
  }
  if (/\b(?:reflect|how (?:do|have) i|blindspot|feeling|energy|mirror)\b/.test(blob)) {
    return "reflection";
  }
  if (/\b(?:plan|roadmap|priorit|allocator|strategy|what should)\b/.test(blob)) {
    return "planning";
  }
  if (/\b(?:draft|rewrite|edit|copy|essay|blog|memo|write)\b/.test(blob)) {
    return "writing";
  }
  if (
    /\b(?:research|compare|survey|literature|sources?|what is|explain)\b/.test(
      blob,
    )
  ) {
    return "research";
  }
  if (/\b(?:calendar|email|invoice|admin|schedule)\b/.test(blob)) {
    return "administration";
  }
  if (session.messages.filter((m) => m.role === "user").length <= 1) {
    return "ambiguous";
  }
  return "research";
}

export function classifyRole(
  context: LlmTaskContext,
  signals: LlmSessionSignals,
): LlmRole {
  if (signals.proofDemandCount + signals.counterexampleCount >= 2) return "critic";
  if (context === "reflection") return "mirror";
  if (context === "research") return "researcher";
  if (context === "writing") return "synthesizer";
  if (context === "planning") return "decision_partner";
  if (signals.closureActCount > 0) return "executor";
  if (signals.avgPromptWords > 80) return "tutor";
  return "synthesizer";
}

function pushEvent(
  events: LlmOpsEvent[],
  eventType: LlmOpsEventType,
  actor: LlmActor,
  messageId: string | null,
  excerpt: string,
  payload: Record<string, unknown> = {},
): void {
  if (events.length >= MAX_EVENTS) return;
  events.push({
    eventIndex: events.length,
    eventType,
    actor,
    messageId,
    excerpt: trunc(excerpt, MAX_EXCERPT),
    payload,
  });
}

/**
 * Extract llm-ops digest. Coding sources return skipReason (caller should not score).
 */
export function extractLlmOps(session: SessionDetail): LlmOpsDigest {
  const signals = emptySignals();
  const events: LlmOpsEvent[] = [];
  let firstPrompt: string | null = null;
  const highlights: string[] = [];
  let sawAssistantProposal = false;
  let acceptedFirst = false;

  if (isCodingOpsSource(session.sourceId)) {
    return {
      sessionId: session.id,
      sourceId: session.sourceId,
      title: session.title,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      context: "coding",
      llmRole: "executor",
      skipReason: "owned_by_coding_ops",
      events: [],
      signals,
      firstPrompt: null,
      userHighlights: "",
      coverage: {
        messageCount: session.messages.length,
        sampled: false,
        stub: false,
      },
    };
  }

  if (!isLlmOpsSource(session.sourceId) && session.messages.length === 0) {
    return {
      sessionId: session.id,
      sourceId: session.sourceId,
      title: session.title,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      context: "ambiguous",
      llmRole: "synthesizer",
      skipReason: "no_messages",
      events: [],
      signals,
      firstPrompt: null,
      userHighlights: "",
      coverage: { messageCount: 0, sampled: false, stub: true },
    };
  }

  let promptWords = 0;

  for (const msg of session.messages) {
    const text = msg.content ?? "";
    const role = (msg.role ?? "").toLowerCase();

    if (role === "user" || role === "human") {
      signals.userMessageCount += 1;
      promptWords += wordCount(text);
      if (!firstPrompt) firstPrompt = trunc(text, 500);
      highlights.push(trunc(text, 240));

      pushEvent(events, "user_directive", "user", msg.id, text);

      if (isThinBrief(text)) {
        signals.thinBriefCount += 1;
      }
      if (REDIRECT_RE.test(text)) {
        signals.redirectCount += 1;
        pushEvent(events, "steering_redirect", "user", msg.id, text);
      }
      if (CONSTRAINT_RE.test(text)) {
        signals.constrainCount += 1;
        pushEvent(events, "steering_constrain", "user", msg.id, text);
      }
      if (PROOF_RE.test(text)) {
        signals.proofDemandCount += 1;
        pushEvent(events, "proof_requested", "user", msg.id, text);
      }
      if (COUNTER_RE.test(text)) {
        signals.counterexampleCount += 1;
        pushEvent(events, "counterexample_requested", "user", msg.id, text);
      }
      if (FRAME_RE.test(text)) {
        pushEvent(events, "frame_challenge", "user", msg.id, text);
      }
      if (SCOPE_KILL_RE.test(text)) {
        pushEvent(events, "scope_kill", "user", msg.id, text);
      }
      if (PARK_RE.test(text)) {
        pushEvent(events, "scope_park", "user", msg.id, text);
      }
      if (CLOSURE_RE.test(text)) {
        signals.closureActCount += 1;
        pushEvent(events, "decision_recorded", "user", msg.id, text);
        pushEvent(events, "next_action_stated", "user", msg.id, text);
      }
      if (COMMITMENT_RE.test(text)) {
        signals.commitmentCount += 1;
        pushEvent(events, "commitment_stated", "user", msg.id, text);
      }
      if (NEXT_ACTION_RE.test(text)) {
        pushEvent(events, "next_action_stated", "user", msg.id, text);
      }
      if (SYNTHESIS_RE.test(text)) {
        pushEvent(events, "synthesis_requested", "user", msg.id, text);
      }
      if (TOPIC_SHIFT_RE.test(text)) {
        signals.topicShiftCount += 1;
        pushEvent(events, "topic_shift", "user", msg.id, text);
      }
      if (OPTION_PICK_RE.test(text)) {
        signals.optionSelectionCount += 1;
        pushEvent(events, "option_selected", "user", msg.id, text);
        if (sawAssistantProposal && !acceptedFirst) {
          // picking after proposal is selection, not passive accept
        }
      } else if (
        sawAssistantProposal &&
        !acceptedFirst &&
        /^(?:yes|ok|okay|sounds good|go ahead|lgtm|ship)\b/i.test(text.trim())
      ) {
        signals.firstProposalAccepted += 1;
        acceptedFirst = true;
      }
      if (/```|https?:\/\//.test(text) && wordCount(text) > 40) {
        pushEvent(events, "artifact_pasted", "user", msg.id, text);
      }
    } else if (role === "assistant" || role === "model") {
      signals.assistantMessageCount += 1;
      if (PROPOSAL_RE.test(text)) {
        sawAssistantProposal = true;
        pushEvent(events, "option_presented", "assistant", msg.id, text);
        pushEvent(events, "agent_proposal", "assistant", msg.id, text);
      }
      if (CLARIFY_RE.test(text)) {
        pushEvent(events, "clarification_requested", "assistant", msg.id, text);
      }
      if (/\b(?:cannot|can't|unable|refus)/i.test(text)) {
        pushEvent(events, "error_or_refusal_encountered", "assistant", msg.id, text);
      }
      if (wordCount(text) > 120) {
        pushEvent(events, "artifact_produced", "assistant", msg.id, text);
      }
    } else if (role === "tool" || role === "function") {
      pushEvent(events, "artifact_produced", "tool", msg.id, text);
    }
  }

  signals.avgPromptWords =
    signals.userMessageCount > 0
      ? Math.round((promptWords / signals.userMessageCount) * 10) / 10
      : 0;

  // Open questions: assistant asked clarifying Q without later user closure
  const clarifications = events.filter(
    (e) => e.eventType === "clarification_requested",
  ).length;
  signals.openQuestionLeftovers = Math.max(
    0,
    clarifications - signals.closureActCount,
  );

  const context = classifyContext(session);
  const llmRole = classifyRole(context, signals);

  let skipReason: string | null = null;
  if (!isLlmOpsSource(session.sourceId) && !isCodingOpsSource(session.sourceId)) {
    // Allow other future chat sources; skip if too thin
    if (signals.userMessageCount === 0) skipReason = "no_user_turns";
  }
  if (signals.userMessageCount <= 1 && wordCount(firstPrompt ?? "") < 20) {
    skipReason = skipReason ?? "low_signal_oneshot";
  }

  return {
    sessionId: session.id,
    sourceId: session.sourceId,
    title: session.title,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    context,
    llmRole,
    skipReason,
    events,
    signals,
    firstPrompt,
    userHighlights: highlights.slice(0, 12).join("\n---\n"),
    coverage: {
      messageCount: session.messages.length,
      sampled: session.messages.length >= 40,
      stub: false,
    },
  };
}

/** Derive lightweight decisions from user-attributed events. */
export function deriveLlmDecisions(
  digest: LlmOpsDigest,
  episodeId: string | null,
): import("./types.js").LlmDecision[] {
  const out: import("./types.js").LlmDecision[] = [];
  for (const e of digest.events) {
    if (e.actor !== "user") continue;
    let decisionType: import("./types.js").LlmDecisionType | null = null;
    let lawKey: string | null = null;
    let significance: "strategic" | "moderate" | "tactical" = "tactical";

    switch (e.eventType) {
      case "steering_redirect":
        decisionType = "strategic_redirect";
        lawKey = "challenge-the-premise";
        significance = "strategic";
        break;
      case "frame_challenge":
        decisionType = "frame_challenge";
        lawKey = "challenge-the-premise";
        significance = "strategic";
        break;
      case "proof_requested":
      case "counterexample_requested":
        decisionType = "evidence_demand";
        lawKey =
          e.eventType === "counterexample_requested"
            ? "seek-the-counterexample"
            : "demand-citations";
        significance = "moderate";
        break;
      case "option_selected":
        decisionType = "option_selection";
        lawKey = "compare-then-choose";
        significance = "moderate";
        break;
      case "scope_kill":
        decisionType = "scope_kill";
        lawKey = "park-the-tangent";
        significance = "strategic";
        break;
      case "scope_park":
        decisionType = "scope_park";
        lawKey = "park-the-tangent";
        significance = "tactical";
        break;
      case "decision_recorded":
      case "next_action_stated":
        decisionType = "closure_act";
        lawKey = "write-the-decision-line";
        significance = "strategic";
        break;
      default:
        break;
    }
    if (!decisionType) continue;
    out.push({
      sessionId: digest.sessionId,
      episodeId,
      decisionType,
      lawKey,
      narrative: e.excerpt.slice(0, 200),
      evidenceEventIndexes: [e.eventIndex],
      significance,
      confidence: 0.55,
    });
  }
  return out;
}
