/**
 * Twin pipeline CLI — nightly / weekly / backfill.
 *
 *   pnpm twin-pipeline -- --mode=nightly
 *   pnpm twin-pipeline -- --mode=weekly
 *   pnpm twin-pipeline -- --mode=backfill --max-batches=20
 */
import { loadDotEnv } from "./env.js";
import { createStore } from "./store/index.js";
import { runTwinPipeline, type TwinPipelineMode } from "./twin-pipeline.js";

loadDotEnv();

function parseArgs(argv: string[]): {
  mode: TwinPipelineMode;
  batchSize: number;
  maxBatches?: number;
  dryRun: boolean;
} {
  let mode: TwinPipelineMode = "nightly";
  let batchSize = 30;
  let maxBatches: number | undefined;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--mode=")) {
      const m = arg.slice("--mode=".length) as TwinPipelineMode;
      if (m === "nightly" || m === "weekly" || m === "backfill") mode = m;
    } else if (arg.startsWith("--batch-size=")) {
      const n = Number(arg.slice("--batch-size=".length));
      if (Number.isFinite(n) && n > 0) batchSize = Math.floor(n);
    } else if (arg.startsWith("--max-batches=")) {
      const n = Number(arg.slice("--max-batches=".length));
      if (Number.isFinite(n) && n > 0) maxBatches = Math.floor(n);
    }
  }
  return { mode, batchSize, maxBatches, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const store = createStore();
  console.info(
    `[twin-pipeline] mode=${args.mode} store=${store.mode} dryRun=${args.dryRun} batchSize=${args.batchSize} maxBatches=${args.maxBatches ?? "(default)"}`,
  );
  const result = await runTwinPipeline(store, args);
  console.info(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
