import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import {
  createOAuth2ClientFromEnv,
  ensureAccessToken,
  gmailApi,
  googleAccountKey,
  shouldUseGoogleMock,
  type OAuth2Client,
} from "@cortex/google-auth";
import {
  decodeGmailBodyData,
  emailSourceRecordId,
  mapEmailMessage,
  type EmailMessageInput,
} from "./map.js";
import { GMAIL_WATCH_NOTES, mockEmailMessages } from "./mock.js";

export type {
  EmailMessageEnvelopeBody,
  EmailMessageInput,
  EmailMessageSummary,
} from "./map.js";
export {
  decodeGmailBodyData,
  emailSourceRecordId,
  mapEmailMessage,
} from "./map.js";
export { GMAIL_WATCH_NOTES, mockEmailMessages } from "./mock.js";

export interface GmailAdapterOptions {
  pageSize?: number;
  limit?: number;
  collectorName?: string;
  mock?: boolean;
  auth?: OAuth2Client | null;
  /** Gmail query for list backfill (default newer_than:365d). */
  query?: string;
}

interface SyncState {
  mode: "list" | "history";
  pageToken?: string;
  /** Gmail historyId for users.history.list. */
  historyId?: string;
}

/**
 * Gmail adapter (Workspace, gmail.readonly).
 *
 * Historical: `users.messages.list` + `users.messages.get` (format=full).
 * Ongoing: `users.history.list` from stored historyId; prepare watch notes
 * for Pub/Sub push (see GMAIL_WATCH_NOTES / docs/google.md).
 */
export class GmailAdapter implements SourceAdapter {
  readonly source = "gmail" as const;

  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private readonly forceMock: boolean;
  private readonly query: string;
  private readonly injectedAuth: OAuth2Client | null | undefined;
  private mockCache: EmailMessageInput[] | null = null;

  constructor(options: GmailAdapterOptions = {}) {
    this.pageSize = options.pageSize ?? 25;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-gmail";
    this.forceMock = options.mock === true;
    this.query = options.query ?? "newer_than:365d";
    this.injectedAuth = options.auth;
  }

  private useMock(): boolean {
    return this.forceMock || shouldUseGoogleMock();
  }

