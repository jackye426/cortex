# GBrain schema pack (fork in the brain repo)

This is a **pack template**, not a GBrain engine change. Fork it in Jack’s brain git repo:

```text
gbrain schema fork gbrain-base-v2
```

Do **not** add custom `cycle.ts` phases. Dream stays stock (`lint → backlinks → … → propose_takes → embed`). Compilers run **after** dream:

```text
gbrain dream && pnpm coding-ops -- --pages=$BRAIN --out=$BRAIN
gbrain dream && pnpm weekly-mirror -- --pages=$BRAIN --out=$BRAIN
gbrain dream && pnpm llm-ops -- --pages=$BRAIN --out=$BRAIN
```

## Page kinds

| Layer | Schema | Path | Role |
|-------|--------|------|------|
| L1 | `session-v1` | `conversations/<harness>/<id>.md` | Evidence. Turns **and** tools. |
| L1 | `gmail-v1` / `calendar-v1` / `drive-v1` | `mail/` `calendar/` `drive/` | Evidence. Drive skips sensitivity-flagged files. |
| L1 | `*-week-digest-v1` | `digests/<source>/<ISO-week>.md` | One page per ISO week (YouTube/Spotify/Calibre/browser). |
| L2 | GBrain facts/takes | dream output | Map + takes. **Not** the evidence base. |
| L3 | `coding-ops-*` | `ops/` | `visibility: private`. Cite L1 slugs. |
| L3 | `weekly-mirror-v1` | `self/weekly-YYYY-Www.md` | `visibility: private`. Cite L1 slugs. |
| L3 | `llm-ops-*` | `ops/llm/` | ChatGPT text transcripts. Separate from coding-ops. |

Dream reflections are `assistant_derived` (confidence cap **0.4**). Never cite `self/weekly-*` as the only evidence.

GitHub: use **GBrain native** GitHub source. Cortex github RAG is retired for the GBrain-first path.

Default agent MCP: `gbrain serve` (not Cortex `/mcp` as the daily brain).
