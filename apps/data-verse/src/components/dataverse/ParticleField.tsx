import { useMemo } from "react";
import { useDataCanvas } from "@/lib/dataverse-canvas";
import { seeded, hex, pad } from "@/lib/dataverse-data";

type P = { x: number; y: number; z: number; a: number };
type Orbit = { tilt: number; yaw: number; r: number; ecc: number; accent: boolean };
type Label = { x: number; y: number; z: number; v: string; n: string };

/** A measured return-rhythm: radius is period, ecc is irregularity. */
export type OrbitOverlay = {
  id?: string | undefined;
  label?: string | undefined;
  tilt: number;
  yaw: number;
  r: number;
  ecc: number;
  accent: boolean;
  /** Mean days between returns; null/absent = one-off impulse. */
  periodDays?: number | null | undefined;
  /** Overdue-ness 0–1 — drives brightness. */
  health?: number | undefined;
  /** Impulse or long overdue: the body stops moving. */
  stalled?: boolean | undefined;
  /** Deterministic starting angle 0–1. */
  phase?: number | undefined;
  events?: number | undefined;
};

/** A record placed by embedding — semantic position, recency brightness. */
export type ParticleDataPoint = {
  x: number;
  y: number;
  z: number;
  a?: number | undefined;
  s?: number | undefined;
};

/** Seconds for the tightest rhythm to complete one lap. */
const FASTEST_LAP_SECONDS = 24;

function build(count: number, orbits: number, labelTexts?: string[]) {
  const rnd = seeded(66123);
  const pts: P[] = [];
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const rad = 0.35 + Math.pow(rnd(), 2.4) * 0.55;
    pts.push({
      x: r * Math.cos(t) * rad,
      y: u * rad * 0.82,
      z: r * Math.sin(t) * rad,
      a: 0.25 + rnd() * 0.75,
    });
  }
  const orb: Orbit[] = Array.from({ length: orbits }, (_, i) => ({
    tilt: rnd() * Math.PI,
    yaw: rnd() * Math.PI * 2,
    r: 0.9 + rnd() * 1.8,
    ecc: 0.35 + rnd() * 0.6,
    accent: i === 3 || i === 11,
  }));
  const labels: Label[] = Array.from({ length: 26 }, (_, i) => {
    const text = labelTexts?.[i % Math.max(1, labelTexts.length)];
    return {
      x: (rnd() - 0.5) * 2.4,
      y: (rnd() - 0.5) * 1.6,
      z: (rnd() - 0.5) * 2.4,
      v: text ? text.slice(0, 18).toUpperCase() : hex(rnd() * 65535),
      n: pad(rnd() * 999, 3),
    };
  });
  return { pts, orb, labels };
}

