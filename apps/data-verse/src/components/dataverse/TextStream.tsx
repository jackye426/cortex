import { useMemo } from "react";
import { useDataCanvas } from "@/lib/dataverse-canvas";
import { seeded } from "@/lib/dataverse-data";

const SETS = [
  "0123456789ABCDEF",
  "0123456789",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  "01",
  "0123456789.:-+/",
];

type Row = {
  text: string;
  speed: number;
  phase: number;
  alpha: number;
  invert: Array<[number, number]>;
  accent: number;
};

/** A wall of running code: dense rows of glyphs streaming horizontally. */
function build(rows: number, cols: number, seedTexts?: string[]) {
  const rnd = seeded(778811);
  const out: Row[] = [];
  for (let r = 0; r < rows; r++) {
    const set = SETS[Math.floor(rnd() * SETS.length)]!;
    let text = "";
    const seed =
      seedTexts && seedTexts.length > 0
        ? seedTexts[r % seedTexts.length]!.toUpperCase().replace(/[^A-Z0-9]+/g, "")
        : "";
    while (text.length < cols) {
      if (seed && rnd() < 0.55) {
        const slice = seed.slice(0, 4 + Math.floor(rnd() * 20)) || "CORTEX";
        text += slice + " ";
      } else if (rnd() < 0.22) {
        text += " ".repeat(1 + Math.floor(rnd() * 9));
      } else {
        const len = 2 + Math.floor(rnd() * 12);
        for (let i = 0; i < len; i++) text += set[Math.floor(rnd() * set.length)]!;
        text += " ";
      }
    }
    text = text.slice(0, cols);
    const invert: Array<[number, number]> = [];
    const blocks = Math.floor(rnd() * 4);
    for (let i = 0; i < blocks; i++) {
      const a = Math.floor(rnd() * cols);
      invert.push([a, a + 3 + Math.floor(rnd() * 22)]);
    }
    out.push({
      text,
      speed: (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 120),
      phase: rnd() * cols,
      alpha: 0.22 + rnd() * 0.78,
      invert,
      accent: rnd(),
    });
  }
  return out;
}

export function TextStream({
  cols = 900,
  seedTexts,
}: {
  cols?: number;
  bands?: number;
  perBand?: number;
  /** Cortex throughput snippets woven into the glyph wall. */
  seedTexts?: string[];
}) {
  const rows = useMemo(() => build(180, cols, seedTexts), [cols, seedTexts]);

  const { wrapRef, canvasRef } = useDataCanvas(({ ctx, w, h, t, fg, accent }) => {
    const rowH = 7;
    const fontPx = 8;
    ctx.font = `${fontPx}px ui-monospace, 'JetBrains Mono', monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const charW = ctx.measureText("0").width || fontPx * 0.6;
    const visible = Math.ceil(w / charW) + 2;
    const count = Math.min(rows.length, Math.ceil(h / rowH) + 1);

    for (let r = 0; r < count; r++) {
      const row = rows[r]!;
      const y = r * rowH + rowH / 2;
      const off = Math.floor(row.phase + t * row.speed);
      let s = "";
      for (let i = 0; i < visible; i++) {
        const idx = (((off + i) % cols) + cols) % cols;
        s += row.text[idx]!;
      }

      ctx.globalAlpha = row.alpha * (0.55 + 0.45 * Math.sin(t * 0.4 + r * 0.21) ** 2);
      ctx.fillStyle = fg;
      ctx.fillText(s, 0, y);

      for (const [a, b] of row.invert) {
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

      if (row.accent > 0.985) {
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

    ctx.globalAlpha = 1;
  });

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
    </div>
  );
}
