import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Stream-parse a Claude Code JSONL transcript into event objects. */
export async function readJsonlEvents(filePath: string): Promise<unknown[]> {
  const events: unknown[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as unknown);
    } catch {
      events.push({ type: "_parse_error", raw: trimmed.slice(0, 500) });
    }
  }

  return events;
}