  /** Expose watch/history setup notes for operators. */
  watchNotes(): string {
    return GMAIL_WATCH_NOTES;
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (this.useMock()) {
      return {
        ok: true,
        detail: `mock mode — ${this.listMock().length} fixture message(s); watch not started`,
      };
    }
    try {
      const auth = this.auth();
      if (!auth) return { ok: false, detail: "GOOGLE_* credentials incomplete" };
      await ensureAccessToken(auth);
      const gmail = gmailApi(auth);
      const profile = await gmail.users.getProfile({ userId: "me" });
      return {
        ok: true,
        detail: `live Gmail ${profile.data.emailAddress ?? "me"} historyId=${profile.data.historyId ?? "?"}`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async fetchPage(checkpoint?: SyncCheckpoint): Promise<AdapterPage> {
    if (this.useMock()) return this.fetchMockPage(checkpoint);
    return this.fetchLivePage(checkpoint);
  }

  /**
   * Full list backfill. When `afterMessageId` is set (collector checkpoint
   * cursor), list pages cheaply until that id, then only `messages.get` the
   * following messages up to `limit`. Avoids re-downloading already-ingested
   * bodies on each stepped `--limit` pass.
   */
  async backfillAll(resume?: {
    afterMessageId?: string;
  }): Promise<RawEnvelope[]> {
    if (this.useMock()) {
      const all = this.listMock().map((m) => this.envelopeFor(m));
      if (!resume?.afterMessageId) return all;
      const idx = all.findIndex((e) => e.sourceRecordId === resume.afterMessageId);
      if (idx < 0) return all;
      const rest = all.slice(idx + 1);
      return this.limit != null ? rest.slice(0, this.limit) : rest;
    }
    if (resume?.afterMessageId) {
      return this.backfillListAfter(resume.afterMessageId);
    }
    return this.backfillListFromStart();
  }

  private async backfillListFromStart(): Promise<RawEnvelope[]> {
    const items: RawEnvelope[] = [];
    let cursor: string | undefined;
    let guard = 0;
    while (guard++ < 500) {
      const page = await this.fetchLivePage(
        cursor
          ? {
              source: "gmail",
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
      const state = this.parseState(page.nextCursor);
      // After list completes we store historyId — stop backfill there
      if (state.mode === "history" && !state.pageToken) break;
      cursor = page.nextCursor;
    }
    return items;
  }

  /** Resume list backfill after a known message id without re-fetching bodies. */
  private async backfillListAfter(afterMessageId: string): Promise<RawEnvelope[]> {
    const auth = this.auth();
    if (!auth) {
      throw new Error(
        "Gmail live mode requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN",
      );
    }
    await ensureAccessToken(auth);
    const gmail = gmailApi(auth);

    const items: RawEnvelope[] = [];
    let pageToken: string | undefined;
    let skipping = true;
    let guard = 0;
    // Gmail list allows up to 500; use large pages while scanning past checkpoint.
    const listMax = 500;

    while (guard++ < 500) {
      const list = await gmail.users.messages.list({
        userId: "me",
        maxResults: listMax,
        pageToken,
        q: this.query,
      });

      for (const ref of list.data.messages ?? []) {
        if (!ref.id) continue;
        if (skipping) {
          if (ref.id === afterMessageId) skipping = false;
          continue;
        }
        const full = await gmail.users.messages.get({
          userId: "me",
          id: ref.id,
          format: "full",
        });
        items.push(this.envelopeFor(this.fromApiMessage(full.data)));
        if (this.limit != null && items.length >= this.limit) {
          return items;
        }
      }

      if (!list.data.nextPageToken) break;
      pageToken = list.data.nextPageToken;
    }

    // Checkpoint id missing from current query window — fall back to full fetch.
    if (skipping) {
      console.warn(
        `[gmail] afterMessageId=${afterMessageId} not in query window; falling back to list-from-start`,
      );
      return this.backfillListFromStart();
    }
    console.info(
      `[gmail] list-resume afterMessageId=${afterMessageId} fetched ${items.length} new message(s)`,
    );
    return items;
  }

  private auth(): OAuth2Client | null {
    if (this.injectedAuth !== undefined) return this.injectedAuth;
    return createOAuth2ClientFromEnv();
  }

  private listMock(): EmailMessageInput[] {
    if (!this.mockCache) {
      let msgs = mockEmailMessages();
      if (this.limit != null && this.limit >= 0) {
        msgs = msgs.slice(0, this.limit);
      }
      this.mockCache = msgs;
    }
    return this.mockCache;
  }

  private fetchMockPage(checkpoint?: SyncCheckpoint): AdapterPage {
    const msgs = this.listMock();
    const start = checkpoint?.cursor ? Number(checkpoint.cursor) || 0 : 0;
    const slice = msgs.slice(start, start + this.pageSize);
    const next = start + slice.length;
    const hasMore = next < msgs.length;
    return {
      items: slice.map((m) => this.envelopeFor(m)),
      nextCursor: hasMore ? String(next) : "mock:history:10002",
      hasMore,
    };
  }

  private parseState(cursor?: string): SyncState {
    if (!cursor) return { mode: "list" };
    try {
      const parsed = JSON.parse(cursor) as SyncState;
      if (parsed?.mode === "list" || parsed?.mode === "history") return parsed;
    } catch {
      /* plain historyId */
    }
    return { mode: "history", historyId: cursor };
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
        "Gmail live mode requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN",
      );
    }
    await ensureAccessToken(auth);
    const gmail = gmailApi(auth);
    const state = this.parseState(checkpoint?.cursor);

    if (state.mode === "history" && state.historyId) {
      return this.fetchHistoryPage(gmail, state);
    }
    return this.fetchListPage(gmail, state);
  }

  private async fetchListPage(
    gmail: ReturnType<typeof gmailApi>,
    state: SyncState,
  ): Promise<AdapterPage> {
    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: this.pageSize,
      pageToken: state.pageToken,
      q: this.query,
    });

    const messages: EmailMessageInput[] = [];
    for (const ref of list.data.messages ?? []) {
      if (!ref.id) continue;
      const full = await gmail.users.messages.get({
        userId: "me",
        id: ref.id,
        format: "full",
      });
      messages.push(this.fromApiMessage(full.data));
    }

    let items = messages.map((m) => this.envelopeFor(m));
    if (this.limit != null) items = items.slice(0, this.limit);

    if (list.data.nextPageToken) {
      return {
        items,
        nextCursor: this.encodeState({
          mode: "list",
          pageToken: list.data.nextPageToken,
        }),
        hasMore: true,
      };
    }

    const profile = await gmail.users.getProfile({ userId: "me" });
    const historyId = profile.data.historyId ?? undefined;
    return {
      items,
      nextCursor: historyId
        ? this.encodeState({ mode: "history", historyId })
        : null,
      hasMore: false,
    };
  }

  private async fetchHistoryPage(
    gmail: ReturnType<typeof gmailApi>,
    state: SyncState,
  ): Promise<AdapterPage> {
    if (!state.historyId) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    try {
      const hist = await gmail.users.history.list({
        userId: "me",
        startHistoryId: state.historyId,
        pageToken: state.pageToken,
        historyTypes: ["messageAdded", "messageDeleted", "labelAdded"],
        maxResults: this.pageSize,
      });

      const ids = new Set<string>();
      for (const h of hist.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (added.message?.id) ids.add(added.message.id);
        }
      }

      const messages: EmailMessageInput[] = [];
      for (const id of ids) {
        try {
          const full = await gmail.users.messages.get({
            userId: "me",
            id,
            format: "full",
          });
          messages.push(this.fromApiMessage(full.data));
        } catch {
          // Message may have been deleted between history and get
        }
      }

      let items = messages.map((m) => this.envelopeFor(m));
      if (this.limit != null) items = items.slice(0, this.limit);

      if (hist.data.nextPageToken) {
        return {
          items,
          nextCursor: this.encodeState({
            mode: "history",
            historyId: state.historyId,
            pageToken: hist.data.nextPageToken,
          }),
          hasMore: true,
        };
      }

      const nextHistoryId = hist.data.historyId ?? state.historyId;
      return {
        items,
        nextCursor: this.encodeState({
          mode: "history",
          historyId: nextHistoryId,
        }),
        hasMore: false,
      };
    } catch (err) {
      const status =
        err && typeof err === "object" && "code" in err
          ? Number((err as { code: unknown }).code)
          : undefined;
      // 404 — historyId too old; restart list backfill
      if (status === 404) {
        return this.fetchListPage(gmail, { mode: "list" });
      }
      throw err;
    }
  }

