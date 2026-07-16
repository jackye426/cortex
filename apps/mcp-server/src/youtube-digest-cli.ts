/**
 * YouTube interest digest CLI.
 *
 *   pnpm --filter @cortex/mcp-server youtube-digest -- --dry-run
 *   pnpm --filter @cortex/mcp-server youtube-digest -- --week=2026-W28
 */
import { loadDotEnv } from "./env.js";
import { createStore } from "./store/index.js";
import { runYoutubeInterestDigest } from "./youtube-digest.js";

loadDotEnv();

function parseArgs(argv: string[]): {
  dryRun: boolean;
  force: boolean;
  weekKey?: string;
  limit: number;
} {
  let dryRun = false;
  let force = false;
  let weekKey: string | undefined;
  let limit = 200;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg.startsWith("--week=")) weekKey = arg.slice("--week=".length);
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }
  return { dryRun, force, weekKey, limit };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--fixture")) {
    process.env.CORTEX_FORCE_FIXTURE = "1";
  }
  const args = parseArgs(argv);
  const store = createStore();
  console.info(
    `[youtube-digest] store=${store.mode} dryRun=${args.dryRun} week=${args.weekKey ?? "(auto)"}`,
  );
  const result = await runYoutubeInterestDigest(store, {
    dryRun: args.dryRun,
    force: args.force,
    weekKey: args.weekKey,
    limitRecords: args.limit,
  });
  console.info(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
