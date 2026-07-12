/**
 * Embed backfill CLI — vectors only, no re-LLM of distillate content.
 *
 *   pnpm --filter @cortex/mcp-server embed-backfill -- --dry-run --limit=20
 *   pnpm --filter @cortex/mcp-server embed-backfill -- --limit=50
 *   pnpm --filter @cortex/mcp-server embed-backfill -- --force --limit=10
 */
import { loadDotEnv } from "./env.js";
import { openaiConfigured } from "./llm.js";
import { runEmbedBackfill } from "./project-brief.js";
import { createStore } from "./store/index.js";

loadDotEnv();

function parseArgs(argv: string[]): {
  dryRun: boolean;
  force: boolean;
  limit: number;
} {
  let dryRun = false;
  let force = false;
  let limit = 50;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }
  return { dryRun, force, limit };
}

async function main(): Promise<void> {
  const { dryRun, force, limit } = parseArgs(process.argv.slice(2));
  const store = createStore();
  console.info(
    `[embed-backfill] mode=${store.mode} dryRun=${dryRun} force=${force} limit=${limit} openai=${openaiConfigured()}`,
  );
  const result = await runEmbedBackfill(store, { dryRun, force, limit });
  console.info(
    `[embed-backfill] scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`,
  );
  if (!openaiConfigured()) {
    console.warn(
      "[embed-backfill] OPENAI_API_KEY not set — nothing embedded. Set key (+ optional OPENAI_BASE_URL / CORTEX_EMBEDDING_MODEL).",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
