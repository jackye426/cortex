/**
 * Evidence broker — policy-gated, excerpt-only raw retrieval for Mirror.
 */
import { createHash, randomUUID } from "node:crypto";
import { redactText } from "@cortex/redaction";
import { logMcpAudit } from "./audit.js";
import type { McpToolProfile } from "./mcp-profile.js";
import type { CortexStore } from "./store/index.js";
import type { RecordHit } from "./store/types.js";

export type EvidenceAccessClass = "routine" | "sensitive" | "restricted";
export type CapabilityClass = "sensitive" | "restricted";

const MAX_RESULTS_HARD = 10;
const MAX_EXCERPT_CHARS = 700;
const MAX_WINDOW_DAYS_ROUTINE = 90;
const MAX_WINDOW_DAYS_SENSITIVE = 60;
const MAX_WINDOW_DAYS_RESTRICTED = 30;
const SENSITIVE_TTL_MAX_SEC = 15 * 60;
const RESTRICTED_TTL_MAX_SEC = 10 * 60;

const ROUTINE_FIELDS = new Set([
  "timestamp",
  "occurred_at",
  "sender",
  "from",
  "subject",
  "title",
  "name",
  "summary",
  "state",
  "repo",
  "record_type",
  "source_record_id",
]);

const SENSITIVE_FIELDS = new Set([
  "body_excerpt",
  "snippet",
  "description_excerpt",
  "text_preview",
  "session_excerpt",
  "content_excerpt",
  "attachment_name",
]);

const RESTRICTED_FIELDS = new Set([
  "full_body",
  "attachment_bytes",
  "export_text",
  "raw_payload",
]);

const DRIVE_RESTRICTED_NAME =
  /\b(password|passwd|credential|secret|api[_-]?keys?|private[_-]?key|recovery|otp|passport|ssn|national.?id)\b/i;

export interface EvidenceCapability {
  id: string;
  class: CapabilityClass;
  purpose: string;
  sourceTypes: string[];
  dateRange: { since: string; until: string };
  subjectIds: string[];
  maxResults: number;
  permittedFields: string[];
  expiresAt: string;
  issuedBy: "mirror" | "ops";
  usesRemaining: number;
}

export interface BrokerRequest {
  purpose: string;
  sourceTypes: string[];
  dateRange?: { since: string; until: string };
  subjectIds?: string[];
  maxResults?: number;
  permittedFields?: string[];
  capabilityId?: string;
}

export interface BrokerExcerpt {
  id: string;
  recordType: string;
  sourceRecordId: string;
  occurredAt: string | null;
  fields: Record<string, string | number | boolean | null>;
}

export interface BrokerResult {
  ok: boolean;
  denied?: string;
  reason?: string;
  accessClass?: EvidenceAccessClass;
  ephemeral: true;
  count?: number;
  excerpts?: BrokerExcerpt[];
  capabilityId?: string;
}

const capabilityStore = new Map<string, EvidenceCapability>();

export function _resetCapabilitiesForTests(): void {
  capabilityStore.clear();
}

export function classifyEvidenceRequest(
  sourceTypes: string[],
  permittedFields: string[],
): EvidenceAccessClass {
  const fields = permittedFields.map((f) => f.toLowerCase());
  if (fields.some((f) => RESTRICTED_FIELDS.has(f))) return "restricted";
  if (sourceTypes.includes("drive") && fields.some((f) => f === "text_preview" || f === "export_text")) {
    // Drive body is at least sensitive; path heuristics may escalate at retrieve time
  }
  if (fields.some((f) => SENSITIVE_FIELDS.has(f))) return "sensitive";
  if (sourceTypes.includes("session")) return "sensitive"; // session turns always sensitive
  if (fields.every((f) => ROUTINE_FIELDS.has(f) || f === "attendee_count")) {
    return "routine";
  }
  // Unknown fields → sensitive by default (fail closed on privilege)
  return "sensitive";
}

function windowDays(since: string, until: string): number {
  const a = Date.parse(since);
  const b = Date.parse(until);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return Infinity;
  return (b - a) / 86400000;
}

