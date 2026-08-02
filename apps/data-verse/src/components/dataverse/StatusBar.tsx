import { useEffect, useState } from "react";
import { pad } from "@/lib/dataverse-data";

export function StatusBar() {
  const [clock, setClock] = useState("--:--:--.---");
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date();
      setClock(
        `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(
          d.getUTCSeconds(),
          2,
        )}.${pad(d.getUTCMilliseconds(), 3)}`,
      );
      setFrame((f) => (f + 1) % 100000);
    }, 66);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="dv-micro flex items-center justify-between gap-6 border-b border-dv-line px-4 py-2 text-dv-dim">
      <div className="flex items-center gap-6">
        <span className="text-dv-fg">DATA&#8202;-&#8202;VERSE / 02</span>
        <span className="hidden sm:inline">SYS ID 0x8F31&#8202;-&#8202;A</span>
      </div>
      <div className="flex items-center gap-6">
        <span className="hidden md:inline">35.6762N 139.6503E</span>
        <span className="tabular-nums text-dv-fg">UTC {clock}</span>
        <span className="tabular-nums">FRM {pad(frame, 5)}</span>
      </div>
    </header>
  );
}