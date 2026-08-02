/** Tiny source/degraded strip — never silent about fixture fallback. */
export function SourceStrip({
  source,
  degraded,
}: {
  source: string;
  degraded?: boolean;
}) {
  return (
    <div
      className={`dv-micro border-b border-dv-hair px-3 py-1 tabular-nums ${
        degraded ? "bg-dv-accent/20 text-dv-accent" : "text-dv-faint"
      }`}
    >
      SRC/{source}
      {degraded ? " · DEGRADED · FIXTURE OVERLAY" : ""}
    </div>
  );
}
