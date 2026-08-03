import type { VizMeter } from "@cortex/viz-contracts";
import { indexRows } from "@/lib/dataverse-data";

type Props = {
  meters?: VizMeter[];
  title?: string;
  activeId?: string;
  onSelect?: (id: string) => void;
};

export function IndexColumn({
  meters,
  title = "INDEX",
  activeId,
  onSelect,
}: Props) {
  const rows =
    meters && meters.length > 0
      ? meters
      : indexRows.map((r) => ({ id: r.id, label: r.label, value: r.value }));

  return (
    <aside className="flex min-h-0 flex-col">
      <div className="dv-micro border-b border-dv-hair px-3 py-2 text-dv-faint">
        {title} / N={rows.length}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.map((row, i) => {
          const active = activeId ? row.id === activeId : !onSelect && i === 6;
          const className = `dv-micro flex w-full items-center justify-between gap-3 border-b border-dv-hair px-3 py-[6px] text-left tabular-nums ${
            active ? "bg-dv-fg text-dv-bg" : "text-dv-dim hover:text-dv-fg"
          }`;
          if (onSelect) {
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelect(row.id)}
                className={className}
              >
                <span className={active ? "" : "text-dv-faint"}>{row.id}</span>
                <span className="flex-1 truncate">{row.label}</span>
                <span>{row.value.toFixed(4)}</span>
              </button>
            );
          }
          return (
            <div key={row.id} className={className}>
              <span className={active ? "" : "text-dv-faint"}>{row.id}</span>
              <span className="flex-1 truncate">{row.label}</span>
              <span>{row.value.toFixed(4)}</span>
            </div>
          );
        })}
      </div>
      <div className="dv-micro border-t border-dv-hair px-3 py-2 text-dv-faint">
        SET / COMPLETE
      </div>
    </aside>
  );
}
