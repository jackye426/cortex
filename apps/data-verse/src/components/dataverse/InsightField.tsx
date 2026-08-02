import type { VizDensity } from "@cortex/viz-contracts";
import { useDataCanvas } from "@/lib/dataverse-canvas";
import { hex } from "@/lib/fixtures";

type Props = { density?: VizDensity };

function hot(v: number, a: number) {
  const k = Math.min(1, Math.max(0, v));
  const r = 150 + 105 * Math.min(1, k * 1.6);
  const g = 20 + 200 * Math.max(0, k - 0.25) ** 1.3;
  const b = 10 + 190 * Math.max(0, k - 0.72) ** 1.6;
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export function InsightField({ density }: Props) {
  const nodes = density?.points ?? [];
  const edges = density?.edges ?? [];
  const bars = density?.channelBars ?? [];

  const { wrapRef, canvasRef } = useDataCanvas(({ ctx, w, h, t, fg, accent }) => {
    const cx = w / 2;
    const cy = h / 2;
    const gap = h * 0.045;
    const cam = 3.1;
    const scale = Math.min(w * 0.32, h * 0.55);
    const ry = t * 0.075;
    const rx = Math.sin(t * 0.05) * 0.22;
    const cosY = Math.cos(ry);
    const sinY = Math.sin(ry);
    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);

    const proj = new Float32Array(nodes.length * 3);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const x1 = n.x * cosY - n.z * sinY;
      const z1 = n.x * sinY + n.z * cosY;
      const y1 = n.y * cosX - z1 * sinX;
      const z2 = n.y * sinX + z1 * cosX;
      const p = cam / (cam - z2);
      proj[i * 3] = x1 * p * scale;
      proj[i * 3 + 1] = y1 * p * scale;
      proj[i * 3 + 2] = p;
    }

    ctx.globalCompositeOperation = "lighter";
    for (const sign of [-1, 1] as const) {
      const oy = cy + sign * gap;
      ctx.lineWidth = 1;
      for (const e of edges) {
        if (e.a >= nodes.length || e.b >= nodes.length) continue;
        const pa = proj[e.a * 3 + 2]!;
        const pb = proj[e.b * 3 + 2]!;
        const depth = (pa + pb) / 2;
        const heat = (depth - 0.72) * 1.55 * e.weight;
        ctx.strokeStyle = hot(heat, 0.1 + e.weight * 0.18 * depth);
        ctx.beginPath();
        ctx.moveTo(cx + proj[e.a * 3]!, oy + sign * (proj[e.a * 3 + 1]! + scale * 0.42));
        ctx.lineTo(cx + proj[e.b * 3]!, oy + sign * (proj[e.b * 3 + 1]! + scale * 0.42));
        ctx.stroke();
      }
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const p = proj[i * 3 + 2]!;
        const x = cx + proj[i * 3]!;
        const y = oy + sign * (proj[i * 3 + 1]! + scale * 0.42);
        const heat = (p - 0.7) * 1.7 + (n.a ?? 0.4) * 0.5;
        const s = (n.a ?? 0.4) > 0.85 ? 1.8 * p : 1 * p;
        ctx.fillStyle = hot(heat, 0.25 + (n.a ?? 0.4) * 0.6);
        ctx.fillRect(x, y, s, s);
      }
    }
    ctx.globalCompositeOperation = "source-over";

    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = fg;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.1, cy);
    ctx.lineTo(cx + w * 0.1, cy);
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.strokeRect(8.5, 8.5, w - 17, h - 17);

    ctx.font = "9px ui-monospace, 'JetBrains Mono', monospace";
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    bars.forEach((b, i) => {
      const y = 24 + i * 13;
      const v = b.value * 100;
      ctx.globalAlpha = 0.5;
      ctx.fillText(`${b.label.padEnd(14, " ").slice(0, 14)} ${v.toFixed(3)}%  ${hex(v * 600)}`, 20, y);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(170, y - 2, v * 0.6, 2);
    });
    ctx.textAlign = "right";
    ctx.globalAlpha = 0.5;
    ctx.fillText(`NODES ${nodes.length} / LINKS ${edges.length}`, w - 20, 24);
    ctx.globalAlpha = 1;
  });

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
    </div>
  );
}
