/**
 * Gmail message → raw envelope body + summary.
 */

export interface EmailMessageSummary {
  messageId: string;
  threadId?: string;
  subject?: string;
  from?: string;
  to?: string[];
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  occurredAt?: string;
}

export interface EmailMessageEnvelopeBody {
  kind: "email_message";
  messageId: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  headers?: {
    subject?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    date?: string;
    messageIdHeader?: string;
  };
  /** Decoded text/plain body when available (readonly ingest). */
  bodyText?: string;
  /** Decoded text/html stripped preview (optional). */
  bodyHtmlPreview?: string;
  sizeEstimate?: number;
}

export interface EmailMessageInput {
  id: string;
  threadId?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  historyId?: string | null;
  internalDate?: string | null;
  sizeEstimate?: number | null;
  headers?: Record<string, string>;
  bodyText?: string | null;
  bodyHtmlPreview?: string | null;
}

export function emailSourceRecordId(messageId: string): string {
  return messageId;
}

function splitAddresses(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mapEmailMessage(msg: EmailMessageInput): {
  body: EmailMessageEnvelopeBody;
  summary: EmailMessageSummary;
} {
  const subject = msg.headers?.subject ?? msg.headers?.Subject;
  const from = msg.headers?.from ?? msg.headers?.From;
  const toRaw = msg.headers?.to ?? msg.headers?.To;
  const ccRaw = msg.headers?.cc ?? msg.headers?.Cc;
  const date = msg.headers?.date ?? msg.headers?.Date;
  const messageIdHeader =
    msg.headers?.["message-id"] ?? msg.headers?.["Message-Id"];

  let internalIso: string | undefined;
  if (msg.internalDate) {
    const n = Number(msg.internalDate);
    if (Number.isFinite(n)) {
      internalIso = new Date(n).toISOString();
    }
  }

  const body: EmailMessageEnvelopeBody = {
    kind: "email_message",
    messageId: msg.id,
    threadId: msg.threadId ?? undefined,
    labelIds: msg.labelIds ?? undefined,
    snippet: msg.snippet ?? undefined,
    historyId: msg.historyId ?? undefined,
    internalDate: internalIso ?? msg.internalDate ?? undefined,
    headers: {
      subject,
      from,
      to: splitAddresses(toRaw),
      cc: splitAddresses(ccRaw),
      date,
      messageIdHeader,
    },
    bodyText: msg.bodyText ?? undefined,
    bodyHtmlPreview: msg.bodyHtmlPreview ?? undefined,
    sizeEstimate: msg.sizeEstimate ?? undefined,
  };

  const summary: EmailMessageSummary = {
    messageId: msg.id,
    threadId: msg.threadId ?? undefined,
    subject,
    from,
    to: splitAddresses(toRaw),
    labelIds: msg.labelIds ?? undefined,
    snippet: msg.snippet?.slice(0, 120),
    internalDate: internalIso,
    occurredAt: internalIso ?? date,
  };

  return { body, summary };
}

/** Decode Gmail body data (base64url). */
export function decodeGmailBodyData(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}
