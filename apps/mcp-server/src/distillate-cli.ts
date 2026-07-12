/**
 * Distillate / project-brief worker CLI.
 *
 *   pnpm --filter @cortex/mcp-server distillate
 *   pnpm --filter @cortex/mcp-server distillate -- --dry-run --limit=5
 *   pnpm --filter @cortex/mcp-server distillate -- --project-brief --dry-run
 */
import { runDistillateWorker } from "./distillate.js";
import { loadDotEnv } from "./env.js";
import { runProjectBriefJob } from "./project-brief.js";
import { createStore } from "./store/index.js";

loadDotEnv();

function parseArgs(argv: string[]): {
  dryRun: boolean;
  limit: number;
  projectBrief: boolean;
  stubOnly: boolean;
} {
  let dryRun = false;
  let limit = 20;
  let projectBrief = false;
  let stubOnly = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--project-brief") projectBrief = true;
    else if (arg === "--stub-only") stubOnly = true;
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }
  return { dryRun, limit, projectBrief, stubOnly };
}

async function main(): Promise<void> {
  const { dryRun, limit, projectBrief, stubOnly } = parseArgs(
    process.argv.slice(2),
  );
  const store = createStore();

  if (projectBrief) {
    console.info(
      `[project-brief] mode=${store.mode} dryRun=${dryRun} limitSessions=${limit}`,
    );
    const result = await runProjectBriefJob(store, {
      dryRun,
      limitSessions: limit,
    });
    console.info(
      `[project-brief] projects=${result.projects.join(",") || "(none)"} written=${result.written}`,
    );
    for (const d of result.briefs) {
      console.info(
        `  - ${d.subjectType}/${d.subjectId}: ${(d.content ?? "").slice(0, 120)}…`,
      );
    }
    return;
  }

  console.info(
    `[distillate] mode=${store.mode} dryRun=${dryRun} limit=${limit}`,
  );
  const result = await runDistillateWorker(store, {
    dryRun,
    limit,
    stubOnly,
  });
  console.info(
    `[distillate] engine=${result.engine} processed=${result.processed} written=${result.written}`,
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
