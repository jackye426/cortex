import type { VizMeter } from "@cortex/viz-contracts";
import { hex } from "@/lib/fixtures";

type Props = { meters?: VizMeter[]; title?: string };

export function ReadoutColumn({ meters = [], title = "READOUT" }: Props) {
  return (
    <aside className="flex min-h-0 flex-col">
      <div className="dv-micro border-b border-dv-hair px-3 py-2 text-dv-faint">
        {title} / CH {meters.length}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {meters.map((c) => (
          <div key={c.id} className="border-b border-dv-hair px-3 py-3">
            <div className="dv-micro flex items-center justify-between text-dv-faint">
              <span>
                {c.id} / {c.label}
              </span>
              <span>{hex(c.value * 65535)}</span>
            </div>
            <div className="mt-2 font-mono text-[18px] leading-none tabular-nums text-dv-fg">
              {c.value.toFixed(6)}
            </div>
            <div className="mt-2 h-[3px] w-full bg-dv-hair">
              <div className="h-full bg-dv-fg" style={{ width: `${c.value * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="dv-micro border-t border-dv-hair px-3 py-2 text-dv-faint">
        SIGNAL / NOMINAL
      </div>
    </aside>
  );
}
