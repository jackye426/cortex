/**
 * Smoke the four I6 views + intrapersonal_metrics against live Supabase.
 *
 *   pnpm smoke-intrapersonal
 */
import { loadDotEnv } from "./env.js";
import { computeIntrapersonalMetrics } from "./intrapersonal/metrics.js";
import { getLatestInterestMap } from "./intrapersonal/interest-map.js";
import { getLatestSelfModel } from "./intrapersonal/self-model-v2.js";
import { getLatestWeeklyMirror } from "./intrapersonal/weekly-mirror.js";
import { listOpenQuestions } from "./intrapersonal/open-questions.js";
import { createStore } from "./store/index.js";

loadDotEnv();

function ok(label: string, pass: boolean, detail: string): void {
  console.info(`${pass ? "PASS" : "FAIL"} ${label}: ${detail}`);
}

async function main(): Promise<void> {
  const store = createStore();
  console.info(`[smoke-intrapersonal] store=${store.mode}\n`);

  if (store.mode !== "supabase") {
    console.error("Expected store=supabase; set SUPABASE_URL + keys in .env");
    process.exit(1);
  }

  const mirror = await getLatestWeeklyMirror(store);
  ok(
    "get_weekly_mirror",
    Boolean(mirror.mirror?.cards?.length),
    `${mirror.mirror?.cards?.length ?? 0} cards distillate=${mirror.distillate?.id ?? "live"}`,
  );

  const interests = await getLatestInterestMap(store);
  const interestCount = interests.map
    ? interests.map.sections.reduce((n, s) => n + s.interests.length, 0)
    : 0;
  ok(
    "get_interest_map",
    interestCount > 0 || Boolean(interests.distillate),
    `${interestCount} interests across ${interests.map?.sections.length ?? 0} sections`,
  );

  const selfModel = await getLatestSelfModel(store);
  ok(
    "get_self_model",
    Boolean(selfModel.version),
    `version=${selfModel.version?.version ?? "?"} strengths=${selfModel.version?.strengths?.length ?? 0}`,
  );

  const openQ = await listOpenQuestions(store, { limit: 10 });
  ok(
    "list_open_questions",
    Array.isArray(openQ.items),
    `${openQ.items.length} ranked items`,
  );

  const metrics = await computeIntrapersonalMetrics(store, { windowDays: 30 });
  ok(
    "intrapersonal_metrics",
    metrics.validatedInsightRate === null || typeof metrics.validatedInsightRate === "number",
    `VIR=${metrics.validatedInsightRate ?? "n/a"} surfaced=${metrics.surfacedDenom} validated=${metrics.validatedNumer}`,
  );

  console.info("\n" + JSON.stringify({ store: store.mode, metrics }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
