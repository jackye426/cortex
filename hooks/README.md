# Cortex reference hooks (GBrain-first)

Default: write a markdown delta under `CORTEX_GBRAIN_DIR` (`conversations/<harness>/hook-*.md`). Full session-v1 pages come from collector `--sink=gbrain-dir=...`. Agent MCP is **`gbrain serve`**, not Cortex ingest.

Legacy `POST /v1/ingest` is a **dead flag**: set `CORTEX_HOOK_INGEST=1` plus `CORTEX_INGEST_URL` / `CORTEX_INGEST_TOKEN`. Hooks are **best-effort** (exit `0`). Shared helper: [`lib/post-ingest.mjs`](lib/post-ingest.mjs).

## Prerequisites

```powershell
# Prefer always-on API via pm2 — see docs/ops-windows.md
cd "C:\Users\yulon\Desktop\Current Projects\Cortex"
pnpm build
pm2 start ecosystem.config.cjs
```

Or for a quick smoke: `pnpm dev:api` with `.env` containing `CORTEX_INGEST_TOKEN`.

Hooks auto-load repo-root `.env` when `CORTEX_INGEST_*` are unset (via `post-ingest.mjs` / Cursor `.cmd` wrappers).

## Claude Code

Scripts:

| File | Hook event |
|------|------------|
| `claude-stop.mjs` | `Stop` |
| `claude-post-tool-use.mjs` | `PostToolUse` |

Example `~/.claude/settings.json` fragment (adjust the absolute path):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/Users/yulon/Desktop/Current Projects/Cortex/hooks/claude-stop.mjs\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"C:/Users/yulon/Desktop/Current Projects/Cortex/hooks/claude-post-tool-use.mjs\""
          }
        ]
      }
    ]
  }
}
```

Claude posts JSON on stdin; the script builds a `claude-code` RawEnvelope (`kind: claude_hook_delta`) with tool name + short args in provenance and a redacted raw payload.

## Codex

Script: `codex-stop.mjs` (`Stop`).

Wire via your Codex hooks mechanism (version-dependent). Example idea — run after a turn completes and pipe a JSON payload:

```powershell
# Pseudocode — adapt to your Codex hook config
$payload | node "C:\Users\yulon\Desktop\Current Projects\Cortex\hooks\codex-stop.mjs"
```

Never point hooks at `~\.codex\auth.json`.

## Cursor

Script: `cursor-hook.mjs` — shared by `stop`, `afterFileEdit`, and `afterShellExecution` (set `CORTEX_HOOK_NAME` per entry).

User-level `~/.cursor/hooks.json` snippet (adjust the absolute path):

```json
{
  "version": 1,
  "hooks": {
    "stop": [
      {
        "command": "C:/Users/yulon/Desktop/Current Projects/Cortex/hooks/cursor-stop.cmd"
      }
    ],
    "afterFileEdit": [
      {
        "command": "C:/Users/yulon/Desktop/Current Projects/Cortex/hooks/cursor-after-file-edit.cmd"
      }
    ],
    "afterShellExecution": [
      {
        "command": "C:/Users/yulon/Desktop/Current Projects/Cortex/hooks/cursor-after-shell.cmd"
      }
    ]
  }
}
```

The `.cmd` wrappers set `CORTEX_HOOK_NAME`, load `.env` tokens when missing, and run `cursor-hook.mjs` (stdin JSON from Cursor).

Noise filter for hooks:

| Event | Canonical summary |
|-------|-------------------|
| `stop` | conversation/generation ids, status, model |
| `afterFileEdit` | file path + short edit previews |
| `afterShellExecution` | command + truncated output preview |

Never read Cursor `secret://` keys or modify `state.vscdb`.

## Verify

With API up, trigger one Stop/stop hook, then:

Or query Supabase `records` where `source_id` in (`claude-code`,`codex`,`cursor`) ordered by `occurred_at` desc.

## Security

- Inline redaction covers common API key / bearer shapes; the ingest API runs `@cortex/redaction` again.
- Do not commit real tokens; use env vars / `.env` only.
