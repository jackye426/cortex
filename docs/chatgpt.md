# ChatGPT → Cortex

Two capture paths: **historical** official export ZIP, and **ongoing** MV3 browser extension. Neither scrapes OpenAI `backend-api` cookies.

**Status:** historical export ingest works (single `conversations.json` or sharded `conversations-NNN.json`). Ongoing capture via MV3 extension.

## 1. Historical — official export

### Download from OpenAI

1. Open [ChatGPT Settings → Data controls](https://chatgpt.com/#settings) (or **Settings → Data controls**).
2. Choose **Export data** and confirm.
3. When the email arrives, download the ZIP (contains `conversations.json` or sharded `conversations-NNN.json`, plus related files).

### Ingest with Cortex backfill

From the repo root (API optional for `--dry-run`):

```powershell
# Dry-run: parse ZIP, print conversation summaries (no upload)
pnpm backfill -- --source=chatgpt-export --path=D:\Downloads\chatgpt-export.zip --dry-run

# Or an extracted folder / conversations.json directly
pnpm backfill -- --source=chatgpt-export --path=D:\Downloads\chatgpt-export --dry-run --limit=5
pnpm backfill -- --source=chatgpt-export --path=D:\Downloads\chatgpt-export\conversations.json --dry-run

# Post to local ingest (set CORTEX_INGEST_TOKEN in .env; API running)
pnpm --filter @cortex/api dev
pnpm backfill -- --source=chatgpt-export --path=D:\Downloads\chatgpt-export.zip --limit=20
```

`--source=all` still runs Claude + Codex only. ChatGPT export always needs `--source=chatgpt-export` and `--path=…`.

### Parser notes

- Adapter: `@cortex/adapter-chatgpt-export`
- Reads `conversations.json` and/or sharded `conversations-NNN.json` from ZIP, folder, or file path
- Reconstructs the **active branch** by walking `current_node` → `parent` (DAG); edited/regenerated siblings are ignored
- Envelope `source`: `chatgpt-export`; `sourceRecordId`: conversation id
- Canonical stub: `session` via `normalizeChatgptConversation`

---

## 2. Ongoing — MV3 extension

### Load unpacked (Chrome / Edge)

1. Start Cortex ingest API locally (`pnpm --filter @cortex/api dev`) with `CORTEX_INGEST_TOKEN` set.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. **Load unpacked** → select:

   `C:\Users\yulon\Desktop\Current Projects\Cortex\apps\chatgpt-extension`

5. Open the extension **Options** (or popup → Open options).
6. Set:
   - **Ingest base URL** — default `http://localhost:8787`
   - **Bearer token** — same value as `CORTEX_INGEST_TOKEN` (never commit this)
   - **Capture enabled** — on
7. Visit [chatgpt.com](https://chatgpt.com), send a message, wait until streaming finishes. Check the API console for `[ingest]` lines with `source:chatgpt`.

### How it works

- Content script watches the page DOM for `[data-message-author-role]` turns.
- On a completed user→assistant pair, it messages the background service worker.
- Background `POST`s a `RawEnvelope` (`source: chatgpt`, `kind: chatgpt_turn_delta`) with your bearer token.
- **No** OpenAI session cookies, **no** `backend-api` fetches.

ChatGPT’s DOM changes over time; if capture stops working, re-check selectors in `apps/chatgpt-extension/content.js`.

### Permissions

Declared hosts: `chatgpt.com`, `chat.openai.com`, `localhost:8787`. For a non-default ingest URL, the options page requests optional host permission when you save.

---

## Security

- Keep `CORTEX_INGEST_TOKEN` in `.env` / extension options only — never in git.
- Extension storage holds the token in `chrome.storage.sync`; treat the browser profile as trusted.
