import { createHash } from "node:crypto";
import { redactText } from "@cortex/redaction";
import { sanitizePathPart } from "./render.js";
import { dumpFrontmatter } from "./yaml.js";

export interface RecordPageInput {
  schema: string;
  slug: string;
  sourceId: string;
  sourceRecordId: string;
  title?: string | null;
  occurredAt?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface WeeklyDigestInput {
  schema: string;
  sourceId: string;
  weekKey: string;
  title: string;
  items: Array<{ id: string; title: string; occurredAt?: string | null }>;
  notes?: string[];
}

function hashText(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Generic L1 record page (email/calendar/drive) with redaction on body. */
export function renderRecordPage(input: RecordPageInput): {
  markdown: string;
  relativePath: string;
  redactionHitCount: number;
  skippedSensitive?: boolean;
} {
  const redacted = redactText(input.body);
  const fm = dumpFrontmatter({
    cortex_schema: input.schema,
    harness: input.sourceId,
    source_record_id: input.sourceRecordId,
    title: input.title ?? null,
    occurred_at: input.occurredAt ?? null,
    content_hash: hashText(redacted.text),
    metadata: input.metadata ?? {},
  });
  const markdown = `${fm}\n\n# ${input.title ?? input.sourceRecordId}\n\n${redacted.text}\n`;
  const relativePath = `${input.slug
    .split("/")
    .map((part) => sanitizePathPart(part))
    .join("/")}.md`;
  return {
    markdown,
    relativePath,
    redactionHitCount: redacted.hits.reduce((s, h) => s + h.count, 0),
  };
}

/**
 * One digest page per ISO week — not per track/event.
 * Used for YouTube / Spotify / Calibre / browser.
 */
export function renderWeeklyDigestPage(input: WeeklyDigestInput): {
  markdown: string;
  relativePath: string;
} {
  const slug = `digests/${input.sourceId}/${input.weekKey}`;
  const fm = dumpFrontmatter({
    cortex_schema: input.schema,
    harness: input.sourceId,
    week_key: input.weekKey,
    item_count: input.items.length,
    content_hash: hashText(
      JSON.stringify(input.items.map((i) => i.id).sort()),
    ),
  });
  const lines = input.items.map(
    (i) =>
      `- ${i.occurredAt ?? ""} ${i.title} (\`${i.id}\`)`.replace(/^-  /, "- "),
  );
  const notes = (input.notes ?? []).map((n) => `- ${n}`);
  const markdown = [
    fm,
    "",
    `# ${input.title}`,
    "",
    `ISO week **${input.weekKey}**. ${input.items.length} item(s). Not a per-event page.`,
    "",
    "## Items",
    "",
    lines.length ? lines.join("\n") : "_None._",
    "",
    notes.length ? `## Notes\n\n${notes.join("\n")}\n` : "",
  ].join("\n");
  return { markdown, relativePath: `${slug}.md` };
}
