import { tickerSamples } from "@/lib/dataverse-data";

export function Ticker({ lines }: { lines?: string[] }) {
  const base = lines && lines.length > 0 ? lines : tickerSamples;
  const stream = [...base, ...base];
  return (
    <footer className="relative overflow-hidden border-t border-dv-line">
      <div
        className="dv-anim dv-micro flex w-max gap-6 whitespace-nowrap py-2 tabular-nums text-dv-dim"
        style={{ animation: "dv-marquee 48s linear infinite" }}
      >
        {stream.map((s, i) => (
          <span key={i} className={i % 5 === 0 ? "text-dv-fg" : ""}>
            {s}
          </span>
        ))}
      </div>
    </footer>
  );
}
