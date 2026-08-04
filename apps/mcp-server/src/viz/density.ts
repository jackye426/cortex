/**
 * Build VizDensity payloads for scan | particle | cross | text.
 */
import {
  DENSITY_BUDGETS,
  emptyDensity,
  type VizDensity,
  type VizPoint3,
  type VizView,
} from "@cortex/viz-contracts";
import type { CortexStore } from "../store/index.js";
import { auditSourceCoverage } from "../intrapersonal/source-health.js";
import { jitterAround, normalizeCloud, projectEmbedding, seeded } from "./project-3d.js";
import {
  computeMediaSeries,
  computeSeries,
  seriesToOrbits,
} from "./orbital-series.js";
import {
  assignTopicFamilies,
  classifyCalendarSummary,
  familyFromSourceFamily,
  FAMILY_BY_ID,
  SCAN_FAMILIES,
  type ScanFamilyId,
} from "./topic-families.js";

const POINT_CAP = 5200;
const TEXT_PREVIEW = 120;

function truncate(s: string, n = TEXT_PREVIEW): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

export async function buildVizDensity(
  store: CortexStore,
  view: VizView,
): Promise<VizDensity> {
  try {
    switch (view) {
      case "scan":
        return await buildScan(store);
      case "particle":
        return await buildParticle(store);
      case "cross":
        return await buildCross(store);
      case "text":
        return await buildText(store);
      default:
        return emptyDensity("scan");
    }
  } catch (err) {
    const empty = emptyDensity(view);
    empty.meta = {
      empty: true,
      shellDriven: true,
      source: "degraded",
      degraded: true,
      error: err instanceof Error ? err.message : String(err),
      budget: DENSITY_BUDGETS[view],
    };
    return empty;
  }
}

function shellMeta(
  view: VizView,
  extra: Record<string, unknown> = {},
): VizDensity["meta"] {
  return {
    shellDriven: true,
    source: "live",
    budget: DENSITY_BUDGETS[view],
    ...extra,
  };
}

const SCAN_OBSERVATION_LIMIT = 400;
const SCAN_CALENDAR_DAYS = 120;
/** Pull zone centres inward so jittered points stay inside the cortical hull. */
const ZONE_INSET = 0.72;
const SIDEBAR_TOPIC_ROWS = 13;

function topicsOf(metadata: Record<string, unknown>): string[] {
  const raw = metadata?.topics;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
}

/**
 * Index 01 — the encephalon is a map of what the work is *about*.
 *
 * Observations supply the volume (one voxel each), the fixed family map supplies
 * the lobes, and calendar events join as additional mass for the families that
 * sessions under-represent (venture meetings, gallery openings, admin). Time is
 * binned by session ordinal rather than wall clock: observations inherit their
 * session timestamp, so the clock is three spikes while the ordinal is smooth.
 */