function defaultRange(days: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);
  return { since: since.toISOString(), until: until.toISOString() };
}

export function mintCapability(input: {
  purpose: string;
  class: CapabilityClass;
  sourceTypes: string[];
  dateRange: { since: string; until: string };
  subjectIds?: string[];
  maxResults: number;
  permittedFields: string[];
  ttlSeconds?: number;
  issuedBy: "mirror" | "ops";
}): { ok: true; capability: EvidenceCapability } | { ok: false; denied: string; reason: string } {
  const purpose = input.purpose.trim();
  if (!purpose) {
    return { ok: false, denied: "invalid_request", reason: "purpose is required" };
  }
  if (input.class === "restricted" && input.issuedBy !== "ops") {
    return {
      ok: false,
      denied: "ops_only",
      reason: "restricted capabilities must be ops-issued",
    };
  }
  const requiredClass = classifyEvidenceRequest(
    input.sourceTypes,
    input.permittedFields,
  );
  if (requiredClass === "restricted" && input.class !== "restricted") {
    return {
      ok: false,
      denied: "ops_only",
      reason: "requested fields/sources require restricted class",
    };
  }
  if (requiredClass === "sensitive" && input.class === "sensitive") {
    // ok
  } else if (requiredClass === "routine") {
    return {
      ok: false,
      denied: "capability_not_needed",
      reason: "routine fields do not require a capability; call retrieve_supporting_evidence directly",
    };
  }

  const maxWindow =
    input.class === "restricted"
      ? MAX_WINDOW_DAYS_RESTRICTED
      : MAX_WINDOW_DAYS_SENSITIVE;
  const days = windowDays(input.dateRange.since, input.dateRange.until);
  if (days > maxWindow) {
    return {
      ok: false,
      denied: "window_exceeded",
      reason: `date_range exceeds ${maxWindow}d for class=${input.class}`,
    };
  }

  const ttlCap =
    input.class === "restricted" ? RESTRICTED_TTL_MAX_SEC : SENSITIVE_TTL_MAX_SEC;
  const ttl = Math.max(30, Math.min(input.ttlSeconds ?? ttlCap, ttlCap));
  const maxResults = Math.max(
    1,
    Math.min(input.maxResults || 5, MAX_RESULTS_HARD),
  );

  const capability: EvidenceCapability = {
    id: randomUUID(),
    class: input.class,
    purpose,
    sourceTypes: [...new Set(input.sourceTypes)],
    dateRange: input.dateRange,
    subjectIds: input.subjectIds ?? [],
    maxResults,
    permittedFields: [...new Set(input.permittedFields)],
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    issuedBy: input.issuedBy,
    usesRemaining: input.class === "restricted" ? 1 : 3,
  };
  capabilityStore.set(capability.id, capability);
  return { ok: true, capability };
}

function getCapability(id: string): EvidenceCapability | null {
  const cap = capabilityStore.get(id);
  if (!cap) return null;
  if (Date.parse(cap.expiresAt) <= Date.now()) {
    capabilityStore.delete(id);
    return null;
  }
  return cap;
}

function consumeCapability(id: string): void {
  const cap = capabilityStore.get(id);
  if (!cap) return;
  cap.usesRemaining -= 1;
  if (cap.usesRemaining <= 0) capabilityStore.delete(id);
  else capabilityStore.set(id, cap);
}

function excerptText(text: string): string {
  const redacted = redactText(text);
  if (redacted.redacted && /sk-|password|BEGIN .*PRIVATE/i.test(text)) {
    // Fail closed for obvious secrets — do not return even redacted blob as useful body
    return "[skipped:secret_pattern]";
  }
  return redacted.text.replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARS);
}

