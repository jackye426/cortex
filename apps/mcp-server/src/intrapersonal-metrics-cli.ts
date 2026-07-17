/**
 * Intrapersonal metrics CLI — Validated Insight Rate + supporting measures.
 *
 *   pnpm --filter @cortex/mcp-server intrapersonal-metrics
 *   pnpm --filter @cortex/mcp-server intrapersonal-metrics -- --fixture --windowDays=90
 */
import { loadDotEnv } from "./env.js";
import { computeIntrapersonalMetrics } from "./intrapersonal/metrics.js";
import { createStore } from "./store/index.js";

loadDotEnv();

function parseWindowDays(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith("--windowDays=")) {
      const n = Number(arg.slice("--windowDays=".length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return 30;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--fixture")) {
    process.env.CORTEX_FORCE_FIXTURE = "1";
  }
  const windowDays = parseWindowDays(argv);
  const store = createStore();
  const metrics = await computeIntrapersonalMetrics(store, { windowDays });
  console.info(
    JSON.stringify(
      {
        store: store.mode,
        ...metrics,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
