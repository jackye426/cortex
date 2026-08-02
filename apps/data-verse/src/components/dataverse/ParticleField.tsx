import type { VizDensity } from "@cortex/viz-contracts";
import { useDataCanvas } from "@/lib/dataverse-canvas";

type Props = { density?: VizDensity };

export function ParticleField({ density }: Props) {
  const pts = density?.points ?? [];
  const orb = density?.orbits ?? [];
  const labels = density?.annotations ?? [];

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
    for (const o of orb) {
      ctx.beginPath();
      for (let i = 0; i <= 110; i++) {
        const a = (i / 110) * Math.PI * 2 + t * 0.05;
        const ox = Math.cos(a) * o.r;
        const oy = Math.sin(a) * o.r * o.ecc;
        const x = ox * Math.cos(o.yaw);
        const z = ox * Math.sin(o.yaw);
        const y = oy * Math.cos(o.tilt);
        const z2 = z + oy * Math.sin(o.tilt);
        const s = proj(x, y, z2);
        if (i === 0) ctx.moveTo(s.sx, s.sy);
        else ctx.lineTo(s.sx, s.sy);
      }
      ctx.strokeStyle = o.accent ? accent : fg;
      ctx.globalAlpha = o.accent ? 0.65 : 0.14;
      ctx.stroke();
    }

    ctx.fillStyle = fg;
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i]!;
      const wob = 1 + Math.sin(t * 0.6 + i) * 0.015;
      const s = proj(pt.x * wob, pt.y * wob, pt.z * wob);
      ctx.globalAlpha = Math.min(1, (pt.a ?? 0.5) * (0.2 + ((s.d + 1) / 2) * 0.9));
      ctx.fillRect(s.sx, s.sy, s.p, s.p);
    }

    ctx.textAlign = "left";
    labels.forEach((l) => {
      const s = proj(l.x, l.y, l.z);
      ctx.globalAlpha = 0.1 + ((s.d + 1.5) / 3) * 0.6;
      ctx.strokeStyle = fg;
      ctx.beginPath();
      ctx.moveTo(s.sx, s.sy);
      ctx.lineTo(s.sx + 22, s.sy);
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.fillText(`${l.id} ${l.label.slice(0, 24)}`, Math.min(w - 70, s.sx + 26), s.sy);
    });
    ctx.globalAlpha = 1;
  });

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
    </div>
  );
}
