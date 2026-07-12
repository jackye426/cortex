import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  composerIdFromTranscriptPath,
  listAgentTranscriptFiles,
} from "./paths.js";

/**
 * Index agent-transcript JSONL files by composer UUID.
 * Multiple files for the same id keep the longest path (usually the nested copy).
 */
export function indexAgentTranscripts(
  projectsRoot: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const files = listAgentTranscriptFiles(projectsRoot);
  for (const filePath of files) {
    const id = composerIdFromTranscriptPath(filePath);
    const existing = map.get(id);
    if (!existing || filePath.length > existing.length) {
      map.set(id, filePath);
    }
  }
  return map;
}

/** Stream-parse an agent-transcript JSONL into event objects. */
export async function readAgentTranscriptEvents(
  filePath: string,
): Promise<unknown[]> {
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
