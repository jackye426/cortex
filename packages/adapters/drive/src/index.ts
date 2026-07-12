import { hostname } from "node:os";
import type {
  AdapterPage,
  RawEnvelope,
  SourceAdapter,
  SyncCheckpoint,
} from "@cortex/core";
import {
  createOAuth2ClientFromEnv,
  driveApi,
  ensureAccessToken,
  googleAccountKey,
  shouldUseGoogleMock,
  type OAuth2Client,
} from "@cortex/google-auth";
import {
  driveSourceRecordId,
  EXPORTABLE_MIMES,
  mapDriveFile,
  preferredExportMime,
  type DriveFileInput,
} from "./map.js";
import { mockDriveFiles } from "./mock.js";

export type {
  DriveFileEnvelopeBody,
  DriveFileInput,
  DriveFileSummary,
} from "./map.js";
export {
  DOCS_MIME,
  driveSourceRecordId,
  EXPORTABLE_MIMES,
  mapDriveFile,
  preferredExportMime,
  SHEETS_MIME,
  SLIDES_MIME,
} from "./map.js";
export { mockDriveFiles } from "./mock.js";

export interface DriveAdapterOptions {
  pageSize?: number;
  limit?: number;
  collectorName?: string;
  mock?: boolean;
  auth?: OAuth2Client | null;
  /** Skip files.export (metadata-only). */
  skipExport?: boolean;
}

interface SyncState {
  mode: "list" | "changes";
  pageToken?: string;
  /** Drive changes.startPageToken for incremental. */
  startPageToken?: string;
}

const FILE_FIELDS =
  "id,name,mimeType,description,parents,webViewLink,iconLink,owners(emailAddress,displayName),createdTime,modifiedTime,size,md5Checksum,trashed";

/**
 * Google Drive adapter (Workspace).
 *
 * Historical: `files.list` + `files.export` for Docs/Sheets/Slides
 * (markdown/csv/plain text + PDF companion flag).
 * Ongoing: `changes.list` after capturing `changes.getStartPageToken`.
 */
export class DriveAdapter implements SourceAdapter {
  readonly source = "drive" as const;

  private readonly pageSize: number;
  private readonly limit: number | undefined;
  private readonly collectorName: string;
  private readonly forceMock: boolean;
  private readonly skipExport: boolean;
  private readonly injectedAuth: OAuth2Client | null | undefined;
  private mockCache: DriveFileInput[] | null = null;

  constructor(options: DriveAdapterOptions = {}) {
    this.pageSize = options.pageSize ?? 25;
    this.limit = options.limit;
    this.collectorName = options.collectorName ?? "adapter-drive";
    this.forceMock = options.mock === true;
    this.skipExport = options.skipExport === true;
    this.injectedAuth = options.auth;
  }

