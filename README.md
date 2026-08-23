# Cortex

Windows **collectors and compilers** for Jack’s personal brain. Cortex writes markdown evidence into a git repo. **GBrain** commits are indexed, embedded, and searched. Agents talk to **`gbrain serve`** (local stdio). They do not use Cortex MCP as the daily brain.

If you only remember one thing: **GBrain indexes commits, not the working tree.** Uncommitted pages are invisible to search.

| | Cortex (this repo) | GBrain |
|---|---|---|
| Role | Collect, backfill, compile L3 judgment pages | Sync, embed, dream (L2), hybrid search |
| On disk | Writers under `CORTEX_GBRAIN_DIR` | Same git repo (`…\Current Projects\brain`) |
| In the cloud | Leftover Railway API/MCP + vault Supabase | **GBrain Supabase** (pages, chunks, embeddings) |
| Agent MCP | `cortex-mcp` on Railway — vault/ops leftover | **`gbrain serve` on this PC** — default |

`gbrain serve` is **not** a Railway service. If this laptop is off, Claude / ChatGPT Desktop / Cursor cannot reach the brain. Embeddings still live in GBrain’s Supabase project.

---

## Why this exists

Jack’s sessions (Cursor, Claude Code, Codex, ChatGPT), mail, calendar, and Drive should become searchable memory and, later, compiled judgment (builder profile, weekly mirror, LLM operator profile).

The old path posted everything to a Cortex vault on Railway and ran `twin-pipeline`. That vault still exists. **Daily use is GBrain-first:** pages in the brain git repo → commit → autopilot → `gbrain query` / MCP.

There is **no** curated `type: project` registry. Until L3 compilers run, “what projects?” returns raw L1 (transcripts, mail, hook deltas). Agents should say that, not invent a project list.

---

## Architecture

```text
Cursor / Claude Code hooks          ChatGPT export ZIP          Gmail / Calendar / Drive
        │                                  │                              │
        ▼                                  ▼                              ▼
  hooks/<harness>/*.md          conversations/chatgpt-export/     mail/ calendar/ drive/
  (session-hook-delta-v1)       (backfill --sink=gbrain-dir)      (pm2 cortex-collector)
        │                                  │                              │
        └──────────────┬───────────────────┴──────────────────────────────┘
                       ▼
              CORTEX_GBRAIN_DIR  (git working tree)
                       │
                       ▼  pm2 gbrain-commit  (every 3 min)
              git commit "collector catch-up"
                       │
                       ▼  pm2 gbrain-autopilot  (every 5 min, --inline)
              sync → extract → synthesize → embed → …
                       │
                       ▼
              GBrain Supabase  +  gbrain serve (stdio MCP)
                       │
          Cursor / Claude Desktop / ChatGPT Desktop / Codex
```

### Layers

| Layer | Writer | Paths / store | Role |
|---|---|---|---|
| **L1** | Collector, `pnpm backfill --sink=gbrain-dir`, hooks | `conversations/<harness>/`, `mail/`, `calendar/`, `drive/`, `hooks/`, `digests/` | Evidence. Session pages should include turns **and** tools (`session-v1`). Hook files do **not** count as full sessions. |
| **L2** | GBrain autopilot (stock dream) | Supabase facts/takes/embeddings | Map layer. Confidence-capped (`assistant_derived` ≤ 0.4). Not the evidence base. |
| **L3** | `coding-ops`, `weekly-mirror`, `llm-ops` | `ops/`, `ops/llm/`, `self/weekly-YYYY-Www.md` | Judgment. **Manual.** Cite L1 slugs. `gbrain-commit` does **not** stage `ops/` or `self/`. |

Schema pack (fork in the brain repo, do not add custom `cycle.ts` phases): [docs/gbrain-schema-pack.md](docs/gbrain-schema-pack.md).

---

## What is automatic on this machine

Three pm2 apps, declared in [`ecosystem.config.cjs`](ecosystem.config.cjs). They resurrect at login via `pm2-windows-startup` (HKCU Run). `pm2 startup` (systemd/launchd) **does not work on Windows**.

