import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  CLAUDE_FIXTURE_SESSION,
  renderRecordPage,
  renderSessionPage,
} from "@cortex/gbrain-session-page";
import { ASSISTANT_ONLY_CONFIDENCE_CAP } from "./types.js";
import {
  analyzeWeeklyOnlyCite,
  compileWeeklyMirrorFromL1,
} from "./from-l1.js";
import { assertInsightCardComplete } from "./insight-card.js";

function writePage(root: string, rel: string, markdown: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, markdown, "utf8");
}

describe("weekly-mirror from L1 pages", () => {
  it("cites session + email slugs, not self/weekly-* ", () => {
    const dir = mkdtempSync(join(tmpdir(), "wm-l1-"));
    writePage(
      dir,
      "conversations/claude-code/fixture-claude-1.md",
      renderSessionPage(CLAUDE_FIXTURE_SESSION),
    );
    writePage(
      dir,
      "mail/msg-100.md",
      renderRecordPage({
        schema: "gmail-v1",
        slug: "mail/msg-100",
        sourceId: "gmail",
        sourceRecordId: "msg-100",
        title: "Q3 roadmap sync",
        occurredAt: "2026-07-09T09:15:00.000Z",
        body: "Can we review the Cortex MCP milestone?",
      }).markdown,
    );

    const result = compileWeeklyMirrorFromL1({
      pagesDir: dir,
      weekKey: "2026-W28",
      dryRun: true,
    });
    const attention = result.cards.find((c) => c.theme === "attention");
    assert.ok(attention);
    const missing = assertInsightCardComplete(attention!);
    assert.equal(missing.length, 0);
    const excerpts = attention!.evidence.map((e) => e.excerpt ?? "").join(" ");
    assert.match(excerpts, /conversations\/claude-code\/fixture-claude-1/);
    assert.match(excerpts, /mail\/msg-100/);
    assert.doesNotMatch(excerpts, /self\/weekly-/);
    for (const card of result.cards) {
      assert.equal(assertInsightCardComplete(card).length, 0);
    }
  });

  it("caps dream/weekly-only cites as assistant_derived circular evidence", () => {
    const analysis = analyzeWeeklyOnlyCite("self/weekly-2026-W28");
    assert.equal(analysis.assistantOnly, true);
    assert.ok(analysis.issues.some((i) => i.code === "circular_evidence"));
    assert.ok(analysis.cappedConfidence <= ASSISTANT_ONLY_CONFIDENCE_CAP);

    const dir = mkdtempSync(join(tmpdir(), "wm-dream-"));
    writePage(
      dir,
      "self/weekly-2026-W27.md",
      [
        "---",
        "cortex_schema: dream-reflection",
        "---",
        "",
        "# Dream reflection",
        "",
      ].join("\n"),
    );
    const result = compileWeeklyMirrorFromL1({
      pagesDir: dir,
      weekKey: "2026-W28",
      dryRun: true,
    });
    const attention = result.cards.find((c) => c.theme === "attention")!;
    assert.equal(
      attention.evidence.every((e) => e.supportKind === "assistant_derived"),
      true,
    );
    assert.ok(attention.confidence <= ASSISTANT_ONLY_CONFIDENCE_CAP + 0.0001);
  });
});
