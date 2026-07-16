/**
 * Weekly YouTube interest digests — first cross-source embedded adapter.
 * Prefer Takeout `youtube_watch` rows for true week grain (library dates are sparse).
 */
import {
  chatJsonCompletion,
  distillateModel,
  embedTexts,
  openaiConfigured,
} from "./llm.js";
import { YOUTUBE_COMPILER_VERSION } from "./eval/baseline.js";
import { normalizeTopic } from "./store/memory-lenses.js";
import { stableSubjectUuid } from "./stable-id.js";
import type { CortexStore } from "./store/index.js";
import type { DistillateRow, RecordHit } from "./store/types.js";
import {
  inWeek,
  isoWeekKey,
  sourceFingerprint,
  weekRange,
} from "./week-helpers.js";

export interface YoutubeDigestOptions {
  /** ISO week key e.g. 2026-W28; default previous completed week. */
  weekKey?: string;
  dryRun?: boolean;
  limitRecords?: number;
  force?: boolean;
}

export interface YoutubeDigestResult {
  mode: CortexStore["mode"];
  dryRun: boolean;
  weekKey: string;
  scanned: number;
  written: number;
  skipped: number;
  distillate: DistillateRow | null;
}

function recordTitle(r: RecordHit): string {
  const p = r.payload;
  return (
    (typeof p.title === "string" && p.title) ||
    (typeof p.name === "string" && p.name) ||
    r.sourceRecordId
  );
}

function recordChannel(r: RecordHit): string {
  const p = r.payload;
  return (
    (typeof p.channelTitle === "string" && p.channelTitle) ||
    (typeof p.channelId === "string" && p.channelId) ||
    "unknown"
  );
}

async function maybeEmbed(
  content: string,
): Promise<{ embedding: number[] | null; embeddingRef: string | null }> {
  if (!openaiConfigured() || !content.trim()) {
    return { embedding: null, embeddingRef: null };
  }
  try {
    const [vec] = await embedTexts([content]);
    if (!vec?.length) return { embedding: null, embeddingRef: null };
    return {
      embedding: vec,
      embeddingRef: `openai:${process.env.CORTEX_EMBEDDING_MODEL?.trim() || "text-embedding-3-small"}`,
    };
  } catch {
    return { embedding: null, embeddingRef: null };
  }
}

function heuristicDigest(items: RecordHit[]): {
  summary: string;
  topics: string[];
  recurring: string[];
  oneOff: string[];
  confidence: number;
} {
  const byChannel = new Map<string, number>();
  const titles: string[] = [];
  for (const r of items) {
    const ch = recordChannel(r);
    byChannel.set(ch, (byChannel.get(ch) ?? 0) + 1);
    titles.push(recordTitle(r));
  }
  const recurring = [...byChannel.entries()]
    .filter(([, n]) => n > 1)
    .map(([ch]) => ch);
  const oneOff = [...byChannel.entries()]
    .filter(([, n]) => n === 1)
    .map(([ch]) => ch)
    .slice(0, 8);
  const topics = recurring.length
    ? recurring.map((c) => normalizeTopic(c)).filter(Boolean)
    : titles.slice(0, 3).map((t) => normalizeTopic(t.split(/\s+/).slice(0, 3).join(" ")));
  return {
    summary: `YouTube week digest: ${items.length} items. Recurring channels: ${recurring.join(", ") || "none"}. Sample titles: ${titles.slice(0, 5).join("; ")}.`,
    topics: [...new Set(topics)].slice(0, 12),
    recurring,
    oneOff,
    confidence: items.length >= 3 ? 0.7 : 0.45,
  };
}

/**
 * Compile a weekly YouTube interest digest and embed it.
 */