| Name | Script | Interval | Does |
|---|---|---|---|
| `cortex-collector` | `apps/collector` | 5 min (`CORTEX_COLLECTOR_INTERVAL_MS`) | Gmail `history.list`, Calendar `syncToken`, Drive `changes.list` → L1 pages. **Does not** backfill Cursor/Claude/Codex/ChatGPT. |
| `gbrain-commit` | [`scripts/gbrain-commit.mjs`](scripts/gbrain-commit.mjs) | 3 min | `git add` `hooks`, `mail`, `drive`, `conversations`, `calendar` (resets `calendar/primary`). Commit message `collector catch-up`. |
| `gbrain-autopilot` | [`scripts/gbrain-hidden.mjs`](scripts/gbrain-hidden.mjs) → Bun `gbrain` CLI | 5 min | Stock cycle: lint, backlinks, sync, extract, synthesize, patterns, embed, orphans. `--inline` so it does not spawn extra `gbrain.exe` (those open visible consoles on Windows). |

```powershell
cd "C:\Users\yulon\Desktop\Current Projects\Cortex"
pnpm install
pnpm --filter @cortex/collector... build
pm2 start ecosystem.config.cjs --only cortex-collector,gbrain-commit,gbrain-autopilot
pm2 save
pm2 list
pm2 logs gbrain-commit --lines 20
pm2 logs gbrain-autopilot --lines 20
```

Healthy: all three `online`; commit log shows `committed N page(s)` when the collector or hooks wrote files; autopilot log shows `[autopilot] running steps inline` and `[cycle.*.] done`.

### Windows console flashing

`gbrain.exe` is a console binary. Autopilot used to spawn `gbrain jobs work` plus a **detached child per job**; each child allocated a new terminal. The supervisor now:

1. Starts Bun + `gbrain/src/cli.ts` via `gbrain-hidden.mjs` with `windowsHide`.
2. Passes `--inline` (no job-worker fan-out).
3. Relies on `windowsHide` on GBrain’s `git` `execFileSync` sites (installed package under `~\.bun\install\global\node_modules\gbrain`). **`gbrain upgrade` can wipe those patches.**

Cursor/Claude still opening **one** terminal when they spawn `gbrain serve` is expected (stdio MCP). That is not the repeating flash.

---

## What you still run by hand

### Full session backfill (L1)

Hooks write deltas. Compilers and good search need `session-v1` pages from the adapters:

```powershell
$brain = $env:CORTEX_GBRAIN_DIR   # e.g. C:\Users\yulon\Desktop\Current Projects\brain

pnpm backfill -- --source=cursor  --sink=gbrain-dir=$brain
pnpm backfill -- --source=claude  --sink=gbrain-dir=$brain
pnpm backfill -- --source=codex   --sink=gbrain-dir=$brain
pnpm backfill -- --source=chatgpt-export --path="C:\Users\yulon\Downloads\chatgpt export.zip" --sink=gbrain-dir=$brain
```

Dry-run first: add `--dry-run` / `--limit=5`. `--source=all` is Claude + Codex + Cursor + Calibre + browser — **not** ChatGPT (always pass `--source=chatgpt-export --path=…`).

`gbrain-commit` will pick up new `conversations/` files on the next tick, or commit yourself.

### L3 compilers (after autopilot has synced)

Not a pm2 cron. Gate on **new L1**, not a blind clock. Build MCP package once: `pnpm --filter @cortex/mcp-server... build`.

| Compiler | For | Writes | When |
|---|---|---|---|
| `pnpm coding-ops -- --pages=$brain --out=$brain` | Cursor / Claude Code / Codex `session-v1` | `ops/sessions/`, `ops/episodes/`, `ops/profile/<ISO-week>.md` | After dream on days with new coding sessions. Full rescan; LLM cost if configured. Skip quiet days (`--dry-run`). |
| `pnpm llm-ops -- --pages=$brain --out=$brain` | ChatGPT / `chatgpt-export` only | `ops/llm/sessions/`, episodes, `ops/llm/profile/<ISO-week>.md` | After ChatGPT L1 is synced; then when new ChatGPT pages land. Heuristic (no LLM on from-pages). |
| `pnpm weekly-mirror -- --pages=$brain --out=$brain` | All L1 families that week | `self/weekly-YYYY-Www.md` | Once per ISO week (Sun night / Monday). |

Then **commit `ops/` and `self/` by hand**. `gbrain-commit` does not add them.

Order when several sources moved: coding-ops → llm-ops → weekly-mirror last.

---

## Capture vs search (by product)

