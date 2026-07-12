import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import {
  calendarApi,
  createOAuth2ClientFromEnv,
  ensureAccessToken,
  googleAccountKey,
  shouldUseGoogleMock,
  type OAuth2Client,
} from "@cortex/google-auth";
import {
  calendarSourceRecordId,
  mapCalendarEvent,
  type CalendarEventInput,
} from "./map.js";
import { mockCalendarEvents } from "./mock.js";

export type {
  CalendarEventEnvelopeBody,
  CalendarEventInput,
  CalendarEventSummary,
} from "./map.js";
export { calendarSourceRecordId, mapCalendarEvent } from "./map.js";
export { mockCalendarEvents } from "./mock.js";

export interface CalendarAdapterOptions {
  /** Calendar id (default `primary`). */
  calendarId?: string;
  pageSize?: number;
  /** Hard cap on events (dry-run / smoke). */
  limit?: number;
  collectorName?: string;
  /** Force mock fixtures even if GOOGLE_* is set. */
  mock?: boolean;
  /** Inject auth (tests). */
  auth?: OAuth2Client | null;
}

interface SyncState {
  /** Opaque Google Calendar syncToken for incremental. */
  syncToken?: string;
  /** Page token within a full or incremental sync. */
  pageToken?: string;
}

/**
 * Google Calendar adapter (Workspace).
 *
 * Historical: `events.list` (time-bounded or full) until `nextSyncToken`.
 * Ongoing: `events.list` with `syncToken`; on 410 Gone, clear and full-resync.
 */
export class CalendarAdapter implements SourceAdapter {
  readonly source = "calendar" as const;

  private readonly calendarId: string;
  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private readonly forceMock: boolean;
  private readonly injectedAuth: OAuth2Client | null | undefined;
  private mockCache: CalendarEventInput[] | null = null;

  constructor(options: CalendarAdapterOptions = {}) {
    this.calendarId = options.calendarId ?? "primary";
    this.pageSize = options.pageSize ?? 50;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-calendar";
    this.forceMock = options.mock === true;
    this.injectedAuth = options.auth;
  }