  private fromApiMessage(data: {
    id?: string | null;
    threadId?: string | null;
    labelIds?: string[] | null;
    snippet?: string | null;
    historyId?: string | null;
    internalDate?: string | null;
    sizeEstimate?: number | null;
    payload?: {
      headers?: Array<{ name?: string | null; value?: string | null }> | null;
      mimeType?: string | null;
      body?: { data?: string | null } | null;
      parts?: Array<{
        mimeType?: string | null;
        body?: { data?: string | null } | null;
        parts?: unknown;
      }> | null;
    } | null;
  }): EmailMessageInput {
    const headers: Record<string, string> = {};
    for (const h of data.payload?.headers ?? []) {
      if (h.name && h.value) headers[h.name.toLowerCase()] = h.value;
    }

    const { bodyText, bodyHtmlPreview } = extractBodies(data.payload);

    return {
      id: data.id!,
      threadId: data.threadId,
      labelIds: data.labelIds,
      snippet: data.snippet,
      historyId: data.historyId,
      internalDate: data.internalDate,
      sizeEstimate: data.sizeEstimate,
      headers,
      bodyText,
      bodyHtmlPreview,
    };
  }

  private envelopeFor(msg: EmailMessageInput): RawEnvelope {
    const { body, summary } = mapEmailMessage(msg);
    return {
      source: "gmail",
      sourceRecordId: emailSourceRecordId(msg.id),
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: googleAccountKey(),
        extra: {
          kind: "email_message_summary",
          accountKey: googleAccountKey(),
          mock: this.useMock(),
          summary,
        },
      },
    };
  }
}

function extractBodies(
  payload:
    | {
        mimeType?: string | null;
        body?: { data?: string | null } | null;
        parts?: Array<{
          mimeType?: string | null;
          body?: { data?: string | null } | null;
          parts?: unknown;
        }> | null;
      }
    | null
    | undefined,
): { bodyText?: string; bodyHtmlPreview?: string } {
  if (!payload) return {};

  let bodyText: string | undefined;
  let bodyHtmlPreview: string | undefined;

  const visit = (part: {
    mimeType?: string | null;
    body?: { data?: string | null } | null;
    parts?: unknown;
  }): void => {
    const mime = part.mimeType ?? "";
    if (part.body?.data) {
      const decoded = decodeGmailBodyData(part.body.data);
      if (mime.startsWith("text/plain") && !bodyText) bodyText = decoded;
      if (mime.startsWith("text/html") && !bodyHtmlPreview) {
        bodyHtmlPreview = decoded.slice(0, 2000);
      }
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        if (child && typeof child === "object") {
          visit(child as typeof part);
        }
      }
    }
  };

  visit(payload);
  return { bodyText, bodyHtmlPreview };
}

export function createGmailAdapter(
  options?: GmailAdapterOptions,
): GmailAdapter {
  return new GmailAdapter(options);
}
