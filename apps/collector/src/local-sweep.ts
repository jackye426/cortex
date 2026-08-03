/**
 * Periodic sweep for the sources that are not part of the Google sync loop.
 *
 * Gmail, Calendar and Drive have incremental cursors and run every tick. AI
 * sessions, browser history, Calibre, GitHub and the media APIs were
 * backfill-only: they flowed exactly as often as somebody remembered to type
 * `pnpm backfill`. In practice that meant they stopped in July while the
 * daemon happily reported healthy ticks, so the vault silently aged out.
 *
 * These adapters are all checkpointed, so re-running them is incremental and
 * cheap: a sweep with nothing new to say costs one adapter healthcheck.
 */

import { runBackfill, type SourceOpt } from "./backfill.js";

/** Sources safe to sweep unattended (no --path argument required). */
const DEFAULT_SWEEP_SOURCES: SourceOpt[] = [
  "claude",
  "codex",
  "cursor",
  "browser",
  "calibre",
  "github",
  "spotify",
  "youtube",
];

function configuredSources(): SourceOpt[] {
  const raw = process.env.CORTEX_SWEEP_SOURCES?.trim();
  if (!raw) return DEFAULT_SWEEP_SOURCES;
  if (raw.toLowerCase() === "none") return [];
  const wanted = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as SourceOpt[];
  return wanted.filter((s) => DEFAULT_SWEEP_SOURCES.includes(s));
}

/** Per-source failures must not take down the sweep or the daemon. */
export async function runLocalSweep(): Promise<void> {
  const sources = configuredSources();
  if (sources.length === 0) {
    console.info("[collector-sweep] disabled (CORTEX_SWEEP_SOURCES=none)");
    return;
  }

  const limit = Number(process.env.CORTEX_SWEEP_LIMIT ?? 200);
  const started = Date.now();
  const summary: Record<string, string> = {};

  for (const source of sources) {
    try {
      const totals = await runBackfill({
        source,
        dryRun: false,
        ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
      });
      summary[source] = `${totals.ok}/${totals.total}`;
      if (totals.fail > 0) summary[source] += ` (${totals.fail} failed)`;
    } catch (err) {
      // An expired OAuth grant on one source should not stop the others.
      summary[source] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  console.info("[collector-sweep] done", {
    ms: Date.now() - started,
    ...summary,
  });
}
