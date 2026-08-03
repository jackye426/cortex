import { useEffect, useRef } from "react";

export type DrawCtx = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  t: number;
  frame: number;
  fg: string;
  accent: string;
};

/** Shared resize + rAF plumbing for every data-verse canvas view. */
export function useDataCanvas(draw: (d: DrawCtx) => void) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 1;
    let h = 1;
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

    const css = getComputedStyle(document.documentElement);
    const fg = css.getPropertyValue("--dv-fg").trim() || "#fff";
    const accent = css.getPropertyValue("--dv-accent").trim() || "#ff3b30";

    let raf = 0;
    let frame = 0;
    const start = performance.now();

    const loop = (now: number) => {
      frame++;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = "9px ui-monospace, 'JetBrains Mono', monospace";
      ctx.textBaseline = "middle";
      drawRef.current({
        ctx,
        w,
        h,
        t: reduced ? 0 : (now - start) / 1000,
        frame,
        fg,
        accent,
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return { wrapRef, canvasRef };
}
