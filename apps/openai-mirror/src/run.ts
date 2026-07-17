/**
 * Local OpenAI Agents client → Cortex Mirror MCP.
 *
 * Preferred path for day-to-day Mirror use (not Cursor).
 *
 *   # Terminal A: local MCP (or point CORTEX_MIRROR_MCP_URL at Railway)
 *   pnpm --filter @cortex/mcp-server dev
 *
 *   # Terminal B:
 *   pnpm --filter @cortex/openai-mirror start -- "what was I working on this week?"
 *
 * Modes:
 * - local (default): your process connects to Mirror via MCPServerStreamableHttp
 * - hosted: OpenAI Responses API calls a public Mirror URL (set CORTEX_MCP_MODE=hosted)
 */
import {
  Agent,
  MCPServerStreamableHttp,
  hostedMcpTool,
  run,
} from "@openai/agents";
import { loadDotEnv, resolveMirrorToken, resolveMirrorUrl } from "./env.js";

loadDotEnv();

function promptFromArgv(): string {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  return (
    args.join(" ").trim() ||
    "Call cortex_help, then briefly say how you should retrieve my recent work."
  );
}

async function runLocal(prompt: string): Promise<void> {
  const url = resolveMirrorUrl();
  const token = resolveMirrorToken();
  const mcpServer = new MCPServerStreamableHttp({
    url,
    name: "cortex-mirror",
    cacheToolsList: true,
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const agent = new Agent({
    name: "Cortex Mirror",
    instructions:
      "You are Jack's Mirror assistant. Use Cortex MCP tools. Prefer distillates " +
      "(search_memory, ask_mirror, list_recent_work, sanitised get_calendar_range). " +
      "Do not invent citations. For raw excerpts, request_evidence_capability then " +
      "retrieve_supporting_evidence — never assume vault dumps exist on this endpoint.",
    mcpServers: [mcpServer],
  });

  try {
    await mcpServer.connect();
    console.error(`Connected to Mirror MCP: ${url}`);
    const result = await run(agent, prompt);
    console.log(result.finalOutput ?? "(no final output)");
  } finally {
    await mcpServer.close();
  }
}

async function runHosted(prompt: string): Promise<void> {
  const url = resolveMirrorUrl();
  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    throw new Error(
      "Hosted mode needs a public Mirror URL (Railway). Set CORTEX_MIRROR_MCP_URL.",
    );
  }
  const token = resolveMirrorToken();
  const agent = new Agent({
    name: "Cortex Mirror (hosted MCP)",
    instructions:
      "You are Jack's Mirror assistant. Use the hosted Cortex MCP tools. " +
      "Prefer distillates; use the evidence broker for raw excerpts.",
    tools: [
      hostedMcpTool({
        serverLabel: "cortex_mirror",
        serverUrl: url,
        authorization: token,
        requireApproval: "never",
      }),
    ],
  });

  console.error(`Hosted MCP via OpenAI Responses → ${url}`);
  const result = await run(agent, prompt);
  console.log(result.finalOutput ?? "(no final output)");
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required for @cortex/openai-mirror");
  }
  const prompt = promptFromArgv();
  const mode = (process.env.CORTEX_MCP_MODE?.trim() || "local").toLowerCase();
  if (mode === "hosted") {
    await runHosted(prompt);
  } else {
    await runLocal(prompt);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
