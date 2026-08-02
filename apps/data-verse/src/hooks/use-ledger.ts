import { useEffect, useState } from "react";
import type { VizLedger, VizLedgerChannel } from "@cortex/viz-contracts";
import { loadLedger } from "@/lib/viz-api";
import { fixtureLedger } from "@/lib/fixtures";

export function useLedger(channel: VizLedgerChannel): VizLedger {
  const [data, setData] = useState<VizLedger>(() => fixtureLedger(channel));
  useEffect(() => {
    let cancelled = false;
    void loadLedger(channel).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [channel]);
  return data;
}
