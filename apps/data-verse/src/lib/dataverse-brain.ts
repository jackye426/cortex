import { seeded } from "./dataverse-data";

export type Vec3 = { x: number; y: number; z: number };
export type BrainPoint = Vec3 & { s: number; a: number };

/**
 * Deterministic, anatomically-suggestive encephalon point cloud.
 * Axes: x = anterior/posterior, y = superior/inferior, z = left/right.
 */
export function buildBrain(count = 9000): BrainPoint[] {
  const rnd = seeded(4412219);
  const pts: BrainPoint[] = [];

  const gyri = (x: number, y: number, z: number) =>
    1 +
    0.052 * Math.sin(10.5 * x + 2.4 * y) +
    0.044 * Math.sin(8.5 * y + 3.6 * z) +
    0.036 * Math.sin(12.0 * z - 2.1 * x) +
    0.022 * Math.sin(19.0 * x * z + 4.0 * y);

  const shell = (
    n: number,
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    opts: {
      fold?: boolean;
      alpha?: number;
      fissure?: boolean;
      flattenBase?: number;
      lamellae?: boolean;
    } = {},
  ) => {
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const dx = r * Math.cos(t);
      const dy = u;
      const dz = r * Math.sin(t);

      const k = opts.fold ? gyri(dx, dy, dz) : 1;
      const x = cx + dx * rx * k;
      let y = cy + dy * ry * k;
      let z = cz + dz * rz * k;

      // taper the frontal pole and narrow the occipital pole
      if (opts.fold) {
        if (x > 0.55) z *= 1 - (x - 0.55) * 0.28;
        if (x < -0.55) y *= 1 - (Math.abs(x) - 0.55) * 0.18;
      }

      if (opts.flattenBase !== undefined && y < opts.flattenBase) {
        y = opts.flattenBase + (y - opts.flattenBase) * 0.55;
      }

      if (opts.fissure) {
        const side = z >= 0 ? 1 : -1;
        z += side * 0.055;
        if (Math.abs(z) < 0.05) continue;
      }

      // a fraction of samples pushed inward → volumetric density
      const inward = rnd() < 0.2 ? 0.72 + rnd() * 0.24 : 1;
      const lam = opts.lamellae ? 0.35 + 0.65 * Math.abs(Math.sin(y * 46)) : 1;

      pts.push({
        x: cx + (x - cx) * inward,
        y: cy + (y - cy) * inward,
        z: cz + (z - cz) * inward,
        s: rnd() < 0.05 ? 1.7 : 1,
        a: (opts.alpha ?? 1) * lam * (0.32 + rnd() * 0.68),
      });
    }
  };

  // cerebrum — two folded hemispheres split by the longitudinal fissure
  shell(Math.floor(count * 0.62), 0, 0.1, 0, 1.0, 0.7, 0.78, {
    fold: true,
    fissure: true,
    flattenBase: -0.12,
  });

  // temporal lobes
  shell(Math.floor(count * 0.09), 0.16, -0.34, 0.44, 0.46, 0.2, 0.2, {
    fold: true,
    alpha: 0.9,
  });
  shell(Math.floor(count * 0.09), 0.16, -0.34, -0.44, 0.46, 0.2, 0.2, {
    fold: true,
    alpha: 0.9,
  });

  // cerebellum — dense, finely laminated
  shell(Math.floor(count * 0.13), -0.78, -0.44, 0, 0.33, 0.27, 0.46, {
    alpha: 0.85,
    lamellae: true,
  });

  // brain stem / medulla — tapered column
  const stem = Math.floor(count * 0.07);
  for (let i = 0; i < stem; i++) {
    const p = i / stem;
    const rad = 0.14 * (1 - p * 0.45);
    const t = rnd() * Math.PI * 2;
    const rr = rad * (0.7 + rnd() * 0.3);
    pts.push({
      x: -0.5 + p * 0.1 + Math.cos(t) * rr,
      y: -0.42 - p * 0.62,
      z: Math.sin(t) * rr,
      s: 1,
      a: 0.3 + rnd() * 0.5,
    });
  }

  return pts;
}

let cache: BrainPoint[] | null = null;
export function brainCloud(count = 9000) {
  if (!cache) cache = buildBrain(count);
  return cache;
}

/** Anchor nodes used for leader-line annotations. */
export const brainNodes: Array<Vec3 & { id: string; label: string }> = [
  { id: "N01", label: "LOBE / FRONTAL", x: 0.86, y: 0.3, z: 0.3 },
  { id: "N02", label: "FISSURE / LONGITUDINAL", x: 0.05, y: 0.78, z: 0.06 },
  { id: "N03", label: "LOBE / OCCIPITAL", x: -0.82, y: 0.28, z: -0.3 },
  { id: "N04", label: "CEREBELLUM / VERMIS", x: -0.86, y: -0.5, z: 0.24 },
  { id: "N05", label: "LOBE / TEMPORAL L", x: 0.3, y: -0.42, z: 0.62 },
  { id: "N06", label: "STEM / MEDULLA", x: -0.44, y: -1.02, z: 0 },
];