| Product | Capture into the brain | Search the brain |
|---|---|---|
| **Cursor** | Hooks in `~\.cursor\hooks.json` → `hooks/cursor/`. Full pages: `pnpm backfill -- --source=cursor --sink=gbrain-dir=…` | This repo `.cursor/mcp.json` → `gbrain serve`. **Not** user-global; other Cursor workspaces need their own MCP entry. |
| **Claude Code** | `~\.claude\settings.json` Stop + PostToolUse → `hooks/claude-code/` (thousands of deltas). Full pages: `--source=claude`. | No default GBrain MCP in Claude Code unless you add it. |
| **Claude Desktop (app)** | **None.** No adapter for Desktop IndexedDB / cowork sessions. | `gbrain` in `%APPDATA%\Claude\claude_desktop_config.json`. Restart the app. |
| **ChatGPT Desktop / Codex** | Codex: historical `--source=codex` backfill; no `hooks.json` wired. ChatGPT history: official export ZIP. Extension still POSTs `localhost:8787` (legacy; `cortex-api` is usually down). | `[mcp_servers.gbrain]` in `~\.codex\config.toml` (desktop + Codex share this). Restart. Type `/mcp` in ChatGPT desktop. |
| **ChatGPT web** | Export ZIP + backfill only. | **Cannot** launch local `gbrain.exe`. Would need a public HTTPS MCP (not deployed). |
| **Gmail / Calendar / Drive** | Automatic via `cortex-collector`. | Same `gbrain serve`. |

Adding MCP does **not** start capturing new Claude/ChatGPT app chats. It only lets those apps **query** what is already indexed.

---

## Agent MCP (search)

All daily clients start a **local** process:

```text
C:\Users\yulon\.bun\bin\gbrain.exe serve
```

| Client | File | Notes |
|---|---|---|
| Cursor (Cortex repo) | [`.cursor/mcp.json`](.cursor/mcp.json) | `command: gbrain`, `args: ["serve"]` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | Server name `gbrain`. Existing DocMap / relationship-desk servers left in place. |
| ChatGPT Desktop + Codex | `~\.codex\config.toml` | `[mcp_servers.gbrain]` stdio + `cwd` = brain repo. Railway `cortex` MCP in the same file is a **different** leftover vault. |

After editing, **fully quit and reopen** the app.

### Smoke tests

```powershell
$env:Path = "C:\Users\yulon\.bun\bin;$env:Path"
Set-Location "C:\Users\yulon\Desktop\Current Projects\brain"

gbrain get conversations/chatgpt-export/00843f33-1beb-453b-a06e-fa8d90cb9cb5
# expect title: Create Latina Model

gbrain query "fintech job application"
# expect conversations/chatgpt-export/00ff5432-… near the top

gbrain list --type project --limit 5
# expect: No pages found  (until someone writes project pages)
```

In an agent: “Search GBrain (ignore `hooks/` and `extracts/`) for Cortex / DocMap. Cite slugs.”

If `gbrain get` is `page_not_found`, the file may be on disk but not committed or not yet synced.

---

## Environment

Copy [`.env.example`](.env.example) → `.env`. Never commit `.env`.

**Required for the GBrain-first loop**

| Variable | Purpose |
|---|---|
| `CORTEX_GBRAIN_DIR` | Absolute path to the brain git repo |
| Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) | Collector mail/calendar/Drive. `GOOGLE_MOCK=1` forces fixtures |
| `CORTEX_SYNC_GMAIL` / `_CALENDAR` / `_DRIVE` | Default `1` |

**GBrain itself** (not this `.env`): `~\.gbrain` + chat/embed provider (OpenRouter etc.). Autopilot LLM phases no-op without a provider.

**Legacy / optional:** `CORTEX_INGEST_URL`, `CORTEX_INGEST_TOKEN` (HTTP ingest, ChatGPT extension); Railway `CORTEX_MCP_TOKEN`, vault `SUPABASE_*`; `CORTEX_HOOK_INGEST=1` to POST hooks instead of writing the brain dir.

Sync cursors: `.cortex/checkpoints/gmail__sync.json` (gitignored).

---

## Repo layout

