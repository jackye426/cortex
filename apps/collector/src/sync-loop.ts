/**
 * Incremental Google sync for the always-on collector daemon.
 * Uses separate checkpoint accountKey "sync" so list-backfill cursors stay intact.
 */

import type { RawEnvelope, SourceId, SyncCheckpoint } from "@cortex/core";
import { CalendarAdapter } from "@cortex/adapter-calendar";
import { DriveAdapter } from "@cortex/adapter-drive";
import { GmailAdapter } from "@cortex/adapter-gmail";
import {
  createOAuth2ClientFromEnv,
  ensureAccessToken,
  gmailApi,
  shouldUseGoogleMock,
} from "@cortex/google-auth";
import { advanceCheckpoint, loadCheckpoint } from "./checkpoint-store.js";
import {
  getIngestConfig,
  postEnvelope,
  type IngestConfig,
} from "./ingest-client.js";

function enabled(flag: string, defaultOn = true): boolean {
  const v = process.env[flag]?.trim().toLowerCase();
  if (v === undefined || v === "") return defaultOn;
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

function checkpointOf(
  source: SourceId,
  cursor: string | null | undefined,
): SyncCheckpoint | undefined {
  if (!cursor) return undefined;
  return {
    source,
    accountKey: "sync",
    cursor,
    updatedAt: new Date().toISOString(),
  };
}

async function ingestPage(
  source: SourceId,
  items: RawEnvelope[],
  nextCursor: string | null,
  config: IngestConfig,
): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  for (const env of items) {
    const result = await postEnvelope(env, config);
    if (result.ok) {
      ok += 1;
    } else {
      fail += 1;
      console.error(
        `[collector-sync] FAIL ${source}:${env.sourceRecordId} ${result.error}`,
      );
    }
  }
  // Advance opaque sync cursor only when the page fully succeeded (or empty).
  if (fail === 0 && nextCursor) {
    advanceCheckpoint({
      source,
      accountKey: "sync",
      cursor: nextCursor,
      metadata: {
        sync: true,
        emptyPage: items.length === 0,
        ingested: ok,
      },
    });
  }
  return { ok, fail };
}

async function bootstrapGmailHistoryCursor(): Promise<string | null> {
  if (shouldUseGoogleMock()) return null;
  const auth = createOAuth2ClientFromEnv();
  if (!auth) return null;
  await ensureAccessToken(auth);
  const gmail = gmailApi(auth);
  const profile = await gmail.users.getProfile({ userId: "me" });
  const historyId = profile.data.historyId;
  if (!historyId) return null;
  return JSON.stringify({ mode: "history", historyId: String(historyId) });
}

function isGmailHistoryCursor(cursor: string | undefined): boolean {
  if (!cursor) return false;
  try {
    const parsed = JSON.parse(cursor) as { mode?: string; historyId?: string };
    return parsed.mode === "history" && Boolean(parsed.historyId);
  } catch {
    return false;
  }
}

async function syncGmail(config: IngestConfig): Promise<void> {
  const adapter = new GmailAdapter({
    pageSize: 50,
    collectorName: "collector-sync",
  });
  const health = await adapter.healthcheck();
  if (!health.ok) {
    console.warn("[collector-sync] gmail skip:", health.detail);
    return;
  }

  let prior = loadCheckpoint("gmail", "sync");
  if (!isGmailHistoryCursor(prior?.cursor)) {
    const boot = await bootstrapGmailHistoryCursor();
    if (!boot) {
      console.warn("[collector-sync] gmail: no historyId bootstrap");
      return;
    }
    advanceCheckpoint({
      source: "gmail",
      accountKey: "sync",
      cursor: boot,
      metadata: { sync: true, bootstrapped: true },
    });
    prior = loadCheckpoint("gmail", "sync");
    console.info("[collector-sync] gmail: bootstrapped history cursor");
  }

  let guard = 0;
  let cursor = prior?.cursor;
  while (guard++ < 20) {
    const page = await adapter.fetchPage(checkpointOf("gmail", cursor));
    const { ok, fail } = await ingestPage(
      "gmail",
      page.items,
      page.nextCursor,
      config,
    );
    console.info("[collector-sync] gmail page", {
      items: page.items.length,
      ok,
      fail,
      hasMore: page.hasMore,
    });
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
}

async function syncCalendar(config: IngestConfig): Promise<void> {
  const adapter = new CalendarAdapter({
    pageSize: 50,
    collectorName: "collector-sync",
  });
  const health = await adapter.healthcheck();
  if (!health.ok) {
    console.warn("[collector-sync] calendar skip:", health.detail);
    return;
  }

  const prior = loadCheckpoint("calendar", "sync");
  let cursor = prior?.cursor;
  let guard = 0;
  while (guard++ < 20) {
    const page = await adapter.fetchPage(checkpointOf("calendar", cursor));
    const { ok, fail } = await ingestPage(
      "calendar",
      page.items,
      page.nextCursor,
      config,
    );
    console.info("[collector-sync] calendar page", {
      items: page.items.length,
      ok,
      fail,
      hasMore: page.hasMore,
    });
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
}

async function syncDrive(config: IngestConfig): Promise<void> {
  const adapter = new DriveAdapter({
    pageSize: 50,
    collectorName: "collector-sync",
  });
  const health = await adapter.healthcheck();
  if (!health.ok) {
    console.warn("[collector-sync] drive skip:", health.detail);
    return;
  }

  let prior = loadCheckpoint("drive", "sync");
  // Reuse finished list-backfill cursor if it already reached changes mode.
  if (!prior?.cursor?.includes('"mode":"changes"')) {
    const listCp = loadCheckpoint("drive", "default");
    if (listCp?.cursor?.includes('"mode":"changes"')) {
      advanceCheckpoint({
        source: "drive",
        accountKey: "sync",
        cursor: listCp.cursor,
        metadata: { sync: true, fromBackfill: true },
      });
      prior = loadCheckpoint("drive", "sync");
      console.info("[collector-sync] drive: adopted changes cursor from backfill");
    }
  }

  let cursor = prior?.cursor;
  if (!cursor?.includes('"mode":"changes"')) {
    console.info(
      "[collector-sync] drive: no changes cursor yet — finish `pnpm backfill -- --source=drive` once, then sync will adopt it",
    );
    return;
  }

  let guard = 0;
  while (guard++ < 20) {
    const page = await adapter.fetchPage(checkpointOf("drive", cursor));
    const { ok, fail } = await ingestPage(
      "drive",
      page.items,
      page.nextCursor,
      config,
    );
    console.info("[collector-sync] drive page", {
      items: page.items.length,
      ok,
      fail,
      hasMore: page.hasMore,
    });
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
}

/** One collector tick: optional Gmail / Calendar / Drive incremental sync. */
export async function runSyncTick(): Promise<void> {
  const config = getIngestConfig();
  if (!config.token) {
    console.warn("[collector-sync] CORTEX_INGEST_TOKEN missing — skip sync");
    return;
  }

  if (enabled("CORTEX_SYNC_GMAIL")) {
    try {
      await syncGmail(config);
    } catch (err) {
      console.error(
        "[collector-sync] gmail error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  if (enabled("CORTEX_SYNC_CALENDAR")) {
    try {
      await syncCalendar(config);
    } catch (err) {
      console.error(
        "[collector-sync] calendar error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  if (enabled("CORTEX_SYNC_DRIVE")) {
    try {
      await syncDrive(config);
    } catch (err) {
      console.error(
        "[collector-sync] drive error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
