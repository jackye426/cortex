import type { VizMeter } from "@cortex/viz-contracts";

type Props = {
  meters?: VizMeter[];
  title?: string;
  activeId?: string;
  onSelect?: (id: string) => void;
};

export function IndexColumn({
  meters = [],
  title = "INDEX",
  activeId,
  onSelect,
}: Props) {
  return (
    <aside className="flex min-h-0 flex-col">
      <div className="dv-micro border-b border-dv-hair px-3 py-2 text-dv-faint">
        {title} / N={meters.length}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {meters.map((row, i) => {
          const active = activeId ? row.id === activeId : i === 0;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect?.(row.id)}
              className={`dv-micro flex w-full items-center justify-between gap-3 border-b border-dv-hair px-3 py-[6px] text-left tabular-nums ${
                active ? "bg-dv-fg text-dv-bg" : "text-dv-dim hover:text-dv-fg"
              }`}
            >
              <span className={active ? "" : "text-dv-faint"}>{row.id}</span>
              <span className="flex-1 truncate">{row.label}</span>
              <span>{row.value.toFixed(4)}</span>
            </button>
          );
        })}
      </div>
      <div className="dv-micro border-t border-dv-hair px-3 py-2 text-dv-faint">
        SET / COMPLETE
      </div>
    </aside>
  );
}