export async function runYoutubeInterestDigest(
  store: CortexStore,
  options: YoutubeDigestOptions = {},
): Promise<YoutubeDigestResult> {
  const dryRun = Boolean(options.dryRun);
  const weekKey = options.weekKey ?? isoWeekKey(new Date(Date.now() - 3 * 86400000));
  const { start, end } = weekRange(weekKey);
  const limit = options.limitRecords ?? 500;

  // Range query — avoids the old top-N cap hiding in-week Takeout watches.
  const [videos, watches] = await Promise.all([
    store.listRecordsByTypeInRange("youtube_video", start, end, limit),
    store.listRecordsByTypeInRange("youtube_watch", start, end, limit),
  ]);
  const all = [...videos, ...watches].filter((r) =>
    inWeek(r.occurredAt, start, end),
  );

  if (all.length === 0) {
    return {
      mode: store.mode,
      dryRun,
      weekKey,
      scanned: 0,
      written: 0,
      skipped: 1,
      distillate: null,
    };
  }

  const fingerprint = sourceFingerprint(all);
  // Idempotency: skip if digest exists with same compiler + fingerprint unless force
  const subjectId = stableSubjectUuid("youtube-week", weekKey);
  if (!options.force) {
    const existing = await store.listDistillates({
      limit: 20,
      kinds: ["youtube_interest_digest"],
    });
    const hit = existing.find(
      (d) =>
        (d.subjectId === subjectId || d.metadata.weekKey === weekKey) &&
        d.metadata.compilerVersion === YOUTUBE_COMPILER_VERSION,
    );
    if (
      hit &&
      (!hit.metadata.sourceFingerprint ||
        hit.metadata.sourceFingerprint === fingerprint)
    ) {
      return {
        mode: store.mode,
        dryRun,
        weekKey,
        scanned: all.length,
        written: 0,
        skipped: 1,
        distillate: hit,
      };
    }
  }

  const lines = all.slice(0, 80).map((r) => {
    const p = r.payload;
    const desc =
      typeof p.descriptionPreview === "string"
        ? p.descriptionPreview.slice(0, 120)
        : "";
    return `- ${recordTitle(r)} | channel=${recordChannel(r)} | id=${r.id}${desc ? ` | ${desc}` : ""}`;
  });

  let summary: string;
  let topics: string[] = [];
  let recurring: string[] = [];
  let oneOff: string[] = [];
  let confidence = 0.6;
  let model = "cortex-youtube-digest-stub";

  if (openaiConfigured() && !dryRun) {
    try {
      const { text, model: m } = await chatJsonCompletion({
        system: `You summarize a week of YouTube watches into JSON for a personal memory system.
Return ONLY JSON: { summary, topics: string[], recurring: string[], oneOff: string[], confidence: number }.
Rules: topics are normalized themes (not video titles); recurring needs >1 supporting item; do not infer identity or endorsement from watching; be concise.`,
        user: `Week ${weekKey} (${start} → ${end})\nItems (${all.length}):\n${lines.join("\n")}`.slice(
          0,
          20000,
        ),
        model: distillateModel(),
      });
      model = m;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      summary =
        typeof parsed.summary === "string"
          ? parsed.summary
          : heuristicDigest(all).summary;
      topics = Array.isArray(parsed.topics)
        ? parsed.topics
            .filter((x): x is string => typeof x === "string")
            .map(normalizeTopic)
            .filter(Boolean)
        : [];
      recurring = Array.isArray(parsed.recurring)
        ? parsed.recurring.filter((x): x is string => typeof x === "string")
        : [];
      oneOff = Array.isArray(parsed.oneOff)
        ? parsed.oneOff.filter((x): x is string => typeof x === "string")
        : [];
      confidence =
        typeof parsed.confidence === "number" ? parsed.confidence : 0.65;
    } catch {
      const h = heuristicDigest(all);
      summary = h.summary;
      topics = h.topics;
      recurring = h.recurring;
      oneOff = h.oneOff;
      confidence = h.confidence;
    }
  } else {
    const h = heuristicDigest(all);
    summary = h.summary;
    topics = h.topics;
    recurring = h.recurring;
    oneOff = h.oneOff;
    confidence = h.confidence;
  }

  const embedText = [summary, ...topics.map((t) => `topic:${t}`)].join("\n");
  const { embedding, embeddingRef } =
    dryRun || !openaiConfigured()
      ? { embedding: null, embeddingRef: null }
      : await maybeEmbed(embedText);

  const metadata: Record<string, unknown> = {
    domains: ["interest"],
    domain: "interest",
    topics,
    sourceType: "youtube",
    evidenceRefs: all.map((r) => ({
      type: "record",
      id: r.id,
      recordType: r.recordType,
      sourceRecordId: r.sourceRecordId,
    })),
    confidence,
    compilerVersion: YOUTUBE_COMPILER_VERSION,
    sourceFingerprint: fingerprint,
    weekKey,
    periodStart: start,
    periodEnd: end,
    itemCount: all.length,
    recurring,
    oneOff,
    coverage:
      all.length < 3
        ? "sparse-week"
        : "ok",
  };

  const draft = {
    subjectType: "week",
    subjectId,
    kind: "youtube_interest_digest",
    content: summary,
    embeddingRef,
    embedding,
    model,
    metadata,
  };

  if (dryRun) {
    const now = new Date().toISOString();
    return {
      mode: store.mode,
      dryRun,
      weekKey,
      scanned: all.length,
      written: 0,
      skipped: 0,
      distillate: {
        id: "dry-run",
        ...draft,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  const row = await store.upsertDistillate(draft);

  // Topic hubs
  for (const topic of topics.slice(0, 12)) {
    const entity = await store.upsertEntity({
      entityType: "topic",
      canonicalKey: topic,
      displayName: topic.replace(/-/g, " "),
      metadata: { twin: "interest", source: "youtube" },
    });
    await store.linkEntity({
      entityId: entity.id,
      linkedType: "distillate",
      linkedId: row.id,
      relation: "mentions",
    });
  }

  return {
    mode: store.mode,
    dryRun,
    weekKey,
    scanned: all.length,
    written: 1,
    skipped: 0,
    distillate: row,
  };
}
