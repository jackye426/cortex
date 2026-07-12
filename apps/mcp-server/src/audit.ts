/**
 * MCP audit stub — mirrors apps/api/src/audit.ts without coupling packages.
 * Logs successful authenticated MCP requests (token hash only).
 */

import { createHash } from "node:crypto";

export function hashTokenId(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function logMcpAudit(input: {
  token: string;
  route: string;
  method?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const tokenIdHash = hashTokenId(input.token);
  console.info("[audit]", {
    source: "mcp",
    tokenIdHash: tokenIdHash.slice(0, 12) + "…",
    route: input.route,
    method: input.method ?? "POST",
  });

  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key || url.includes("YOUR_PROJECT_REF")) return;

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/audit_log`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        owner_id: process.env.CORTEX_OWNER_ID ?? null,
        source: "mcp",
        token_id_hash: tokenIdHash,
        route: input.route,
        method: input.method ?? "POST",
        metadata: input.metadata ?? {},
      }),
    });
    if (!res.ok) {
      console.warn(`[audit] supabase insert failed status=${res.status}`);
    }
  } catch (err) {
    console.warn(
      "[audit] supabase insert error",
      err instanceof Error ? err.message : String(err),
    );
  }
}