async function buildScan(store: CortexStore): Promise<VizDensity> {
  const rnd = seeded(4412219);
  const calendarStart = new Date(
    Date.now() - SCAN_CALENDAR_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const [observations, events] = await Promise.all([
    store.listObservations({ limit: SCAN_OBSERVATION_LIMIT }),
    store
      .getCalendarStructure(calendarStart, new Date().toISOString())
      .catch(() => []),
  ]);

  // Session-level topic sets drive both classification and the co-occurrence fallback.
  const sessionTopics = new Map<string, string[]>();
  for (const o of observations) {
    const key = o.sessionId ?? o.distillateId ?? o.id;
    if (!sessionTopics.has(key)) sessionTopics.set(key, topicsOf(o.metadata));
  }
  const { topicFamily, unclassifiedTopics } = assignTopicFamilies([...sessionTopics.values()]);

  // Session ordinal = the scan's time axis.
  const sessionOrder = [...sessionTopics.keys()].sort((a, b) => {
    const ta = observations.find((o) => (o.sessionId ?? o.distillateId ?? o.id) === a)?.occurredAt ?? "";
    const tb = observations.find((o) => (o.sessionId ?? o.distillateId ?? o.id) === b)?.occurredAt ?? "";
    return ta.localeCompare(tb);
  });
  const ordinalOf = new Map(sessionOrder.map((id, i) => [id, i]));
  const sessionSpan = Math.max(1, sessionOrder.length - 1);

  const topicCounts = new Map<string, number>();
  const familyCounts = new Map<ScanFamilyId, number>();
  const familySessions = new Map<ScanFamilyId, Set<string>>();

  for (const o of observations) {
    for (const topic of topicsOf(o.metadata)) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
  }
  const maxTopicCount = Math.max(1, ...topicCounts.values());

  let sourcePriorUsed = 0;
  const familyOf = (o: (typeof observations)[number]): ScanFamilyId => {
    const votes = new Map<ScanFamilyId, number>();
    for (const topic of topicsOf(o.metadata)) {
      const fam = topicFamily.get(topic);
      if (fam) votes.set(fam, (votes.get(fam) ?? 0) + 1);
    }
    let best: ScanFamilyId | null = null;
    let bestN = -1;
    for (const [fam, n] of votes) {
      if (n > bestN) {
        best = fam;
        bestN = n;
      }
    }
    if (best) return best;
    // No topic matched: fall back to where the observation came from rather
    // than dumping non-DocMap material into BROADCAST.
    const prior = familyFromSourceFamily(o.sourceFamily);
    if (prior) {
      sourcePriorUsed += 1;
      return prior;
    }
    return "broadcast";
  };

  const points: VizPoint3[] = [];
  const seenSession = new Set<string>();

  for (const o of observations) {
    const family = familyOf(o);
    const meta = FAMILY_BY_ID.get(family)!;
    const centre = {
      x: meta.anchor.x * ZONE_INSET,
      y: meta.anchor.y * ZONE_INSET,
      z: meta.anchor.z * ZONE_INSET,
    };
    const p = jitterAround(centre, rnd, 0.34);
    const topics = topicsOf(o.metadata);
    const headline = topics[0] ?? family;
    // Confidence is near-constant in the vault (0.60–0.65), so brightness comes
    // from how often the topic recurs — that has real dynamic range.
    const recurrence = (topicCounts.get(headline) ?? 1) / maxTopicCount;
    const sessionKey = o.sessionId ?? o.distillateId ?? o.id;
    const isSessionAnchor = !seenSession.has(sessionKey);
    seenSession.add(sessionKey);

    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    if (!familySessions.has(family)) familySessions.set(family, new Set());
    familySessions.get(family)!.add(sessionKey);

    points.push({
      ...p,
      id: o.id,
      region: family,
      label: headline.slice(0, 24).toUpperCase(),
      confidence: o.confidence,
      a: 0.28 + recurrence * 0.66,
      s: isSessionAnchor ? 1.6 : 1,
      t: (ordinalOf.get(sessionKey) ?? 0) / sessionSpan,
    });
  }

  // Calendar joins as mass for the families sessions under-represent.
  const calendarByFamily = new Map<ScanFamilyId, number>();
  for (const event of events) {
    const family = classifyCalendarSummary(event.summary);
    if (!family) continue;
    const meta = FAMILY_BY_ID.get(family)!;
    const centre = {
      x: meta.anchor.x * ZONE_INSET,
      y: meta.anchor.y * ZONE_INSET,
      z: meta.anchor.z * ZONE_INSET,
    };
    const p = jitterAround(centre, rnd, 0.34);
    calendarByFamily.set(family, (calendarByFamily.get(family) ?? 0) + 1);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    points.push({
      ...p,
      id: event.id,
      region: family,
      label: (event.summary ?? "EVENT").slice(0, 24).toUpperCase(),
      a: 0.62,
      s: 1.3,
      t: 1,
    });
  }

  const totalMass = Math.max(1, [...familyCounts.values()].reduce((s, n) => s + n, 0));

  // Annotations sit at the anatomical anchors in the client's brainNodes order.
  const annotations: VizDensity["annotations"] = [];
  const hotTopic = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const slots: Array<{ label: string; sub: string; anchor: { x: number; y: number; z: number } }> =
    [];
  for (let i = 0; i < DENSITY_BUDGETS.scan.annotations; i++) {
    const family = SCAN_FAMILIES.find((f) => f.anchorIndex === i);
    if (family) {
      const n = familyCounts.get(family.id) ?? 0;
      const share = ((n / totalMass) * 100).toFixed(1);
      slots[i] = {
        label: family.label,
        sub: `${family.gloss} N=${n} ${share}%`,
        anchor: family.anchor,
      };
    } else {
      slots[i] = {
        label: (hotTopic?.[0] ?? "CORTEX").slice(0, 24).toUpperCase(),
        sub: `HOT TOPIC N=${hotTopic?.[1] ?? 0}`,
        anchor: { x: -0.86, y: -0.5, z: 0.24 },
      };
    }
  }
  slots.forEach((slot, i) => {
    annotations.push({
      id: `N${String(i + 1).padStart(2, "0")}`,
      label: slot.label,
      sub: slot.sub,
      x: slot.anchor.x,
      y: slot.anchor.y,
      z: slot.anchor.z,
    });
  });

  // Sidebar: five family rows (share of mass), then the top topics by count.
  const meters = SCAN_FAMILIES.map((f, i) => ({
    id: String(i + 1).padStart(2, "0"),
    label: f.label,
    value: (familyCounts.get(f.id) ?? 0) / totalMass,
  }));
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SIDEBAR_TOPIC_ROWS);
  topTopics.forEach(([topic, n], i) => {
    meters.push({
      id: String(SCAN_FAMILIES.length + i + 1).padStart(2, "0"),
      label: topic.slice(0, 28).toUpperCase(),
      value: n / maxTopicCount,
    });
  });

  // Section matrix: 32 slabs across the session sequence.
  const sliceCount = DENSITY_BUDGETS.scan.slices;
  const slices = Array.from({ length: sliceCount }, (_, i) => {
    const lo = i / sliceCount;
    const hi = (i + 1) / sliceCount;
    const pointIndexes: number[] = [];
    const votes = new Map<ScanFamilyId, number>();
    points.forEach((p, idx) => {
      const t = p.t ?? 0;
      if (t >= lo && (t < hi || (i === sliceCount - 1 && t <= hi))) {
        pointIndexes.push(idx);
        const fam = p.region as ScanFamilyId;
        votes.set(fam, (votes.get(fam) ?? 0) + 1);
      }
    });
    let region: string | undefined;
    let bestN = 0;
    for (const [fam, n] of votes) {
      if (n > bestN) {
        region = fam;
        bestN = n;
      }
    }
    return {
      pos: 1.15 - (i / (sliceCount - 1)) * 2.3,
      region,
      pointIndexes,
      count: pointIndexes.length,
      label: `S${String(i + 1).padStart(3, "0")}`,
    };
  });

  const windowStart = observations.reduce<string | null>(
    (min, o) => (o.occurredAt && (!min || o.occurredAt < min) ? o.occurredAt : min),
    null,
  );
  const windowEnd = observations.reduce<string | null>(
    (max, o) => (o.occurredAt && (!max || o.occurredAt > max) ? o.occurredAt : max),
    null,
  );
  const windowDays =
    windowStart && windowEnd
      ? Math.max(
          1,
          Math.round(
            (Date.parse(windowEnd) - Date.parse(windowStart)) / (24 * 60 * 60 * 1000),
          ),
        )
      : 0;

  return {
    view: "scan",
    generatedAt: new Date().toISOString(),
    points: points.slice(0, POINT_CAP),
    annotations,
    meters,
    slices,
    meta: shellMeta("scan", {
      empty: points.length === 0,
      observationCount: observations.length,
      calendarCount: [...calendarByFamily.values()].reduce((s, n) => s + n, 0),
      sessionCount: sessionOrder.length,
      windowDays,
      windowStart,
      windowEnd,
      families: SCAN_FAMILIES.map((f) => ({
        id: f.id,
        label: f.label,
        short: f.short,
        gloss: f.gloss,
        count: familyCounts.get(f.id) ?? 0,
        sessions: familySessions.get(f.id)?.size ?? 0,
        share: (familyCounts.get(f.id) ?? 0) / totalMass,
      })),
      topicCount: topicCounts.size,
      sourcePriorUsed,
      unclassifiedTopics: unclassifiedTopics.length,
      hotTopic: hotTopic?.[0] ?? null,
      timeAxis: "session_ordinal",
    }),
  };
}

