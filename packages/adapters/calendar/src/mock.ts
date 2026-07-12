import type { CalendarEventInput } from "./map.js";

/** Deterministic fixtures for dry-run / missing credentials. */
export function mockCalendarEvents(): CalendarEventInput[] {
  return [
    {
      id: "mock-evt-standup",
      calendarId: "primary",
      summary: "Team standup",
      description: "Mock Calendar event for Cortex dry-run.",
      status: "confirmed",
      htmlLink: "https://calendar.google.com/calendar/event?eid=mock-standup",
      organizer: { email: "you@workspace.example" },
      start: {
        dateTime: "2026-07-11T09:00:00Z",
        timeZone: "Europe/London",
      },
      end: {
        dateTime: "2026-07-11T09:15:00Z",
        timeZone: "Europe/London",
      },
      attendees: [
        { email: "you@workspace.example", responseStatus: "accepted" },
        { email: "teammate@workspace.example", responseStatus: "accepted" },
      ],
      updated: "2026-07-10T18:00:00Z",
    },
    {
      id: "mock-evt-focus",
      calendarId: "primary",
      summary: "Deep work block",
      status: "confirmed",
      start: {
        dateTime: "2026-07-11T13:00:00Z",
        timeZone: "Europe/London",
      },
      end: {
        dateTime: "2026-07-11T15:00:00Z",
        timeZone: "Europe/London",
      },
      updated: "2026-07-09T12:00:00Z",
    },
  ];
}
