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
import { runYoutubeInterestDigest } from "./youtube-digest.js";
import { refreshPortrait } from "./portrait.js";
import {
  enabledSourceAdapters,
  NIGHTLY_ADAPTER_IDS,
  runSourceAdapter,
  WEEKLY_ADAPTER_IDS,
  type SourceAdapterResult,
} from "./source-adapters.js";
import { isoWeekKey } from "./week-helpers.js";
import { extractObservations } from "./intrapersonal/extract-observations.js";
import { extractAffectProxies } from "./intrapersonal/affect.js";
import { refreshInterestMap } from "./intrapersonal/interest-map.js";

export type TwinPipelineMode = "nightly" | "weekly" | "backfill";

export interface TwinPipelineOptions {
  mode?: TwinPipelineMode;
  /** Sessions per distillate batch (default 30). */
  batchSize?: number;
  /** Max distillate batches per run (default 10 nightly, 30 backfill). */
  maxBatches?: number;
  dryRun?: boolean;
  /** Enable weekly portrait snapshot (default true for weekly). */
  portrait?: boolean;
  /** Skip YouTube digest (default false). */
  skipYoutube?: boolean;
  /** Per enabled source adapter write cap (default 15). */
  sourceAdapterLimit?: number;
  /** Force recompile source adapters (ignore fingerprint skip). */
  forceSourceAdapters?: boolean;
}

export interface TwinPipelineResult {
  mode: TwinPipelineMode;
  dryRun: boolean;
  distillateBatches: number;
  distillateProcessed: number;
  distillateWritten: number;
  embedBackfillUpdated: number;
  seedEntitiesLinked: number;
  youtubeDigestWritten?: number;
  youtubeWeekKey?: string;
  projectBriefsWritten?: number;
  priorityWeek?: string;
  selfModelUpdated?: boolean;
  portraitWritten?: boolean;
  sourceAdapters?: Array<{
    adapter: string;
    written: number;
    skipped: number;
    scanned: number;
    skippedSensitive?: number;
  }>;
  observationsScanned?: number;
  observationsWritten?: number;
  affectWritten?: number;
  interestMapWritten?: boolean;
  interestsMined?: number;
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

async function runEnabledSourceAdapters(
  store: CortexStore,
  opts: {
    cadence: "nightly" | "weekly";
    dryRun: boolean;
    limit: number;
    force?: boolean;
  },
): Promise<SourceAdapterResult[]> {
  const enabled = new Set(enabledSourceAdapters());
  const allowed =
    opts.cadence === "nightly" ? NIGHTLY_ADAPTER_IDS : WEEKLY_ADAPTER_IDS;
  const ids = allowed.filter((id) => enabled.has(id));
  const results: SourceAdapterResult[] = [];
  const weekKey =
    opts.cadence === "weekly" ? isoWeekKey() : undefined;

  for (const id of ids) {
    try {
      const result = await runSourceAdapter(store, id, {
        dryRun: opts.dryRun,
        limit: opts.limit,
        force: opts.force,
        weekKey,
      });
      results.push(result);
      console.info(
        `[twin-pipeline] source-adapter ${id}: written=${result.written} skipped=${result.skipped} scanned=${result.scanned}` +
          (result.skippedSensitive != null
            ? ` skippedSensitive=${result.skippedSensitive}`
            : ""),
      );
    } catch (err) {
      console.warn(
        `[twin-pipeline] source-adapter ${id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return results;
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
  const sourceLimit = options.sourceAdapterLimit ?? 15;

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

  // Nightly (+ backfill): enabled operational source adapters
  if (mode === "nightly" || mode === "backfill") {
    const nightly = await runEnabledSourceAdapters(store, {
      cadence: "nightly",
      dryRun,
      limit: sourceLimit,
      force: options.forceSourceAdapters,
    });
    out.sourceAdapters = [
      ...(out.sourceAdapters ?? []),
      ...nightly.map((r) => ({
        adapter: r.adapter,
        written: r.written,
        skipped: r.skipped,
        scanned: r.scanned,
        skippedSensitive: r.skippedSensitive,
      })),
    ];
  }

  if (!options.skipYoutube) {
    const yt = await runYoutubeInterestDigest(store, { dryRun });
    out.youtubeDigestWritten = yt.written;
    out.youtubeWeekKey = yt.weekKey;
    console.info(
      `[twin-pipeline] youtube-digest week=${yt.weekKey} written=${yt.written} scanned=${yt.scanned} skipped=${yt.skipped}`,
    );
  }

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

  const observations = await extractObservations(store, {
    dryRun,
    limit: Math.max(batchSize * 2, 80),
  });
  out.observationsScanned = observations.scanned;
  out.observationsWritten = observations.written;
  console.info(
    `[twin-pipeline] extract-observations scanned=${observations.scanned} written=${observations.written} skipped=${observations.skipped}`,
  );

  const affect = await extractAffectProxies(store, {
    dryRun,
    limit: Math.max(batchSize, 40),
  });
  out.affectWritten = affect.written;
  console.info(
    `[twin-pipeline] extract-affect scanned=${affect.scanned} written=${affect.written}`,
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
    // Reflective week digests for enabled adapters (current ISO week)
    const weekly = await runEnabledSourceAdapters(store, {
      cadence: "weekly",
      dryRun,
      limit: Math.max(sourceLimit, 200),
      force: options.forceSourceAdapters,
    });
    out.sourceAdapters = [
      ...(out.sourceAdapters ?? []),
      ...weekly.map((r) => ({
        adapter: r.adapter,
        written: r.written,
        skipped: r.skipped,
        scanned: r.scanned,
        skippedSensitive: r.skippedSensitive,
      })),
    ];

    const interestMap = await refreshInterestMap(store, { dryRun });
    out.interestMapWritten = interestMap.written;
    out.interestsMined = interestMap.mined;
    console.info(
      `[twin-pipeline] interest-map week=${interestMap.weekKey} written=${interestMap.written} mined=${interestMap.mined}`,
    );

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
    if (options.portrait !== false) {
      const portrait = await refreshPortrait(store, { dryRun });
      out.portraitWritten = portrait.written;
      console.info(
        `[twin-pipeline] portrait written=${portrait.written} id=${portrait.portrait?.id ?? "none"}`,
      );
    }
  }

  return out;
}
