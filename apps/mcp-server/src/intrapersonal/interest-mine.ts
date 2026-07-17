/**
 * Mine interest candidates from digests + session topics; classify heuristically.
 */
import { normalizeTopic } from "../store/memory-lenses.js";
import type { CortexStore } from "../store/index.js";
import type { DistillateRow } from "../store/types.js";
import {
  familyFromDistillateKind,
} from "./source-family.js";
import type {
  InterestClass,
  InterestRow,
  SourceFamily,
  UpsertInterestInput,
} from "./types.js";

const INTEREST_DIGEST_KINDS = [
  "youtube_interest_digest",
  "spotify_interest_digest",
  "browser_interest_digest",
  "reading_interest_digest",
] as const;

const DORMANT_DAYS = 42;

export interface InterestCandidate {
  canonicalKey: string;
  displayName: string;
  families: Set<SourceFamily>;
  distillateIds: string[];
  projectKeys: Set<string>;
  dates: string[];
  recurringMentions: number;
  topicMentions: number;
  fromWorkProject: boolean;
  aspirationalLanguage: boolean;
}

export interface MineInterestsOptions {
  limit?: number;
  dryRun?: boolean;
  dormantAfterDays?: number;
}

export interface MineInterestsResult {
  scanned: number;
  upserted: number;
  dryRun: boolean;
  interests: Array<Pick<InterestRow, "canonicalKey" | "class" | "confidence">>;
  /** Full upsert payloads (useful for dry-run Interest Map compile). */
  payloads: UpsertInterestInput[];
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function displayFromKey(key: string): string {
  return key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(b) - Date.parse(a));
  return ms / 86400000;
}

function collectCandidates(distillates: DistillateRow[]): Map<string, InterestCandidate> {
  const map = new Map<string, InterestCandidate>();

  const touch = (
    raw: string,
    d: DistillateRow,
    opts?: { recurring?: boolean; aspirational?: boolean },
  ) => {
    const key = normalizeTopic(raw);
    if (!key || key.length < 2) return;
    const family = familyFromDistillateKind(d.kind);
    const existing = map.get(key) ?? {
      canonicalKey: key,
      displayName: displayFromKey(key),
      families: new Set<SourceFamily>(),
      distillateIds: [],
      projectKeys: new Set<string>(),
      dates: [],
      recurringMentions: 0,
      topicMentions: 0,
      fromWorkProject: false,
      aspirationalLanguage: false,
    };
    existing.families.add(family);
    if (!existing.distillateIds.includes(d.id)) {
      existing.distillateIds.push(d.id);
    }
    existing.dates.push(d.updatedAt);
    existing.topicMentions += 1;
    if (opts?.recurring) existing.recurringMentions += 1;
    if (opts?.aspirational) existing.aspirationalLanguage = true;

    const projects = asStringArray(d.metadata.projects);
    for (const p of projects) {
      existing.projectKeys.add(normalizeTopic(p));
      if (d.kind === "summary" || d.kind === "project_brief") {
        existing.fromWorkProject = true;
      }
    }
    const domains = asStringArray(d.metadata.domains);
    if (domains.includes("work") && d.kind === "summary") {
      existing.fromWorkProject = true;
    }
    map.set(key, existing);
  };

  for (const d of distillates) {
    const topics = asStringArray(d.metadata.topics);
    const recurring = asStringArray(d.metadata.recurring);
    const themes = asStringArray(d.metadata.themes);
    const hay = `${d.content ?? ""}\n${topics.join(" ")}`.toLowerCase();
    const aspirational = /\b(want to become|aspir|identity|taste|fluency)\b/.test(
      hay,
    );

    if ((INTEREST_DIGEST_KINDS as readonly string[]).includes(d.kind)) {
      for (const t of topics) touch(t, d, { aspirational });
      for (const t of recurring) touch(t, d, { recurring: true, aspirational });
      for (const t of themes) touch(t, d, { aspirational });
    }

    if (d.kind === "summary") {
      for (const t of topics) touch(t, d, { aspirational });
      const exploration = Array.isArray(d.metadata.explorationSignals)
        ? d.metadata.explorationSignals
        : [];
      for (const sig of exploration) {
        if (sig && typeof sig === "object" && !Array.isArray(sig)) {
          const text = (sig as Record<string, unknown>).text;
          if (typeof text === "string") {
            // Use first 4 content words as a soft topic hint
            const words = text
              .split(/\s+/)
              .filter((w) => w.length > 3)
              .slice(0, 4)
              .join(" ");
            if (words) touch(words, d, { aspirational });
          }
        }
      }
    }
  }

  return map;
}

/**
 * Classify interest from multi-source recurrence and project coupling.
 */
