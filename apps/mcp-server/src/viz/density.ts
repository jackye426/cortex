/**
 * Build VizDensity payloads for scan | particle | cross | text.
 */
import {
  DENSITY_BUDGETS,
  emptyDensity,
  VIZ_SOURCE_FAMILIES,
  type SelfFacet,
  type VizDensity,
  type VizEdge,
  type VizPoint3,
  type VizView,
} from "@cortex/viz-contracts";
import type { CortexStore } from "../store/index.js";
import { rankConnectionCandidates, type CandidateMemory } from "../connection-candidates.js";
import { auditSourceCoverage } from "../intrapersonal/source-health.js";
import { runPriorityVsActual } from "../project-brief.js";
import { FACET_CENTERS, jitterAround, projectEmbedding, seeded } from "./project-3d.js";
import { loadVizProjectionSnapshot } from "./projection-job.js";

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

async function buildScan(store: CortexStore): Promise<VizDensity> {
  const rnd = seeded(4412219);
  const [selfModel, interests, hyps, affect, diffs] = await Promise.all([
    store.getLatestSelfModelVersion(),
    store.listInterests({ limit: 80 }),
    store.listHypotheses({ limit: 40 }),
    store.listAffectSignals({ limit: 40 }),
    store.listSelfModelDiffs({ limit: 1 }),
  ]);

  const points: VizPoint3[] = [];
  const pushFacet = (
    facet: SelfFacet,
    items: Array<{ statement?: string; confidence?: number; evidenceIds?: string[]; title?: string }>,
  ) => {
    for (const item of items) {
      const c = FACET_CENTERS[facet];
      const p = jitterAround(c, rnd, 0.4);
      points.push({
        ...p,
        region: facet,
        confidence: item.confidence ?? 0.5,
        evidenceFamilies: item.evidenceIds?.length ?? 1,
        a: 0.35 + (item.confidence ?? 0.5) * 0.6,
        s: (item.confidence ?? 0.5) > 0.75 ? 1.6 : 1,
        label: (item.title ?? item.statement ?? facet).slice(0, 24),
      });
    }
  };

  if (selfModel) {
    pushFacet("strengths", selfModel.strengths);
    pushFacet("limitations", selfModel.limitations);
    pushFacet("motives", selfModel.motives);
    pushFacet("tensions", selfModel.tensions);
    pushFacet("identity", selfModel.identityDevelopment);
  }

  for (const interest of interests) {
    const c = FACET_CENTERS.motives;
    const p = jitterAround(c, rnd, 0.7);
    points.push({
      ...p,
      region: interest.class,
      confidence: interest.confidence,
      a: 0.3 + interest.recurrenceScore * 0.5,
      label: interest.displayName.slice(0, 24),
      id: interest.id,
    });
  }

  // Pad with projection snapshot points tagged by kind if sparse
  if (points.length < 200) {
    const snap = await loadVizProjectionSnapshot(store);
    for (const p of (snap?.points ?? []).slice(0, 800)) {
      points.push({
        x: p.x * 0.5,
        y: p.y * 0.5,
        z: p.z * 0.5,
        a: p.a,
        region: "identity",
        id: p.id,
      });
    }
  }

  const hotHyps = hyps
    .filter((h) => h.state !== "retired")
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);

  const annotations: Array<{ id: string; label: string; x: number; y: number; z: number }> =
    hotHyps.map((h, i) => {
      const facet: SelfFacet =
        h.domains.includes("tension") || h.domains.includes("avoidance")
          ? "tensions"
          : h.domains.includes("motive")
            ? "motives"
            : "identity";
      const c = FACET_CENTERS[facet];
      return {
        id: `N${String(i + 1).padStart(2, "0")}`,
        label: h.claim.slice(0, 24),
        x: c.x,
        y: c.y,
        z: c.z,
      };
    });
  // Pad to anatomical annotation budget so client overlays stay dense
  while (annotations.length < DENSITY_BUDGETS.scan.annotations) {
    const i = annotations.length;
    const facet = (["strengths", "limitations", "motives", "tensions", "identity"] as SelfFacet[])[
      i % 5
    ]!;
    const c = FACET_CENTERS[facet];
    annotations.push({
      id: `N${String(i + 1).padStart(2, "0")}`,
      label: facet.toUpperCase().slice(0, 24),
      x: c.x,
      y: c.y,
      z: c.z,
    });
  }

  const energy = affect.filter((a) => a.signalType === "energy");
  const valence = affect.filter((a) => a.signalType === "valence");
  const friction = affect.filter((a) => a.signalType === "friction");
  const flow = affect.filter((a) => a.signalType === "flow");
  const avg = (rows: typeof affect) =>
    rows.length ? rows.reduce((s, r) => s + r.value, 0) / rows.length : 0.5;

  const diff = diffs[0];
  const slices = Array.from({ length: 32 }, (_, i) => ({
    pos: 1.15 - (i / 31) * 2.3,
    region: diff
      ? i % 3 === 0
        ? "emerging"
        : i % 3 === 1
          ? "fading"
          : "stable"
      : undefined,
  }));

  return {
    view: "scan",
    generatedAt: new Date().toISOString(),
    points: points.slice(0, POINT_CAP),
    annotations,
    meters: [
      { id: "01", label: "ENERGY", value: Math.min(1, Math.max(0, avg(energy))) },
      { id: "02", label: "VALENCE", value: Math.min(1, Math.max(0, avg(valence))) },
      { id: "03", label: "FRICTION", value: Math.min(1, Math.max(0, avg(friction))) },
      { id: "04", label: "FLOW", value: Math.min(1, Math.max(0, avg(flow))) },
      { id: "05", label: "INTERESTS", value: Math.min(1, interests.length / 40) },
      { id: "06", label: "HYPS", value: Math.min(1, hyps.length / 40) },
    ],
    slices,
    meta: shellMeta("scan", {
      empty: points.length === 0 && annotations.length === 0,
      selfModelVersion: selfModel?.version ?? null,
      overlayAnnotations: annotations.length,
    }),
  };
}

