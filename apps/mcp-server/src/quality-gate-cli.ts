/**
 * Quality-gate CLI — runs baseline Mirror questions against the active store.
 *
 *   pnpm --filter @cortex/mcp-server quality-gate
 *   pnpm --filter @cortex/mcp-server quality-gate -- --limit=5
 *   pnpm --filter @cortex/mcp-server quality-gate -- --fixture --limit=11
 */
import { askMirror } from "./analyst.js";
import { MEMORY_EVAL_QUESTIONS } from "./eval/baseline.js";
import { loadDotEnv } from "./env.js";
import { createStore } from "./store/index.js";

loadDotEnv();

function parseLimit(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return MEMORY_EVAL_QUESTIONS.length;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--fixture")) {
    process.env.CORTEX_FORCE_FIXTURE = "1";
  }
  const limit = parseLimit(argv);
  const store = createStore();
  console.info(`[quality-gate] store=${store.mode} questions=${limit}`);

  let passed = 0;
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
      `${pass ? "PASS" : "FAIL"} ${q.id}: evidence=${answer.evidence.length} confidence=${answer.confidence.toFixed(2)} engine=${answer.engine}`,
    );
    console.info(`  Q: ${q.question}`);
    console.info(`  A: ${answer.answer.slice(0, 200)}`);
  }

  console.info(
    JSON.stringify(
      {
        store: store.mode,
        passed,
        total: Math.min(limit, MEMORY_EVAL_QUESTIONS.length),
      },
      null,
      2,
    ),
  );
  if (passed < Math.min(limit, MEMORY_EVAL_QUESTIONS.length) * 0.5) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
