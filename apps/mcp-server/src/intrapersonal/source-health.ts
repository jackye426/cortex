/**
 * Source coverage / drowning-risk audit for evidence integrity.
 */
import type { CortexStore } from "../store/index.js";
import { OPERATIONAL_KINDS, REFLECTIVE_KINDS } from "../store/memory-lenses.js";
import {
  familyFromDistillateKind,
  familyFromSourceId,
} from "./source-family.js";
import type {
  SourceCoverageReport,
  SourceCoverageRow,
  SourceFamily,
} from "./types.js";

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

function inWindow(iso: string | null | undefined, since: string): boolean {
  if (!iso) return false;
  return iso >= since;
}

export async function auditSourceCoverage(
  store: CortexStore,
): Promise<SourceCoverageReport> {
  const since7 = daysAgoIso(7);
  const since30 = daysAgoIso(30);
  const distillates = await store.listDistillates({ limit: 400 });

  const byFamilyDistillates = new Map<SourceFamily, typeof distillates>();
  let reflective = 0;
  let operational = 0;
  let aiSessionDistillates = 0;

  for (const d of distillates) {
    const family = familyFromDistillateKind(d.kind);
    const bucket = byFamilyDistillates.get(family) ?? [];
    bucket.push(d);
    byFamilyDistillates.set(family, bucket);
    if ((REFLECTIVE_KINDS as readonly string[]).includes(d.kind)) {
      reflective += 1;
    }
    if ((OPERATIONAL_KINDS as readonly string[]).includes(d.kind)) {
      operational += 1;
    }
    if (family === "ai_sessions") aiSessionDistillates += 1;
  }

  const totalDist = Math.max(distillates.length, 1);
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

    // AI session sources: approximate via session summaries metadata / subject
    const familyDistillates = byFamilyDistillates.get(family) ?? [];
    let distillateCount = 0;
    let embedded = 0;
    let lastDistillateAt: string | null = null;

    if (recordTypes.length === 0 && family === "ai_sessions") {
      // Count summaries; cannot always attribute to a specific AI source in metadata.
      const summaries = distillates.filter((d) => d.kind === "summary");
      distillateCount = summaries.length;
      embedded = summaries.filter((d) => Boolean(d.embedding?.length)).length;
      lastDistillateAt = summaries[0]?.updatedAt ?? null;
    } else {
      const matched = familyDistillates.filter((d) => {
        const st =
          typeof d.metadata.sourceType === "string"
            ? d.metadata.sourceType
            : typeof d.metadata.sourceId === "string"
              ? d.metadata.sourceId
              : "";
        return !st || st === sourceId || familyFromSourceId(st) === family;
      });
      distillateCount = matched.length || familyDistillates.length;
      const pool = matched.length ? matched : familyDistillates;
      embedded = pool.filter((d) => Boolean(d.embedding?.length)).length;
      lastDistillateAt = pool[0]?.updatedAt ?? null;
    }

    const embedCoverage =
      distillateCount === 0 ? 0 : embedded / Math.max(distillateCount, 1);

    // Drowning risk: AI share of recent distillates, higher when reflective volume low.
    const drowningRisk =
      family === "ai_sessions"
        ? Math.min(1, aiSessionDistillates / totalDist)
        : Math.max(
            0,
            Math.min(
              1,
              aiSessionDistillates / totalDist -
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
  const aiShare = aiSessionDistillates / totalDist;
  if (aiShare > 0.6) {
    notes.push(
      `AI session distillates are ${Math.round(aiShare * 100)}% of recent memory — reflective retrieval should use source balancing.`,
    );
  }
  if (reflective === 0) {
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
    reflectiveShare: Number((reflective / totalDist).toFixed(3)),
    operationalShare: Number((operational / totalDist).toFixed(3)),
    aiSessionShareOfRecentDistillates: Number(aiShare.toFixed(3)),
    notes,
  };
}
