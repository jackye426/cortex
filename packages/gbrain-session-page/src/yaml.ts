/** Minimal YAML frontmatter dump/parse for session-v1 pages. */

export function yamlQuote(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")}"`;
}

export function yamlUnquote(raw: string): string {
  const t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    const inner = t.slice(1, -1);
    if (t.startsWith('"')) {
      return inner
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    return inner;
  }
  return t;
}

export function dumpFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value === null) {
      lines.push(`${key}: null`);
      continue;
    }
    if (typeof value === "boolean" || typeof value === "number") {
      lines.push(`${key}: ${value}`);
      continue;
    }
    if (typeof value === "object") {
      lines.push(`${key}: ${yamlQuote(JSON.stringify(value))}`);
      continue;
    }
    const s = String(value);
    if (s === "") {
      lines.push(`${key}: ""`);
      continue;
    }
    if (/^[\w./:+-]+$/.test(s) && !s.includes("\\")) {
      lines.push(`${key}: ${s}`);
      continue;
    }
    lines.push(`${key}: ${yamlQuote(s)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function parseFrontmatter(markdown: string): {
  fields: Record<string, string | null>;
  body: string;
} {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    throw new Error("session-v1 page is missing YAML frontmatter");
  }
  const fields: Record<string, string | null> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    if (raw === "null" || raw === "~") {
      fields[key] = null;
    } else {
      fields[key] = yamlUnquote(raw);
    }
  }
  return { fields, body: m[2] ?? "" };
}
