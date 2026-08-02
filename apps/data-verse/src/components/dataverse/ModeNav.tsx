import { Link } from "@tanstack/react-router";

const MODES = [
  { to: "/", id: "00", label: "INDEX" },
  { to: "/scan", id: "01", label: "SCAN / ENCEPHALON" },
  { to: "/particles", id: "02", label: "PARTICLE / ORBITAL" },
  { to: "/insights", id: "03", label: "CROSS-PLATFORM" },
  { to: "/streams", id: "04", label: "TEXT / STRUCTURE" },
  { to: "/ledger", id: "05", label: "LEDGER / MIRROR" },
] as const;

export function ModeNav() {
  return (
    <nav className="dv-micro flex items-stretch overflow-x-auto border-b border-dv-line text-dv-faint">
      {MODES.map((m) => (
        <Link
          key={m.to}
          to={m.to}
          activeOptions={{ exact: true }}
          activeProps={{ className: "bg-dv-fg text-dv-bg" }}
          inactiveProps={{ className: "hover:text-dv-fg" }}
          className="flex items-center gap-2 whitespace-nowrap border-r border-dv-hair px-3 py-2 transition-colors"
        >
          <span className="tabular-nums opacity-70">{m.id}</span>
          <span>{m.label}</span>
        </Link>
      ))}
    </nav>
  );
}