  private useMock(): boolean {
    return this.forceMock || shouldUseGoogleMock();
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    if (this.useMock()) {
      return {
        ok: true,
        detail: `mock mode — ${this.listMock().length} fixture file(s)`,
      };
    }
    try {
      const auth = this.auth();
      if (!auth) return { ok: false, detail: "GOOGLE_* credentials incomplete" };
      await ensureAccessToken(auth);
      const drive = driveApi(auth);
      const about = await drive.about.get({ fields: "user(emailAddress,displayName)" });
      return {
        ok: true,
        detail: `live Drive as ${about.data.user?.emailAddress ?? "unknown"}`,
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

  async backfillAll(): Promise<RawEnvelope[]> {
    if (this.useMock()) {
      return this.listMock().map((f) => this.envelopeFor(f));
    }
    const items: RawEnvelope[] = [];
    let cursor: string | undefined;
    let guard = 0;
    while (guard++ < 500) {
      const page = await this.fetchLivePage(
        cursor
          ? {
              source: "drive",
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
      // Stop after list phase completes (cursor switches to changes token)
      const state = this.parseState(page.nextCursor);
      if (state.mode === "changes" && !page.hasMore) break;
      if (state.mode === "changes" && !state.pageToken) {
        // List finished; startPageToken stored — backfill complete
        break;
      }
      cursor = page.nextCursor;
    }
    return items;
  }

  private auth(): OAuth2Client | null {
    if (this.injectedAuth !== undefined) return this.injectedAuth;
    return createOAuth2ClientFromEnv();
  }

  private listMock(): DriveFileInput[] {
    if (!this.mockCache) {
      let files = mockDriveFiles();
      if (this.limit != null && this.limit >= 0) {
        files = files.slice(0, this.limit);
      }
      this.mockCache = files;
    }
    return this.mockCache;
  }

  private fetchMockPage(checkpoint?: SyncCheckpoint): AdapterPage {
    const files = this.listMock();
    const start = checkpoint?.cursor ? Number(checkpoint.cursor) || 0 : 0;
    const slice = files.slice(start, start + this.pageSize);
    const next = start + slice.length;
    const hasMore = next < files.length;
    return {
      items: slice.map((f) => this.envelopeFor(f)),
      nextCursor: hasMore ? String(next) : "mock:changes:0",
      hasMore,
    };
  }

  private parseState(cursor?: string): SyncState {
    if (!cursor) return { mode: "list" };
    try {
      const parsed = JSON.parse(cursor) as SyncState;
      if (parsed?.mode === "list" || parsed?.mode === "changes") return parsed;
    } catch {
      /* fall through */
    }
    return { mode: "changes", startPageToken: cursor };
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
        "Drive live mode requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN",
      );
    }
    await ensureAccessToken(auth);
    const drive = driveApi(auth);
    const state = this.parseState(checkpoint?.cursor);

    if (state.mode === "changes" && state.startPageToken) {
      return this.fetchChangesPage(drive, state);
    }

    return this.fetchListPage(drive, state);
  }

  private async fetchListPage(
    drive: ReturnType<typeof driveApi>,
    state: SyncState,
  ): Promise<AdapterPage> {
    const res = await drive.files.list({
      pageSize: this.pageSize,
      pageToken: state.pageToken,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      q: "trashed = false",
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files: DriveFileInput[] = [];
    for (const f of res.data.files ?? []) {
      if (!f.id) continue;
      files.push(await this.enrichFile(drive, f));
    }

    let items = files.map((f) => this.envelopeFor(f));
    if (this.limit != null) items = items.slice(0, this.limit);

    if (res.data.nextPageToken) {
      return {
        items,
        nextCursor: this.encodeState({
          mode: "list",
          pageToken: res.data.nextPageToken,
        }),
        hasMore: true,
      };
    }

    // Capture changes start token for incremental
    const start = await drive.changes.getStartPageToken({
      supportsAllDrives: true,
    });
    const startPageToken = start.data.startPageToken ?? undefined;
    return {
      items,
      nextCursor: startPageToken
        ? this.encodeState({ mode: "changes", startPageToken })
        : null,
      hasMore: false,
    };
  }

  private async fetchChangesPage(
    drive: ReturnType<typeof driveApi>,
    state: SyncState,
  ): Promise<AdapterPage> {
    const pageToken = state.pageToken ?? state.startPageToken;
    if (!pageToken) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const res = await drive.changes.list({
      pageToken,
      pageSize: this.pageSize,
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files: DriveFileInput[] = [];
    for (const ch of res.data.changes ?? []) {
      if (ch.removed || !ch.file?.id) continue;
      files.push(await this.enrichFile(drive, ch.file));
    }

    let items = files.map((f) => this.envelopeFor(f));
    if (this.limit != null) items = items.slice(0, this.limit);

    if (res.data.nextPageToken) {
      return {
        items,
        nextCursor: this.encodeState({
          mode: "changes",
          startPageToken: state.startPageToken,
          pageToken: res.data.nextPageToken,
        }),
        hasMore: true,
      };
    }

    const nextStart = res.data.newStartPageToken ?? state.startPageToken;
    return {
      items,
      nextCursor: nextStart
        ? this.encodeState({ mode: "changes", startPageToken: nextStart })
        : null,
      hasMore: false,
    };
  }

  private async enrichFile(
    drive: ReturnType<typeof driveApi>,
    f: {
      id?: string | null;
      name?: string | null;
      mimeType?: string | null;
      description?: string | null;
      parents?: string[] | null;
      webViewLink?: string | null;
      iconLink?: string | null;
      owners?: Array<{
        emailAddress?: string | null;
        displayName?: string | null;
      }> | null;
      createdTime?: string | null;
      modifiedTime?: string | null;
      size?: string | null;
      md5Checksum?: string | null;
      trashed?: boolean | null;
    },
  ): Promise<DriveFileInput> {
    const base: DriveFileInput = {
      id: f.id!,
      name: f.name,
      mimeType: f.mimeType,
      description: f.description,
      parents: f.parents,
      webViewLink: f.webViewLink,
      iconLink: f.iconLink,
      owners: f.owners,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      size: f.size,
      md5Checksum: f.md5Checksum,
      trashed: f.trashed,
    };

    if (
      this.skipExport ||
      !f.mimeType ||
      !EXPORTABLE_MIMES.has(f.mimeType)
    ) {
      return base;
    }

    const { exportMime, format } = preferredExportMime(f.mimeType);
    try {
      const exported = await drive.files.export(
        { fileId: f.id!, mimeType: exportMime },
        { responseType: "text" },
      );
      const text =
        typeof exported.data === "string"
          ? exported.data
          : String(exported.data ?? "");
      return {
        ...base,
        exportText: text,
        exportFormat: format,
        exportMime,
        pdfRequested: true,
        exportByteLength: Buffer.byteLength(text, "utf8"),
      };
    } catch {
      // Export can fail for large/restricted docs — keep metadata
      return {
        ...base,
        exportFormat: format,
        exportMime,
        pdfRequested: true,
      };
    }
  }

  private envelopeFor(file: DriveFileInput): RawEnvelope {
    const { body, summary } = mapDriveFile(file);
    return {
      source: "drive",
      sourceRecordId: driveSourceRecordId(file.id),
      occurredAt: summary.occurredAt,
      mimeType: "application/json",
      body,
      provenance: {
        collector: this.collectorName,
        host: hostname(),
        workspace: googleAccountKey(),
        extra: {
          kind: "drive_file_summary",
          accountKey: googleAccountKey(),
          mock: this.useMock(),
          summary,
        },
      },
    };
  }
}

export function createDriveAdapter(
  options?: DriveAdapterOptions,
): DriveAdapter {
  return new DriveAdapter(options);
}
