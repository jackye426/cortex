/**
 * Offline viz projection snapshot — embedding→3D + orbits for particle/scan.
 * Stored as distillate kind `viz_projection`.
 */
import {
  VIZ_PROJECTION_KIND,
  type VizOrbit,
  type VizProjectionSnapshot,
} from "@cortex/viz-contracts";
import { stableSubjectUuid } from "../stable-id.js";
import type { CortexStore } from "../store/index.js";
import { detectCycles } from "../intrapersonal/cycles.js";
import { projectEmbedding, seeded } from "./project-3d.js";

const DEFAULT_LIMIT = 5200;

export interface BuildVizProjectionOptions {
  dryRun?: boolean;
  pointLimit?: number;
}

export async function buildVizProjectionSnapshot(
  store: CortexStore,
  options: BuildVizProjectionOptions = {},
): Promise<{
  dryRun: boolean;
  written: boolean;
  snapshot: VizProjectionSnapshot;
}> {
  const pointLimit = options.pointLimit ?? DEFAULT_LIMIT;
  const dryRun = Boolean(options.dryRun);
  const distillates = await store.listDistillates({ limit: Math.min(pointLimit * 2, 8000) });
  const withEmb = distillates.filter((d) => d.embedding && d.embedding.length > 0);
  const points = withEmb.slice(0, pointLimit).map((d) => {
    const p = projectEmbedding(d.embedding!);
    return {
      ...p,
      a: 0.35 + Math.min(0.6, (d.content?.length ?? 0) / 4000),
      s: 1,
      id: d.id,
      distillateId: d.id,
      label: d.kind.slice(0, 24),
      region: d.kind,
    };
  });

  const entities = await store.listEntities(undefined, 40);
  const priorities = entities.filter(
    (e) => e.entityType === "priority" || e.entityType === "ambition",
  );
  const projects = entities.filter((e) => e.entityType === "project");
  const rnd = seeded(991122);
  const orbits: VizOrbit[] = [];

  for (let i = 0; i < Math.min(8, priorities.length); i++) {
    const e = priorities[i]!;
    orbits.push({
      tilt: rnd() * Math.PI,
      yaw: rnd() * Math.PI * 2,
      r: 0.9 + rnd() * 1.4,
      ecc: 0.4 + rnd() * 0.5,
      accent: true,
      id: e.id,
      label: e.canonicalKey.slice(0, 24),
    });
  }

  try {
    const cycles = await detectCycles(store, { dryRun: true });
    for (let i = 0; i < Math.min(6, cycles.cycles.length); i++) {
      const c = cycles.cycles[i]!;
      orbits.push({
        tilt: rnd() * Math.PI,
        yaw: rnd() * Math.PI * 2,
        r: 1.1 + rnd() * 1.2,
        ecc: 0.35 + rnd() * 0.5,
        accent: false,
        id: `cycle-${i}`,
        label: String(c.kind ?? "cycle").slice(0, 24),
      });
    }
  } catch {
    // cycles optional
  }

  while (orbits.length < 3) {
    orbits.push({
      tilt: rnd() * Math.PI,
      yaw: rnd() * Math.PI * 2,
      r: 1 + rnd(),
      ecc: 0.5,
      accent: orbits.length === 0,
      id: `orbit-${orbits.length}`,
      label: "ORBIT",
    });
  }

  const labels = projects.slice(0, 26).map((e) => {
    const p = projectEmbedding(
      Array.from({ length: 32 }, (_, i) => ((e.canonicalKey.charCodeAt(i % e.canonicalKey.length) ?? 0) / 128) - 0.5),
      4242,
    );
    return {
      id: e.id.slice(0, 8),
      label: e.canonicalKey.slice(0, 24),
      x: p.x,
      y: p.y,
      z: p.z,
    };
  });

  const snapshot: VizProjectionSnapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    pointLimit,
    points,
    orbits,
    labels,
  };

  if (dryRun) {
    return { dryRun: true, written: false, snapshot };
  }

  const subjectId = stableSubjectUuid("viz", "projection");
  await store.upsertDistillate({
    subjectType: "system",
    subjectId,
    kind: VIZ_PROJECTION_KIND,
    content: JSON.stringify({
      pointCount: points.length,
      orbitCount: orbits.length,
      generatedAt: snapshot.generatedAt,
    }),
    embedding: null,
    embeddingRef: null,
    model: "viz-projection-v1",
    metadata: {
      twin: "viz",
      snapshot,
      sourceFingerprint: `viz:${snapshot.generatedAt}:${points.length}`,
    },
  });

  return { dryRun: false, written: true, snapshot };
}

export async function loadVizProjectionSnapshot(
  store: CortexStore,
): Promise<VizProjectionSnapshot | null> {
  const rows = await store.listDistillates({
    limit: 5,
    kinds: [VIZ_PROJECTION_KIND],
  });
  const row = rows.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];
  if (!row) return null;
  const snap = row.metadata?.snapshot as VizProjectionSnapshot | undefined;
  return snap ?? null;
}
