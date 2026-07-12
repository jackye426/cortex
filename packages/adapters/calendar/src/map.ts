/**
 * Google Calendar event → raw envelope body + summary.
 */

export interface CalendarEventSummary {
  eventId: string;
  calendarId: string;
  summary?: string;
  status?: string;
  start?: string;
  end?: string;
  htmlLink?: string;
  recurringEventId?: string;
  attendeesCount?: number;
  occurredAt?: string;
}

export interface CalendarEventEnvelopeBody {
  kind: "calendar_event";
  eventId: string;
  calendarId: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  creatorEmail?: string;
  organizerEmail?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurringEventId?: string;
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  updated?: string;
  raw?: Record<string, unknown>;
}

export interface CalendarEventInput {
  id: string;
  calendarId: string;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  status?: string | null;
  htmlLink?: string | null;
  creator?: { email?: string | null } | null;
  organizer?: { email?: string | null } | null;
  start?: {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
  } | null;
  end?: {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
  } | null;
  recurringEventId?: string | null;
  attendees?: Array<{
    email?: string | null;
    displayName?: string | null;
    responseStatus?: string | null;
  }> | null;
  updated?: string | null;
}

/** Idempotency: `{calendarId}:{eventId}`. */
export function calendarSourceRecordId(
  calendarId: string,
  eventId: string,
): string {
  return `${calendarId}:${eventId}`;
}

function startIso(
  start?: CalendarEventInput["start"],
): string | undefined {
  if (!start) return undefined;
  return start.dateTime ?? start.date ?? undefined;
}

export function mapCalendarEvent(event: CalendarEventInput): {
  body: CalendarEventEnvelopeBody;
  summary: CalendarEventSummary;
} {
  const start = startIso(event.start);
  const end = event.end?.dateTime ?? event.end?.date ?? undefined;
  const body: CalendarEventEnvelopeBody = {
    kind: "calendar_event",
    eventId: event.id,
    calendarId: event.calendarId,
    summary: event.summary ?? undefined,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    status: event.status ?? undefined,
    htmlLink: event.htmlLink ?? undefined,
    creatorEmail: event.creator?.email ?? undefined,
    organizerEmail: event.organizer?.email ?? undefined,
    start: event.start
      ? {
          date: event.start.date ?? undefined,
          dateTime: event.start.dateTime ?? undefined,
          timeZone: event.start.timeZone ?? undefined,
        }
      : undefined,
    end: event.end
      ? {
          date: event.end.date ?? undefined,
          dateTime: event.end.dateTime ?? undefined,
          timeZone: event.end.timeZone ?? undefined,
        }
      : undefined,
    recurringEventId: event.recurringEventId ?? undefined,
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.email ?? undefined,
      displayName: a.displayName ?? undefined,
      responseStatus: a.responseStatus ?? undefined,
    })),
    updated: event.updated ?? undefined,
  };

  const summary: CalendarEventSummary = {
    eventId: event.id,
    calendarId: event.calendarId,
    summary: event.summary ?? undefined,
    status: event.status ?? undefined,
    start,
    end,
    htmlLink: event.htmlLink ?? undefined,
    recurringEventId: event.recurringEventId ?? undefined,
    attendeesCount: event.attendees?.length ?? 0,
    occurredAt: start ?? event.updated ?? undefined,
  };

  return { body, summary };
}
