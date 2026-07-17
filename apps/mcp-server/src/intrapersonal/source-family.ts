/**
 * Map distillate kinds / record types / source ids → SourceFamily.
 */
import type { EvidenceSupportKind, SourceFamily } from "./types.js";

const KIND_FAMILY: Record<string, SourceFamily> = {
  summary: "ai_sessions",
  project_brief: "ai_sessions",
  priority_vs_actual: "ai_sessions",
  decision: "decisions",
  outcome: "decisions",
  email_thread_digest: "email",
  calendar_event_digest: "calendar",
  github_outcome_digest: "github",
  drive_file_digest: "drive",
  youtube_interest_digest: "media_youtube",
  spotify_interest_digest: "media_spotify",
  browser_interest_digest: "browser",
  reading_interest_digest: "reading",
  portrait: "reflections",
  self_model: "reflections",
  interest_map: "reflections",
  weekly_mirror: "reflections",
  open_questions_snapshot: "reflections",
  change_report: "reflections",
};

const RECORD_FAMILY: Record<string, SourceFamily> = {
  email_message: "email",
  calendar_event: "calendar",
  github_pr: "github",
  github_issue: "github",
  github_commit: "github",
  drive_file: "drive",
  youtube_video: "media_youtube",
  youtube_watch: "media_youtube",
  spotify_track: "media_spotify",
  spotify_play: "media_spotify",
  spotify_episode: "media_spotify",
  bookmark: "browser",
  search_query: "browser",
  ebook: "reading",
};

const SOURCE_ID_FAMILY: Record<string, SourceFamily> = {
  cursor: "ai_sessions",
  "claude-code": "ai_sessions",
  codex: "ai_sessions",
  chatgpt: "ai_sessions",
  "chatgpt-export": "ai_sessions",
  gmail: "email",
  calendar: "calendar",
  drive: "drive",
  github: "github",
  calibre: "reading",
  browser: "browser",
  spotify: "media_spotify",
  youtube: "media_youtube",
  manual: "other",
};

/** Distillate kinds that are primarily assistant-compiled self-descriptions. */
export const ASSISTANT_DERIVED_KINDS = new Set([
  "portrait",
  "self_model",
  "interest_map",
  "weekly_mirror",
  "open_questions_snapshot",
  "change_report",
]);

export function familyFromDistillateKind(kind: string): SourceFamily {
  return KIND_FAMILY[kind] ?? "other";
}

export function familyFromRecordType(recordType: string): SourceFamily {
  return RECORD_FAMILY[recordType] ?? "other";
}

export function familyFromSourceId(sourceId: string): SourceFamily {
  return SOURCE_ID_FAMILY[sourceId] ?? "other";
}

export function supportKindForDistillateKind(
  kind: string,
): EvidenceSupportKind {
  if (ASSISTANT_DERIVED_KINDS.has(kind)) return "assistant_derived";
  if (kind === "decision" || kind === "outcome") return "self_report";
  return "direct_observation";
}

export function independenceGroupForHit(input: {
  sourceFamily: SourceFamily;
  sourceId?: string;
  distillateKind?: string;
  subjectId?: string;
}): string {
  if (input.sourceId) return `${input.sourceFamily}:${input.sourceId}`;
  if (input.distillateKind && input.subjectId) {
    return `${input.sourceFamily}:${input.distillateKind}`;
  }
  return input.sourceFamily;
}