/** First populated field wins — adapters name the creator differently. */
function mediaKey(payload: Record<string, unknown>, fields: string[]): string {
  for (const f of fields) {
    const v = payload[f];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const first = v[0];
      if (typeof first === "string" && first.trim()) return first.trim();
      if (first && typeof first === "object" && "name" in first) {
        const name = (first as { name?: unknown }).name;
        if (typeof name === "string" && name.trim()) return name.trim();
      }
    }
  }
  return "";
}

const PARTICLE_CALENDAR_DAYS = 180;
const READOUT_CHANNELS = 8;
/** One-offs shown as parked bodies; the rest are dropped as noise. */
const MAX_IMPULSE_ORBITS = 6;

/**
 * Index 02 — rhythm, not composition.
 *
 * Orbits are measured return intervals: radius is period, eccentricity is
 * irregularity, and alpha decays with how overdue a rhythm is. Particles are
 * the embedded distillate corpus as texture — semantic position, recency
 * brightness — and the labels name the series and projects behind the geometry.
 */
async function buildParticle(store: CortexStore): Promise<VizDensity> {
  const calendarStart = new Date(
    Date.now() - PARTICLE_CALENDAR_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const [events, distillates, entities, plays, episodes, watches] = await Promise.all([
    store.getCalendarStructure(calendarStart, new Date().toISOString()).catch(() => []),
    store.listDistillates({ limit: 800 }),
    store.listEntities("project", 40).catch(() => []),
    store.listRecordsByType("spotify_play", 400).catch(() => []),
    store.listRecordsByType("spotify_episode", 200).catch(() => []),
    store.listRecordsByType("youtube_watch", 300).catch(() => []),
  ]);

  // Rhythms are the point of this index; impulses are context. Without a cap
  // a few dozen one-offs would fill every slot with identical parked rings.
  //
  // "Has a rhythm" and "is on schedule" are different questions: a 7-day
  // commitment 40 days overdue is the most interesting body in the system, so
  // it is kept as a rhythm (dim and stalled) rather than binned with one-offs.
  // Media returns: the artist, show or channel you come back to. Grouping by
  // creator rather than track means the rhythm is "how often do I return to
  // this", which is the question this index answers.
  const mediaItems = [
    ...plays.map((r) => ({
      key: mediaKey(r.payload, ["artistNames", "artistName", "albumArtist"]),
      at: String(r.payload.playedAt ?? r.occurredAt ?? ""),
    })),
    ...episodes.map((r) => ({
      key: mediaKey(r.payload, ["showName", "publisher", "episodeName"]),
      at: String(r.payload.playedAt ?? r.occurredAt ?? ""),
    })),
    ...watches.map((r) => ({
      key: mediaKey(r.payload, ["channelTitle", "channelName"]),
      at: String(r.payload.watchedAt ?? r.occurredAt ?? ""),
    })),
  ].filter((m) => m.key.length > 1);

  const allSeries = [...computeSeries(events), ...computeMediaSeries(mediaItems)];
  const rhythmSeries = allSeries.filter((s) => s.periodDays !== null);
  const impulseSeries = allSeries
    .filter((s) => s.periodDays === null)
    .sort((a, b) => a.daysSinceLast - b.daysSinceLast)
    .slice(0, MAX_IMPULSE_ORBITS);
  const series = [...rhythmSeries, ...impulseSeries];
  const realOrbits = seriesToOrbits(series).slice(0, DENSITY_BUDGETS.particle.orbits);

  // Keep the shell's orbit count; anything past the measured series is dim
  // background so the field stays dense without pretending to be data.
  const orbits: VizDensity["orbits"] = realOrbits.map((o) => ({
    tilt: o.tilt,
    yaw: o.yaw,
    r: o.r,
    ecc: o.ecc,
    accent: o.accent,
    id: o.id,
    label: o.label,
    periodDays: o.periodDays,
    daysSinceLast: o.daysSinceLast,
    returns: o.returns,
    events: o.events,
    health: o.health,
    stalled: o.stalled,
    phase: o.phase,
  }));
  const fillerRnd = seeded(66);
  for (let i = orbits.length; i < DENSITY_BUDGETS.particle.orbits; i++) {
    orbits.push({
      tilt: fillerRnd() * Math.PI,
      yaw: fillerRnd() * Math.PI * 2,
      r: 0.9 + fillerRnd() * 1.8,
      ecc: 0.35 + fillerRnd() * 0.6,
      accent: false,
      id: `filler-${i}`,
    });
  }

  // Particles: the embedded corpus, rescaled to fill the sphere.
  const embedded = distillates.filter((d) => d.embedding?.length).slice(0, POINT_CAP);
  const newest = embedded.reduce(
    (max, d) => Math.max(max, Date.parse(d.createdAt ?? "") || 0),
    0,
  );
  const oldest = embedded.reduce(
    (min, d) => Math.min(min, Date.parse(d.createdAt ?? "") || Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER,
  );
  const ageSpan = Math.max(1, newest - oldest);
  const projected = embedded.map((d) => {
    const p = projectEmbedding(d.embedding!);
    const age = (Date.parse(d.createdAt ?? "") || oldest) - oldest;
    const recency = age / ageSpan;
    return {
      ...p,
      id: d.id,
      label: d.kind.slice(0, 24),
      region: d.kind,
      a: 0.3 + recency * 0.6,
      s: d.kind === "project_brief" ? 1.5 : 1,
      t: recency,
    };
  });
  const points: VizPoint3[] = normalizeCloud(projected);

  // Labels: measured series first, then real project keys.
  const labelPool = [
    ...realOrbits.map((o) => o.label),
    ...entities.map((e) => e.canonicalKey.toUpperCase()),
  ].filter(Boolean);
  const rndL = seeded(66123);
  const annotations = Array.from(
    { length: DENSITY_BUDGETS.particle.labels },
    (_, i) => ({
      id: `L${String(i + 1).padStart(2, "0")}`,
      label: (labelPool[i % Math.max(1, labelPool.length)] ?? "CORTEX").slice(0, 34),
      x: (rndL() - 0.5) * 2.4,
      y: (rndL() - 0.5) * 1.6,
      z: (rndL() - 0.5) * 2.4,
    }),
  );

  // Readout: overdue-ness per series. 1.000 = on schedule, 0.000 = gone.
  const meters = series.slice(0, READOUT_CHANNELS).map((s, i) => ({
    id: String(i + 1).padStart(2, "0"),
    label: s.key.slice(0, 14),
    value: Math.max(0, Math.min(1, s.health)),
  }));

  const tightest = rhythmSeries.reduce<number | null>(
    (min, s) => (s.periodDays !== null && (min === null || s.periodDays < min) ? s.periodDays : min),
    null,
  );

  return {
    view: "particle",
    generatedAt: new Date().toISOString(),
    points,
    orbits,
    annotations,
    meters:
      meters.length > 0
        ? meters
        : [{ id: "01", label: "PTS", value: Math.min(1, points.length / POINT_CAP) }],
    meta: shellMeta("particle", {
      empty: points.length === 0 && realOrbits.length === 0,
      pointCap: POINT_CAP,
      overlayLabels: annotations.length,
      realOrbits: realOrbits.length,
      seriesCount: allSeries.length,
      rhythmCount: rhythmSeries.length,
      impulseCount: allSeries.length - rhythmSeries.length,
      tightestPeriodDays: tightest,
      accentSeries: realOrbits.find((o) => o.accent)?.label ?? null,
      embeddedCount: embedded.length,
      embeddingModel: embedded[0]?.embeddingRef ?? null,
      embeddingDims: embedded[0]?.embedding?.length ?? null,
      calendarEvents: events.length,
    }),
  };
}

/** Independent source families backing a theme — the corroboration unit. */
const CROSS_OBSERVATION_LIMIT = 400;
const CROSS_THEME_ROWS = 18;

/**
 * Index 03 — how much of what Cortex believes rests on more than one source.
 *
 * 01 says where cognition sits, 02 says what returns. This says whether any of
 * it can be trusted: a theme carried by AI sessions alone is a single narrator,
 * one that also appears in email, calendar or GitHub is corroborated.
 *
 * The shell draws the same filament web mirrored top and bottom, so the two
 * halves take the corroborated and single-source weights. A lopsided mirror is
 * the honest picture of a vault that has only ever heard one voice.
 */
async function buildCross(store: CortexStore): Promise<VizDensity> {
  const [observations, coverage] = await Promise.all([
    store.listObservations({ limit: CROSS_OBSERVATION_LIMIT }),
    auditSourceCoverage(store),
  ]);

  const themeFamilies = new Map<string, Set<string>>();
  const familyObservations = new Map<string, number>();
  for (const o of observations) {
    const family = o.sourceFamily || "other";
    familyObservations.set(family, (familyObservations.get(family) ?? 0) + 1);
    for (const topic of topicsOf(o.metadata)) {
      if (!themeFamilies.has(topic)) themeFamilies.set(topic, new Set());
      themeFamilies.get(topic)!.add(family);
    }
  }

  const themes = [...themeFamilies.entries()]
    .map(([theme, families]) => ({ theme, families: [...families] }))
    .sort(
      (a, b) =>
        b.families.length - a.families.length || a.theme.localeCompare(b.theme),
    );
  const corroborated = themes.filter((t) => t.families.length >= 2);
  const singleSource = themes.length - corroborated.length;
  const corroborationRate = themes.length ? corroborated.length / themes.length : 0;

  // Channel bars per *family*, not per sourceId: the five AI session ids all
  // map to one family and were rendering as five identical saturated bars.
  const totalObs = Math.max(1, observations.length);
  const channelBars = [...familyObservations.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([family, n], i) => ({
      id: String(i + 1).padStart(2, "0"),
      label: family,
      value: n / totalObs,
    }));

  const cores = [...familyObservations.keys()].slice(0, 12).map((label) => ({
    id: label,
    label,
    x: 0,
    y: 0,
    z: 0,
  }));

  const drown = Math.max(0, ...coverage.sources.map((s) => s.drowningRisk));

  return {
    view: "cross",
    generatedAt: new Date().toISOString(),
    // The shell owns this topology; nothing here is drawn as points.
    points: [],
    edges: [],
    cores,
    channelBars,
    meters: [
      { id: "01", label: "CORROB", value: corroborationRate },
      { id: "02", label: "SINGLE", value: themes.length ? singleSource / themes.length : 0 },
      { id: "03", label: "FAMILIES", value: Math.min(1, familyObservations.size / 11) },
      { id: "04", label: "DROWN", value: Math.min(1, drown) },
    ],
    meta: shellMeta("cross", {
      empty: themes.length === 0,
      observationCount: observations.length,
      themeCount: themes.length,
      corroboratedCount: corroborated.length,
      singleSourceCount: singleSource,
      corroborationRate,
      familyCount: familyObservations.size,
      reflectiveShare: coverage.reflectiveShare,
      drowningRisk: drown,
      // Right-column readout: what is actually backed by more than one voice.
      themes: themes.slice(0, CROSS_THEME_ROWS).map((t) => ({
        theme: t.theme,
        families: t.families.length,
        familyNames: t.families,
      })),
    }),
  };
}
async function buildText(store: CortexStore): Promise<VizDensity> {
  const [recent, observations, distillates] = await Promise.all([
    store.listRecentWork({ limit: 40 }),
    store.listObservations({ limit: 40 }),
    store.listDistillates({
      limit: 40,
      kinds: ["portrait", "weekly_mirror", "summary", "youtube_interest_digest"],
    }),
  ]);

  const texts: Array<{ text: string; kind: "session" | "observation" | "digest" }> = [];
  for (const r of recent) {
    texts.push({
      text: truncate(`${r.title ?? ""} ${r.distillateSummary ?? ""}`),
      kind: "session",
    });
  }
  for (const o of observations) {
    texts.push({ text: truncate(o.statement), kind: "observation" });
  }
  for (const d of distillates) {
    texts.push({ text: truncate(d.content ?? ""), kind: "digest" });
  }

  const rnd = seeded(778811);
  const rowBudget = DENSITY_BUDGETS.text.rows;
  const streamRows: import("@cortex/viz-contracts").VizStreamRow[] = Array.from(
    { length: rowBudget },
    (_, r) => {
      const src = texts[r % Math.max(1, texts.length)] ?? {
        text: "CORTEX THROUGHPUT EMPTY",
        kind: "other" as const,
      };
      const raw = (src.text || "EMPTY").toUpperCase().replace(/[^A-Z0-9]+/g, "");
      let text = "";
      while (text.length < 200) {
        text += raw.slice(0, 8 + Math.floor(rnd() * 16)) + " ";
        if (rnd() < 0.25) {
          text += Math.floor(rnd() * 65535).toString(16).toUpperCase() + " ";
        }
      }
      text = text.slice(0, 200);
      const invert: Array<[number, number]> = [];
      if (src.kind === "session" || rnd() < 0.35) {
        const a = Math.floor(rnd() * 150);
        invert.push([a, a + 10 + Math.floor(rnd() * 20)]);
      }
      const kind =
        src.kind === "session" || src.kind === "observation" || src.kind === "digest"
          ? src.kind
          : "other";
      return {
        text,
        speed: (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 100),
        phase: rnd() * 200,
        alpha: 0.25 + rnd() * 0.7,
        invert,
        accent: rnd() > 0.97,
        kind,
      };
    },
  );

  return {
    view: "text",
    generatedAt: new Date().toISOString(),
    points: [],
    streamRows,
    meters: [
      { id: "01", label: "RECENT", value: Math.min(1, recent.length / 40) },
      { id: "02", label: "OBS", value: Math.min(1, observations.length / 40) },
      { id: "03", label: "DIGEST", value: Math.min(1, distillates.length / 40) },
    ],
    meta: shellMeta("text", {
      empty: texts.length === 0,
      overlaySeeds: texts.length,
    }),
  };
}
