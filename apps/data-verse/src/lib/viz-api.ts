/** Client for mcp-server viz projection API with fixture fallback. */
import type {
  VizDensity,
  VizLedger,
  VizLedgerChannel,
  VizVerdictRequest,
  VizVerdictResponse,
  VizView,
} from "@cortex/viz-contracts";
import { fixtureDensity, fixtureLedger } from "./fixtures";

function apiBase(): string {
  return (import.meta.env.VITE_VIZ_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
}

function useFixtures(): boolean {
  if (import.meta.env.VITE_VIZ_FIXTURES === "1") return true;
  if (import.meta.env.VITE_VIZ_FIXTURES === "0") return false;
  return !apiBase();
}

function bearer(): string {
  return (import.meta.env.VITE_VIZ_BEARER as string | undefined)?.trim() ?? "";
}

async function vizFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const base = apiBase();
  if (!base) return null;
  const token = bearer();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function loadDensity(view: VizView): Promise<VizDensity> {
  if (useFixtures()) return fixtureDensity(view);
  try {
    const data = await vizFetch<VizDensity>(`/v1/viz/density?view=${view}`);
    if (data?.points || data?.streamRows?.length) return data;
  } catch {
    /* fall through */
  }
  return fixtureDensity(view);
}

export async function loadLedger(channel: VizLedgerChannel): Promise<VizLedger> {
  if (useFixtures()) return fixtureLedger(channel);
  try {
    const data = await vizFetch<VizLedger>(`/v1/viz/ledger?channel=${channel}`);
    if (data?.rows) return data;
  } catch {
    /* fall through */
  }
  return fixtureLedger(channel);
}

export async function postVerdict(
  body: VizVerdictRequest,
): Promise<VizVerdictResponse> {
  if (useFixtures()) {
    return { ok: true, insightId: body.insightId, verdict: body.verdict };
  }
  const data = await vizFetch<VizVerdictResponse>("/v1/viz/verdict", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!data) return { ok: false, insightId: body.insightId, verdict: body.verdict, error: "request_failed" };
  return data;
}
