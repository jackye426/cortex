import type { VizDensity } from "@cortex/viz-contracts";
import { useDataCanvas } from "@/lib/dataverse-canvas";
import { pad } from "@/lib/fixtures";

type Props = {
  density?: VizDensity;
  annotations?: boolean;
  caption?: string;
  spin?: number;
};

export function BrainField({
  density,
  annotations = true,
  caption = "VOLUME 01 / STRUCTURE ENCEPHALON / SAMPLING CONTINUOUS",
  spin = 0.14,
}: Props) {
  const points = density?.points ?? [];
  const nodes = density?.annotations ?? [];

  const { wrapRef, canvasRef } = useDataCanvas(({ ctx, w, h, t, fg, accent }) => {
    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h) * 0.34;
    const ry = t * spin;
    const rx = Math.sin(t * 0.07) * 0.22 - 0.06;
    const breathe = 1 + Math.sin(t * 0.23) * 0.012;
    const cosY = Math.cos(ry);
    const sinY = Math.sin(ry);
    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);
    const camera = 3.4;

    const project = (x: number, y: number, z: number) => {
      x *= breathe;
      y *= breathe;
      z *= breathe;
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const y1 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;
      const p = camera / (camera - z2);
      return { sx: cx + x1 * scale * p, sy: cy - y1 * scale * p, depth: z2, p };
    };

    ctx.fillStyle = fg;
    for (const pt of points) {
      const s = project(pt.x, pt.y, pt.z);
      ctx.globalAlpha = Math.min(
        1,
        (pt.a ?? 0.6) * (0.25 + ((s.depth + 1.2) / 2.4) * 0.75),
      );
      const size = (pt.s ?? 1) * s.p;
      ctx.fillRect(s.sx, s.sy, size, size);
    }

    if (annotations) {
      ctx.textAlign = "left";
      for (const n of nodes) {
        const s = project(n.x, n.y, n.z);
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = accent;
        ctx.beginPath();
        ctx.moveTo(s.sx, s.sy);
        ctx.lineTo(s.sx + 28, s.sy - 10);
        ctx.stroke();
        ctx.fillStyle = fg;
        ctx.fillText(`${n.id} ${n.label.slice(0, 24)}`, s.sx + 32, s.sy - 10);
      }
    }

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.fillText(caption, 12, 16);
    ctx.textAlign = "right";
    ctx.fillText(`N ${pad(points.length, 4)}`, w - 12, 16);
    ctx.globalAlpha = 1;
  });

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
    </div>
  );
}