```text
apps/collector             Daemon + backfill CLI (--sink=http | --sink=gbrain-dir=PATH)
apps/api                   Legacy POST /v1/ingest (port 8787)
apps/mcp-server            Railway Cortex MCP + compiler CLIs
apps/chatgpt-extension     MV3 → /v1/ingest (not gbrain-dir)
apps/data-verse            Old viz app (frontend moving to Lovable / jackye.wiki)
hooks/                     Cursor / Claude Code / Codex reference hooks
packages/adapters/*        claude-code, cursor, codex, chatgpt-export, gmail, …
packages/gbrain-session-page   session-v1 writer
packages/redaction         Secret patterns
scripts/gbrain-commit.mjs  Commit loop
scripts/gbrain-hidden.mjs  Hidden Bun launcher for autopilot
docs/gbrain-schema-pack.md L1–L3 + compiler contract
docs/ops-windows.md        pm2 runbook (some Railway smoke still stale)
docs/chatgpt.md            Export + extension (prefer --sink=gbrain-dir)
docs/vibe-law.md           Agent session contract
```

---

## Scripts (GBrain-first)

| Command | Purpose |
|---|---|
| `pnpm backfill -- --sink=gbrain-dir=$BRAIN --source=…` | Write L1 pages (no HTTP) |
| `pnpm backfill -- --dry-run --limit=5` | Parse only |
| `pnpm coding-ops -- --pages=$BRAIN --out=$BRAIN` | L3 coding builder pages |
| `pnpm llm-ops -- --pages=$BRAIN --out=$BRAIN` | L3 ChatGPT operator pages |
| `pnpm weekly-mirror -- --pages=$BRAIN --out=$BRAIN` | L3 weekly insight cards |
| `pnpm --filter @cortex/collector... build` | Required after pull before pm2 collector |

Vault-era commands (`pnpm distillate`, `pnpm twin-pipeline`, `pnpm embed-backfill`, `pnpm dev:mcp`) still exist. They write the **Railway/Supabase vault**, not brain git `ops/` / `self/`. Do not assume they ran the GBrain compilers.

---

## Known gaps (read before claiming “it works”)

1. **No project typed pages** — `gbrain list --type project` is empty. Hook deltas dominate unfiltered search.
2. **Session L1 is stale unless you backfill** — collector never polls Cursor/Claude/Codex/ChatGPT. Newest Cursor/Claude Code full pages were last written when someone ran backfill.
3. **ChatGPT live capture is broken for GBrain** — extension → HTTP ingest; `cortex-api` is not part of the always-on set.
4. **Claude Desktop / ChatGPT app chats are not ingested** — MCP search only.
5. **Compilers have not been run** — `ops/` and `self/` may be missing. No builder profile, no weekly mirror in the brain.
6. **`gbrain-commit` ignores `ops/`, `self/`, and `calendar/primary`**.
7. **Autopilot crash risk** — 96% RAM can make `git rev-parse` look like “not a git repository” (30s timeout). Retry usually works.
8. **NUL bytes in a Codex transcript** once blocked sync; strip `\0` if a page fails UTF-8.
9. **Docs drift** — `docs/twin.md` / some READMEs still describe `cortex-twin-nightly`. Trust this README + `gbrain-schema-pack.md` + `ecosystem.config.cjs` for the live path.

---

## Requirements

- Node.js 25+, [pnpm](https://pnpm.io) 10+
- [pm2](https://pm2.keymetrics.io/) + `pm2-windows-startup` for logon
- [gbrain](https://www.npmjs.com/package/gbrain) CLI via Bun (`~\.bun\bin\gbrain.exe`)
- Git (brain repo must be initialized)
- Google OAuth for live Workspace sync

## Related docs

| Doc | Use |
|---|---|
| [docs/gbrain-schema-pack.md](docs/gbrain-schema-pack.md) | Page kinds, dream vs compilers |
| [docs/ops-windows.md](docs/ops-windows.md) | Collector knobs, pm2 |
| [docs/chatgpt.md](docs/chatgpt.md) | Export ZIP + extension |
| [hooks/README.md](hooks/README.md) | Hook install snippets |
| [docs/coding-ops-roadmap.md](docs/coding-ops-roadmap.md) | Builder profile design |
| [docs/intrapersonal-roadmap.md](docs/intrapersonal-roadmap.md) | Weekly mirror design |
| [docs/vibe-law.md](docs/vibe-law.md) | `/vibe-law` for agents |
| [docs/twin.md](docs/twin.md) | Twin product (vault-era automation — compilers now target GBrain dirs) |
| [AGENTS.md](AGENTS.md) | Pointer for coding agents |

## Auth note

Legacy HTTP ingest uses `CORTEX_INGEST_TOKEN`. GBrain MCP is local process spawn (no bearer). Do not put API keys in brain pages; hooks and `@cortex/redaction` strip common secret shapes.