function recordMatchesSubjects(r: RecordHit, subjectIds: string[]): boolean {
  if (!subjectIds.length) return true;
  const hay = [
    r.id,
    r.sourceRecordId,
    String(r.payload.threadId ?? ""),
    String(r.payload.project ?? ""),
    String(r.payload.repoFullName ?? r.payload.repo ?? ""),
    String(r.payload.name ?? ""),
    String(r.payload.subject ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  return subjectIds.some((s) => hay.includes(s.toLowerCase()));
}

function isRestrictedDrive(r: RecordHit): boolean {
  const name = String(r.payload.name ?? r.payload.title ?? "");
  const path = String(
    r.payload.folderPath ?? r.payload.path ?? r.payload.fullPath ?? "",
  );
  return DRIVE_RESTRICTED_NAME.test(`${path} ${name}`);
}

function pickFields(
  r: RecordHit,
  permittedFields: string[],
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  const p = r.payload;
  for (const field of permittedFields) {
    const f = field.toLowerCase();
    switch (f) {
      case "timestamp":
      case "occurred_at":
        out[f] = r.occurredAt;
        break;
      case "sender":
      case "from":
        out[f] = typeof p.from === "string" ? p.from : null;
        break;
      case "subject":
        out.subject = typeof p.subject === "string" ? p.subject : null;
        break;
      case "title":
        out.title =
          (typeof p.title === "string" && p.title) ||
          (typeof p.name === "string" && p.name) ||
          null;
        break;
      case "name":
        out.name = typeof p.name === "string" ? p.name : null;
        break;
      case "summary":
        out.summary =
          (typeof p.summary === "string" && p.summary) ||
          (typeof p.title === "string" && p.title) ||
          null;
        break;
      case "state":
        out.state = typeof p.state === "string" ? p.state : null;
        break;
      case "repo":
        out.repo = String(p.repoFullName ?? p.repo ?? "") || null;
        break;
      case "record_type":
        out.record_type = r.recordType;
        break;
      case "source_record_id":
        out.source_record_id = r.sourceRecordId;
        break;
      case "attendee_count": {
        const n = Array.isArray(p.attendees)
          ? p.attendees.length
          : typeof p.attendeeCount === "number"
            ? p.attendeeCount
            : 0;
        out.attendee_count = n;
        break;
      }
      case "snippet":
        out.snippet =
          typeof p.snippet === "string" ? excerptText(p.snippet) : null;
        break;
      case "body_excerpt":
      case "content_excerpt": {
        const body = String(p.body ?? p.bodyText ?? p.snippet ?? "");
        out[f] = body ? excerptText(body) : null;
        break;
      }
      case "description_excerpt": {
        const d = String(p.description ?? "");
        out.description_excerpt = d ? excerptText(d) : null;
        break;
      }
      case "text_preview": {
        const t = String(p.textPreview ?? p.exportText ?? "");
        out.text_preview = t ? excerptText(t) : null;
        break;
      }
      case "session_excerpt": {
        // Session raw turns are not on RecordHit — handled separately
        break;
      }
      case "attachment_name": {
        const atts = Array.isArray(p.attachments) ? p.attachments : [];
        const names = atts
          .map((a) =>
            a && typeof a === "object" && "name" in a
              ? String((a as { name: unknown }).name ?? "")
              : typeof a === "string"
                ? a
                : "",
          )
          .filter(Boolean);
        out.attachment_name = names.slice(0, 3).join("; ") || null;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

const SOURCE_TO_RECORD_TYPES: Record<string, string[]> = {
  email: ["email_message"],
  calendar: ["calendar_event"],
  drive: ["drive_file"],
  github: ["github_pr", "github_issue"],
  youtube: ["youtube_watch", "youtube_video"],
  browser: ["bookmark", "search_query"],
  spotify: ["spotify_play", "spotify_episode"],
  session: [], // special path
};

async function loadSessionExcerpts(
  store: CortexStore,
  subjectIds: string[],
  maxResults: number,
  permittedFields: string[],
): Promise<BrokerExcerpt[]> {
  if (!permittedFields.some((f) => f === "session_excerpt" || f === "title")) {
    return [];
  }
  const out: BrokerExcerpt[] = [];
  const ids = subjectIds.length ? subjectIds.slice(0, maxResults) : [];
  // If no subject ids, pull recent session distillates as pointers only (no raw turns without id)
  if (!ids.length) {
    const summaries = await store.listDistillates({
      limit: maxResults,
      kinds: ["summary"],
    });
    for (const d of summaries) {
      out.push({
        id: d.subjectId,
        recordType: "session_summary_pointer",
        sourceRecordId: d.subjectId,
        occurredAt: d.createdAt,
        fields: {
          title: `session:${d.subjectId}`,
          session_excerpt:
            "[denied: provide subject_ids with session UUID for turn excerpts]",
        },
      });
    }
    return out;
  }
  for (const sid of ids) {
    if (out.length >= maxResults) break;
    const session = await store.getSession(sid);
    if (!session) continue;
    const turns = (session.messages ?? [])
      .slice(0, 6)
      .map((m) => `${m.role}: ${String(m.content ?? "").slice(0, 200)}`)
      .join(" | ");
    const fields: Record<string, string | number | boolean | null> = {
      title: session.title,
      record_type: "session",
      source_record_id: session.sourceSessionId,
    };
    if (permittedFields.includes("session_excerpt")) {
      fields.session_excerpt = excerptText(turns);
    }
    out.push({
      id: session.id,
      recordType: "session",
      sourceRecordId: session.sourceSessionId,
      occurredAt: session.endedAt ?? session.startedAt,
      fields,
    });
  }
  return out;
}

export async function retrieveSupportingEvidence(
  store: CortexStore,
  profile: McpToolProfile,
  req: BrokerRequest,
  auditToken: string,
  /** Raw vault reads after policy — defaults to `store` (Ops). Mirror passes vault store. */
  vaultStore: CortexStore = store,
): Promise<BrokerResult> {
  const purpose = req.purpose?.trim() ?? "";
  if (!purpose) {
    return {
      ok: false,
      denied: "invalid_request",
      reason: "purpose is required",
      ephemeral: true,
    };
  }
  const sourceTypes = [...new Set(req.sourceTypes ?? [])].filter(Boolean);
  if (!sourceTypes.length) {
    return {
      ok: false,
      denied: "invalid_request",
      reason: "source_types required",
      ephemeral: true,
    };
  }
  const permittedFields = [
    ...new Set(
      (req.permittedFields?.length
        ? req.permittedFields
        : ["timestamp", "subject", "title", "sender"]
      ).map((f) => f.toLowerCase()),
    ),
  ];
  const accessClass = classifyEvidenceRequest(sourceTypes, permittedFields);
  const maxResults = Math.max(
    1,
    Math.min(req.maxResults ?? 5, MAX_RESULTS_HARD),
  );
  const range =
    req.dateRange ??
    defaultRange(
      accessClass === "restricted"
        ? MAX_WINDOW_DAYS_RESTRICTED
        : accessClass === "sensitive"
          ? MAX_WINDOW_DAYS_SENSITIVE
          : MAX_WINDOW_DAYS_ROUTINE,
    );
  const days = windowDays(range.since, range.until);
  const maxWindow =
    accessClass === "restricted"
      ? MAX_WINDOW_DAYS_RESTRICTED
      : accessClass === "sensitive"
        ? MAX_WINDOW_DAYS_SENSITIVE
        : MAX_WINDOW_DAYS_ROUTINE;
  if (days > maxWindow) {
    return {
      ok: false,
      denied: "window_exceeded",
      reason: `date_range exceeds ${maxWindow}d for class=${accessClass}`,
      ephemeral: true,
      accessClass,
    };
  }

  let capability: EvidenceCapability | null = null;
  if (accessClass === "routine") {
    // no capability
  } else if (accessClass === "sensitive" || accessClass === "restricted") {
    if (!req.capabilityId) {
      return {
        ok: false,
        denied: accessClass === "restricted" ? "ops_only" : "needs_capability",
        reason:
          accessClass === "restricted"
            ? "restricted evidence requires an ops-issued capability"
            : "mint a sensitive capability via request_evidence_capability first",
        ephemeral: true,
        accessClass,
      };
    }
    capability = getCapability(req.capabilityId);
    if (!capability) {
      return {
        ok: false,
        denied: "capability_invalid",
        reason: "capability missing or expired",
        ephemeral: true,
        accessClass,
      };
    }
    if (accessClass === "restricted" && capability.class !== "restricted") {
      return {
        ok: false,
        denied: "ops_only",
        reason: "capability class insufficient for restricted evidence",
        ephemeral: true,
        accessClass,
      };
    }
    if (capability.class === "restricted" && profile !== "ops" && capability.issuedBy !== "ops") {
      return {
        ok: false,
        denied: "ops_only",
        reason: "restricted capability must be ops-issued",
        ephemeral: true,
        accessClass,
      };
    }
    // Scope must cover request
    for (const st of sourceTypes) {
      if (!capability.sourceTypes.includes(st)) {
        return {
          ok: false,
          denied: "capability_scope",
          reason: `capability does not include source_type=${st}`,
          ephemeral: true,
          accessClass,
        };
      }
    }
    if (
      range.since < capability.dateRange.since ||
      range.until > capability.dateRange.until
    ) {
      return {
        ok: false,
        denied: "capability_scope",
        reason: "date_range outside capability window",
        ephemeral: true,
        accessClass,
      };
    }
  }

  const subjectIds = req.subjectIds ?? capability?.subjectIds ?? [];
  const excerpts: BrokerExcerpt[] = [];

  if (sourceTypes.includes("session")) {
    const sessionExcerpts = await loadSessionExcerpts(
      vaultStore,
      subjectIds,
      maxResults,
      permittedFields,
    );
    excerpts.push(...sessionExcerpts);
  }

  for (const st of sourceTypes) {
    if (st === "session") continue;
    const types = SOURCE_TO_RECORD_TYPES[st];
    if (!types) {
      return {
        ok: false,
        denied: "source_forbidden",
        reason: `unknown source_type=${st}`,
        ephemeral: true,
        accessClass,
      };
    }
    for (const rt of types) {
      if (excerpts.length >= maxResults) break;
      const rows = await vaultStore.listRecordsByTypeInRange(
        rt,
        range.since,
        range.until,
        80,
      );
      for (const r of rows) {
        if (excerpts.length >= maxResults) break;
        if (!recordMatchesSubjects(r, subjectIds)) continue;
        if (st === "drive" && isRestrictedDrive(r)) {
          if (accessClass !== "restricted" || capability?.class !== "restricted") {
            continue; // skip silently under fail-closed
          }
        }
        const fields = pickFields(r, permittedFields);
        if (Object.values(fields).some((v) => v === "[skipped:secret_pattern]")) {
          continue;
        }
        excerpts.push({
          id: r.id,
          recordType: r.recordType,
          sourceRecordId: r.sourceRecordId,
          occurredAt: r.occurredAt,
          fields,
        });
      }
    }
  }

  if (capability) consumeCapability(capability.id);

  const sourceRefs = excerpts.map((e) => e.id);
  void logMcpAudit({
    token: auditToken,
    route: "retrieve_supporting_evidence",
    method: "TOOL",
    metadata: {
      surface: "retrieve_supporting_evidence",
      endpoint: profile,
      purpose,
      accessClass,
      capabilityId: capability?.id ?? null,
      evidence_classes: ["broker_excerpt"],
      source_refs: sourceRefs,
      retention: "ephemeral",
      sourceTypes,
      count: excerpts.length,
    },
  });

  return {
    ok: true,
    ephemeral: true,
    accessClass,
    count: excerpts.length,
    excerpts,
    capabilityId: capability?.id,
  };
}

export function capabilityPublicView(cap: EvidenceCapability): Record<string, unknown> {
  return {
    capability_id: cap.id,
    class: cap.class,
    purpose: cap.purpose,
    source_types: cap.sourceTypes,
    date_range: cap.dateRange,
    subject_ids: cap.subjectIds,
    max_results: cap.maxResults,
    permitted_fields: cap.permittedFields,
    expires_at: cap.expiresAt,
    uses_remaining: cap.usesRemaining,
    issued_by: cap.issuedBy,
  };
}

/** Stable id helper for tests. */
export function hashPurpose(purpose: string): string {
  return createHash("sha256").update(purpose).digest("hex").slice(0, 12);
}
