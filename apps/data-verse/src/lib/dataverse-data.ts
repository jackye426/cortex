// Deterministic pseudo-random source so SSR and hydration agree.
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function pad(n: number, width = 3) {
  return Math.abs(Math.floor(n)).toString().padStart(width, "0");
}

export function hex(n: number, width = 4) {
  return Math.floor(n).toString(16).toUpperCase().padStart(width, "0");
}

export type Channel = { id: string; label: string; value: number };

const CHANNEL_LABELS = [
  "PHASE",
  "ENTROPY",
  "DRIFT",
  "LUMA",
  "SAMPLE",
  "VECTOR",
  "DELTA",
  "NOISE",
  "SPECTRA",
  "CADENCE",
  "PARALLAX",
  "QUANTA",
  "INDEX",
  "MOMENT",
  "RASTER",
  "SIGMA",
  "TENSOR",
  "FIELD",
];

export const indexRows: Channel[] = (() => {
  const rnd = seeded(20260802);
  return CHANNEL_LABELS.map((label, i) => ({
    id: pad(i + 1),
    label,
    value: rnd(),
  }));
})();

export const readoutChannels: Channel[] = (() => {
  const rnd = seeded(77341);
  return ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY"].map((label, i) => ({
    id: pad(i + 1, 2),
    label,
    value: rnd(),
  }));
})();

export type Point = { x: number; y: number; r: number };

export const swarm: Point[] = (() => {
  const rnd = seeded(918273);
  const pts: Point[] = [];
  for (let i = 0; i < 460; i++) {
    const cluster = i % 3;
    const cx = [0.26, 0.55, 0.8][cluster] ?? 0.5;
    const cy = [0.5, 0.46, 0.62][cluster] ?? 0.5;
    const spread = [0.26, 0.42, 0.2][cluster] ?? 0.3;
    const x = Math.min(0.995, Math.max(0.005, cx + (rnd() - 0.5) * spread * 2));
    const y = Math.min(0.995, Math.max(0.005, cy + (rnd() - 0.5) * spread * 2));
    pts.push({ x, y, r: rnd() < 0.08 ? 1.8 : 0.9 });
  }
  return pts;
})();

export const tickerSamples: string[] = (() => {
  const rnd = seeded(551122);
  return Array.from({ length: 90 }, (_, i) =>
    i % 5 === 0 ? hex(rnd() * 65535) : (rnd() * 9.9999).toFixed(4),
  );
})();
