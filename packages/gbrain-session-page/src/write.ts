import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderSessionPageFull } from "./render.js";
import type { SessionDetail, SessionPageRender } from "./types.js";

export interface WriteSessionPageOptions {
  /** Brain repo root. Pages land at conversations/<harness>/<id>.md */
  brainDir: string;
  dryRun?: boolean;
}

export interface WriteSessionPageResult extends SessionPageRender {
  absolutePath: string;
  dryRun: boolean;
  written: boolean;
}

export function writeSessionPage(
  detail: SessionDetail,
  options: WriteSessionPageOptions,
): WriteSessionPageResult {
  const rendered = renderSessionPageFull(detail);
  const absolutePath = join(options.brainDir, rendered.relativePath);
  const dryRun = Boolean(options.dryRun);
  if (!dryRun) {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, rendered.markdown, "utf8");
  }
  return {
    ...rendered,
    absolutePath,
    dryRun,
    written: !dryRun,
  };
}
