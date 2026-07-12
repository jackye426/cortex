/**
 * Cortex local collector daemon (Windows host).
 * Heartbeat + incremental Google sync (Gmail history, Calendar, Drive).
 * See docs/ops-windows.md.
 */

import { hostname } from "node:os";
import { loadDotEnv, getIngestConfig } from "./ingest-client.js";
import { runSyncTick } from "./sync-loop.js";

loadDotEnv();

const INGEST_URL = getIngestConfig().url;
const INTERVAL_MS = Number(process.env.CORTEX_COLLECTOR_INTERVAL_MS ?? 300_000);

async function healthPing(): Promise<void> {
  try {
    const res = await fetch(`${INGEST_URL}/health`);
    const body = (await res.json()) as unknown;
    console.info("[collector] api health", { status: res.status, body });
  } catch (err) {
    console.warn("[collector] api unreachable", {
      url: INGEST_URL,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function tick(): Promise<void> {
  console.info("[collector] tick", {
    host: hostname(),
    at: new Date().toISOString(),
  });
  await healthPing();
  await runSyncTick();
}

console.info("[collector] starting", {
  ingestUrl: INGEST_URL,
  intervalMs: INTERVAL_MS,
  host: hostname(),
  syncGmail: process.env.CORTEX_SYNC_GMAIL ?? "1",
  syncCalendar: process.env.CORTEX_SYNC_CALENDAR ?? "1",
  syncDrive: process.env.CORTEX_SYNC_DRIVE ?? "1",
});

await tick();
const handle = setInterval(() => {
  void tick();
}, INTERVAL_MS);

function shutdown(signal: string): void {
  console.info(`[collector] shutting down (${signal})`);
  clearInterval(handle);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
