import type { VizDensity } from "@cortex/viz-contracts";
import { useDataCanvas } from "@/lib/dataverse-canvas";

type Props = { density?: VizDensity };

export function TextStream({ density }: Props) {
  const rows = density?.streamRows ?? [];

  const { wrapRef, canvasRef } = useDataCanvas(({ ctx, w, h, t, fg, accent }) => {
    const rowH = 7;
    const fontPx = 8;
    ctx.font = `${fontPx}px ui-monospace, 'JetBrains Mono', monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const charW = ctx.measureText("0").width || fontPx * 0.6;
    const visible = Math.ceil(w / charW) + 2;
    const count = Math.min(rows.length, Math.ceil(h / rowH) + 1);
    const cols = rows[0]?.text.length || 200;

    for (let r = 0; r < count; r++) {
      const row = rows[r]!;
      const y = r * rowH + rowH / 2;
      const speed = row.speed ?? 40;
      const phase = row.phase ?? 0;
      const off = Math.floor(phase + t * speed);
      let s = "";
      for (let i = 0; i < visible; i++) {
        const idx = (((off + i) % cols) + cols) % cols;
        s += row.text[idx] ?? " ";
      }

      ctx.globalAlpha = (row.alpha ?? 0.6) * (0.55 + 0.45 * Math.sin(t * 0.4 + r * 0.21) ** 2);
      ctx.fillStyle = fg;
      ctx.fillText(s, 0, y);

      for (const [a, b] of row.invert ?? []) {
        const x0 = (((a - off) % cols) + cols) % cols;
        if (x0 > visible) continue;
        const len = Math.min(b - a, visible - x0);
        if (len <= 0) continue;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = fg;
        ctx.fillRect(x0 * charW, y - rowH / 2 + 0.5, len * charW, rowH - 1);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000";
        ctx.fillText(s.slice(x0, x0 + len), x0 * charW, y);
      }

      if (row.accent) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = accent;
        ctx.fillText(s, 0, y);
      }
    }

    const sweep = ((t * 0.06) % 1) * (w + 300) - 150;
    const grad = ctx.createLinearGradient(sweep - 150, 0, sweep + 150, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
    </div>
  );
}
