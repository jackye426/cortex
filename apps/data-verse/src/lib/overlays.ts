/** Map VizDensity overlays onto restored generative shells. */
import type { VizDensity, VizMeter } from "@cortex/viz-contracts";
import type { BrainDataPoint, BrainNodeOverlay } from "@/components/dataverse/BrainField";
import type { ChannelOverlay } from "@/components/dataverse/InsightField";
import type {
  OrbitOverlay,
  ParticleDataPoint,
} from "@/components/dataverse/ParticleField";
import type { ScanSliceOverlay } from "@/components/dataverse/ScanSlices";

export function brainOverlays(d: VizDensity): BrainNodeOverlay[] | undefined {
  if (!d.annotations?.length) return undefined;
  return d.annotations.slice(0, 6).map((a) => ({
    id: a.id,
    label: a.label.slice(0, 24).toUpperCase(),
    ...(a.sub ? { sub: a.sub } : {}),
    x: a.x,
    y: a.y,
    z: a.z,
  }));
}

/** Records bound into the volume — 01 only; density elsewhere stays generative. */
export function brainDataPoints(d: VizDensity): BrainDataPoint[] | undefined {
  if (!d.points?.length) return undefined;
  return d.points.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    ...(p.a === undefined ? {} : { a: p.a }),
    ...(p.s === undefined ? {} : { s: p.s }),
    ...(p.t === undefined ? {} : { t: p.t }),
  }));
}

export function scanSliceOverlays(d: VizDensity): ScanSliceOverlay[] | undefined {
  if (!d.slices?.length) return undefined;
  return d.slices.map((s) => ({
    pos: s.pos,
    ...(s.label ? { label: s.label } : {}),
    ...(s.count === undefined ? {} : { count: s.count }),
    ...(s.region ? { region: s.region } : {}),
  }));
}

/** Chrome readouts for index 01 — real counts instead of static strings. */
export function scanReadouts(d: VizDensity): {
  caption: string;
  split: string;
  slab: string;
  sidebarTitle: string;
} {
  const meta: Record<string, unknown> = d.meta ?? {};
  const num = (key: string): number => {
    const v = meta[key];
    return typeof v === "number" ? v : 0;
  };
  const obs = num("observationCount");
  const cal = num("calendarCount");
  const sess = num("sessionCount");
  const days = num("windowDays");
  const families = Array.isArray(meta["families"])
    ? (meta["families"] as Array<{ label?: string; short?: string; count?: number }>)
    : [];

  const split =
    families.length > 0
      ? families
          .map((f) => `${f.short ?? (f.label ?? "").slice(0, 5)} ${f.count ?? 0}`)
          .join(" · ")
      : "PROJECTION PERSPECTIVE / ORTHO REF";

  const slabStep = sess > 1 ? (sess / 32).toFixed(2) : "0.00";

  return {
    caption: obs
      ? `VOLUME 01 / OBS ${obs} + CAL ${cal} / ${sess} SESS / ${days}D`
      : "VOLUME 01 / STRUCTURE ENCEPHALON / SAMPLING CONTINUOUS",
    split,
    slab: sess ? `SLAB ${slabStep} SESS / STEP ${(1 / 32).toFixed(3)}` : "SLAB 0.150 U / STEP 0.074 U",
    sidebarTitle: obs ? "INDEX / ENCEPHALON" : "INDEX / SELF",
  };
}

export function particleLabelTexts(d: VizDensity): string[] | undefined {
  const fromAnno = d.annotations?.map((a) => a.label) ?? [];
  const fromMeters = d.meters?.map((m) => m.label) ?? [];
  const merged = [...fromAnno, ...fromMeters].filter(Boolean);
  return merged.length ? merged : undefined;
}

/** Measured return-rhythms for index 02 — filler rings carry no health. */
export function orbitOverlays(d: VizDensity): OrbitOverlay[] | undefined {
  if (!d.orbits?.length) return undefined;
  return d.orbits.map((o) => ({
    ...(o.id ? { id: o.id } : {}),
    ...(o.label ? { label: o.label } : {}),
    tilt: o.tilt,
    yaw: o.yaw,
    r: o.r,
    ecc: o.ecc,
    accent: o.accent,
    ...(o.periodDays === undefined ? {} : { periodDays: o.periodDays }),
    ...(o.health === undefined ? {} : { health: o.health }),
    ...(o.stalled === undefined ? {} : { stalled: o.stalled }),
    ...(o.phase === undefined ? {} : { phase: o.phase }),
    ...(o.events === undefined ? {} : { events: o.events }),
  }));
}

