import type { SessionDetail } from "./types.js";

/** Clone of FIXTURE_SESSIONS[0] from apps/mcp-server (coding Claude session). */
export const CLAUDE_FIXTURE_SESSION: SessionDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  sourceId: "claude-code",
  sourceSessionId: "fixture-claude-1",
  title: "Wire Cortex ingest API",
  workspace: "C:\\Users\\yulon\\Desktop\\Current Projects\\Cortex",
  startedAt: "2026-07-10T14:00:00.000Z",
  endedAt: "2026-07-10T15:30:00.000Z",
  metadata: { fixture: true },
  messages: [
    {
      id: "m1",
      role: "user",
      content:
        "Add bearer auth to the ingest endpoint. Dry-run first, no secrets printed, do not commit.",
    },
    {
      id: "m2",
      role: "assistant",
      content:
        "I can add middleware or check the header inline. Option A: middleware. Option B: inline check. Which approach?",
    },
    {
      id: "m1b",
      role: "user",
      content:
        "Use middleware instead — keep CORTEX_INGEST_TOKEN out of logs. Verify with a dry-run curl before any commit.",
    },
    {
      id: "m2b",
      role: "assistant",
      content: "Added CORTEX_INGEST_TOKEN bearer check on POST /v1/ingest.",
    },
  ],
  toolCalls: [
    {
      id: "t1",
      toolName: "Write",
      argsSummary: "file_path=apps/api/src/index.ts",
      status: "ok",
    },
    {
      id: "t2",
      toolName: "Bash",
      argsSummary: 'git commit -m "feat: bearer auth on ingest"',
      status: "ok",
    },
    {
      id: "t3",
      toolName: "Write",
      argsSummary:
        "file_path=.claude/plans/INGEST_AUTH_PLAN.md content=# Plan\nVerify with curl\n",
      status: "ok",
    },
  ],
  distillate: null,
};

export const CHATGPT_FIXTURE_SESSION: SessionDetail = {
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
        "Go with option A instead. Cite two concrete differences and give a rival explanation for why summaries alone feel insightful but fail.",
    },
    {
      id: "c4",
      role: "assistant",
      content:
        "Long synthesis: event→score catches steering; summaries miss redirects. Rival: summaries feel deep because they narrate confidently without falsifiers.",
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
};
