/**
 * Distillate / twin worker CLI.
 *
 *   pnpm --filter @cortex/mcp-server distillate
 *   pnpm --filter @cortex/mcp-server distillate -- --dry-run --limit=5
 *   pnpm --filter @cortex/mcp-server distillate -- --project-brief --dry-run
 *   pnpm --filter @cortex/mcp-server distillate -- --seed-entities
 *   pnpm --filter @cortex/mcp-server distillate -- --priority-vs-actual
 *   pnpm --filter @cortex/mcp-server distillate -- --self-model
 */
import { runDistillateWorker } from "./distillate.js";
import { loadDotEnv } from "./env.js";
import {
  refreshSelfModel,
  runPriorityVsActual,
  runProjectBriefJob,
  seedEntitiesFromDistillates,
} from "./project-brief.js";
import { createStore } from "./store/index.js";

loadDotEnv();

function parseArgs(argv: string[]): {
  dryRun: boolean;
  limit: number;
  projectBrief: boolean;
  seedEntities: boolean;
  priorityVsActual: boolean;
  selfModel: boolean;
  stubOnly: boolean;
} {
  let dryRun = false;
  let limit = 20;
  let projectBrief = false;
  let seedEntities = false;
  let priorityVsActual = false;
  let selfModel = false;
  let stubOnly = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--project-brief") projectBrief = true;
    else if (arg === "--seed-entities") seedEntities = true;
    else if (arg === "--priority-vs-actual") priorityVsActual = true;
    else if (arg === "--self-model") selfModel = true;
    else if (arg === "--stub-only") stubOnly = true;
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }
  return {
    dryRun,
    limit,
    projectBrief,
    seedEntities,
    priorityVsActual,
    selfModel,
    stubOnly,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const store = createStore();

  if (args.seedEntities) {
    console.info(
      `[seed-entities] mode=${store.mode} dryRun=${args.dryRun} limit=${args.limit}`,
    );
    const result = await seedEntitiesFromDistillates(store, {
      dryRun: args.dryRun,
      limit: args.limit,
    });
    console.info(
      `[seed-entities] scanned=${result.scanned} upserted=${result.upserted.length} linked=${result.linked}`,
    );
    for (const e of result.upserted) {
      console.info(`  - ${e.entityType}/${e.canonicalKey}`);
    }
    return;
  }

  if (args.priorityVsActual) {
    console.info(
      `[priority-vs-actual] mode=${store.mode} dryRun=${args.dryRun}`,
    );
    const result = await runPriorityVsActual(store, { dryRun: args.dryRun });
    console.info(
      `[priority-vs-actual] week=${result.weekKey} rows=${result.attribution.length}`,
    );
    for (const a of result.attribution) {
      console.info(
        `  - ${a.pct}% ${a.projectKey} (${a.hours}h, ${a.sessions} sessions)`,
      );
    }
    if (result.distillate) {
      console.info(
        `  distillate: ${(result.distillate.content ?? "").slice(0, 160)}…`,
      );
    }
    return;
  }

  if (args.selfModel) {
    console.info(`[self-model] mode=${store.mode} dryRun=${args.dryRun}`);
    const row = await refreshSelfModel(store, { dryRun: args.dryRun });
    console.info(`[self-model] ${(row.content ?? "").slice(0, 200)}…`);
    return;
  }

  if (args.projectBrief) {
    console.info(
      `[project-brief] mode=${store.mode} dryRun=${args.dryRun} limitSessions=${args.limit}`,
    );
    const result = await runProjectBriefJob(store, {
      dryRun: args.dryRun,
      limitSessions: args.limit,
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
    `[distillate] mode=${store.mode} dryRun=${args.dryRun} limit=${args.limit}`,
  );
  const result = await runDistillateWorker(store, {
    dryRun: args.dryRun,
    limit: args.limit,
    stubOnly: args.stubOnly,
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
