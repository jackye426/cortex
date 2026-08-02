import type { ReactNode } from "react";
import { StatusBar } from "./StatusBar";
import { ModeNav } from "./ModeNav";
import { Ticker } from "./Ticker";

type Props = { title: string; children: ReactNode };

export function DvFrame({ title, children }: Props) {
  return (
    <main className="relative flex h-screen flex-col overflow-hidden bg-dv-bg font-mono text-dv-fg">
      <div className="dv-lattice pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="dv-interlace pointer-events-none absolute inset-0 z-50" aria-hidden="true" />
      <div
        className="dv-anim pointer-events-none absolute inset-x-0 z-50 h-24 bg-gradient-to-b from-transparent via-white/[0.04] to-transparent"
        style={{ animation: "dv-scan 7s linear infinite" }}
        aria-hidden="true"
      />
      <h1 className="sr-only">{title}</h1>
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <StatusBar />
        <ModeNav />
        {children}
        <Ticker />
      </div>
    </main>
  );
}
