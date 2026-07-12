/**
 * Deletion tombstones — vault forever (soft delete only).
 *
 * Schema: `public.deletions` (phase0 migration).
 * Never hard-delete vault/raw_artifacts/records; insert a tombstone and hide
 * from MCP/search via `target_type` + `target_id`.
 *
 * See docs/hardening.md.
 */

export type DeletionTargetType =
  | "record"
  | "raw_artifact"
  | "session"
  | "turn"
  | "message"
  | "entity"
  | "distillate"
  | string;

export interface DeletionTombstone {
  targetType: DeletionTargetType;
  targetId: string;
  reason?: string;
  ownerId?: string;
}

export interface DeletionRecord extends DeletionTombstone {
  id?: string;
  deletedAt: string;
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
 * Record a tombstone. Stub: logs locally; POSTs to Supabase when configured.
 * Does not purge Storage objects — vault forever.
 */
export async function recordDeletion(
  tombstone: DeletionTombstone,
): Promise<DeletionRecord> {
  const deletedAt = new Date().toISOString();
  const row = {
    owner_id: tombstone.ownerId ?? process.env.CORTEX_OWNER_ID ?? null,
    target_type: tombstone.targetType,
    target_id: tombstone.targetId,
    reason: tombstone.reason ?? null,
    deleted_at: deletedAt,
  };

  console.info("[deletions] tombstone", {
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
  });

  if (!isSupabaseConfigured() || !row.owner_id) {
    return {
      ...tombstone,
      deletedAt,
    };
  }

  const url = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY!.trim();

  try {
    const res = await fetch(`${url}/rest/v1/deletions`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.warn(`[deletions] insert failed status=${res.status}`);
      return { ...tombstone, deletedAt };
    }
    const body = (await res.json()) as Array<{ id?: string }>;
    const id = Array.isArray(body) && body[0]?.id ? String(body[0].id) : undefined;
    return { ...tombstone, id, deletedAt };
  } catch (err) {
    console.warn(
      "[deletions] insert error",
      err instanceof Error ? err.message : String(err),
    );
    return { ...tombstone, deletedAt };
  }
}

/**
 * Check whether a target is tombstoned. Stub returns false without Supabase.
 */
export async function isTombstoned(
  targetType: DeletionTargetType,
  targetId: string,
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const url = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY!.trim();

  try {
    const qs = new URLSearchParams({
      select: "id",
      target_type: `eq.${targetType}`,
      target_id: `eq.${targetId}`,
      limit: "1",
    });
    const res = await fetch(`${url}/rest/v1/deletions?${qs}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as unknown[];
    return Array.isArray(body) && body.length > 0;
  } catch {
    return false;
  }
}
