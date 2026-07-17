/**
 * Quality-gate CLI — runs baseline Mirror questions and/or insight-quality fixtures.
 *
 *   pnpm --filter @cortex/mcp-server quality-gate
 *   pnpm --filter @cortex/mcp-server quality-gate -- --limit=5
 *   pnpm --filter @cortex/mcp-server quality-gate -- --fixture --limit=11
 *   pnpm --filter @cortex/mcp-server quality-gate -- --suite=insight
 *   pnpm --filter @cortex/mcp-server quality-gate -- --suite=all --fixture
 */
import { askMirror } from "./analyst.js";
import { MEMORY_EVAL_QUESTIONS } from "./eval/baseline.js";
import { runInsightQualityFixtures } from "./eval/insight-quality.js";
import { loadDotEnv } from "./env.js";
import { createStore } from "./store/index.js";

loadDotEnv();

type Suite = "memory" | "insight" | "all";

function parseLimit(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return MEMORY_EVAL_QUESTIONS.length;
}

function parseSuite(argv: string[]): Suite {
  for (const arg of argv) {
    if (arg.startsWith("--suite=")) {
      const v = arg.slice("--suite=".length);
      if (v === "memory" || v === "insight" || v === "all") return v;
    }
  }
  return "memory";
}

async function runMemorySuite(limit: number): Promise<{
  passed: number;
  total: number;
}> {
  const store = createStore();
  console.info(`[quality-gate] suite=memory store=${store.mode} questions=${limit}`);

  let passed = 0;
  const total = Math.min(limit, MEMORY_EVAL_QUESTIONS.length);
  for (const q of MEMORY_EVAL_QUESTIONS.slice(0, limit)) {
    const answer = await askMirror(store, {
      query: q.question,
      mode: q.mode,
      limit: 10,
    });
    const hasEvidence = answer.evidence.length > 0;
    const pass =
      q.expectsEvidence === false
        ? answer.confidence < 0.45 ||
          /insufficient/i.test(answer.answer) ||
          answer.gaps.length > 0
        : hasEvidence;
    if (pass) passed += 1;
    console.info(
      `${pass ? "PASS" : "FAIL"} ${q.id}: evidence=${answer.evidence.length} confidence=${answer.confidence.toFixed(2)} engine=${answer.engine} families=${JSON.stringify(answer.familyHistogram ?? {})}`,
    );
    console.info(`  Q: ${q.question}`);
    console.info(`  A: ${answer.answer.slice(0, 200)}`);
  }
  return { passed, total };
}

function runInsightSuite(): { passed: number; total: number } {
  console.info("[quality-gate] suite=insight (fixtures)");
  const { passed, total, results } = runInsightQualityFixtures();
  for (const r of results) {
    console.info(
      `${r.pass ? "PASS" : "FAIL"} ${r.id}: provenance=${r.provenanceRate.toFixed(2)} issues=${r.issues.map((i) => i.code).join(",") || "none"} missing=${r.missingCodes.join(",") || "none"}`,
    );
  }
  return { passed, total };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--fixture")) {
    process.env.CORTEX_FORCE_FIXTURE = "1";
  }
  const limit = parseLimit(argv);
  const suite = parseSuite(argv);

  const summary: Record<string, { passed: number; total: number }> = {};

  if (suite === "memory" || suite === "all") {
    summary.memory = await runMemorySuite(limit);
  }
  if (suite === "insight" || suite === "all") {
    summary.insight = runInsightSuite();
  }

  console.info(JSON.stringify({ suite, ...summary }, null, 2));

  for (const part of Object.values(summary)) {
    if (part.passed < part.total * 0.5) {
      process.exitCode = 2;
    }
  }
  if (summary.insight && summary.insight.passed < summary.insight.total) {
    // Insight suite is a hard gate — all fixtures must pass.
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
