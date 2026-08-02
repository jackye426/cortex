import { useEffect, useState } from "react";
import type { VizLedger, VizLedgerChannel } from "@cortex/viz-contracts";
import { loadLedger } from "@/lib/viz-api";
import { fixtureLedger } from "@/lib/fixtures";

export type LedgerState = {
  data: VizLedger;
  degraded: boolean;
  loading: boolean;
};

export function useLedger(channel: VizLedgerChannel): LedgerState {
  const [state, setState] = useState<LedgerState>({
    data: fixtureLedger(channel),
    degraded: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void loadLedger(channel).then((r) => {
      if (!cancelled) {
        setState({ data: r.data, degraded: r.degraded, loading: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  return state;
}
