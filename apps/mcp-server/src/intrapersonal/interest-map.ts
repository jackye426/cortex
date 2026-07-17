/**
 * Compile Interest Map distillate + ensure interest rows are current.
 */
import { embedTexts, openaiConfigured } from "../llm.js";
import { isoWeekKey } from "../week-helpers.js";
import { stableSubjectUuid } from "../stable-id.js";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import { mineInterests } from "./interest-mine.js";
import type {
  InterestClass,
  InterestMapPayload,
  InterestRow,
  SourceFamily,
  UpsertInterestInput,
} from "./types.js";

const INTEREST_MAP_COMPILER = "interest-map-v1";

const CLASS_ORDER: InterestClass[] = [
  "terminal",
  "instrumental",
  "aspirational",
  "situational",
  "dormant",
];

export interface RefreshInterestMapOptions {
  dryRun?: boolean;
  weekKey?: string;
  mineLimit?: number;
  skipMine?: boolean;
}

export interface RefreshInterestMapResult {
  dryRun: boolean;
  weekKey: string;
  mined: number;
  written: boolean;
  distillate: DistillateRow | null;
  map: InterestMapPayload;
}

function familiesFromMeta(meta: Record<string, unknown>): SourceFamily[] {
  if (!Array.isArray(meta.sourceFamilies)) return [];
  return meta.sourceFamilies.filter(
    (x): x is SourceFamily => typeof x === "string",
  );
}

function payloadToRow(input: UpsertInterestInput): InterestRow {
  const now = new Date().toISOString();
  return {
    id: `dry-${input.canonicalKey}`,
    canonicalKey: input.canonicalKey,
    displayName: input.displayName ?? input.canonicalKey,
    class: input.class,
    status: input.status ?? "active",
    confidence: input.confidence ?? 0.5,
    summary: input.summary ?? "",
    firstSeenAt: input.firstSeenAt ?? null,
    lastActiveAt: input.lastActiveAt ?? null,
    recurrenceScore: input.recurrenceScore ?? 0,
    specificityScore: input.specificityScore ?? 0,
    voluntaryReturnScore: input.voluntaryReturnScore ?? 0,
    persistenceAfterUtility: input.persistenceAfterUtility ?? 0,
    energyDelta: input.energyDelta ?? null,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

export function buildInterestMapPayload(
  interests: InterestRow[],
  weekKey?: string,
): InterestMapPayload {
  const byClass = new Map<InterestClass, InterestRow[]>();
  for (const cls of CLASS_ORDER) byClass.set(cls, []);

  for (const interest of interests) {
    const bucket =
      interest.status === "dormant" || interest.class === "dormant"
        ? "dormant"
        : interest.class;
    byClass.get(bucket)?.push(interest);
  }

  const sections = CLASS_ORDER.map((cls) => {
    const rows = (byClass.get(cls) ?? [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 12)
      .map((i) => ({
        canonicalKey: i.canonicalKey,
        displayName: i.displayName,
        confidence: i.confidence,
        summary: i.summary,
        sourceFamilies: familiesFromMeta(i.metadata),
        evidenceCount:
          typeof i.metadata.evidenceCount === "number"
            ? i.metadata.evidenceCount
            : Array.isArray(i.metadata.distillateIds)
              ? i.metadata.distillateIds.length
              : 0,
      }));
    return { class: cls, interests: rows };
  });

  const notes: string[] = [];
  const multi = interests.filter(
    (i) => familiesFromMeta(i.metadata).length >= 2,
  );
  if (multi.length) {
    notes.push(
      `${multi.length} interest(s) have multi-family evidence (project-independent candidates).`,
    );
  }
  if (interests.length === 0) {
    notes.push(
      "No interests mined yet — run reflective digests + interest-mine.",
    );
  }

  return {
    weekKey,
    generatedAt: new Date().toISOString(),
    sections,
    notes,
  };
}

function mapToContent(map: InterestMapPayload): string {
  const lines = [`Interest map${map.weekKey ? ` ${map.weekKey}` : ""}.`];
  for (const section of map.sections) {
    if (!section.interests.length) continue;
    lines.push(
      `${section.class}: ${section.interests
        .map((i) => `${i.displayName} (${i.confidence.toFixed(2)})`)
        .join("; ")}`,
    );
  }
  if (map.notes.length) lines.push(`Notes: ${map.notes.join(" ")}`);
  return lines.join("\n").slice(0, 4000);
}

export async function refreshInterestMap(
  store: CortexStore,
  options: RefreshInterestMapOptions = {},
): Promise<RefreshInterestMapResult> {
  const dryRun = Boolean(options.dryRun);
  const weekKey = options.weekKey ?? isoWeekKey();

  let mined = 0;
  let dryPayloads: UpsertInterestInput[] = [];
  if (!options.skipMine) {
    const mine = await mineInterests(store, {
      dryRun,
      limit: options.mineLimit ?? 120,
    });
    mined = mine.upserted;
    dryPayloads = mine.payloads;
  }

  const interests = dryRun
    ? dryPayloads.map(payloadToRow)
    : await store.listInterests({ limit: 100 });

  const map = buildInterestMapPayload(interests, weekKey);
  const content = mapToContent(map);
  const topics = map.sections
    .flatMap((s) => s.interests.map((i) => i.canonicalKey))
    .slice(0, 16);

  let embedding: number[] | null = null;
  let embeddingRef: string | null = null;
  if (!dryRun && openaiConfigured() && content.trim()) {
    try {
      const [vec] = await embedTexts([content]);
      embedding = vec ?? null;
      embeddingRef = embedding
        ? `openai:${process.env.CORTEX_EMBEDDING_MODEL?.trim() || "text-embedding-3-small"}`
        : null;
    } catch {
      // keep map write without embed
    }
  }

  const subjectId = stableSubjectUuid("interest-map", weekKey);
  const draft = {
    subjectType: "week",
    subjectId,
    kind: "interest_map",
    content,
    embeddingRef,
    embedding,
    model: "cortex-interest-map-v1",
    metadata: {
      domains: ["interest"],
      domain: "interest",
      sourceType: "interest-map",
      topics,
      compilerVersion: INTEREST_MAP_COMPILER,
      weekKey,
      confidence: 0.7,
      twin: "I2",
      sensitivity: "reflective_sensitive",
      map,
    },
  };

  if (dryRun) {
    const now = new Date().toISOString();
    return {
      dryRun: true,
      weekKey,
      mined,
      written: false,
      distillate: { id: "dry-run", ...draft, createdAt: now, updatedAt: now },
      map,
    };
  }

  const distillate = await store.upsertDistillate(draft);
  return {
    dryRun: false,
    weekKey,
    mined,
    written: true,
    distillate,
    map,
  };
}

export async function getLatestInterestMap(store: CortexStore): Promise<{
  distillate: DistillateRow | null;
  map: InterestMapPayload | null;
}> {
  const rows = await store.listDistillates({
    limit: 5,
    kinds: ["interest_map"],
  });
  const distillate = rows[0] ?? null;
  if (!distillate) {
    const interests = await store.listInterests({ limit: 100 });
    if (!interests.length) return { distillate: null, map: null };
    return {
      distillate: null,
      map: buildInterestMapPayload(interests),
    };
  }
  const raw = distillate.metadata.map;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { distillate, map: raw as InterestMapPayload };
  }
  const interests = await store.listInterests({ limit: 100 });
  return {
    distillate,
    map: buildInterestMapPayload(
      interests,
      typeof distillate.metadata.weekKey === "string"
        ? distillate.metadata.weekKey
        : undefined,
    ),
  };
}
