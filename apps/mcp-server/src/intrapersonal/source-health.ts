/**
 * Source coverage / drowning-risk audit for evidence integrity.
 */
import type { CortexStore } from "../store/index.js";
import { OPERATIONAL_KINDS, REFLECTIVE_KINDS } from "../store/memory-lenses.js";
import {
  familyFromDistillateKind,
  familyFromSourceId,
} from "./source-family.js";
import type { SourceCoverageReport, SourceCoverageRow } from "./types.js";

const TRACKED_SOURCES = [
  "cursor",
  "claude-code",
  "codex",
  "chatgpt",
  "chatgpt-export",
  "gmail",
  "calendar",
  "drive",
  "github",
  "calibre",
  "browser",
  "spotify",
  "youtube",
  "manual",
] as const;

const SOURCE_RECORD_TYPES: Record<string, string[]> = {
  gmail: ["email_message"],
  calendar: ["calendar_event"],
  drive: ["drive_file"],
  github: ["github_pr", "github_issue", "github_commit"],
  calibre: ["ebook"],
  browser: ["bookmark", "search_query"],
  spotify: ["spotify_play", "spotify_episode", "spotify_track"],
  youtube: ["youtube_watch", "youtube_video"],
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/**
 * Recency window. The upper bound matters: calendar records carry future
 * `occurred_at` values, and without it every scheduled meeting counted as
 * "recent signal", masking a stalled source.
 */
function inWindow(
  iso: string | null | undefined,
  since: string,
  until = new Date().toISOString(),
): boolean {
  if (!iso) return false;
  return iso >= since && iso <= until;
}

export async function auditSourceCoverage(
  store: CortexStore,
): Promise<SourceCoverageReport> {
  const since7 = daysAgoIso(7);
  const since30 = daysAgoIso(30);
  // Whole-table totals; listDistillates caps at 200 rows ordered by recency.
  const kindStats = await store.listDistillateStats();

  // Shares come from totals too — sampling the newest 200 made whichever batch
  // ran last look like the entire vault.
  let totalKindCount = 0;
  let reflectiveTotal = 0;
  let operationalTotal = 0;
  let aiSessionTotal = 0;
  for (const stat of kindStats) {
    totalKindCount += stat.count;
    if ((REFLECTIVE_KINDS as readonly string[]).includes(stat.kind)) {
      reflectiveTotal += stat.count;
    }
    if ((OPERATIONAL_KINDS as readonly string[]).includes(stat.kind)) {
      operationalTotal += stat.count;
    }
    if (familyFromDistillateKind(stat.kind) === "ai_sessions") {
      aiSessionTotal += stat.count;
    }
  }
  const totalDist = Math.max(totalKindCount, 1);

  // Sessions grouped by source, so ai_sessions rows can report real ingest.
  const recentSessionsBySource = new Map<
    string,
    Array<{ occurredAt: string | null }>
  >();
  try {
    const recent = await store.listRecentWork({
      limit: 500,
      kinds: ["session"],
      horizonDays: null,
      workMode: false,
    });
    for (const item of recent) {
      const list = recentSessionsBySource.get(item.sourceId) ?? [];
      list.push({ occurredAt: item.occurredAt });
      recentSessionsBySource.set(item.sourceId, list);
    }
  } catch (err) {
    console.warn(
      "[source-health] session sampling failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  const sources: SourceCoverageRow[] = [];

  for (const sourceId of TRACKED_SOURCES) {
    const family = familyFromSourceId(sourceId);
    const recordTypes = SOURCE_RECORD_TYPES[sourceId] ?? [];
    let recordCount7d = 0;
    let recordCount30d = 0;

    for (const rt of recordTypes) {
      const rows = await store.listRecordsByType(rt, 200);
      for (const r of rows) {
        if (inWindow(r.occurredAt, since7)) recordCount7d += 1;
        if (inWindow(r.occurredAt, since30)) recordCount30d += 1;
      }
    }

    // AI session sources store sessions, not records, so the record-type map
    // above cannot see them: every session source reported zero ingest
    // regardless of how much had landed, which made a healthy source look dead.
    if (family === "ai_sessions") {
      const sessions = recentSessionsBySource.get(sourceId) ?? [];
      for (const s of sessions) {
        if (inWindow(s.occurredAt, since7)) recordCount7d += 1;
        if (inWindow(s.occurredAt, since30)) recordCount30d += 1;
      }
    }

    // Counted from per-kind totals rather than the recency sample, so a source
    // distilled before the latest run no longer reports zero.
    let distillateCount = 0;
    let embedded = 0;
    let lastDistillateAt: string | null = null;

    for (const stat of kindStats) {
      if (familyFromDistillateKind(stat.kind) !== family) continue;
      distillateCount += stat.count;
      embedded += stat.embedded;
      if (
        stat.lastCreatedAt &&
        (!lastDistillateAt || stat.lastCreatedAt > lastDistillateAt)
      ) {
        lastDistillateAt = stat.lastCreatedAt;
      }
    }

    const embedCoverage =
      distillateCount === 0 ? 0 : embedded / Math.max(distillateCount, 1);

    // Drowning risk: AI share of recent distillates, higher when reflective volume low.
    const drowningRisk =
      family === "ai_sessions"
        ? Math.min(1, aiSessionTotal / totalDist)
        : Math.max(
            0,
            Math.min(
              1,
              aiSessionTotal / totalDist -
                distillateCount / totalDist,
            ),
          );

    sources.push({
      sourceId,
      sourceFamily: family,
      recordCount7d,
      recordCount30d,
      distillateCount,
      embedCoverage: Number(embedCoverage.toFixed(3)),
      lastDistillateAt,
      drowningRisk: Number(drowningRisk.toFixed(3)),
    });
  }

  const notes: string[] = [];
  const aiShare = aiSessionTotal / totalDist;
  if (aiShare > 0.6) {
    notes.push(
      `AI session distillates are ${Math.round(aiShare * 100)}% of recent memory — reflective retrieval should use source balancing.`,
    );
  }
  if (reflectiveTotal === 0) {
    notes.push("No reflective distillates found in recent list.");
  }
  const quiet = sources.filter(
    (s) =>
      s.sourceFamily !== "ai_sessions" &&
      s.recordCount30d === 0 &&
      s.distillateCount === 0,
  );
  if (quiet.length) {
    notes.push(
      `No recent signal for: ${quiet.map((s) => s.sourceId).join(", ")}`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    sources,
    reflectiveShare: Number((reflectiveTotal / totalDist).toFixed(3)),
    operationalShare: Number((operationalTotal / totalDist).toFixed(3)),
    aiSessionShareOfRecentDistillates: Number(aiShare.toFixed(3)),
    notes,
  };
}
