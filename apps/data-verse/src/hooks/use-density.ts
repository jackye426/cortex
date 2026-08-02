import { useEffect, useState } from "react";
import type { VizDensity, VizView } from "@cortex/viz-contracts";
import { loadDensity } from "@/lib/viz-api";
import { fixtureDensity } from "@/lib/fixtures";

export type DensityState = {
  data: VizDensity;
  degraded: boolean;
  loading: boolean;
};

export function useDensity(view: VizView): DensityState {
  const [state, setState] = useState<DensityState>({
    data: {
      ...fixtureDensity(view),
      meta: { ...fixtureDensity(view).meta, shellDriven: true, source: "fixture" },
    },
    degraded: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void loadDensity(view).then((r) => {
      if (!cancelled) {
        setState({ data: r.data, degraded: r.degraded, loading: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

  return state;
}
