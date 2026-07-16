/**
 * ISO-week helpers + source fingerprints for incremental distillate compilers.
 */
import { createHash } from "node:crypto";

/** ISO week key e.g. 2026-W28. */
export function isoWeekKey(d = new Date()): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  // Thursday in current week decides the year
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Half-open [start, end) UTC range for an ISO week key. */
export function weekRange(weekKey: string): { start: string; end: string } {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 7);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO week: Monday of week 1 contains Jan 4
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 7);
  return { start: monday.toISOString(), end: sunday.toISOString() };
}

export function inWeek(
  iso: string | null | undefined,
  start: string,
  end: string,
): boolean {
  if (!iso) return false;
  return iso >= start && iso < end;
}

export interface FingerprintRecord {
  sourceRecordId: string;
  occurredAt?: string | null;
}

/**
 * Lightweight source fingerprint: hash of sorted source_record_ids + latest occurred_at.
 * Stored on distillate metadata.sourceFingerprint for skip/recompile.
 */
export function sourceFingerprint(records: FingerprintRecord[]): string {
  const ids = records.map((r) => r.sourceRecordId).sort();
  let latest = "";
  for (const r of records) {
    const t = r.occurredAt ?? "";
    if (t > latest) latest = t;
  }
  const payload = `${ids.join("|")}#${latest}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
