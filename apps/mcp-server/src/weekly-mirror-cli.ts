/**
 * Weekly-mirror CLI over L1 pages.
 *
 *   pnpm --filter @cortex/mcp-server weekly-mirror -- --pages=./brain --dry-run
 */
import { loadDotEnv } from "./env.js";
import { compileWeeklyMirrorFromL1 } from "./intrapersonal/from-l1.js";

loadDotEnv();

function parseArgs(argv: string[]): {
  pages: string;
  out?: string;
  weekKey?: string;
  dryRun: boolean;
} {
  let pages = "";
  let out: string | undefined;
  let weekKey: string | undefined;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "-n") dryRun = true;
    else if (arg.startsWith("--pages=")) pages = arg.slice("--pages=".length);
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg.startsWith("--week=")) weekKey = arg.slice("--week=".length);
  }
  if (!pages) throw new Error("--pages=<l1-dir> is required");
  return { pages, out, weekKey, dryRun };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = compileWeeklyMirrorFromL1({
    pagesDir: args.pages,
    outDir: args.out,
    weekKey: args.weekKey,
    dryRun: args.dryRun,
  });
  console.info(JSON.stringify(result, null, 2));
}

main();
