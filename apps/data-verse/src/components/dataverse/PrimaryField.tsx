import { useRef, useState } from "react";
import { swarm as defaultSwarm, pad } from "@/lib/dataverse-data";

type SwarmPoint = { x: number; y: number; r: number };

const TICKS = Array.from({ length: 21 }, (_, i) => i / 20);

type Props = {
  swarm?: SwarmPoint[] | undefined;
  label?: string | undefined;
  /** Axis meaning. The plot always had real axes; nothing ever said so. */
  axes?: { x: string; y: string } | undefined;
};

export function PrimaryField({
  swarm,
  label = "FIELD 01 / PROJECTION ORTHO",
  axes,
}: Props) {
  const points = swarm && swarm.length > 0 ? swarm : defaultSwarm;
  const ref = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  return (
    <section
      ref={ref}
      // h-full, not flex-1: every child is absolutely positioned, so in a grid
      // cell (which is how the ledger mounts this) flex-1 does nothing and the
      // section collapses to zero height — the plot never drew at all.
      className="relative h-full min-h-0 overflow-hidden"
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        setCursor({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
      }}
      onMouseLeave={() => setCursor(null)}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {TICKS.map((t) => (
          <g key={`v${t}`}>
            <line
              x1={t * 1000}
              y1={0}
              x2={t * 1000}
              y2={1000}
              stroke="var(--dv-hair)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={0}
              y1={t * 1000}
              x2={1000}
              y2={t * 1000}
              stroke="var(--dv-hair)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x * 1000}
            cy={p.y * 1000}
            r={p.r}
            fill="var(--dv-fg)"
            opacity={p.r > 1 ? 1 : 0.55}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Crosshair on the largest mark so the selected row is findable. */}
        {points.length <= 60
          ? points
              .filter((p) => p.r >= 12)
              .map((p, i) => (
                <g key={`sel${i}`} stroke="var(--dv-accent)" strokeWidth={1}>
                  <line
                    x1={p.x * 1000 - 40}
                    y1={p.y * 1000}
                    x2={p.x * 1000 + 40}
                    y2={p.y * 1000}
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={p.x * 1000}
                    y1={p.y * 1000 - 40}
                    x2={p.x * 1000}
                    y2={p.y * 1000 + 40}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))
          : null}
      </svg>

      <div className="dv-micro pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-1 pb-1 text-dv-faint">
        {TICKS.filter((_, i) => i % 4 === 0).map((t) => (
          <span key={t}>{t.toFixed(2)}</span>
        ))}
      </div>
      <div className="dv-micro pointer-events-none absolute inset-y-0 left-1 flex flex-col justify-between py-1 text-dv-faint">
        {TICKS.filter((_, i) => i % 4 === 0).map((t) => (
          <span key={t}>{(1 - t).toFixed(2)}</span>
        ))}
      </div>

      <div
        className="dv-anim pointer-events-none absolute inset-y-0 left-0 w-px bg-dv-fg/60"
        style={{ animation: "dv-sweep 9s linear infinite" }}
      />

      {cursor && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-y-0 w-px bg-dv-line" style={{ left: `${cursor.x * 100}%` }} />
          <div className="absolute inset-x-0 h-px bg-dv-line" style={{ top: `${cursor.y * 100}%` }} />
          <span
            className="dv-micro absolute tabular-nums text-dv-fg"
            style={{
              left: `calc(${cursor.x * 100}% + 6px)`,
              top: `calc(${cursor.y * 100}% + 6px)`,
            }}
          >
            X {cursor.x.toFixed(5)} / Y {(1 - cursor.y).toFixed(5)}
          </span>
        </div>
      )}

      <div className="dv-micro pointer-events-none absolute right-3 top-2 text-right text-dv-faint">
        <div>{label}</div>
        <div>N {pad(points.length, 4)} SAMPLES</div>
      </div>

      {axes ? (
        <>
          <div className="dv-micro pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-dv-faint">
            {axes.x} →
          </div>
          <div className="dv-micro pointer-events-none absolute left-10 top-1/2 origin-left -rotate-90 text-dv-faint">
            {axes.y} →
          </div>
        </>
      ) : null}
    </section>
  );
}
