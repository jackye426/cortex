# Post-gate source distillate adapters

Session + YouTube digests ship in v1. Other sources stay **keyword-only** until quality-gate passes and each adapter is enabled deliberately.

## Enablement order

| Order | Adapter | Grain | Acceptance check |
|-------|---------|-------|------------------|
| 1 | `email-thread` | Multi-message Gmail threads → commitments + open loops | `ask_mirror` cites `email_thread_digest` for “What commitments did email create?” |
| 2 | `github-outcome` | PR/issue outcomes (not README/files) | Links a session next-action → shipped/stalled PR with citations |
| 3 | `calendar-event` | 1:1 / sync / review / interview only | Meetings usable in priority-vs-actual without gym/focus noise |
| 4 | `drive-file` | Recently authored/edited high-signal docs | Specs/briefs only; no dump folders |
| 5 | `browser-interest` | Weekly bookmark/search themes | Reflective themes; no visit firehose |
| 6 | `spotify-interest` | Weekly artist/show clusters | Reflective only |

YouTube weekly digests are already on; richness needs Takeout watch history.

## Grain / noise (do not distill)

| Source | Do | Skip |
|--------|----|------|
| Gmail | Threads (≥2 msgs), commitments, open loops | newsletters, noreply, promotions, social, spam |
| Calendar | Non-noisy meetings | gym, focus blocks, lunch, most recurring |
| GitHub | PR/issue outcomes (+ optional weekly repo rollup) | bots, dependabot, README/file blobs as first-class memory |
| Drive | High-signal docs you authored/edited | dumps, shared junk |
| Browser | Weekly bookmark/search themes | visit history |
| Spotify | Weekly artist/show clusters | every play |

## Rollout steps (per adapter)

```powershell
pnpm source-adapter -- --list
pnpm source-adapter -- --adapter=email-thread --dry-run --limit=5
# inspect content — then small live write
pnpm source-adapter -- --adapter=email-thread --limit=5
# spot-check via MCP ask_mirror / search_memory mode=operational
pnpm quality-gate -- --limit=11
```

Only enable the next adapter after Mirror still passes and the new distillates answer their eval questions with citations.
