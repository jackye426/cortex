/** Client for viz API — same-origin /api/viz on Railway; fixtures offline. */
import type {
  VizDensity,
  VizLedger,
  VizLedgerChannel,
  VizVerdictRequest,
  VizVerdictResponse,
  VizView,
} from "@cortex/viz-contracts";
import { fixtureDensity, fixtureLedger } from "./fixtures";

function useFixtures(): boolean {
  if (import.meta.env.VITE_VIZ_FIXTURES === "1") return true;
  // Explicit remote (dev against local MCP) still supported
  if (import.meta.env.VITE_VIZ_API_URL) return false;
  // Production Railway serves /api/viz proxy — never force fixtures
  if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return false;
  }
  // Local vite without proxy → fixtures unless VITE_VIZ_API_URL set
  return import.meta.env.DEV && !import.meta.env.VITE_VIZ_API_URL;
}

function apiPrefix(): string {
  const remote = (import.meta.env.VITE_VIZ_API_URL as string | undefined)?.replace(/\/$/, "");
  if (remote) return remote;
  // same-origin proxy (Railway server.mjs)
  return "";
}

function bearer(): string {
  return (import.meta.env.VITE_VIZ_BEARER as string | undefined)?.trim() ?? "";
}

async function vizFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const base = apiPrefix();
  const url = base
    ? `${base}${path}`
    : `/api/viz${path.replace(/^\/v1\/viz/, "")}`;
  const token = bearer();
  const res = await fetch(url, {
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
  if (!data) {
    return {
      ok: false,
      insightId: body.insightId,
      verdict: body.verdict,
      error: "request_failed",
    };
  }
  return data;
}
