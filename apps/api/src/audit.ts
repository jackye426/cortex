/**
 * Ingest / MCP audit log helper (Phase 7).
 *
 * Persists to `public.audit_log` when Supabase is configured; otherwise console stub.
 * Token material is never stored — only a SHA-256 hash of the bearer secret.
 */

import { createHash } from "node:crypto";

export interface AuditEvent {
  /** Ingest source id, `mcp`, `webhook:github`, etc. */
  source: string;
  /** SHA-256 hex of the bearer token (or known api_tokens.token_hash). */
  tokenIdHash: string;
  /** Route path, e.g. `/v1/ingest` or `/mcp`. */
  route: string;
  method?: string;
  metadata?: Record<string, unknown>;
  ownerId?: string;
}

export function hashTokenId(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  if (url.includes("YOUR_PROJECT_REF")) return false;
  return true;
}

/**
 * Record a successful authenticated request.
 * Never throws — audit must not break the main request path.
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  const row = {
    owner_id: event.ownerId ?? process.env.CORTEX_OWNER_ID ?? null,
    source: event.source,
    token_id_hash: event.tokenIdHash,
    route: event.route,
    method: event.method ?? "POST",
    metadata: event.metadata ?? {},
  };

  console.info("[audit]", {
    source: row.source,
    tokenIdHash: row.token_id_hash.slice(0, 12) + "…",
    route: row.route,
    method: row.method,
  });

  if (!isSupabaseConfigured()) {
    return;
  }

  const url = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY!.trim();

  try {
    const res = await fetch(`${url}/rest/v1/audit_log`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.warn(
        `[audit] supabase insert failed status=${res.status} (migration applied?)`,
      );
    }
  } catch (err) {
    console.warn(
      "[audit] supabase insert error",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Extract bearer token from Authorization header. */
export function bearerFromHeader(
  authHeader: string | undefined,
): string | undefined {
  if (!authHeader?.startsWith("Bearer ")) return undefined;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || undefined;
}
