import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitiseCalendarEvent } from "./sanitised-calendar.js";

describe("sanitised calendar", () => {
  it("drops location and exposes structure only", () => {
    const out = sanitiseCalendarEvent(
      {
        id: "c1",
        sourceRecordId: "evt-1",
        summary: "DocMap sync",
        start: "2026-07-10T10:00:00.000Z",
        end: "2026-07-10T11:00:00.000Z",
        calendarId: "primary",
        location: "https://meet.google.com/secret-room",
      },
      {
        id: "c1",
        sourceId: "calendar",
        sourceRecordId: "evt-1",
        recordType: "calendar_event",
        payload: {
          summary: "DocMap sync",
          description: "Confidential pilot notes",
          attendees: [{ email: "a@x.com" }, { email: "b@x.com" }],
          attachments: [{ name: "brief.pdf" }],
        },
        contentHash: "x",
        occurredAt: "2026-07-10T10:00:00.000Z",
      },
    );
    assert.equal(out.summary, "DocMap sync");
    assert.equal(out.attendeeCount, 2);
    assert.equal(out.hasDescription, true);
    assert.equal(out.hasAttachments, true);
    assert.equal("location" in out, false);
  });
});
