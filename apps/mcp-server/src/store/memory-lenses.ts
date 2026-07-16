/**
 * Memory lens helpers — operational vs reflective retrieval over distillates.metadata.
 */

export type MemoryMode = "operational" | "reflective" | "both";

export const OPERATIONAL_KINDS = [
  "summary",
  "project_brief",
  "priority_vs_actual",
  "decision",
  "outcome",
  "email_thread_digest",
  "calendar_event_digest",
  "github_outcome_digest",
] as const;

export const REFLECTIVE_KINDS = [
  "youtube_interest_digest",
  "spotify_interest_digest",
  "browser_interest_digest",
  "reading_interest_digest",
  "portrait",
  "self_model",
] as const;

/** Session summaries also carry reflective observation fields — included in both. */
export const BOTH_EXTRA_KINDS = ["summary"] as const;

export function kindsForMode(mode: MemoryMode | undefined): string[] | undefined {
  if (!mode || mode === "both") return undefined;
  if (mode === "operational") return [...OPERATIONAL_KINDS];
  return [...REFLECTIVE_KINDS, "summary"];
}

export function distillateMatchesLenses(
  d: {
    kind: string;
    metadata: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
  },
  options: {
    mode?: MemoryMode;
    domains?: string[];
    topics?: string[];
    kinds?: string[];
    sourceTypes?: string[];
    since?: string;
    until?: string;
    minConfidence?: number;
  },
): boolean {
  const kinds =
    options.kinds?.length ? options.kinds : kindsForMode(options.mode);
  if (kinds?.length && !kinds.includes(d.kind)) return false;

  const meta = d.metadata ?? {};
  if (options.domains?.length) {
    const domains = Array.isArray(meta.domains)
      ? meta.domains.filter((x): x is string => typeof x === "string")
      : typeof meta.domain === "string"
        ? [meta.domain]
        : [];
    if (!options.domains.some((d0) => domains.includes(d0))) return false;
  }
  if (options.topics?.length) {
    const topics = Array.isArray(meta.topics)
      ? meta.topics.filter((x): x is string => typeof x === "string")
      : [];
    const slugs = topics.map((t) => t.toLowerCase());
    if (
      !options.topics.some((t) =>
        slugs.some((s) => s.includes(t.toLowerCase()) || t.toLowerCase().includes(s)),
      )
    ) {
      return false;
    }
  }
  if (options.sourceTypes?.length) {
    const sourceType =
      typeof meta.sourceType === "string"
        ? meta.sourceType
        : typeof meta.sourceId === "string"
          ? meta.sourceId
          : null;
    if (!sourceType || !options.sourceTypes.includes(sourceType)) return false;
  }
  if (typeof options.minConfidence === "number") {
    const conf =
      typeof meta.confidence === "number"
        ? meta.confidence
        : typeof meta.confidence === "string"
          ? Number(meta.confidence)
          : 1;
    if (!(conf >= options.minConfidence)) return false;
  }
  const at = d.updatedAt ?? d.createdAt ?? "";
  if (options.since && at && at < options.since) return false;
  if (options.until && at && at > options.until) return false;
  return true;
}

export function normalizeTopic(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}
