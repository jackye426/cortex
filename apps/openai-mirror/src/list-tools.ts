/**
 * Smoke: list Mirror MCP tools via streamable HTTP (no LLM call).
 *
 *   pnpm --filter @cortex/openai-mirror tools
 */
import { MCPServerStreamableHttp } from "@openai/agents";
import { loadDotEnv, resolveMirrorToken, resolveMirrorUrl } from "./env.js";

loadDotEnv();

async function main(): Promise<void> {
  const url = resolveMirrorUrl();
  const token = resolveMirrorToken();
  const server = new MCPServerStreamableHttp({
    url,
    name: "cortex-mirror",
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  try {
    await server.connect();
    const tools = await server.listTools();
    console.log(`Mirror MCP: ${url}`);
    console.log(`Tools (${tools.length}):`);
    for (const tool of tools) {
      const name = "name" in tool ? String(tool.name) : JSON.stringify(tool);
      console.log(`- ${name}`);
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
