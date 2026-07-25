/**
 * Deterministic session ops extract from Cortex session grain.
 * Behavioral port of Paxel EventExtractor / SessionSignalExtractor onto
 * sessions/messages/tool_calls (not raw filesystem JSONL).
 */
import type { SessionDetail } from "../store/types.js";
import type {
  PlanFileVersion,
  SessionOpsDigest,
  SessionOpsEvent,
  SessionOpsEventType,
  SessionSignals,
  SteeringTrace,
} from "./types.js";

const MAX_TEXT = 4000;
const MAX_EVENTS = 3000;
const PLAN_PATH =
  /(?:\.claude\/plans\/[^/]+\.md|(?:^|\/)(?:[A-Z][A-Z0-9_]*_)?PLAN\.md)$/;

const PRODUCT_RE =
  /\bcustomer\b|\bUX\b|user experience|onboarding|\bfriction\b|pain point|product decision|user need|user research/i;
const SELF_CORRECTION_RE =
  /\bactually\b|wait,|no,\s|let me rethink|scratch that|on second thought/i;
const KILL_RE =
  /\bdelete\b|\bremove\b|\bdrop\b|\bkill\b|get rid of|rip out|revert/i;
const HYPOTHESIS_RE =
  /i think.*because|my theory is|i suspect|probably.*caused by|the issue is likely/i;
const DOMAIN_CORRECTION_RE =
  /that's not how|actually it should|no,.*works like|you're wrong about/i;
const ARCHITECTURE_RE =
  /\barchitect(?:ure|ural)\b|\babstraction\b|\bdecoupl|\bcoupling\b|separation of concerns|design pattern|\bmodular|refactor into/i;
const DEBUGGING_RE =
  /\bwhy\b|broken|error|fail|bug|wrong|issue|crash|exception|stack trace/i;
const REVIEW_RE =
  /looks wrong|check if|verify|doesn't look right|are you sure|let me see/i;
const CRITIQUE_RE =
  /rate me|evaluate|how am i doing|critique|review my|what do you think of my/i;
