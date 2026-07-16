/**
 * Persist redacted envelopes to Supabase:
 * - Storage bucket `raw` + `raw_artifacts` (content-addressed by sha256)
 * - `records` upsert on (source_id, source_record_id)
 * - `sessions` (+ light turns/messages/tool_calls) when recordType is session
 *
 * Matches `supabase/migrations/20260711100000_phase0_schema.sql`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Provenance } from "@cortex/core";
import type { CanonicalRecordStub } from "@cortex/normalize";

/** Stable single-user owner when CORTEX_OWNER_ID is unset (MCP distillate uses the same). */
export const DEFAULT_OWNER_ID = "00000000-0000-4000-8000-000000000001";

export interface PersistIngestInput {
  source: string;
  sourceRecordId: string;
  occurredAt?: string;
  mimeType?: string;
  redactedBody: unknown;
  contentHash: string;
  provenance: Provenance;
  record: CanonicalRecordStub;
}

export interface PersistIngestResult {
  vaultPath: string | null;
  rawArtifactId: string | null;
  recordId: string | null;
  sessionId: string | null;
  /** True when an existing raw_artifacts row already had this sha256. */
  reusedRaw: boolean;
}

let cachedClient: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  if (url.includes("YOUR_PROJECT_REF")) return false;
  return true;
}

export function resolveOwnerId(): string {
  const fromEnv = process.env.CORTEX_OWNER_ID?.trim();
  if (fromEnv && /^[0-9a-f-]{36}$/i.test(fromEnv)) return fromEnv;
  return DEFAULT_OWNER_ID;
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;
  if (!isSupabaseConfigured()) {
    cachedClient = null;
    return null;
  }
  const url = process.env.SUPABASE_URL!.trim().replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY!.trim();
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Postgres jsonb rejects \\u0000 and PostgREST rejects lone UTF-16 surrogates.
 * Strip both so vault writes never fail on otherwise-valid chat text.
 */
export function sanitizeJsonbValue(value: unknown): unknown {
  if (typeof value === "string") {
    let out = "";
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c === 0) continue;
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += value[i]! + value[i + 1]!;
          i += 1;
        }
        // drop lone high surrogate
        continue;
      }
      if (c >= 0xdc00 && c <= 0xdfff) continue; // lone low surrogate
      out += value[i]!;
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(sanitizeJsonbValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeJsonbValue(v);
    }
    return out;
  }
  return value;
}

function asIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function storageObjectPath(
  ownerId: string,
  source: string,
  sourceRecordId: string,
  sha256: string,
): string {
  const safeRecord = sourceRecordId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
  return `${ownerId}/${source}/${safeRecord}/${sha256}.json`;
}

async function uploadRawBlob(
  client: SupabaseClient,
  path: string,
  bytes: Buffer,
  mimeType: string,
): Promise<{ ok: boolean; path: string; mode: "storage" | "inline" }> {
  const { error } = await client.storage.from("raw").upload(path, bytes, {
    contentType: mimeType,
    upsert: true,
  });
  if (!error) {
    return { ok: true, path, mode: "storage" };
  }
  console.warn("[persist] storage upload failed; using inline path fallback:", error.message);
  // Schema requires storage_path; no jsonb body column — encode sentinel path.
  return { ok: true, path: `inline/${path}`, mode: "inline" };
}