export function classifyInterest(c: InterestCandidate, now = new Date()): {
  class: InterestClass;
  status: "active" | "dormant";
  confidence: number;
  recurrenceScore: number;
  specificityScore: number;
  voluntaryReturnScore: number;
  persistenceAfterUtility: number;
  rationale: string[];
} {
  const rationale: string[] = [];
  const familyCount = c.families.size;
  const dates = [...c.dates].sort();
  const first = dates[0] ?? now.toISOString();
  const last = dates[dates.length - 1] ?? now.toISOString();
  const spanDays = Math.max(1, daysBetween(first, last));
  const inactiveDays = daysBetween(last, now.toISOString());

  const recurrenceScore = Math.min(
    1,
    (c.topicMentions / 6) * 0.5 +
      (c.recurringMentions / 4) * 0.3 +
      (familyCount / 3) * 0.4,
  );
  const specificityScore = Math.min(1, c.canonicalKey.split("-").length / 4);
  const voluntaryReturnScore = Math.min(
    1,
    (familyCount >= 2 ? 0.45 : 0.15) +
      (c.recurringMentions > 0 ? 0.35 : 0) +
      (spanDays >= 14 ? 0.2 : 0),
  );
  // High when interest appears outside a single project / after work utility.
  const persistenceAfterUtility = Math.min(
    1,
    (!c.fromWorkProject || familyCount >= 2 ? 0.55 : 0.15) +
      (c.projectKeys.size === 0 && familyCount >= 1 ? 0.25 : 0) +
      (c.recurringMentions > 0 && familyCount >= 2 ? 0.2 : 0),
  );

  let interestClass: InterestClass = "situational";
  if (inactiveDays >= DORMANT_DAYS && recurrenceScore >= 0.25) {
    interestClass = "dormant";
    rationale.push(`Inactive ${Math.round(inactiveDays)}d after prior recurrence`);
  } else if (c.aspirationalLanguage && voluntaryReturnScore >= 0.35) {
    interestClass = "aspirational";
    rationale.push("Identity/aspiration language with voluntary return signals");
  } else if (
    familyCount >= 2 &&
    persistenceAfterUtility >= 0.5 &&
    voluntaryReturnScore >= 0.4
  ) {
    interestClass = "terminal";
    rationale.push("Multi-family recurrence with persistence beyond a single project");
  } else if (c.fromWorkProject && familyCount <= 1 && persistenceAfterUtility < 0.45) {
    interestClass = "instrumental";
    rationale.push("Primarily coupled to work/project context");
  } else if (familyCount >= 2 || c.recurringMentions >= 2) {
    interestClass = "terminal";
    rationale.push("Recurring across contexts");
  } else {
    interestClass = "situational";
    rationale.push("Limited window / single-context signal");
  }

  const status =
    interestClass === "dormant" || inactiveDays >= DORMANT_DAYS
      ? "dormant"
      : "active";

  const confidence = Math.min(
    0.9,
    0.35 +
      recurrenceScore * 0.35 +
      (familyCount >= 2 ? 0.15 : 0) +
      voluntaryReturnScore * 0.15,
  );

  return {
    class: interestClass,
    status,
    confidence,
    recurrenceScore,
    specificityScore,
    voluntaryReturnScore,
    persistenceAfterUtility,
    rationale,
  };
}

export async function mineInterests(
  store: CortexStore,
  options: MineInterestsOptions = {},
): Promise<MineInterestsResult> {
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit ?? 120;
  const kinds = [
    ...INTEREST_DIGEST_KINDS,
    "summary",
    "project_brief",
  ];
  const distillates = await store.listDistillates({ limit, kinds });
  const candidates = collectCandidates(distillates);
  const interests: MineInterestsResult["interests"] = [];
  const payloads: UpsertInterestInput[] = [];
  let upserted = 0;

  for (const c of candidates.values()) {
    // Require at least one non-work family OR multi-mention to avoid project noise.
    const nonWork = [...c.families].filter(
      (f) => f !== "ai_sessions" && f !== "github" && f !== "drive",
    );
    if (nonWork.length === 0 && c.topicMentions < 2 && c.families.size < 2) {
      continue;
    }

    const classified = classifyInterest(c);
    const input: UpsertInterestInput = {
      canonicalKey: c.canonicalKey,
      displayName: c.displayName,
      class: classified.class,
      status: classified.status,
      confidence: classified.confidence,
      summary: `${classified.rationale[0] ?? "Interest candidate"}. Families: ${[...c.families].join(", ")}.`,
      firstSeenAt: [...c.dates].sort()[0] ?? null,
      lastActiveAt: [...c.dates].sort().at(-1) ?? null,
      recurrenceScore: classified.recurrenceScore,
      specificityScore: classified.specificityScore,
      voluntaryReturnScore: classified.voluntaryReturnScore,
      persistenceAfterUtility: classified.persistenceAfterUtility,
      metadata: {
        sourceFamilies: [...c.families],
        distillateIds: c.distillateIds.slice(0, 20),
        projectKeys: [...c.projectKeys],
        rationale: classified.rationale,
        evidenceCount: c.distillateIds.length,
      },
    };

    interests.push({
      canonicalKey: input.canonicalKey,
      class: input.class,
      confidence: input.confidence ?? 0.5,
    });
    payloads.push(input);

    if (!dryRun) {
      const row = await store.upsertInterest(input);
      // Bridge to topic entity graph
      const entity = await store.upsertEntity({
        entityType: "topic",
        canonicalKey: row.canonicalKey,
        displayName: row.displayName,
        metadata: {
          interestId: row.id,
          interestClass: row.class,
          source: "interest-mine",
        },
      });
      await store.linkEntity({
        entityId: entity.id,
        linkedType: "interest",
        linkedId: row.id,
        relation: "represents",
      });
      upserted += 1;
    } else {
      upserted += 1;
    }
  }

  return {
    scanned: distillates.length,
    upserted,
    dryRun,
    interests: interests.slice(0, 40),
    payloads,
  };
}
