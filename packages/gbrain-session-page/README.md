# @cortex/gbrain-session-page

session-v1 markdown for GBrain L1. Cortex writers emit these pages; coding-ops and weekly-mirror compilers **read them**.

## How compilers must read L1

1. Evidence is the session/email/digest **page slug** (`conversations/<harness>/<source_session_id>`), never a dream reflection path.
2. Parse with `parseSessionPage`. `extractSessionOps` needs `messages[]` **and** `toolCalls[]` from `## Tools`.
3. Stock `gbrain transcripts ingest` is text-only (no Cursor, no tools) — insufficient for coding-ops.
4. Do not grade `gbrain dream` summaries as if they were the session. L2 is a map + takes, not the evidence base.
5. Cite slugs in `evidenceSessionIds` / `evidence[].excerpt`. Dream pages are `assistant_derived` (confidence cap 0.4).
6. Skip ChatGPT pages in coding-ops (`isCodingOpsSource`). llm-ops reads those separately.
7. Redaction already ran on write; never put secrets back into `ops/` or `self/` pages.
8. `ops/` and `self/` are compiler output (L3), not L1 evidence.

Render: `renderSessionPage(detail)` → YAML (`cortex_schema: session-v1`) + `## Turns` + `## Tools`.