async function upsertRawArtifact(
  client: SupabaseClient,
  input: PersistIngestInput,
  ownerId: string,
  serialized: string,
  bytes: Buffer,
): Promise<{ id: string; storagePath: string; reused: boolean }> {
  const { data: existing, error: lookupErr } = await client
    .from("raw_artifacts")
    .select("id, storage_path")
    .eq("sha256", input.contentHash)
    .maybeSingle();

  if (lookupErr) {
    throw new Error(`raw_artifacts lookup failed: ${lookupErr.message}`);
  }
  if (existing?.id) {
    return {
      id: String(existing.id),
      storagePath: String(existing.storage_path),
      reused: true,
    };
  }

  const objectPath = storageObjectPath(
    ownerId,
    input.source,
    input.sourceRecordId,
    input.contentHash,
  );
  const mimeType = input.mimeType ?? "application/json";
  const uploaded = await uploadRawBlob(client, objectPath, bytes, mimeType);

  const provenance: Record<string, unknown> = {
    ...(sanitizeJsonbValue(input.provenance) as Record<string, unknown>),
    contentHash: input.contentHash,
  };
  if (uploaded.mode === "inline") {
    // Keep small payloads recoverable without Storage; large bodies stay path-only.
    const maxInline = 256_000;
    provenance.inline = true;
    provenance.storageError = true;
    if (bytes.byteLength <= maxInline) {
      try {
        provenance.body = sanitizeJsonbValue(JSON.parse(serialized) as unknown);
      } catch {
        provenance.bodyText = String(
          sanitizeJsonbValue(serialized.slice(0, maxInline)),
        );
      }
    } else {
      provenance.bodyOmitted = true;
      provenance.byteSize = bytes.byteLength;
    }
  }

  const row = {
    owner_id: ownerId,
    source_id: input.source,
    source_record_id: input.sourceRecordId,
    storage_path: uploaded.path,
    sha256: input.contentHash,
    mime_type: mimeType,
    byte_size: bytes.byteLength,
    provenance,
  };

  const { data, error } = await client
    .from("raw_artifacts")
    .upsert(row, { onConflict: "sha256" })
    .select("id, storage_path")
    .single();

  if (error) {
    // Race: another writer inserted the same sha256
    const { data: raced, error: raceErr } = await client
      .from("raw_artifacts")
      .select("id, storage_path")
      .eq("sha256", input.contentHash)
      .maybeSingle();
    if (raceErr || !raced?.id) {
      throw new Error(`raw_artifacts upsert failed: ${error.message}`);
    }
    return {
      id: String(raced.id),
      storagePath: String(raced.storage_path),
      reused: true,
    };
  }

  return {
    id: String(data.id),
    storagePath: String(data.storage_path),
    reused: false,
  };
}

async function upsertRecord(
  client: SupabaseClient,
  input: PersistIngestInput,
  ownerId: string,
  rawArtifactId: string,
): Promise<string> {
  const occurredAt =
    asIso(input.occurredAt) ??
    asIso(input.record.payload.occurredAt) ??
    null;
  const now = new Date().toISOString();

  const row = {
    owner_id: ownerId,
    source_id: input.source,
    source_record_id: input.sourceRecordId,
    record_type: input.record.recordType,
    payload: sanitizeJsonbValue(input.record.payload) as Record<string, unknown>,
    content_hash: input.contentHash,
    raw_artifact_id: rawArtifactId,
    occurred_at: occurredAt,
    updated_at: now,
  };

  const { data, error } = await client
    .from("records")
    .upsert(row, { onConflict: "source_id,source_record_id" })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(`records upsert failed: ${error?.message ?? "no id"}`);
  }
  return String(data.id);
}

type TurnRole = "user" | "assistant" | "system" | "tool";

function normalizeMessageRole(role: unknown): TurnRole | null {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }
  return null;
}

