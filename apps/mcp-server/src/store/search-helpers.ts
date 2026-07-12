/** Shared search / recent-work helpers for Supabase + fixture stores. */

export const CALENDAR_TYPE = "calendar_event";

export const WORK_RECORD_TYPES = [
  "email_message",
  "github_pr",
  "github_issue",
  "github_commit",
  "github_repo",
  "github_release",
  "drive_file",
] as const;

export const EMPTY_SEARCH_HINT =
  "No matches. Try list_recent_work (work mode defaults to sessions + github + email), narrow with recordTypes/sources, or get_session for a known id. Keyword search covers payload text and distillate content — empty results are not a sparse-index failure. Use get_calendar_range for schedule, not list_recent_work.";

export const EMPTY_MEMORY_HINT =
  "No memory hits. Ensure session distillates exist (pnpm distillate). Semantic search needs OPENAI_API_KEY + distillates.embedding (pnpm embed-backfill for rows missing vectors). Keyword path still searches distillate content and canonical payload text.";

export function resolveExcludeTypes(options: {
  recordTypes?: string[];
  excludeTypes?: string[];
  excludeCalendarDefault?: boolean;
}): string[] {
  const explicit = options.excludeTypes ?? [];
  const excludeCalendar =
    options.excludeCalendarDefault !== false &&
    !(options.recordTypes ?? []).includes(CALENDAR_TYPE) &&
    !explicit.includes(CALENDAR_TYPE);
  if (excludeCalendar && !explicit.includes(CALENDAR_TYPE)) {
    return [...explicit, CALENDAR_TYPE];
  }
  return explicit;
}

export function isWorkRecordType(recordType: string): boolean {
  return (
    recordType.startsWith("github_") ||
    (WORK_RECORD_TYPES as readonly string[]).includes(recordType)
  );
}

export function horizonCutoffIso(horizonDays: number | null | undefined): string | null {
  if (horizonDays === null) return null;
  const days = horizonDays === undefined ? 7 : horizonDays;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function withinHorizon(
  occurredAt: string | null | undefined,
  cutoffIso: string | null,
): boolean {
  if (!cutoffIso || !occurredAt) return true;
  return occurredAt <= cutoffIso;
}

export function payloadMatchesQuery(
  payload: Record<string, unknown>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return JSON.stringify(payload).toLowerCase().includes(q);
}

export function textMatchesQuery(text: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (text ?? "").toLowerCase().includes(q);
}

/** Escape % and _ for PostgREST/SQL ILIKE patterns. */
export function ilikePattern(query: string): string {
  return `%${query.trim().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

/** Cosine similarity for hybrid re-rank (fixture + Supabase fallback). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Deterministic short vector for fixture RAG demos (not OpenAI dims). */
export function fixtureEmbedFromText(text: string, dims = 16): number[] {
  const out = new Array<number>(dims).fill(0);
  const s = text.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[i % dims]! += ((code % 31) - 15) / 15;
  }
  const norm = Math.sqrt(out.reduce((acc, v) => acc + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

export function projectKeysFromMetadata(
  metadata: Record<string, unknown>,
): string[] {
  const projects = Array.isArray(metadata.projects)
    ? metadata.projects.filter(
        (p): p is string => typeof p === "string" && p.trim().length > 0,
      )
    : [];
  return projects.map((p) => p.trim());
}

export function slugifyKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}
