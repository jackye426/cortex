import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  CLAUDE_FIXTURE_SESSION,
  CHATGPT_FIXTURE_SESSION,
  renderSessionPage,
} from "@cortex/gbrain-session-page";
import { runCodingOpsFromPages } from "./from-pages.js";

function writePage(root: string, rel: string, markdown: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, markdown, "utf8");
}

describe("coding-ops from session-v1 pages", () => {
  it("dry-run scores fixture pages with slug citations and skips ChatGPT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coding-ops-pages-"));
    writePage(
      dir,
      "conversations/claude-code/fixture-claude-1.md",
      renderSessionPage(CLAUDE_FIXTURE_SESSION),
    );
    writePage(
      dir,
      "conversations/chatgpt-export/fixture-chatgpt-1.md",
      renderSessionPage(CHATGPT_FIXTURE_SESSION),
    );

    const result = await runCodingOpsFromPages({
      pagesDir: dir,
      outDir: dir,
      dryRun: true,
      stubOnly: true,
    });

    assert.equal(result.scanned, 1);
    assert.ok(result.skipped >= 1, "chatgpt page skipped");
    assert.ok(result.episodes >= 1);
    assert.ok(result.profile);
    assert.ok(result.scoresWritten >= 1);
    assert.ok(
      result.samples.every((s) => s.slug.includes("conversations/claude-code/")),
    );
    assert.ok(
      result.writtenPaths.some((p) => p.startsWith("ops/episodes/")),
    );
    assert.ok(result.profile!.axes);
    const axisKeys = Object.keys(result.profile!.axes);
    assert.ok(axisKeys.length >= 1);
  });

  it("writes ops/episodes markdown with axis keys and evidenceSessionIds slugs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coding-ops-write-"));
    writePage(
      dir,
      "conversations/claude-code/fixture-claude-1.md",
      renderSessionPage(CLAUDE_FIXTURE_SESSION),
    );
    const result = await runCodingOpsFromPages({
      pagesDir: dir,
      outDir: dir,
      dryRun: false,
      stubOnly: true,
    });
    assert.equal(result.profileWritten, true);
    const epPath = result.writtenPaths.find((p) => p.startsWith("ops/episodes/"));
    assert.ok(epPath);
    const { readFileSync } = await import("node:fs");
    const md = readFileSync(join(dir, epPath!), "utf8");
    assert.match(md, /execution_leverage|steering|engineering_quality|product_thinking|planning/);
    assert.match(md, /evidenceSessionIds/);
    assert.match(md, /conversations\/claude-code\/fixture-claude-1/);
    assert.doesNotMatch(md, /self\/weekly-/);
  });
});