export function particleDataPoints(d: VizDensity): ParticleDataPoint[] | undefined {
  if (!d.points?.length) return undefined;
  return d.points.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    ...(p.a === undefined ? {} : { a: p.a }),
    ...(p.s === undefined ? {} : { s: p.s }),
  }));
}

/** Chrome readouts for index 02. */
export function particleReadouts(d: VizDensity): {
  basis: string;
  cells: string[];
} {
  const meta: Record<string, unknown> = d.meta ?? {};
  const num = (key: string): number | null => {
    const v = meta[key];
    return typeof v === "number" ? v : null;
  };
  const str = (key: string): string | null => {
    const v = meta[key];
    return typeof v === "string" ? v : null;
  };

  const dims = num("embeddingDims");
  const model = str("embeddingModel");
  const embedded = num("embeddedCount");
  const realOrbits = num("realOrbits");
  const rhythms = num("rhythmCount");
  const impulses = num("impulseCount");
  const tightest = num("tightestPeriodDays");
  const accentSeries = str("accentSeries");

  const basis = dims
    ? `BASIS ${(model ?? "EMBED").split("/").pop()?.toUpperCase()} / DIM ${dims}`
    : "FRAME BARYCENTRIC / EPOCH J2000";

  return {
    basis,
    cells: [
      `PTS ${embedded ?? 0}`,
      `ORBITS ${String(realOrbits ?? 0).padStart(3, "0")} / ${rhythms ?? 0} RHYTHM`,
      tightest ? `PERIOD MIN ${tightest.toFixed(2)}D` : "PERIOD —",
      accentSeries ? `ENTERING ${accentSeries.slice(0, 14)}` : `IMPULSE ${impulses ?? 0}`,
    ],
  };
}

/** Index 03 — corroboration split, theme rows and chrome. */
export function crossReadouts(d: VizDensity): {
  halfWeights: { top: number; bottom: number };
  halfLabels: { top: string; bottom: string };
  themes: VizMeter[] | undefined;
  cells: string[];
} {
  const meta: Record<string, unknown> = d.meta ?? {};
  const num = (key: string): number => {
    const v = meta[key];
    return typeof v === "number" ? v : 0;
  };
  const corroborated = num("corroboratedCount");
  const single = num("singleSourceCount");
  const themeCount = num("themeCount");
  const families = num("familyCount");
  const rate = num("corroborationRate");

  const rows = Array.isArray(meta["themes"])
    ? (meta["themes"] as Array<{ theme?: string; families?: number }>)
    : [];

  return {
    // Brightness is the ratio itself, so the mirror tilts toward whichever
    // side the evidence actually sits on.
    halfWeights: {
      top: themeCount ? corroborated / themeCount : 0,
      bottom: themeCount ? single / themeCount : 1,
    },
    halfLabels: {
      top: `CORROB ${corroborated}`,
      bottom: `SINGLE ${single}`,
    },
    themes: rows.length
      ? rows.map((r, i) => ({
          id: String(i + 1).padStart(2, "0"),
          label: (r.theme ?? "").slice(0, 26).toUpperCase(),
          value: r.families ?? 0,
        }))
      : undefined,
    cells: [
      `THEMES ${themeCount}`,
      `FAMILIES ${families}`,
      `CORROB ${(rate * 100).toFixed(1)}%`,
      `DROWN ${num("drowningRisk").toFixed(3)}`,
    ],
  };
}

export function crossChannels(d: VizDensity): ChannelOverlay[] | undefined {
  if (!d.channelBars?.length) return undefined;
  return d.channelBars.map((b) => ({ label: b.label, value: b.value }));
}

export function textSeedTexts(d: VizDensity): string[] | undefined {
  const rows = d.streamRows?.map((r) => r.text).filter(Boolean) ?? [];
  return rows.length ? rows : undefined;
}

export function panelMeters(d: VizDensity): VizMeter[] | undefined {
  return d.meters?.length ? d.meters : undefined;
}

export function isDegraded(d: VizDensity): boolean {
  return Boolean(d.meta?.degraded || d.meta?.source === "degraded" || d.meta?.source === "fixture");
}

export function sourceLabel(d: VizDensity): string {
  const src = d.meta?.source;
  if (src === "live") return "LIVE";
  if (src === "fixture") return "FIXTURE";
  if (src === "degraded") return "DEGRADED";
  return d.meta?.empty ? "EMPTY" : "SHELL";
}