export function ParticleField({
  count = 5200,
  orbits = 22,
  labelTexts,
  orbitOverlays,
  dataPoints,
}: {
  count?: number | undefined;
  orbits?: number | undefined;
  /** Cortex project / distillate keys woven into floating annotations. */
  labelTexts?: string[] | undefined;
  /** Measured return-rhythms — replaces the generative rings when supplied. */
  orbitOverlays?: OrbitOverlay[] | undefined;
  /** Cortex records placed by embedding, drawn over the generative cloud. */
  dataPoints?: ParticleDataPoint[] | undefined;
}) {
  const { pts, orb, labels } = useMemo(
    () => build(count, orbits, labelTexts),
    [count, orbits, labelTexts],
  );

  // Angular speed is relative to the tightest measured rhythm, so the ratio
  // between bodies is the ratio between their real periods.
  const fastestPeriod = useMemo(() => {
    const periods = (orbitOverlays ?? [])
      .map((o) => o.periodDays)
      .filter((p): p is number => typeof p === "number" && p > 0);
    return periods.length ? Math.min(...periods) : null;
  }, [orbitOverlays]);

  const { wrapRef, canvasRef } = useDataCanvas(({ ctx, w, h, t, fg, accent }) => {
    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h) * 0.42;
    const ry = t * 0.09;
    const rx = Math.sin(t * 0.05) * 0.3;
    const cosY = Math.cos(ry);
    const sinY = Math.sin(ry);
    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);
    const cam = 3.6;

    const proj = (x: number, y: number, z: number) => {
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const y1 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;
      const p = cam / (cam - z2);
      return { sx: cx + x1 * scale * p, sy: cy - y1 * scale * p, d: z2, p };
    };

    ctx.lineWidth = 1;
    const rings: Array<Orbit & Partial<OrbitOverlay>> = orbitOverlays?.length
      ? orbitOverlays
      : orb;

    /** Ellipse point at angle a, in the orbit's tilted plane. */
    const orbitAt = (o: Orbit & Partial<OrbitOverlay>, a: number) => {
      const ox = Math.cos(a) * o.r;
      const oy = Math.sin(a) * o.r * o.ecc;
      const x = ox * Math.cos(o.yaw);
      const z = ox * Math.sin(o.yaw);
      const y = oy * Math.cos(o.tilt);
      return proj(x, y, z + oy * Math.sin(o.tilt));
    };

    for (const o of rings) {
      const measured = typeof o.health === "number";
      ctx.beginPath();
      for (let i = 0; i <= 110; i++) {
        const s = orbitAt(o, (i / 110) * Math.PI * 2 + t * 0.05);
        if (i === 0) ctx.moveTo(s.sx, s.sy);
        else ctx.lineTo(s.sx, s.sy);
      }
      ctx.strokeStyle = o.accent ? accent : fg;
      // Overdue rhythms fade; unmeasured filler stays far back.
      ctx.globalAlpha = o.accent
        ? 0.5
        : measured
          ? 0.09 + (o.health ?? 0) * 0.28
          : 0.06;
      ctx.stroke();

      // The body. Rings alone cannot show period — a marker moving at
      // 1/period makes rhythm perceptible, and a stalled body sits still.
      if (measured) {
        const speed =
          o.stalled || !o.periodDays || !fastestPeriod
            ? 0
            : (fastestPeriod / o.periodDays) * ((Math.PI * 2) / FASTEST_LAP_SECONDS);
        const angle = (o.phase ?? 0) * Math.PI * 2 + t * speed;
        const s = orbitAt(o, angle);
        const size = Math.max(2.6, Math.min(5.4, 2.6 + Math.log1p(o.events ?? 1) * 0.9)) * s.p;
        ctx.fillStyle = o.accent ? accent : fg;
        ctx.globalAlpha = Math.max(0.35, Math.min(1, 0.4 + (o.health ?? 0) * 0.6));
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, size / 2, 0, Math.PI * 2);
        ctx.fill();
        // Halo marks a live body; stalled ones stay bare so the eye can tell
        // "still orbiting" from "coasting" without reading the label.
        if (!o.stalled) {
          ctx.strokeStyle = o.accent ? accent : fg;
          ctx.globalAlpha = 0.35;
          ctx.beginPath();
          ctx.arc(s.sx, s.sy, size / 2 + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = fg;
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i]!;
      const wob = 1 + Math.sin(t * 0.6 + i) * 0.015;
      const s = proj(pt.x * wob, pt.y * wob, pt.z * wob);
      ctx.globalAlpha = Math.min(1, pt.a * (0.2 + ((s.d + 1) / 2) * 0.9));
      ctx.fillRect(s.sx, s.sy, s.p, s.p);
    }

    // Bound records over the generative cloud — semantic position, recency alpha.
    if (dataPoints?.length) {
      for (let i = 0; i < dataPoints.length; i++) {
        const pt = dataPoints[i]!;
        const wob = 1 + Math.sin(t * 0.6 + i) * 0.015;
        const s = proj(pt.x * wob, pt.y * wob, pt.z * wob);
        ctx.globalAlpha = Math.min(1, (pt.a ?? 0.6) * (0.35 + ((s.d + 1) / 2) * 0.75));
        const size = (pt.s ?? 1) * 1.8 * s.p;
        ctx.fillRect(s.sx - size / 2, s.sy - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = "left";
    labels.forEach((l, i) => {
      const s = proj(l.x, l.y, l.z);
      ctx.globalAlpha = 0.1 + ((s.d + 1.5) / 3) * 0.6;
      ctx.strokeStyle = fg;
      ctx.beginPath();
      ctx.moveTo(s.sx, s.sy);
      ctx.lineTo(s.sx + 22, s.sy);
      ctx.stroke();
      ctx.fillText(`${l.n} ${l.v}`, Math.min(w - 130, s.sx + 26), s.sy);
      if (i % 7 === 0) {
        ctx.fillText(`${(s.d + 1.5).toFixed(4)}`, Math.min(w - 130, s.sx + 26), s.sy + 11);
      }
    });
    ctx.globalAlpha = 1;
  });

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
    </div>
  );
}
