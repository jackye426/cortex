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
import { runLlmOpsFromPages } from "./from-pages.js";

function writePage(root: string, rel: string, markdown: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, markdown, "utf8");
}

describe("llm-ops from transcript pages", () => {
  it("scores ChatGPT text pages and skips coding-ops sources", async () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-ops-pages-"));
    writePage(
      dir,
      "conversations/chatgpt-export/fixture-chatgpt-1.md",
      renderSessionPage(CHATGPT_FIXTURE_SESSION),
    );
    writePage(
      dir,
      "conversations/claude-code/fixture-claude-1.md",
      renderSessionPage(CLAUDE_FIXTURE_SESSION),
    );
    const result = await runLlmOpsFromPages({
      pagesDir: dir,
      outDir: dir,
      dryRun: false,
    });
    assert.ok(result.scanned >= 1);
    assert.ok(result.skipped >= 1);
    assert.ok(result.samples.every((s) => s.sourceId !== "claude-code"));
    assert.ok(
      result.samples.some((s) => s.sourceId === "chatgpt-export"),
    );
    assert.ok(result.writtenPaths.some((p) => p.startsWith("ops/llm/")));
    assert.ok(
      result.samples.some((s) =>
        s.slug.includes("conversations/chatgpt-export/"),
      ),
    );
  });
});
