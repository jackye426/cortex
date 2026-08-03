import { useEffect, useMemo, useState } from "react";
import type { VizMeter } from "@cortex/viz-contracts";
import { readoutChannels, hex } from "@/lib/dataverse-data";

type Props = { meters?: VizMeter[]; title?: string };

export function ReadoutColumn({ meters, title = "READOUT" }: Props) {
  const live = Boolean(meters && meters.length > 0);
  const base = useMemo(
    () =>
      live
        ? meters!
        : readoutChannels.map((c) => ({ id: c.id, label: c.label, value: c.value })),
    [live, meters],
  );

  const [values, setValues] = useState(base.map((c) => c.value));

  useEffect(() => {
    setValues(base.map((c) => c.value));
  }, [base]);

  useEffect(() => {
    if (live) return;
    const id = window.setInterval(() => {
      setValues((prev) =>
        prev.map((v) => {
          const next = v + (Math.random() - 0.5) * 0.12;
          return Math.min(1, Math.max(0, next));
        }),
      );
    }, 420);
    return () => window.clearInterval(id);
  }, [live]);

  return (
    <aside className="flex min-h-0 flex-col">
      <div className="dv-micro border-b border-dv-hair px-3 py-2 text-dv-faint">
        {title} / CH {base.length}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {base.map((c, i) => {
          const v = values[i] ?? c.value;
          return (
            <div key={c.id} className="border-b border-dv-hair px-3 py-3">
              <div className="dv-micro flex items-center justify-between text-dv-faint">
                <span>
                  {c.id} / {c.label}
                </span>
                <span>{hex(v * 65535)}</span>
              </div>
              <div className="mt-2 font-mono text-[18px] leading-none tabular-nums text-dv-fg">
                {v.toFixed(6)}
              </div>
              <div className="mt-2 h-[3px] w-full bg-dv-hair">
                <div
                  className="h-full bg-dv-fg transition-[width] duration-300 ease-linear"
                  style={{ width: `${v * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="dv-micro border-t border-dv-hair px-3 py-2 text-dv-faint">
        SIGNAL / NOMINAL
      </div>
    </aside>
  );
}
