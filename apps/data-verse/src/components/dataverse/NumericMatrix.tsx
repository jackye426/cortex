import { seeded, hex } from "@/lib/dataverse-data";

type Props = { title: string; rows?: number; cols?: number; seed?: number };

export function NumericMatrix({ title, rows = 10, cols = 4, seed = 3319 }: Props) {
  const rnd = seeded(seed);
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => hex(rnd() * 65535)),
  );
  return (
    <div className="border-t border-dv-hair">
      <div className="dv-micro border-b border-dv-hair px-3 py-2 text-dv-faint">{title}</div>
      <div className="px-3 py-2">
        {grid.map((row, i) => (
          <div key={i} className="dv-micro flex justify-between tabular-nums text-dv-dim">
            {row.map((cell, j) => (
              <span key={j} className={(i + j) % 7 === 0 ? "text-dv-fg" : ""}>
                {cell}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
