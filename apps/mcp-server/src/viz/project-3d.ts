/**
 * Deterministic embedding → 3D projection (no UMAP in request path).
 * Uses a seeded random orthonormal-ish projection matrix.
 */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildAxes(dim: number, seed = 20260802): [number[], number[], number[]] {
  const rnd = seeded(seed);
  const axes: number[][] = [[], [], []];
  for (let a = 0; a < 3; a++) {
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      const v = rnd() * 2 - 1;
      axes[a]!.push(v);
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) axes[a]![i]! /= norm;
  }
  return [axes[0]!, axes[1]!, axes[2]!];
}

export function projectEmbedding(
  embedding: number[],
  seed = 20260802,
): { x: number; y: number; z: number } {
  if (!embedding.length) return { x: 0, y: 0, z: 0 };
  const [ax, ay, az] = buildAxes(embedding.length, seed);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < embedding.length; i++) {
    const v = embedding[i]!;
    x += v * ax[i]!;
    y += v * ay[i]!;
    z += v * az[i]!;
  }
  // soft squash into roughly [-1.2, 1.2]
  const squash = (n: number) => Math.tanh(n * 0.85);
  return { x: squash(x), y: squash(y), z: squash(z) };
}

/**
 * Rescale a projected cloud to fill the shell's unit sphere.
 *
 * A random unit axis dotted with a unit-normalized 1536-dim embedding has an
 * expected magnitude around 1/sqrt(dim) ≈ 0.026, so raw projections collapse
 * into a speck at the origin. Centre the cloud, then scale so the 95th
 * percentile radius lands at 1.0 — robust to the handful of outliers that
 * would otherwise squash everything back toward the middle.
 */
export function normalizeCloud<T extends { x: number; y: number; z: number }>(
  points: T[],
  target = 1,
): T[] {
  if (points.length === 0) return points;
  const mean = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
    { x: 0, y: 0, z: 0 },
  );
  mean.x /= points.length;
  mean.y /= points.length;
  mean.z /= points.length;

  const centred = points.map((p) => ({
    ...p,
    x: p.x - mean.x,
    y: p.y - mean.y,
    z: p.z - mean.z,
  }));
  const radii = centred
    .map((p) => Math.hypot(p.x, p.y, p.z))
    .sort((a, b) => a - b);
  const p95 = radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.95))] ?? 0;
  if (!p95) return centred;
  const k = target / p95;
  return centred.map((p) => ({ ...p, x: p.x * k, y: p.y * k, z: p.z * k }));
}

/** Region centers for self-model facets (scan view). */
export const FACET_CENTERS = {
  strengths: { x: 0.7, y: 0.25, z: 0.25 },
  limitations: { x: -0.65, y: 0.2, z: -0.3 },
  motives: { x: 0.15, y: 0.55, z: -0.4 },
  tensions: { x: 0.05, y: -0.1, z: 0.55 },
  identity: { x: -0.2, y: -0.45, z: 0.05 },
} as const;

export function jitterAround(
  center: { x: number; y: number; z: number },
  rnd: () => number,
  spread = 0.35,
): { x: number; y: number; z: number } {
  return {
    x: center.x + (rnd() - 0.5) * spread * 2,
    y: center.y + (rnd() - 0.5) * spread * 1.6,
    z: center.z + (rnd() - 0.5) * spread * 1.6,
  };
}
