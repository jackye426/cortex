/**
 * Google Drive file → raw envelope (metadata + optional exported text).
 */

/** Google Workspace native MIME types we export. */
export const DOCS_MIME = "application/vnd.google-apps.document";
export const SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
export const SLIDES_MIME = "application/vnd.google-apps.presentation";

export const EXPORTABLE_MIMES = new Set([
  DOCS_MIME,
  SHEETS_MIME,
  SLIDES_MIME,
]);

/** Preferred export MIME per native type. */
export function preferredExportMime(nativeMime: string): {
  exportMime: string;
  format: "markdown" | "csv" | "plain" | "pdf";
} {
  switch (nativeMime) {
    case DOCS_MIME:
      return { exportMime: "text/markdown", format: "markdown" };
    case SHEETS_MIME:
      // Sheets has no markdown export; CSV is the text path; PDF kept as alt.
      return { exportMime: "text/csv", format: "csv" };
    case SLIDES_MIME:
      return { exportMime: "text/plain", format: "plain" };
    default:
      return { exportMime: "application/pdf", format: "pdf" };
  }
}

export interface DriveFileSummary {
  fileId: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  owners?: string[];
  exportFormat?: string;
  textPreview?: string;
  occurredAt?: string;
}

export interface DriveFileEnvelopeBody {
  kind: "drive_file";
  fileId: string;
  name?: string;
  mimeType?: string;
  description?: string;
  parents?: string[];
  webViewLink?: string;
  iconLink?: string;
  owners?: Array<{ emailAddress?: string; displayName?: string }>;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
  md5Checksum?: string;
  trashed?: boolean;
  /** Export result for Docs/Sheets/Slides (text path). */
  export?: {
    format: string;
    exportMime: string;
    /** Exported text (markdown/csv/plain). Binary PDF is not inlined. */
    text?: string;
    /** True when PDF export was requested as companion metadata only. */
    pdfRequested?: boolean;
    byteLength?: number;
  };
}

export interface DriveFileInput {
  id: string;
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
  exportText?: string | null;
  exportFormat?: string | null;
  exportMime?: string | null;
  pdfRequested?: boolean;
  exportByteLength?: number;
}

export function driveSourceRecordId(fileId: string): string {
  return fileId;
}

export function mapDriveFile(file: DriveFileInput): {
  body: DriveFileEnvelopeBody;
  summary: DriveFileSummary;
} {
  const body: DriveFileEnvelopeBody = {
    kind: "drive_file",
    fileId: file.id,
    name: file.name ?? undefined,
    mimeType: file.mimeType ?? undefined,
    description: file.description ?? undefined,
    parents: file.parents ?? undefined,
    webViewLink: file.webViewLink ?? undefined,
    iconLink: file.iconLink ?? undefined,
    owners: (file.owners ?? []).map((o) => ({
      emailAddress: o.emailAddress ?? undefined,
      displayName: o.displayName ?? undefined,
    })),
    createdTime: file.createdTime ?? undefined,
    modifiedTime: file.modifiedTime ?? undefined,
    size: file.size ?? undefined,
    md5Checksum: file.md5Checksum ?? undefined,
    trashed: file.trashed ?? undefined,
  };

  if (file.exportText != null || file.exportMime) {
    body.export = {
      format: file.exportFormat ?? "unknown",
      exportMime: file.exportMime ?? "text/plain",
      text: file.exportText ?? undefined,
      pdfRequested: file.pdfRequested,
      byteLength: file.exportByteLength,
    };
  }

  const textPreview =
    file.exportText != null
      ? file.exportText.slice(0, 200).replace(/\s+/g, " ")
      : undefined;

  const summary: DriveFileSummary = {
    fileId: file.id,
    name: file.name ?? undefined,
    mimeType: file.mimeType ?? undefined,
    modifiedTime: file.modifiedTime ?? undefined,
    webViewLink: file.webViewLink ?? undefined,
    owners: (file.owners ?? [])
      .map((o) => o.emailAddress)
      .filter((e): e is string => Boolean(e)),
    exportFormat: file.exportFormat ?? undefined,
    textPreview,
    occurredAt: file.modifiedTime ?? file.createdTime ?? undefined,
  };

  return { body, summary };
}
