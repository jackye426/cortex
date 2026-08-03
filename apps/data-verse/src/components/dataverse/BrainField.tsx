import { useEffect, useMemo, useRef } from "react";
import { brainCloud, brainNodes } from "@/lib/dataverse-brain";
import { hex, pad } from "@/lib/dataverse-data";

export type BrainNodeOverlay = {
  id: string;
  label: string;
  x?: number;
  y?: number;
  z?: number;
};

type Props = {
  annotations?: boolean | undefined;
  caption?: string | undefined;
  spin?: number | undefined;
  /** Cortex labels mapped onto anatomical anchors — geometry stays generative. */
  nodeOverlays?: BrainNodeOverlay[] | undefined;
};

export function BrainField({
  annotations = true,
  caption = "VOLUME 01 / STRUCTURE ENCEPHALON / SAMPLING CONTINUOUS",
  spin = 0.14,
  nodeOverlays,
}: Props) {
  const POINTS = brainCloud(9000);
  const nodes = useMemo(() => {
    if (!nodeOverlays?.length) return brainNodes;
    return brainNodes.map((anchor, i) => {
      const o = nodeOverlays[i % nodeOverlays.length]!;
      return {
        ...anchor,
        id: o.id || anchor.id,
        label: o.label || anchor.label,
        x: o.x ?? anchor.x,
        y: o.y ?? anchor.y,
        z: o.z ?? anchor.z,
      };
    });
  }, [nodeOverlays]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const fg = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--dv-fg").trim() ||
      "#fff";

    let raf = 0;
    let frame = 0;
    const start = performance.now();

    const render = (now: number) => {
      frame++;
      const t = reduced ? 0 : (now - start) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) * 0.38;
      const ry = t * spin;
      const rx = Math.sin(t * 0.11) * 0.35;
      const cosY = Math.cos(ry);
      const sinY = Math.sin(ry);
      const cosX = Math.cos(rx);
      const sinX = Math.sin(rx);
      const camera = 3.4;

      const project = (x: number, y: number, z: number) => {
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;
        const y1 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        const p = camera / (camera - z2);
        return {
          sx: cx + x1 * scale * p,
          sy: cy - y1 * scale * p,
          depth: z2,
          p,
        };
      };

      const color = fg();
      ctx.fillStyle = color;
      for (let i = 0; i < POINTS.length; i++) {
        const pt = POINTS[i]!;
        const { sx, sy, depth, p } = project(pt.x, pt.y, pt.z);
        const shade = 0.18 + ((depth + 1.2) / 2.4) * 0.82;
        ctx.globalAlpha = Math.min(1, pt.a * shade * 1.25);
        const s = pt.s * p * (dpr > 1 ? 1.05 : 1.2);
        ctx.fillRect(sx, sy, s, s);
      }
      ctx.globalAlpha = 1;

      const c = 1.18;
      const corners: Array<[number, number, number]> = [
        [-c, -c, -c], [c, -c, -c], [c, c, -c], [-c, c, -c],
        [-c, -c, c], [c, -c, c], [c, c, c], [-c, c, c],
      ];
      const edges: Array<[number, number]> = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
      const proj = corners.map(([x, y, z]) => project(x, y, z));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      for (const [a, b] of edges) {
        const A = proj[a]!;
        const B = proj[b]!;
        ctx.moveTo(A.sx, A.sy);
        ctx.lineTo(B.sx, B.sy);
      }
      ctx.stroke();

      ctx.font = "9px ui-monospace, 'JetBrains Mono', monospace";
      ctx.textBaseline = "middle";
      if (annotations) {
        nodes.forEach((n, i) => {
          const { sx, sy, depth } = project(n.x, n.y, n.z);
          const front = depth > -0.15;
          const dir = i % 2 === 0 ? 1 : -1;
          const lxRaw = sx + dir * (46 + (i % 3) * 26);
          const lx = Math.min(w - 200, Math.max(200, lxRaw));
          const ly = sy - 26 + i * 6;

          ctx.globalAlpha = front ? 0.55 : 0.18;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(lx, ly);
          ctx.lineTo(lx + dir * 54, ly);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
          ctx.stroke();

          ctx.globalAlpha = front ? 0.85 : 0.28;
          let tx = lx + dir * 58;
          let align: CanvasTextAlign = dir === 1 ? "left" : "right";
          if (align === "left" && tx > w - 170) {
            align = "right";
            tx = Math.min(lx - 8, w - 8);
          } else if (align === "right" && tx < 170) {
            align = "left";
            tx = Math.max(lx + 8, 8);
          }
          ctx.textAlign = align;
          ctx.fillText(`${n.id} ${n.label}`, tx, ly - 7);
          ctx.fillText(
            `${hex((depth + 1.5) * 20000)} / D ${depth.toFixed(4)}`,
            tx,
            ly + 5,
          );
        });
      }

      ctx.globalAlpha = 0.42;
      ctx.textAlign = "left";
      ctx.fillText(`ROT.Y ${(((ry * 180) / Math.PI) % 360).toFixed(3)}`, 12, 16);
      ctx.fillText(`ROT.X ${((rx * 180) / Math.PI).toFixed(3)}`, 12, 28);
      ctx.fillText(`VERT ${pad(POINTS.length, 6)}`, 12, 40);
      ctx.textAlign = "right";
      ctx.fillText(`FRM ${pad(frame, 6)}`, w - 12, 16);
      ctx.fillText(`SCALE ${scale.toFixed(2)}px/u`, w - 12, 28);
      ctx.fillText(`PROJ PERSP f=${camera.toFixed(2)}`, w - 12, 40);
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [POINTS, annotations, spin, nodes]);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
      <div className="dv-micro pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-dv-faint">
        {caption}
      </div>
    </div>
  );
}
