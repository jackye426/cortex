/**
 * Distillate worker CLI stub.
 *
 *   pnpm --filter @cortex/mcp-server distillate
 *   pnpm --filter @cortex/mcp-server distillate -- --dry-run --limit=5
 */
import { runDistillateWorker } from "./distillate.js";
import { loadDotEnv } from "./env.js";
import { createStore } from "./store/index.js";

loadDotEnv();

function parseArgs(argv: string[]): { dryRun: boolean; limit: number } {
  let dryRun = false;
  let limit = 20;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }
  return { dryRun, limit };
}

async function main(): Promise<void> {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const store = createStore();
  console.info(
    `[distillate] mode=${store.mode} dryRun=${dryRun} limit=${limit}`,
  );
  const result = await runDistillateWorker(store, { dryRun, limit });
  console.info(
    `[distillate] processed=${result.processed} written=${result.written}`,
  );
  for (const d of result.distillates) {
    console.info(
      `  - ${d.subjectType}/${d.subjectId}: ${(d.content ?? "").slice(0, 120)}…`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