async function buildParticle(store: CortexStore): Promise<VizDensity> {
  const snap = await loadVizProjectionSnapshot(store);
  let points: VizPoint3[] = [];
  let orbits = snap?.orbits ?? [];
  let annotations = (snap?.labels ?? []).map((l) => ({
    id: l.id,
    label: l.label,
    x: l.x,
    y: l.y,
    z: l.z,
  }));

  if (snap?.points?.length) {
    points = snap.points.slice(0, POINT_CAP).map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      a: p.a,
      s: p.s,
      id: p.id,
      label: p.label,
      region: p.region,
    }));
  } else {
    // Fallback: project on the fly from available embeddings (bounded)
    const distillates = await store.listDistillates({ limit: 800 });
    points = distillates
      .filter((d) => d.embedding?.length)
      .slice(0, 800)
      .map((d) => {
        const p = projectEmbedding(d.embedding!);
        return { ...p, a: 0.5, id: d.id, label: d.kind.slice(0, 24) };
      });
  }

  const pva = await runPriorityVsActual(store, { dryRun: true });
  const meters = pva.attribution.slice(0, 8).map((row, i) => ({
    id: String(i + 1).padStart(2, "0"),
    label: row.projectKey.slice(0, 12).toUpperCase(),
    value: Math.min(1, row.pct ?? row.hours / 40),
  }));

  // Expand floating labels to shell budget from projects + distillate tags
  const labelPool = [
    ...meters.map((m) => m.label),
    ...annotations.map((a) => a.label),
    ...points.map((p) => p.label).filter((x): x is string => Boolean(x)),
  ];
  if (labelPool.length > 0) {
    const rndL = seeded(66123);
    annotations = Array.from({ length: DENSITY_BUDGETS.particle.labels }, (_, i) => ({
      id: `L${String(i + 1).padStart(2, "0")}`,
      label: (labelPool[i % labelPool.length] ?? "CORTEX").slice(0, 12).toUpperCase(),
      x: (rndL() - 0.5) * 2.4,
      y: (rndL() - 0.5) * 1.6,
      z: (rndL() - 0.5) * 2.4,
    }));
  }

  if (!orbits.length) {
    const rnd = seeded(66);
    orbits = Array.from({ length: DENSITY_BUDGETS.particle.orbits }, (_, i) => ({
      tilt: rnd() * Math.PI,
      yaw: rnd() * Math.PI * 2,
      r: 0.9 + rnd() * 1.8,
      ecc: 0.35 + rnd() * 0.6,
      accent: i === 3 || i === 11,
      id: `o${i}`,
      label: meters[i % Math.max(1, meters.length)]?.label ?? "ORBIT",
    }));
  }

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
      empty: points.length === 0 && annotations.length === 0,
      fromSnapshot: Boolean(snap),
      pointCap: POINT_CAP,
      overlayLabels: annotations.length,
    }),
  };
}

