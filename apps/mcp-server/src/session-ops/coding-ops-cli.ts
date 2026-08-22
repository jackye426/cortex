/**
 * Coding-ops CLI over L1 session-v1 pages.
 *
 *   pnpm --filter @cortex/mcp-server coding-ops -- --pages=./brain --dry-run
 *   gbrain dream && pnpm --filter @cortex/mcp-server coding-ops -- --pages=$BRAIN --out=$BRAIN
 */
import { loadDotEnv } from "../env.js";
import { runCodingOpsFromPages } from "./from-pages.js";

loadDotEnv();

function parseArgs(argv: string[]): {
  pages: string;
  out?: string;
  dryRun: boolean;
} {
  let pages = "";
  let out: string | undefined;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "-n") dryRun = true;
    else if (arg.startsWith("--pages=")) pages = arg.slice("--pages=".length);
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
  }
  if (!pages) {
    throw new Error("--pages=<l1-dir> is required");
  }
  return { pages, out, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runCodingOpsFromPages({
    pagesDir: args.pages,
    outDir: args.out,
    dryRun: args.dryRun,
    stubOnly: args.dryRun,
  });
  console.info(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
