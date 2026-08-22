/** ISO week key e.g. 2026-W28. */
export function isoWeekKey(d = new Date()): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function occurredWeekKey(iso: string | null | undefined): string {
  if (!iso) return isoWeekKey();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return isoWeekKey();
  return isoWeekKey(d);
}