async function buildCross(store: CortexStore): Promise<VizDensity> {
  const coverage = await auditSourceCoverage(store);
  const entities = await store.listEntities(undefined, 60);
  const distillates = await store.listDistillates({ limit: 120 });

  const rnd = seeded(313377);
  const familySet = new Set<string>([
    ...VIZ_SOURCE_FAMILIES,
    ...coverage.sources.map((s) => s.sourceFamily),
  ]);
  const families = [...familySet].slice(0, 12);
  const cores = families.map((label) => ({
    id: label,
    label,
    x: (rnd() - 0.5) * 1.7,
    y: (rnd() - 0.5) * 0.9,
    z: (rnd() - 0.5) * 1.2,
  }));

  const points: VizPoint3[] = [];
  const edges: VizEdge[] = [];
  const coreIndex = new Map(cores.map((c, i) => [c.id, i]));

  // Seed core nodes
  for (const c of cores) {
    points.push({ x: c.x, y: c.y, z: c.z, a: 0.95, id: c.id, label: c.label, s: 1.8 });
  }

  const candidates: CandidateMemory[] = distillates.slice(0, 80).map((d) => ({
    id: d.id,
    kind: d.kind,
    sourceType: String(d.metadata?.sourceFamily ?? d.kind.split("_")[0] ?? "other"),
    content: (d.content ?? "").slice(0, 200),
    topics: Array.isArray(d.metadata?.topics) ? (d.metadata.topics as string[]) : [],
    projects: Array.isArray(d.metadata?.projects) ? (d.metadata.projects as string[]) : [],
    occurredAt: d.createdAt,
    embedding: d.embedding ?? null,
  }));

  const ranked = rankConnectionCandidates(candidates, { limit: 40, requireCrossSource: true });
  for (const pair of ranked) {
    const pa = projectEmbedding(
      pair.a.embedding ??
        Array.from({ length: 16 }, (_, i) => (pair.a.id.charCodeAt(i % pair.a.id.length) / 128) - 0.5),
    );
    const pb = projectEmbedding(
      pair.b.embedding ??
        Array.from({ length: 16 }, (_, i) => (pair.b.id.charCodeAt(i % pair.b.id.length) / 128) - 0.5),
      99,
    );
    const ia = points.length;
    points.push({ ...pa, a: 0.5 + pair.score * 0.4, id: pair.a.id });
    const ib = points.length;
    points.push({ ...pb, a: 0.5 + pair.score * 0.4, id: pair.b.id });
    edges.push({ a: ia, b: ib, weight: pair.score, polarity: "supports" });
  }

  // Entity links
  for (const ent of entities.slice(0, 30)) {
    const links = await store.listEntityLinks(ent.id);
    for (const link of links.slice(0, 5)) {
      const from = points.findIndex((p) => p.id === ent.id || p.label === ent.canonicalKey);
      const ia =
        from >= 0
          ? from
          : (() => {
              const p = jitterAround(cores[0] ?? { x: 0, y: 0, z: 0 }, rnd, 0.8);
              const idx = points.length;
              points.push({
                ...p,
                id: ent.id,
                label: ent.canonicalKey.slice(0, 24),
                a: 0.7,
              });
              return idx;
            })();
      const ib = points.length;
      points.push({
        x: (rnd() - 0.5) * 1.4,
        y: (rnd() - 0.5) * 0.8,
        z: (rnd() - 0.5) * 1.0,
        a: 0.45,
        id: link.id,
      });
      edges.push({ a: ia, b: ib, weight: 0.4, polarity: "neutral" });
    }
  }

  // Dendritic walks from cores for visual density
  for (let s = 0; s < Math.min(24, cores.length * 3); s++) {
    const c = cores[s % cores.length]!;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    let prev = coreIndex.get(c.id) ?? 0;
    for (let i = 0; i < 12; i++) {
      x += (rnd() - 0.5) * 0.08;
      y += (rnd() - 0.5) * 0.06;
      z += (rnd() - 0.5) * 0.08;
      const idx = points.length;
      points.push({ x, y, z, a: 0.35 + rnd() * 0.4 });
      edges.push({ a: prev, b: idx, weight: 0.3 + rnd() * 0.4, polarity: "supports" });
      prev = idx;
    }
  }

  const channelBars = coverage.sources.slice(0, 12).map((s, i) => ({
    id: String(i + 1).padStart(2, "0"),
    label: s.sourceFamily,
    value: Math.min(1, Math.max(s.drowningRisk, s.recordCount7d / 200, s.embedCoverage)),
  }));

  // Ensure ≥6 cortex-labelled bars
  if (channelBars.length < 6) {
    for (const fam of VIZ_SOURCE_FAMILIES) {
      if (channelBars.length >= 8) break;
      if (!channelBars.some((b) => b.label === fam)) {
        channelBars.push({
          id: String(channelBars.length + 1).padStart(2, "0"),
          label: fam,
          value: 0.05,
        });
      }
    }
  }

  return {
    view: "cross",
    generatedAt: new Date().toISOString(),
    points: points.slice(0, POINT_CAP),
    edges,
    cores,
    channelBars,
    meters: [
      { id: "01", label: "CROSS", value: Math.min(1, ranked.length / 20) },
      { id: "02", label: "DROWN", value: Math.min(1, Math.max(...coverage.sources.map((s) => s.drowningRisk), 0)) },
      { id: "03", label: "REFL", value: coverage.reflectiveShare },
      { id: "04", label: "OPS", value: coverage.operationalShare },
    ],
    meta: shellMeta("cross", {
      empty: points.length === 0 && channelBars.length === 0,
      entityCount: entities.length,
      overlayChannels: channelBars.length,
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
