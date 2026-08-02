/** Compatibility re-exports — prefer @/lib/fixtures and @cortex/viz-contracts. */
export { seeded, pad, hex } from "./fixtures";
export { fixtureScan as indexRowsCompat } from "./fixtures";

import { seeded, pad } from "./fixtures";

export type Channel = { id: string; label: string; value: number };

export const indexRows: Channel[] = (() => {
  const rnd = seeded(20260802);
  return ["PHASE", "ENTROPY", "DRIFT", "LUMA", "SAMPLE", "VECTOR"].map((label, i) => ({
    id: pad(i + 1),
    label,
    value: rnd(),
  }));
})();

export const readoutChannels: Channel[] = (() => {
  const rnd = seeded(77341);
  return ["AX", "AY", "AZ", "BX", "BY", "BZ"].map((label, i) => ({
    id: pad(i + 1, 2),
    label,
    value: rnd(),
  }));
})();

export type Point = { x: number; y: number; r: number };

export const swarm: Point[] = (() => {
  const rnd = seeded(918273);
  const pts: Point[] = [];
  for (let i = 0; i < 120; i++) {
    pts.push({ x: rnd(), y: rnd(), r: rnd() < 0.08 ? 1.8 : 0.9 });
  }
  return pts;
})();

export const tickerSamples: string[] = (() => {
  const rnd = seeded(551122);
  return Array.from({ length: 40 }, (_, i) =>
    i % 5 === 0 ? Math.floor(rnd() * 65535).toString(16).toUpperCase() : (rnd() * 9.9999).toFixed(4),
  );
})();
