import { useMemo } from "react";
import { useDataCanvas } from "@/lib/dataverse-canvas";
import { seeded, hex } from "@/lib/dataverse-data";

type P3 = { x: number; y: number; z: number; m: number };
type Edge = [number, number, number];

const DEFAULT_PLATFORMS = [
  "WEB",
  "MOBILE",
  "EDGE",
  "SENSOR",
  "SOCIAL",
  "LEDGER",
  "SAT",
  "AUDIO",
];

export type ChannelOverlay = { label: string; value: number };

/** Neuronal / cosmic-web filaments in 3D: cores linked by dendritic chains. */
function build(nodeCount: number) {
  const rnd = seeded(313377);
  const nodes: P3[] = [];
  const edges: Edge[] = [];

  const cores = Array.from({ length: 11 }, () => ({
    x: (rnd() - 0.5) * 1.7,
    y: (rnd() - 0.5) * 0.9,
    z: (rnd() - 0.5) * 1.2,
  }));

  // dendrites: random walks that leave a trail of points and links
  const perWalk = 26;
  const walks = Math.floor(nodeCount / perWalk);
  for (let s = 0; s < walks; s++) {
    const c = cores[Math.floor(rnd() * cores.length)]!;
    let x = c.x + (rnd() - 0.5) * 0.16;
    let y = c.y + (rnd() - 0.5) * 0.16;
    let z = c.z + (rnd() - 0.5) * 0.16;
    let dx = (rnd() - 0.5) * 0.05;
    let dy = (rnd() - 0.5) * 0.05;
    let dz = (rnd() - 0.5) * 0.05;
    let prev = -1;
    for (let i = 0; i < perWalk; i++) {
      dx += (rnd() - 0.5) * 0.022;
      dy += (rnd() - 0.5) * 0.018;
      dz += (rnd() - 0.5) * 0.022;
      // gentle pull back toward the core keeps clusters dense
      dx -= (x - c.x) * 0.012;
      dy -= (y - c.y) * 0.012;
      dz -= (z - c.z) * 0.012;
      x += dx;
      y += dy;
      z += dz;
      const idx = nodes.length;
      nodes.push({ x, y, z, m: 1 - i / perWalk + rnd() * 0.25 });
      if (prev >= 0) edges.push([prev, idx, 0.35 + rnd() * 0.65]);
      prev = idx;
    }
  }

  // diffuse halo dust
  for (let i = 0; i < nodeCount * 1.1; i++) {
    const g = () => (rnd() + rnd() + rnd() - 1.5) * 0.9;
    nodes.push({ x: g() * 1.3, y: g() * 0.7, z: g(), m: rnd() * 0.35 });
  }

  return { nodes, edges };
}

function hot(v: number, a: number) {
  // deep crimson -> orange -> incandescent yellow-white
  const k = Math.min(1, Math.max(0, v));
  const r = 150 + 105 * Math.min(1, k * 1.6);
  const g = 20 + 200 * Math.max(0, k - 0.25) ** 1.3;
  const b = 10 + 190 * Math.max(0, k - 0.72) ** 1.6;
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export function InsightField({
  nodeCount = 4600,
  channels,
  halfLabels = { top: "OPS", bottom: "REFL" },
}: {
  nodeCount?: number | undefined;
  /** Cortex source-family bars — labels/values only; topology stays generative. */
  channels?: ChannelOverlay[] | undefined;
  halfLabels?: { top: string; bottom: string } | undefined;
}) {
  const { nodes, edges } = useMemo(() => build(nodeCount), [nodeCount]);
  const platforms = useMemo(() => {
    if (!channels?.length) {
      return DEFAULT_PLATFORMS.map((label) => ({ label, value: -1 }));
    }
    return channels.slice(0, 8).map((c) => ({
      label: c.label.slice(0, 10).toUpperCase(),
      value: Math.min(1, Math.max(0, c.value)),
    }));
  }, [channels]);

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

      // filaments
      ctx.lineWidth = 1;
      for (const [a, b, wgt] of edges) {
        const pa = proj[a * 3 + 2]!;
        const pb = proj[b * 3 + 2]!;
        const depth = (pa + pb) / 2;
        const heat = (depth - 0.72) * 1.55 * wgt;
        ctx.strokeStyle = hot(heat, 0.1 + wgt * 0.18 * depth);
        ctx.beginPath();
        ctx.moveTo(cx + proj[a * 3]!, oy + sign * (proj[a * 3 + 1]! + scale * 0.42));
        ctx.lineTo(cx + proj[b * 3]!, oy + sign * (proj[b * 3 + 1]! + scale * 0.42));
        ctx.stroke();
      }

      // nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const p = proj[i * 3 + 2]!;
        const x = cx + proj[i * 3]!;
        const y = oy + sign * (proj[i * 3 + 1]! + scale * 0.42);
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
        const heat = (p - 0.7) * 1.7 + n.m * 0.5;
        const s = n.m > 0.85 ? 1.8 * p : 1 * p;
        ctx.fillStyle = hot(heat, 0.25 + n.m * 0.6);
        ctx.fillRect(x, y, s, s);
        if (n.m > 0.93) {
          ctx.fillStyle = hot(heat + 0.5, 0.16);
          ctx.fillRect(x - 2, y - 2, s + 4, s + 4);
        }
      }
    }

    ctx.globalCompositeOperation = "source-over";

    // horizon rule + registration frame stay austere white/red
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.1, cy);
    ctx.lineTo(cx + w * 0.1, cy);
    ctx.stroke();

    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(8.5, 8.5, w - 17, h - 17);
    for (const [mx, my] of [
      [8.5, 8.5],
      [w - 8.5, 8.5],
      [8.5, h - 8.5],
      [w - 8.5, h - 8.5],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(mx - 5, my);
      ctx.lineTo(mx + 5, my);
      ctx.moveTo(mx, my - 5);
      ctx.lineTo(mx, my + 5);
      ctx.stroke();
    }

    ctx.font = "9px ui-monospace, 'JetBrains Mono', monospace";
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    platforms.forEach((p, i) => {
      const y = 24 + i * 13;
      const v =
        p.value < 0
          ? (Math.sin(t * 0.5 + i) * 0.5 + 0.5) * 100
          : p.value * 100;
      ctx.globalAlpha = 0.5;
      ctx.fillText(
        `${p.label.padEnd(10, " ")} ${v.toFixed(3)}%  ${hex(v * 600)}`,
        20,
        y,
      );
      ctx.globalAlpha = 0.25;
      ctx.fillRect(170, y - 2, v * 0.6, 2);
    });

    ctx.textAlign = "right";
    ctx.globalAlpha = 0.5;
    ctx.fillText(`NODES ${nodes.length} / LINKS ${edges.length}`, w - 20, 24);
    ctx.fillText(`CORRELATION ${(0.6 + Math.sin(t * 0.3) * 0.2).toFixed(6)}`, w - 20, 37);
    ctx.fillText(`ROT.Y ${((t * 0.075) % (Math.PI * 2)).toFixed(3)} RAD`, w - 20, 50);
    ctx.fillText(`${halfLabels.top} ▲ / ${halfLabels.bottom} ▼`, w - 20, 63);
    ctx.globalAlpha = 1;
  });

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
    </div>
  );
}
