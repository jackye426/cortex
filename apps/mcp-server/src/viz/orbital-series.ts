/**
 * Orbital mechanics for index 02 (particle / orbital).
 *
 * Index 01 answers "where does my recorded cognition sit". This answers
 * "what do I keep returning to, how regularly, and what have I stopped
 * returning to" — period, irregularity and decay, measured from calendar
 * recurrence.
 *
 * Events are clustered into *returns* before any period is measured: five
 * gallery events in one evening are one return, not a five-hour orbit.
 */

const DAY_MS = 86_400_000;
/** Events closer together than this belong to the same sitting. */
const RETURN_CLUSTER_HOURS = 30;

export interface CalendarLike {
  id: string;
  summary: string | null;
  start: string | null;
  end?: string | null;
}

/**
 * All-day entries are availability markers ("OUT OF OFFICE", "GOING TO THE
 * BEACH"), not commitments you return to. Anything spanning most of a day is
 * excluded before rhythms are measured.
 */
const AWAY_MARKER_HOURS = 20;

export interface OrbitalSeries {
  key: string;
  /** Raw events observed. */
  events: number;
  /** Distinct sittings — the thing a period is measured between. */
  returns: number;
  /** Mean days between returns; null for impulses. */
  periodDays: number | null;
  /** Coefficient of variation of the gaps — irregularity. */
  cv: number;
  daysSinceLast: number;
  /** Overdue-ness: 1 = on schedule, → 0 = long past due. */
  health: number;
  /** No measurable rhythm, or so overdue it is coasting. */
  stalled: boolean;
  lastAt: string;
  /** First return — how long this body has been in the system. */
  firstAt: string;
}

/**
 * Collapse a calendar summary to a series key.
 *
 * Venue prefixes are dropped ("Hales: Opening Reception" → "OPENING RECEPTION")
 * so event *types* group together, and attendee suffixes are dropped
 * ("DocMap meeting with Luna Clinic" → "DOCMAP MEETING") so a recurring
 * commitment stays one body rather than fragmenting per guest.
 */
export function normalizeSeriesKey(summary: string | null): string | null {
  if (!summary) return null;
  let s = summary.toLowerCase();
  s = s.replace(/&amp;/g, "&");
  s = s.replace(/\([^)]*\)/g, " ");
  // Venue / host prefix.
  if (s.includes(":")) s = s.slice(s.indexOf(":") + 1);
  // Attendee suffixes.
  s = s.replace(/\s+(?:with|w\/|x|<>|&|\/)\s+.*$/, "");
  // Booking references and dates.
  s = s.replace(/\b[a-z]{0,3}\d{4,}\b/g, " ");
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length < 2) return null;
  return s.toUpperCase().slice(0, 24);
}

/** Group timestamps into sittings. */
export function clusterReturns(timesMs: number[]): number[] {
  const sorted = [...timesMs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || t - last > RETURN_CLUSTER_HOURS * 3600_000) out.push(t);
  }
  return out;
}

export function computeSeries(
  events: CalendarLike[],
  now = Date.now(),
): OrbitalSeries[] {
  const byKey = new Map<string, number[]>();
  for (const e of events) {
    if (!e.start) continue;
    const ms = Date.parse(e.start);
    if (!Number.isFinite(ms)) continue;
    const endMs = e.end ? Date.parse(e.end) : NaN;
    if (Number.isFinite(endMs) && endMs - ms >= AWAY_MARKER_HOURS * 3600_000) continue;
    const key = normalizeSeriesKey(e.summary);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(ms);
  }

  const series: OrbitalSeries[] = [];
  for (const [key, times] of byKey) {
    const returns = clusterReturns(times);
    const gaps: number[] = [];
    for (let i = 1; i < returns.length; i++) {
      gaps.push((returns[i]! - returns[i - 1]!) / DAY_MS);
    }
    const periodDays = gaps.length
      ? gaps.reduce((s, g) => s + g, 0) / gaps.length
      : null;
    const cv =
      periodDays && gaps.length > 1
        ? Math.sqrt(
            gaps.reduce((s, g) => s + (g - periodDays) ** 2, 0) / gaps.length,
          ) / periodDays
        : 0;
    const last = returns[returns.length - 1]!;
    const daysSinceLast = (now - last) / DAY_MS;
    const health = periodDays
      ? Math.exp(-Math.max(0, daysSinceLast - periodDays) / periodDays)
      : 0;
    series.push({
      key,
      events: times.length,
      returns: returns.length,
      periodDays,
      cv,
      daysSinceLast,
      health,
      stalled: periodDays === null || health < 0.05,
      lastAt: new Date(last).toISOString(),
      firstAt: new Date(returns[0]!).toISOString(),
    });
  }

  // Rhythms first, then impulses; within each, most-attended first.
  return series.sort((a, b) => {
    if (a.stalled !== b.stalled) return a.stalled ? 1 : -1;
    if (a.returns !== b.returns) return b.returns - a.returns;
    return b.events - a.events;
  });
}

/** Stable pseudo-random from the series key so rings never jump between refreshes. */
function hashUnit(key: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export interface OrbitGeometry {
  id: string;
  label: string;
  tilt: number;
  yaw: number;
  r: number;
  ecc: number;
  accent: boolean;
  periodDays: number | null;
  daysSinceLast: number;
  returns: number;
  events: number;
  health: number;
  stalled: boolean;
  /** Deterministic starting angle so bodies do not teleport on refresh. */
  phase: number;
}

/**
 * Map measured rhythm onto the shell's orbit parameters.
 *
 * Radius is log-scaled by period so short rhythms sit inside long ones;
 * impulses park at the outer edge. Eccentricity carries irregularity, so a
 * fixed weekly commitment reads near-circular and a scattered one reads as a
 * long ellipse. The accent goes to the newest rhythm still on schedule.
 */
export function seriesToOrbits(series: OrbitalSeries[]): OrbitGeometry[] {
  const periods = series
    .map((s) => s.periodDays)
    .filter((p): p is number => p !== null && p > 0);
  const minP = periods.length ? Math.min(...periods) : 1;
  const maxP = periods.length ? Math.max(...periods) : 1;
  const span = Math.log(maxP / minP) || 1;

  // Accent the body that most recently *entered* and is still on schedule —
  // the new thing pulling on your time, not merely the least frequent one.
  let accentKey: string | null = null;
  let newestEntry = -Infinity;
  for (const s of series) {
    if (s.stalled || s.periodDays === null) continue;
    const entered = Date.parse(s.firstAt);
    if (entered > newestEntry) {
      newestEntry = entered;
      accentKey = s.key;
    }
  }

  return series.map((s) => {
    // Impulses park at the outer edge, spread a little so they do not stack
    // into one thick ring.
    const r =
      s.periodDays === null
        ? 2.35 + hashUnit(s.key, 4) * 0.5
        : 0.9 + (Math.log(s.periodDays / minP) / span) * 1.7;
    return {
      id: s.key.toLowerCase().replace(/\s+/g, "-"),
      label: s.key,
      tilt: hashUnit(s.key, 1) * Math.PI,
      yaw: hashUnit(s.key, 2) * Math.PI * 2,
      r,
      // 0.35 (flat ellipse) … 0.95 (near-circular); low CV = circular.
      ecc: Math.max(0.35, Math.min(0.95, 0.95 - s.cv * 0.6)),
      accent: s.key === accentKey,
      periodDays: s.periodDays,
      daysSinceLast: s.daysSinceLast,
      returns: s.returns,
      events: s.events,
      health: s.health,
      stalled: s.stalled,
      phase: hashUnit(s.key, 3),
    };
  });
}
