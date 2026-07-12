import type { DriveFileInput } from "./map.js";
import { DOCS_MIME, SHEETS_MIME, SLIDES_MIME } from "./map.js";

/** Deterministic Drive fixtures for dry-run / missing credentials. */
export function mockDriveFiles(): DriveFileInput[] {
  return [
    {
      id: "mock-doc-1",
      name: "Cortex notes (mock)",
      mimeType: DOCS_MIME,
      webViewLink: "https://docs.google.com/document/d/mock-doc-1",
      owners: [{ emailAddress: "you@workspace.example" }],
      createdTime: "2026-06-01T10:00:00Z",
      modifiedTime: "2026-07-10T15:00:00Z",
      exportText:
        "# Cortex notes\n\nMock Google Doc export as markdown for dry-run.",
      exportFormat: "markdown",
      exportMime: "text/markdown",
      pdfRequested: true,
      exportByteLength: 64,
    },
    {
      id: "mock-sheet-1",
      name: "Budget (mock)",
      mimeType: SHEETS_MIME,
      webViewLink: "https://docs.google.com/spreadsheets/d/mock-sheet-1",
      owners: [{ emailAddress: "you@workspace.example" }],
      modifiedTime: "2026-07-08T12:00:00Z",
      exportText: "item,amount\ncoffee,4.50\nlunch,12.00\n",
      exportFormat: "csv",
      exportMime: "text/csv",
      pdfRequested: true,
      exportByteLength: 40,
    },
    {
      id: "mock-slides-1",
      name: "Demo deck (mock)",
      mimeType: SLIDES_MIME,
      webViewLink: "https://docs.google.com/presentation/d/mock-slides-1",
      owners: [{ emailAddress: "you@workspace.example" }],
      modifiedTime: "2026-07-05T09:00:00Z",
      exportText: "Slide 1: Title\nSlide 2: Agenda\n",
      exportFormat: "plain",
      exportMime: "text/plain",
      pdfRequested: true,
      exportByteLength: 36,
    },
    {
      id: "mock-pdf-1",
      name: "uploaded.pdf",
      mimeType: "application/pdf",
      webViewLink: "https://drive.google.com/file/d/mock-pdf-1/view",
      owners: [{ emailAddress: "you@workspace.example" }],
      modifiedTime: "2026-07-01T08:00:00Z",
      size: "1024",
      // Binary uploads: metadata only (no files.export)
    },
  ];
}