const REDIRECT_RE =
  /\b(?:stop|don't|do not|instead|rather|no,|actually|change (?:that|it|approach)|use .+ instead|not that)\b/i;
const CONSTRAINT_RE =
  /\b(?:no secrets?|dry-?run|read-?only|do not commit|don't commit|must|never|only edit|exact file)\b/i;
const IMPERATIVE_VERBS =
  /^(?:add|build|create|implement|write|fix|update|refactor|deploy|run|test|make|delete|remove)\b/i;

const GIT_COMMIT_CMD = /\bgit\s+commit\b/i;
const GIT_PUSH_CMD = /\bgit\s+push\b/i;
const GIT_CHECKOUT_CMD = /\bgit\s+(?:checkout|switch)\s+(?:-[bc]\s+)?(\S+)/i;
const GIT_SHA = /\b([0-9a-f]{7,40})\b/i;
const PR_CREATE = /\bgh\s+pr\s+create\b/i;
const PR_URL = /github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/i;
const TEST_CMD =
  /\b(?:pytest|jest|vitest|npm test|pnpm test|cargo test|rspec|go test)\b/i;
const ERROR_LINE =
  /(?:Error|Exception|FAILED|Errno|NoMethodError|TypeError|SyntaxError)[:!\s]/i;
const SUBAGENT_TOOL = /^(?:Task|Agent|subagent|AgentTask)$/i;

function trunc(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, Math.max(n - 3, 0))}...`;
}

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function toolEventType(
  toolName: string,
  args: string,
): SessionOpsEventType | null {
  const name = toolName.trim();
  const lower = `${name} ${args}`.toLowerCase();
  if (SUBAGENT_TOOL.test(name)) return "subagent_dispatch";
  if (/^(write|create)$/i.test(name)) return "file_create";
  if (
    /^(edit|strreplace|search_replace|apply_patch|multiedit)$/i.test(name)
  ) {
    return "file_edit";
  }
  if (/^(read|read_file)$/i.test(name)) return "file_read";
  if (/^(bash|shell|terminal|run_terminal_command)/i.test(name)) {
    if (GIT_COMMIT_CMD.test(args)) return "git_commit";
    if (GIT_PUSH_CMD.test(args)) return "git_push";
    if (GIT_CHECKOUT_CMD.test(args)) return "git_branch_switch";
    if (TEST_CMD.test(args)) return "test_run";
    return "bash_command";
  }
  if (lower.includes("git commit")) return "git_commit";
  return null;
}

function looksLikeProposal(text: string): boolean {
  return (
    /(?:option|approach|alternative)\s*(?:\d|[A-C])/i.test(text) ||
    /(?:we could|you could|options are|alternatives):/i.test(text) ||
    /(?:would you (?:like|prefer)|should (?:I|we)|which (?:option|approach))/i.test(
      text,
    )
  );
}

function emptySignals(): SessionSignals {
  return {
    killDecisions: 0,
    selfCorrections: 0,
    hypothesisDriven: 0,
    domainCorrections: 0,
    debuggingMessages: 0,
    architectureDiscussions: 0,
    productReferences: 0,
    imperativePrompts: 0,
    reviewChecks: 0,
    critiques: 0,
    userMessageCount: 0,
    avgPromptWords: 0,
  };
}

function bumpSignals(signals: SessionSignals, text: string): void {
  if (KILL_RE.test(text)) signals.killDecisions += 1;
  if (SELF_CORRECTION_RE.test(text)) signals.selfCorrections += 1;
  if (HYPOTHESIS_RE.test(text)) signals.hypothesisDriven += 1;
  if (DOMAIN_CORRECTION_RE.test(text)) signals.domainCorrections += 1;
  if (DEBUGGING_RE.test(text)) signals.debuggingMessages += 1;
  if (ARCHITECTURE_RE.test(text)) signals.architectureDiscussions += 1;
  if (PRODUCT_RE.test(text)) signals.productReferences += 1;
  if (IMPERATIVE_VERBS.test(text.trim())) signals.imperativePrompts += 1;
  if (REVIEW_RE.test(text)) signals.reviewChecks += 1;
  if (CRITIQUE_RE.test(text)) signals.critiques += 1;
}

function planBooleans(content: string): Omit<
  PlanFileVersion,
  "filename" | "versionCount" | "content"
> {
  return {
    hasVerification: /verif|test|check|confirm|- \[ \]/i.test(content),
    hasAlternatives: /alternativ|option|instead|tradeoff|approach [A-C]/i.test(
      content,
    ),
    hasEdgeCases: /edge.case|corner.case|what.if|fallback|error.handling/i.test(
      content,
    ),
  };
}

/**
 * Extract session ops digest from a Cortex SessionDetail.
 */
export function extractSessionOps(session: SessionDetail): SessionOpsDigest {
  const events: SessionOpsEvent[] = [];
  const steeringTraces: SteeringTrace[] = [];
  const planByName = new Map<string, PlanFileVersion>();
  const gitShas: string[] = [];
  const gitBranches: string[] = [];
  const signals = emptySignals();
  const highlights: string[] = [];
  let firstPrompt: string | null = null;
  let prNumber: number | null = null;
  let eventIndex = 0;

  const push = (
    eventType: SessionOpsEventType,
    payload: Record<string, unknown>,
    occurredAt: string | null = null,
  ) => {
    if (
      events.length >= MAX_EVENTS &&
      eventType !== "git_commit" &&
      eventType !== "subagent_dispatch" &&
      eventType !== "subagent_return"
    ) {
      return;
    }
    events.push({
      eventIndex: eventIndex++,
      eventType,
      occurredAt,
      payload,
    });
  };

  for (const msg of session.messages) {
    const role = (msg.role || "").toLowerCase();
    const content = (msg.content ?? "").trim();
    if (!content) continue;

    if (role === "user") {
      signals.userMessageCount += 1;
      const words = wordCount(content);
      if (!firstPrompt) firstPrompt = trunc(content, 200);
      bumpSignals(signals, content);
      if (words > 15) highlights.push(trunc(content, 2000));

      push("user_directive", { text: trunc(content, MAX_TEXT), words });

      const wordsList = content.trim().split(/\s+/);
      if (REDIRECT_RE.test(content) || CONSTRAINT_RE.test(content)) {
        steeringTraces.push({
          text: trunc(content, 500),
          eventIndex: eventIndex - 1,
          kind: CONSTRAINT_RE.test(content) ? "constrain" : "redirect",
        });
      } else if (wordsList.length > 0 && wordsList.length <= 25) {
        steeringTraces.push({
          text: trunc(content, 500),
          eventIndex: eventIndex - 1,
          kind: "short_directive",
        });
      }
      continue;
    }

    if (role === "assistant") {
      if (looksLikeProposal(content)) {
        push("agent_proposal", { text: trunc(content, MAX_TEXT) });
      }
      if (/thinking|consider|analysis/i.test(content.slice(0, 200))) {
        push("agent_thinking", { text: trunc(content, 1500) });
      }
      if (ERROR_LINE.test(content)) {
        push("error_encountered", { text: trunc(content, 800) });
      }
    }
  }

  for (const tool of session.toolCalls) {
    const args = tool.argsSummary ?? "";
    const type = toolEventType(tool.toolName, args);
    if (!type) continue;

    const payload: Record<string, unknown> = {
      toolName: tool.toolName,
      argsSummary: trunc(args, 2000),
      status: tool.status,
    };

    if (type === "bash_command" || type === "git_commit" || type === "git_push") {
      payload.command = trunc(args, 2000);
    }
    if (type === "git_commit") {
      const sha = args.match(GIT_SHA)?.[1];
      if (sha) {
        gitShas.push(sha);
        payload.sha = sha;
      }
      const msg =
        args.match(/-m\s+"((?:[^"\\]|\\.)*)"/)?.[1] ??
        args.match(/-m\s+'((?:[^'\\]|\\.)*)'/)?.[1];
      if (msg) payload.commitMessage = trunc(msg, 500);
    }
    if (type === "git_branch_switch") {
      const branch = args.match(GIT_CHECKOUT_CMD)?.[1];
      if (branch) {
        gitBranches.push(branch);
        payload.branch = branch;
      }
    }
    if (type === "file_create" || type === "file_edit" || type === "file_read") {
      const pathMatch = args.match(
        /(?:file_path|path)[=:]\s*["']?([^\s"']+)/i,
      );
      const path = pathMatch?.[1] ?? args.split(/\s+/).find((p) => p.includes("/"));
      if (path) {
        payload.path = path;
        if (type === "file_create" && PLAN_PATH.test(path)) {
          const existing = planByName.get(path);
          const content = trunc(args, 5000);
          const flags = planBooleans(content);
          planByName.set(path, {
            filename: path,
            versionCount: (existing?.versionCount ?? 0) + 1,
            content,
            ...flags,
          });
        }
      }
    }
    if (PR_CREATE.test(args) || PR_URL.test(args)) {
      const n = args.match(PR_URL)?.[1];
      if (n) prNumber = Number(n);
    }
    if (type === "test_run" && ERROR_LINE.test(args)) {
      push("error_encountered", { text: trunc(args, 800), fromTool: true });
    }

    push(type, payload);

    if (type === "subagent_dispatch" && /return|completed|done/i.test(args)) {
      push("subagent_return", {
        toolName: tool.toolName,
        argsSummary: trunc(args, 1000),
      });
    }
  }

  const meta = session.metadata ?? {};
  if (typeof meta.gitBranch === "string" && meta.gitBranch) {
    gitBranches.push(meta.gitBranch);
  }
  if (typeof meta.gitSha === "string" && meta.gitSha) {
    gitShas.push(meta.gitSha);
  }

  const totalWords = session.messages
    .filter((m) => (m.role || "").toLowerCase() === "user")
    .reduce((s, m) => s + wordCount(m.content ?? ""), 0);
  signals.avgPromptWords =
    signals.userMessageCount > 0
      ? Math.round((totalWords / signals.userMessageCount) * 10) / 10
      : 0;

  return {
    sessionId: session.id,
    sourceId: session.sourceId,
    title: session.title,
    firstPrompt,
    sessionIntent: null,
    events,
    steeringTraces: steeringTraces.slice(0, 40),
    planFiles: [...planByName.values()],
    sessionSignals: signals,
    userHighlights: highlights.slice(0, 50).join("\n---\n"),
    gitShas: [...new Set(gitShas)],
    gitBranches: [...new Set(gitBranches)],
    prNumber,
    extractedAt: new Date().toISOString(),
  };
}

export function isThinProductPrompt(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (/^goal:\s*add\s*$/i.test(t)) return true;
  if (t.length < 40 && /^(add|make|fix|implement)\b/i.test(t)) return true;
  if (
    /\b(?:checkout|endpoint|feature|ui)\b/i.test(t) &&
    !/\b(?:user|customer|acceptance|should be able|so that)\b/i.test(t) &&
    wordCount(t) < 25
  ) {
    return true;
  }
  return false;
}
