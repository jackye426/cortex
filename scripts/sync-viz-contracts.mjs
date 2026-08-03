#!/usr/bin/env node
/**
 * Generate the frontend copy of packages/viz-contracts for jackye426/data-verse-render.
 *
 * That repo is not part of this workspace, so it cannot depend on @cortex/viz-contracts.
 * It carries src/lib/viz-contracts.ts instead — which drifted by hand-editing until the
 * frontend was missing DENSITY_BUDGETS and typed VizDensity.meta as Record<string, unknown>.
 * This script makes that file generated output rather than a second source of truth.
 *
 *   node scripts/sync-viz-contracts.mjs --check          exit 1 if the copy is stale
 *   node scripts/sync-viz-contracts.mjs                  write ../data-verse-render-backup/...
 *   node scripts/sync-viz-contracts.mjs --target=<path>  point at another clone
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(repoRoot, "packages", "viz-contracts", "src", "index.ts");
const DEFAULT_TARGETS = [
  resolve(repoRoot, "..", "data-verse-render-backup"),
  resolve(repoRoot, "..", "data-verse-render"),
];
const RELATIVE_TARGET = join("src", "lib", "viz-contracts.ts");

const args = process.argv.slice(2);
const check = args.includes("--check");
const explicitTarget = args.find((a) => a.startsWith("--target="))?.slice("--target=".length);

function resolveTargetFile() {
  if (explicitTarget) {
    const base = resolve(explicitTarget);
    return base.endsWith(".ts") ? base : join(base, RELATIVE_TARGET);
  }
  for (const candidate of DEFAULT_TARGETS) {
    if (existsSync(candidate)) return join(candidate, RELATIVE_TARGET);
  }
  return null;
}

function render(source) {
  const header = [
    "/**",
    " * GENERATED FILE — DO NOT EDIT.",
    " *",
    " * Mirror of packages/viz-contracts/src/index.ts in jackye426/cortex.",
    " * Regenerate with `node scripts/sync-viz-contracts.mjs` from the Cortex repo.",
    " */",
    "",
  ].join("\n");
  return header + source.replace(/^\/\*\*[\s\S]*?\*\/\n/, "");
}

const targetFile = resolveTargetFile();
if (!targetFile) {
  console.error(
    "[sync-viz-contracts] no data-verse-render clone found; pass --target=<path to clone>",
  );
  process.exit(2);
}

/** Compare content only — Windows checkouts give the target CRLF endings. */
function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

const expected = render(normalize(readFileSync(SOURCE, "utf8")));
const actual = existsSync(targetFile) ? normalize(readFileSync(targetFile, "utf8")) : null;

if (actual === expected) {
  console.info(`[sync-viz-contracts] up to date: ${targetFile}`);
  process.exit(0);
}

if (check) {
  console.error(
    `[sync-viz-contracts] STALE: ${targetFile}\n` +
      "  run `node scripts/sync-viz-contracts.mjs` and commit the frontend copy",
  );
  process.exit(1);
}

writeFileSync(targetFile, expected, "utf8");
console.info(`[sync-viz-contracts] wrote ${targetFile}`);