async function replaceSessionGrain(
  client: SupabaseClient,
  ownerId: string,
  sessionId: string,
  turns: unknown[],
): Promise<void> {
  // Cascade deletes messages + tool_calls referencing turns.
  const { error: delErr } = await client
    .from("turns")
    .delete()
    .eq("session_id", sessionId);
  if (delErr) {
    console.warn("[persist] turns replace delete:", delErr.message);
    return;
  }

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!isRecord(turn)) continue;
    const role = typeof turn.role === "string" ? turn.role : null;
    const occurredAt = asIso(turn.timestamp) ?? asIso(turn.occurredAt);
    const sourceTurnId =
      typeof turn.uuid === "string"
        ? turn.uuid
        : typeof turn.id === "string"
          ? turn.id
          : null;

    const { data: turnRow, error: turnErr } = await client
      .from("turns")
      .insert({
        owner_id: ownerId,
        session_id: sessionId,
        source_turn_id: sourceTurnId,
        turn_index: i,
        role,
        occurred_at: occurredAt,
        metadata: {
          hasTextPreview: typeof turn.textPreview === "string",
          toolCount: Array.isArray(turn.tools) ? turn.tools.length : 0,
        },
      })
      .select("id")
      .single();

    if (turnErr || !turnRow?.id) {
      console.warn("[persist] turn insert:", turnErr?.message ?? "no id");
      continue;
    }
    const turnId = String(turnRow.id);

    const msgRole = normalizeMessageRole(role);
    const content =
      typeof turn.textPreview === "string"
        ? turn.textPreview
        : typeof turn.content === "string"
          ? turn.content
          : null;
    if (msgRole && content) {
      const { error: msgErr } = await client.from("messages").insert({
        owner_id: ownerId,
        turn_id: turnId,
        session_id: sessionId,
        role: msgRole,
        content,
        content_hash: null,
        metadata: {},
      });
      if (msgErr) {
        console.warn("[persist] message insert:", msgErr.message);
      }
    }

    const tools = Array.isArray(turn.tools) ? turn.tools : [];
    for (const tool of tools) {
      if (!isRecord(tool)) continue;
      const toolName =
        typeof tool.name === "string"
          ? tool.name
          : typeof tool.toolName === "string"
            ? tool.toolName
            : null;
      if (!toolName) continue;
      const argsSummary =
        typeof tool.argsPreview === "string"
          ? tool.argsPreview
          : typeof tool.args_summary === "string"
            ? tool.args_summary
            : null;
      const { error: toolErr } = await client.from("tool_calls").insert({
        owner_id: ownerId,
        turn_id: turnId,
        session_id: sessionId,
        tool_name: toolName,
        args_summary: argsSummary,
        status: typeof tool.status === "string" ? tool.status : null,
        metadata: {},
      });
      if (toolErr) {
        console.warn("[persist] tool_calls insert:", toolErr.message);
      }
    }
  }
}

async function upsertSessionGrain(
  client: SupabaseClient,
  input: PersistIngestInput,
  ownerId: string,
): Promise<string | null> {
  if (input.record.recordType !== "session") return null;

  const payload = input.record.payload;
  const sourceSessionId =
    (typeof payload.sessionId === "string" && payload.sessionId) ||
    (typeof payload.conversationId === "string" && payload.conversationId) ||
    input.sourceRecordId;

  const title =
    typeof payload.title === "string"
      ? payload.title
      : typeof payload.cwd === "string"
        ? payload.cwd
        : null;
  const workspace =
    typeof payload.cwd === "string"
      ? payload.cwd
      : typeof input.provenance.workspace === "string"
        ? input.provenance.workspace
        : null;
  const startedAt =
    asIso(payload.occurredAt) ?? asIso(input.occurredAt) ?? null;

  const metadata: Record<string, unknown> = {
    recordType: input.record.recordType,
    contentHash: input.contentHash,
    provider: payload.provider ?? null,
    turnCount: payload.turnCount ?? null,
    model: payload.model ?? null,
  };

  const { data, error } = await client
    .from("sessions")
    .upsert(
      {
        owner_id: ownerId,
        source_id: input.source,
        source_session_id: sourceSessionId,
        title,
        workspace,
        started_at: startedAt,
        ended_at: asIso(payload.updatedAt) ?? asIso(payload.endedAt),
        metadata,
      },
      { onConflict: "source_id,source_session_id" },
    )
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(`sessions upsert failed: ${error?.message ?? "no id"}`);
  }

  const sessionId = String(data.id);
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  if (turns.length > 0) {
    await replaceSessionGrain(client, ownerId, sessionId, turns);
  }
  return sessionId;
}

/**
 * Write vault + canonical rows. Throws on hard failures so the API can 502.
 * No-ops with a clear error when Supabase env is missing.
 */
export async function persistIngest(
  input: PersistIngestInput,
): Promise<PersistIngestResult> {
  const client = getSupabaseAdmin();
  if (!client) {
    throw new Error(
      "Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  const ownerId = resolveOwnerId();
  const serialized = JSON.stringify(input.redactedBody);
  const bytes = Buffer.from(serialized, "utf8");

  const raw = await upsertRawArtifact(client, input, ownerId, serialized, bytes);
  const recordId = await upsertRecord(client, input, ownerId, raw.id);
  const sessionId = await upsertSessionGrain(client, input, ownerId);

  return {
    vaultPath: raw.storagePath,
    rawArtifactId: raw.id,
    recordId,
    sessionId,
    reusedRaw: raw.reused,
  };
}
