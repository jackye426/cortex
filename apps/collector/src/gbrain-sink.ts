/**
 * GBrain directory sink — session-v1 pages for Claude/Codex/Cursor,
 * record pages for Gmail/calendar/Drive, weekly digests for media.
 * HTTP ingest remains the default in backfill until this sink is selected.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RawEnvelope } from "@cortex/core";
import {
  driveSensitiveReasonsFromPayload,
  isCodingSessionEnvelope,
  occurredWeekKey,
  renderRecordPage,
  renderWeeklyDigestPage,
  sessionDetailFromEnvelope,
  writeSessionPage,
} from "@cortex/gbrain-session-page";

export type GbrainSinkMode = "http" | "gbrain-dir";

export interface GbrainSinkOptions {
  brainDir: string;
  dryRun: boolean;
}

export interface GbrainSinkResult {
  kind: "session" | "record" | "digest" | "skip";
  path?: string;
  redactionHits?: number;
  reason?: string;
  written: boolean;
}

const WEEKLY_DIGEST_SOURCES = new Set([
  "youtube",
  "spotify",
  "calibre",
  "browser",
]);

const RECORD_SOURCES = new Set(["gmail", "calendar", "drive"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function envelopeTitle(env: RawEnvelope): string {
  const extra = env.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(env.body) ? env.body : {};
  for (const key of ["title", "name", "subject", "summary"]) {
    const v = summary[key] ?? body[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return env.sourceRecordId;
}

function envelopeBodyText(env: RawEnvelope): string {
  const extra = env.provenance.extra;
  const summary =
    isRecord(extra) && isRecord(extra.summary) ? extra.summary : {};
  const body = isRecord(env.body) ? env.body : {};
  const parts: string[] = [];
  for (const key of [
    "snippet",
    "textPreview",
    "description",
    "summary",
    "subject",
  ]) {
    const v = summary[key] ?? body[key];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  }
  if (parts.length === 0) {
    try {
      parts.push(JSON.stringify(summary, null, 2).slice(0, 4000));
    } catch {
      /* ignore */
    }
  }
  return parts.join("\n\n");
}

function writeFile(brainDir: string, relativePath: string, markdown: string, dryRun: boolean): string {
  const absolute = join(brainDir, relativePath);
  if (!dryRun) {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, markdown, "utf8");
  }
  return relativePath;
}

export function sinkCodingSession(
  env: RawEnvelope,
  opts: GbrainSinkOptions,
): GbrainSinkResult {
  const detail = sessionDetailFromEnvelope(env);
  const result = writeSessionPage(detail, {
    brainDir: opts.brainDir,
    dryRun: opts.dryRun,
  });
  return {
    kind: "session",
    path: result.relativePath,
    redactionHits: result.redactionHitCount,
    written: result.written,
  };
}

export function sinkRecordEnvelope(
  env: RawEnvelope,
  opts: GbrainSinkOptions,
): GbrainSinkResult {
  const body = isRecord(env.body) ? env.body : {};
  const extra = isRecord(env.provenance.extra) ? env.provenance.extra : {};
  const summary = isRecord(extra.summary) ? extra.summary : {};
  const payload = { ...summary, ...body };

  if (env.source === "drive") {
    const reasons = driveSensitiveReasonsFromPayload(payload);
    if (reasons.length) {
      return {
        kind: "skip",
        reason: `drive-file-v2 sensitivity (${reasons.join(",")})`,
        written: false,
      };
    }
  }

  const folder =
    env.source === "gmail"
      ? "mail"
      : env.source === "calendar"
        ? "calendar"
        : "drive";
  const rendered = renderRecordPage({
    schema: `${env.source}-v1`,
    slug: `${folder}/${env.sourceRecordId}`,
    sourceId: env.source,
    sourceRecordId: env.sourceRecordId,
    title: envelopeTitle(env),
    occurredAt: env.occurredAt ?? null,
    body: envelopeBodyText(env),
    metadata: { kind: body.kind },
  });
  const path = writeFile(
    opts.brainDir,
    rendered.relativePath,
    rendered.markdown,
    opts.dryRun,
  );
  return {
    kind: "record",
    path,
    redactionHits: rendered.redactionHitCount,
    written: !opts.dryRun,
  };
}

export interface DigestAccumulator {
  source: string;
  weekKey: string;
  items: Array<{ id: string; title: string; occurredAt?: string | null }>;
}

export function digestKey(env: RawEnvelope): string {
  const week = occurredWeekKey(env.occurredAt ?? null);
  return `${env.source}:${week}`;
}

export function addToDigest(
  buckets: Map<string, DigestAccumulator>,
  env: RawEnvelope,
): void {
  const weekKey = occurredWeekKey(env.occurredAt ?? null);
  const key = `${env.source}:${weekKey}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { source: env.source, weekKey, items: [] };
    buckets.set(key, bucket);
  }
  bucket.items.push({
    id: env.sourceRecordId,
    title: envelopeTitle(env),
    occurredAt: env.occurredAt ?? null,
  });
}

export function flushDigests(
  buckets: Map<string, DigestAccumulator>,
  opts: GbrainSinkOptions,
): GbrainSinkResult[] {
  const out: GbrainSinkResult[] = [];
  for (const bucket of buckets.values()) {
    const rendered = renderWeeklyDigestPage({
      schema: `${bucket.source}-week-digest-v1`,
      sourceId: bucket.source,
      weekKey: bucket.weekKey,
      title: `${bucket.source} week ${bucket.weekKey}`,
      items: bucket.items,
    });
    const path = writeFile(
      opts.brainDir,
      rendered.relativePath,
      rendered.markdown,
      opts.dryRun,
    );
    out.push({
      kind: "digest",
      path,
      written: !opts.dryRun,
    });
  }
  return out;
}

export function classifySinkTarget(
  env: RawEnvelope,
): "session" | "record" | "digest" | "github-native" | "skip" {
  if (env.source === "github") return "github-native";
  if (isCodingSessionEnvelope(env) || env.source === "chatgpt-export" || env.source === "chatgpt") {
    return "session";
  }
  if (RECORD_SOURCES.has(env.source)) return "record";
  if (WEEKLY_DIGEST_SOURCES.has(env.source)) return "digest";
  return "skip";
}

export function sinkEnvelope(
  env: RawEnvelope,
  opts: GbrainSinkOptions,
  digestBuckets: Map<string, DigestAccumulator>,
): GbrainSinkResult {
  const target = classifySinkTarget(env);
  if (target === "github-native") {
    return {
      kind: "skip",
      reason: "GitHub is a GBrain native source — skip Cortex github RAG",
      written: false,
    };
  }
  if (target === "digest") {
    addToDigest(digestBuckets, env);
    return {
      kind: "digest",
      reason: `buffered for weekly digest (${digestKey(env)})`,
      written: false,
    };
  }
  if (target === "record") return sinkRecordEnvelope(env, opts);
  if (target === "session") return sinkCodingSession(env, opts);
  return { kind: "skip", reason: `no gbrain writer for source=${env.source}`, written: false };
}

export { WEEKLY_DIGEST_SOURCES };
