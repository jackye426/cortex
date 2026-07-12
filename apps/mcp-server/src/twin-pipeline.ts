/**
 * Orchestrated distillate + twin jobs for nightly cron / backfill.
 */
import { runDistillateWorker } from "./distillate.js";
import type { CortexStore } from "./store/index.js";
import {
  refreshSelfModel,
  runEmbedBackfill,
  runPriorityVsActual,
  runProjectBriefJob,
  seedEntitiesFromDistillates,
} from "./project-brief.js";

export type TwinPipelineMode = "nightly" | "weekly" | "backfill";

export interface TwinPipelineOptions {
  mode?: TwinPipelineMode;
  /** Sessions per distillate batch (default 30). */
  batchSize?: number;
  /** Max distillate batches per run (default 10 nightly, 30 backfill). */
  maxBatches?: number;
  dryRun?: boolean;
}

export interface TwinPipelineResult {
  mode: TwinPipelineMode;
  dryRun: boolean;
  distillateBatches: number;
  distillateProcessed: number;
  distillateWritten: number;
  embedBackfillUpdated: number;
  seedEntitiesLinked: number;
  projectBriefsWritten?: number;
  priorityWeek?: string;
  selfModelUpdated?: boolean;
}

async function runDistillateBatches(
  store: CortexStore,
  opts: {
    batchSize: number;
    maxBatches: number;
    dryRun: boolean;
  },
): Promise<{
  batches: number;
  processed: number;
  written: number;
}> {
  let batches = 0;
  let processed = 0;
  let written = 0;

  while (batches < opts.maxBatches) {
    const result = await runDistillateWorker(store, {
      limit: opts.batchSize,
      dryRun: opts.dryRun,
      skipDistilled: true,
    });
    batches += 1;
    processed += result.processed;
    written += result.written;
    if (result.processed === 0) break;
    console.info(
      `[twin-pipeline] distillate batch ${batches}: processed=${result.processed} written=${result.written}`,
    );
  }

  return { batches, processed, written };
}

export async function runTwinPipeline(
  store: CortexStore,
  options: TwinPipelineOptions = {},
): Promise<TwinPipelineResult> {
  const mode = options.mode ?? "nightly";
  const dryRun = Boolean(options.dryRun);
  const batchSize = options.batchSize ?? 30;
  const maxBatches =
    options.maxBatches ??
    (mode === "backfill" ? 30 : mode === "weekly" ? 15 : 10);

  const out: TwinPipelineResult = {
    mode,
    dryRun,
    distillateBatches: 0,
    distillateProcessed: 0,
    distillateWritten: 0,
    embedBackfillUpdated: 0,
    seedEntitiesLinked: 0,
  };

  const distill = await runDistillateBatches(store, {
    batchSize,
    maxBatches,
    dryRun,
  });
  out.distillateBatches = distill.batches;
  out.distillateProcessed = distill.processed;
  out.distillateWritten = distill.written;

  const embed = await runEmbedBackfill(store, {
    limit: Math.max(batchSize * 2, 50),
    dryRun,
  });
  out.embedBackfillUpdated = embed.updated;
  console.info(
    `[twin-pipeline] embed-backfill updated=${embed.updated} skipped=${embed.skipped}`,
  );

  const seed = await seedEntitiesFromDistillates(store, {
    dryRun,
    limit: 100,
  });
  out.seedEntitiesLinked = seed.linked;
  console.info(
    `[twin-pipeline] seed-entities linked=${seed.linked} upserted=${seed.upserted.length}`,
  );

  if (mode === "weekly" || mode === "backfill") {
    const brief = await runProjectBriefJob(store, {
      dryRun,
      limitSessions: 80,
    });
    out.projectBriefsWritten = brief.written;
    console.info(
      `[twin-pipeline] project-brief written=${brief.written} projects=${brief.projects.join(",")}`,
    );
  }

  if (mode === "weekly") {
    const pva = await runPriorityVsActual(store, { dryRun });
    out.priorityWeek = pva.weekKey;
    console.info(
      `[twin-pipeline] priority-vs-actual week=${pva.weekKey} rows=${pva.attribution.length}`,
    );
    if (!dryRun) {
      await refreshSelfModel(store, { dryRun: false });
      out.selfModelUpdated = true;
      console.info("[twin-pipeline] self-model refreshed");
    }
  }

  return out;
}
