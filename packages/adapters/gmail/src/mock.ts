import type { EmailMessageInput } from "./map.js";

/** Deterministic Gmail fixtures for dry-run / missing credentials. */
export function mockEmailMessages(): EmailMessageInput[] {
  return [
    {
      id: "mock-msg-1",
      threadId: "mock-thread-1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "Welcome to Cortex mock Gmail ingest…",
      historyId: "10001",
      internalDate: String(Date.parse("2026-07-10T14:30:00Z")),
      sizeEstimate: 2048,
      headers: {
        subject: "Welcome to Cortex (mock)",
        from: "noreply@workspace.example",
        to: "you@workspace.example",
        date: "Fri, 10 Jul 2026 14:30:00 +0000",
        "message-id": "<mock-1@workspace.example>",
      },
      bodyText:
        "Hello,\n\nThis is a mock Gmail message for Cortex dry-run.\n\n— Cortex\n",
    },
    {
      id: "mock-msg-2",
      threadId: "mock-thread-2",
      labelIds: ["INBOX"],
      snippet: "Quarterly planning notes attached…",
      historyId: "10002",
      internalDate: String(Date.parse("2026-07-09T09:00:00Z")),
      headers: {
        subject: "Q3 planning",
        from: "teammate@workspace.example",
        to: "you@workspace.example",
        cc: "ops@workspace.example",
        date: "Thu, 9 Jul 2026 09:00:00 +0000",
      },
      bodyText: "Can we sync on Q3 priorities tomorrow?\n",
    },
  ];
}

/**
 * Notes for Gmail push (users.watch) — not enabled in Phase 5 scaffolding.
 *
 * Production path (later):
 * 1. Create a GCP Pub/Sub topic in the same project as the OAuth client.
 * 2. Grant `gmail-api-push@system.gserviceaccount.com` Pub/Sub Publisher.
 * 3. Call `users.watch({ userId: 'me', requestBody: { topicName, labelIds } })`.
 * 4. On notification, call `users.history.list({ startHistoryId })` and fetch
 *    new/changed message ids (same incremental path as poll).
 * 5. Renew watch before `expiration` (~7 days).
 *
 * Fallback: poll `history.list` with stored `historyId` from profile/getProfile
 * or the last ingested message's historyId.
 */
export const GMAIL_WATCH_NOTES = `
Gmail users.watch + Pub/Sub (Phase 5 prepared, not auto-started):
- Requires GCP Pub/Sub topic + IAM for gmail-api-push service account.
- watch response includes historyId + expiration; renew before expiry.
- Push payload is a nudge only — always fetch via history.list.
- Poll fallback: store historyId checkpoint; history.list on interval.
`.trim();
