import type { VizDensity } from "@cortex/viz-contracts";
import { useDataCanvas } from "@/lib/dataverse-canvas";
import { pad } from "@/lib/fixtures";

type Props = { density?: VizDensity; cols?: number; rows?: number };

export function ScanSlices({ density, cols = 8, rows = 4 }: Props) {
  const points = density?.points ?? [];
  const sliceDefs =
    density?.slices?.length && density.slices.length >= cols * rows
      ? density.slices.slice(0, cols * rows)
      : Array.from({ length: cols * rows }, (_, i) => ({
          pos: 1.15 - (i / Math.max(1, cols * rows - 1)) * 2.3,
        }));

  const { wrapRef, canvasRef } = useDataCanvas(({ ctx, w, h, t, fg }) => {
    const cw = w / cols;
    const ch = h / rows;
    const active = Math.floor(t * 2) % sliceDefs.length;

    ctx.strokeStyle = fg;
    ctx.fillStyle = fg;
    ctx.lineWidth = 1;

    sliceDefs.forEach((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x0 = col * cw;
      const y0 = row * ch;
      const cx = x0 + cw / 2;
      const cy = y0 + ch / 2;
      const scale = Math.min(cw, ch) * 0.32;
      const isActive = i === active;
      const slab = 0.075;

      ctx.globalAlpha = isActive ? 0.3 : 0.09;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);

      ctx.globalAlpha = isActive ? 1 : 0.55;
      for (const p of points) {
        if (Math.abs(p.x - s.pos) < slab) {
          ctx.fillRect(cx + p.z * scale, cy - p.y * scale, 1, 1);
        }
      }

      ctx.globalAlpha = isActive ? 0.9 : 0.35;
      ctx.textAlign = "left";
      ctx.fillText(`S${pad(i + 1, 3)}`, x0 + 6, y0 + 10);
      ctx.textAlign = "right";
      ctx.fillText(`X ${s.pos.toFixed(3)}`, x0 + cw - 6, y0 + ch - 9);

      if (isActive) {
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(x0 + 4, cy);
        ctx.lineTo(x0 + cw - 4, cy);
        ctx.moveTo(cx, y0 + 4);
        ctx.lineTo(cx, y0 + ch - 4);
        ctx.stroke();
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
