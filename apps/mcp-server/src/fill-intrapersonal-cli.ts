/**
 * One-shot intrapersonal fill — skips session distillate (use when vault already has distillates).
 *
 *   pnpm --filter @cortex/mcp-server fill-intrapersonal
 */
import { loadDotEnv } from "./env.js";
import { createStore } from "./store/index.js";
import { extractObservations } from "./intrapersonal/extract-observations.js";
import { extractAffectProxies } from "./intrapersonal/affect.js";
import { refreshInterestMap } from "./intrapersonal/interest-map.js";
import { compileAbilityModel } from "./intrapersonal/ability-model.js";
import { detectCycles } from "./intrapersonal/cycles.js";
import { compileSelfModelVersion } from "./intrapersonal/self-model-v2.js";
import { compileSelfModelDiff } from "./intrapersonal/change-explain.js";
import { refreshWeeklyMirror } from "./intrapersonal/weekly-mirror.js";
import { snapshotOpenQuestions } from "./intrapersonal/open-questions.js";
import {
  runPriorityVsActual,
  seedEntitiesFromDistillates,
} from "./project-brief.js";
import { runEmbedBackfill } from "./project-brief.js";
import { refreshPortrait } from "./portrait.js";
import {
  enabledSourceAdapters,
  runSourceAdapter,
  WEEKLY_ADAPTER_IDS,
} from "./source-adapters.js";
import { isoWeekKey } from "./week-helpers.js";

loadDotEnv();

async function main(): Promise<void> {
  const store = createStore();
  console.info(`[fill-intrapersonal] store=${store.mode}`);

  const seed = await seedEntitiesFromDistillates(store, { limit: 200 });
  console.info(
    `[fill-intrapersonal] seed-entities linked=${seed.linked} upserted=${seed.upserted.length}`,
  );

  const embed = await runEmbedBackfill(store, { limit: 100 });
  console.info(
    `[fill-intrapersonal] embed-backfill updated=${embed.updated} skipped=${embed.skipped}`,
  );

  const observations = await extractObservations(store, { limit: 200 });
  console.info(
    `[fill-intrapersonal] extract-observations scanned=${observations.scanned} written=${observations.written} skipped=${observations.skipped}`,
  );

  const affect = await extractAffectProxies(store, { limit: 80 });
  console.info(
    `[fill-intrapersonal] extract-affect scanned=${affect.scanned} written=${affect.written}`,
  );

  const enabled = new Set(enabledSourceAdapters());
  const weekKey = isoWeekKey();
  for (const id of WEEKLY_ADAPTER_IDS.filter((a) => enabled.has(a))) {
    const result = await runSourceAdapter(store, id, {
      limit: 200,
      weekKey,
      force: true,
    });
    console.info(
      `[fill-intrapersonal] source-adapter ${id}: written=${result.written} scanned=${result.scanned}`,
    );
  }

  const interestMap = await refreshInterestMap(store, {});
  console.info(
    `[fill-intrapersonal] interest-map week=${interestMap.weekKey} written=${interestMap.written} mined=${interestMap.mined}`,
  );

  const pva = await runPriorityVsActual(store, {});
  console.info(
    `[fill-intrapersonal] priority-vs-actual week=${pva.weekKey} rows=${pva.attribution.length}`,
  );

  const ability = await compileAbilityModel(store, {});
  console.info(
    `[fill-intrapersonal] ability-model written=${ability.written} strengths=${ability.strengths.length}`,
  );

  const cycles = await detectCycles(store, {});
  console.info(
    `[fill-intrapersonal] cycles detected=${cycles.cycles.length} hypotheses=${cycles.hypotheses.length}`,
  );

  const selfModel = await compileSelfModelVersion(store, { skipAbility: true });
  console.info(
    `[fill-intrapersonal] self-model v2 version=${selfModel.version?.version ?? "?"} written=${selfModel.written}`,
  );

  const diff = await compileSelfModelDiff(store, {});
  console.info(
    `[fill-intrapersonal] self-model-diff written=${Boolean(diff)} id=${diff?.id ?? "none"}`,
  );

  const weeklyMirror = await refreshWeeklyMirror(store, {});
  console.info(
    `[fill-intrapersonal] weekly-mirror week=${weeklyMirror.weekKey} cards=${weeklyMirror.mirror.cards.length} written=${weeklyMirror.written}`,
  );

  const openQ = await snapshotOpenQuestions(store, {});
  console.info(
    `[fill-intrapersonal] open-questions items=${openQ.payload.items.length} written=${openQ.written}`,
  );

  const portrait = await refreshPortrait(store, {});
  console.info(
    `[fill-intrapersonal] portrait written=${portrait.written} id=${portrait.portrait?.id ?? "none"}`,
  );

  console.info("[fill-intrapersonal] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
