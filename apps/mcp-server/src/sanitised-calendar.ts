/**
 * Sanitised calendar structure for the Mirror endpoint.
 * No descriptions, attachments, conference secrets, or free-text locations.
 */
import type { CalendarEventItem, RecordHit } from "./store/types.js";

export interface SanitisedCalendarEvent {
  id: string;
  sourceRecordId: string;
  summary: string | null;
  start: string | null;
  end: string | null;
  attendeeCount: number;
  /** Structural only — never description/body. */
  hasDescription: boolean;
  hasAttachments: boolean;
}

function attendeeCountFromPayload(payload: Record<string, unknown>): number {
  if (Array.isArray(payload.attendees)) return payload.attendees.length;
  const n = payload.attendeeCount;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export function sanitiseCalendarEvent(
  event: CalendarEventItem,
  raw?: RecordHit | null,
): SanitisedCalendarEvent {
  const payload = raw?.payload ?? {};
  const description = String(payload.description ?? "").trim();
  const attachments = payload.attachments;
  return {
    id: event.id,
    sourceRecordId: event.sourceRecordId,
    summary: event.summary,
    start: event.start,
    end: event.end,
    attendeeCount: attendeeCountFromPayload(payload),
    hasDescription: description.length > 0,
    hasAttachments: Array.isArray(attachments) && attachments.length > 0,
  };
}

/** Drop location / calendarId and any non-structural fields from Mirror responses. */
export function sanitiseCalendarEvents(
  events: CalendarEventItem[],
  rawById?: Map<string, RecordHit>,
): SanitisedCalendarEvent[] {
  return events.map((e) => sanitiseCalendarEvent(e, rawById?.get(e.id)));
}