  private useMock(): boolean {
    return this.forceMock || shouldUseGoogleMock();
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (this.useMock()) {
      const n = this.listMock().length;
      return {
        ok: true,
        detail: `mock mode — ${n} fixture event(s); set GOOGLE_* for live Workspace`,
      };
    }
    try {
      const auth = this.auth();
      if (!auth) {
        return { ok: false, detail: "GOOGLE_* credentials incomplete" };
      }
      await ensureAccessToken(auth);
      const cal = calendarApi(auth);
      const res = await cal.calendarList.get({ calendarId: this.calendarId });
      return {
        ok: true,
        detail: `live calendar ${res.data.summary ?? this.calendarId}`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    if (this.useMock()) {
      return this.fetchMockPage(checkpoint);
    }
    return this.fetchLivePage(checkpoint);
  }

  async backfillAll(): Promise<RawEnvelope[]> {
    if (this.useMock()) {
      return this.listMock().map((e) => this.envelopeFor(e));
    }

    const items: RawEnvelope[] = [];
    let cursor: string | undefined;
    let guard = 0;
    while (guard++ < 500) {
      const page = await this.fetchLivePage(
        cursor
          ? {
              source: "calendar",
              accountKey: googleAccountKey(),
              cursor,
              updatedAt: new Date().toISOString(),
            }
          : undefined,
      );
      items.push(...page.items);
      if (this.limit != null && items.length >= this.limit) {
        return items.slice(0, this.limit);
      }
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return items;
  }

  private auth(): OAuth2Client | null {
    if (this.injectedAuth !== undefined) return this.injectedAuth;
    return createOAuth2ClientFromEnv();
  }

  private listMock(): CalendarEventInput[] {
    if (!this.mockCache) {
      let events = mockCalendarEvents().map((e) => ({
        ...e,
        calendarId: this.calendarId,
      }));
      if (this.limit != null && this.limit >= 0) {
        events = events.slice(0, this.limit);
      }
      this.mockCache = events;
    }
    return this.mockCache;
  }

  private fetchMockPage(checkpoint?: SyncCheckpoint): AdapterPage {
    const events = this.listMock();
    const start = checkpoint?.cursor ? Number(checkpoint.cursor) || 0 : 0;
    const slice = events.slice(start, start + this.pageSize);
    const next = start + slice.length;
    const hasMore = next < events.length;
    return {
      items: slice.map((e) => this.envelopeFor(e)),
      nextCursor: hasMore ? String(next) : "mock:done",
      hasMore,
    };
  }

  private parseState(cursor?: string): SyncState {
    if (!cursor) return {};
    try {
      const parsed = JSON.parse(cursor) as SyncState;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // Plain syncToken from older runs
      return { syncToken: cursor };
    }
  }

  private encodeState(state: SyncState): string {
    return JSON.stringify(state);
  }

  private async fetchLivePage(
    checkpoint?: SyncCheckpoint,
  ): Promise<AdapterPage> {
    const auth = this.auth();
    if (!auth) {
      throw new Error(
        "Calendar live mode requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN",
      );
    }
    await ensureAccessToken(auth);
    const cal = calendarApi(auth);
    const state = this.parseState(checkpoint?.cursor);

    try {
      const res = await cal.events.list({
        calendarId: this.calendarId,
        maxResults: this.pageSize,
        singleEvents: true,
        showDeleted: true,
        ...(state.syncToken
          ? { syncToken: state.syncToken }
          : {
              // Full sync window: 1 year back → 2 years forward
              timeMin: new Date(
                Date.now() - 365 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              timeMax: new Date(
                Date.now() + 2 * 365 * 24 * 60 * 60 * 1000,
              ).toISOString(),
            }),
        ...(state.pageToken ? { pageToken: state.pageToken } : {}),
      });

      const events = (res.data.items ?? [])
        .filter((e): e is NonNullable<typeof e> & { id: string } =>
          Boolean(e?.id),
        )
        .map((e) => this.fromApi(e));

      let items = events.map((e) => this.envelopeFor(e));
      if (this.limit != null) {
        items = items.slice(0, this.limit);
      }

      if (res.data.nextPageToken) {
        return {
          items,
          nextCursor: this.encodeState({
            syncToken: state.syncToken,
            pageToken: res.data.nextPageToken,
          }),
          hasMore: true,
        };
      }

      // Persist nextSyncToken for incremental polls
      const nextSync = res.data.nextSyncToken;
      return {
        items,
        nextCursor: nextSync
          ? this.encodeState({ syncToken: nextSync })
          : null,
        hasMore: false,
      };
    } catch (err) {
      const status =
        err && typeof err === "object" && "code" in err
          ? Number((err as { code: unknown }).code)
          : undefined;
      // 410 Gone — syncToken expired; restart full sync
      if (status === 410) {
        return this.fetchLivePage(undefined);
      }
      throw err;
    }
  }

  private fromApi(e: {
    id?: string | null;
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
  }): CalendarEventInput {
    return {
      id: e.id!,
      calendarId: this.calendarId,
      summary: e.summary,
      description: e.description,
      location: e.location,
      status: e.status,
      htmlLink: e.htmlLink,
      creator: e.creator,
      organizer: e.organizer,
      start: e.start,
      end: e.end,
      recurringEventId: e.recurringEventId,
      attendees: e.attendees,
      updated: e.updated,
    };
  }

  private envelopeFor(event: CalendarEventInput): RawEnvelope {
    const { body, summary } = mapCalendarEvent(event);
    return {
      source: "calendar",
      sourceRecordId: calendarSourceRecordId(event.calendarId, event.id),
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: googleAccountKey(),
        extra: {
          kind: "calendar_event_summary",
          accountKey: googleAccountKey(),
          mock: this.useMock(),
          summary,
        },
      },
    };
  }
}

export function createCalendarAdapter(
  options?: CalendarAdapterOptions,
): CalendarAdapter {
  return new CalendarAdapter(options);
}
