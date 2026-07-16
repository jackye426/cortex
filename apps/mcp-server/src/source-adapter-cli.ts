/**
 * Post-quality-gate source adapter CLI.
 *
 *   pnpm --filter @cortex/mcp-server source-adapter -- --list
 *   pnpm --filter @cortex/mcp-server source-adapter -- --adapter=email-thread --dry-run
 */
import { loadDotEnv } from "./env.js";
import { createStore } from "./store/index.js";
import { runSourceAdapter, SOURCE_ADAPTERS } from "./source-adapters.js";

loadDotEnv();

function parseArgs(argv: string[]): {
  list: boolean;
  dryRun: boolean;
  force: boolean;
  adapter?: string;
  limit: number;
} {
  let list = false;
  let dryRun = false;
  let force = false;
  let adapter: string | undefined;
  let limit = 40;
  for (const arg of argv) {
    if (arg === "--list") list = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg.startsWith("--adapter=")) adapter = arg.slice("--adapter=".length);
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }
  return { list, dryRun, force, adapter, limit };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--fixture")) {
    process.env.CORTEX_FORCE_FIXTURE = "1";
  }
  const args = parseArgs(argv);
  if (args.list || !args.adapter) {
    console.info("Available adapters:");
    for (const a of SOURCE_ADAPTERS) {
      console.info(
        `  - ${a.id} kind=${a.kind} grain=${a.grain} domain=${a.domainDefault}`,
      );
      for (const q of a.evaluationQuestions) {
        console.info(`      eval: ${q}`);
      }
    }
    if (!args.adapter) return;
  }

  const store = createStore();
  console.info(
    `[source-adapter] adapter=${args.adapter} store=${store.mode} dryRun=${args.dryRun}`,
  );
  const result = await runSourceAdapter(store, args.adapter, {
    dryRun: args.dryRun,
    limit: args.limit,
    force: args.force,
  });
  // Avoid dumping embedding vectors into the terminal.
  const slim = {
    ...result,
    distillates: result.distillates.map((d) => ({
      id: d.id,
      subjectType: d.subjectType,
      subjectId: d.subjectId,
      kind: d.kind,
      model: d.model,
      content: d.content,
      metadata: d.metadata,
      hasEmbedding: Array.isArray(d.embedding) && d.embedding.length > 0,
    })),
  };
  console.info(JSON.stringify(slim, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
