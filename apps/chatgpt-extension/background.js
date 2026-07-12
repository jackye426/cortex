/**
 * Background service worker — POSTs turn envelopes to Cortex ingest.
 * Uses extension host_permissions (not page cookies / OpenAI backend-api).
 */

const DEFAULT_INGEST_URL = "http://localhost:8787";

async function getSettings() {
  const stored = await chrome.storage.sync.get([
    "ingestUrl",
    "ingestToken",
    "enabled",
  ]);
  return {
    ingestUrl: (stored.ingestUrl || DEFAULT_INGEST_URL).replace(/\/$/, ""),
    ingestToken: stored.ingestToken || "",
    enabled: stored.enabled !== false,
  };
}

/**
 * @param {object} turn
 * @param {string} turn.conversationId
 * @param {string} turn.turnId
 * @param {string} [turn.userText]
 * @param {string} [turn.assistantText]
 * @param {string} [turn.pageUrl]
 * @param {string} [turn.occurredAt]
 */
async function postTurn(turn) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { ok: false, error: "extension disabled" };
  }
  if (!settings.ingestToken) {
    return { ok: false, error: "ingest token not configured (open extension options)" };
  }

  const preview = (s, n = 2000) =>
    typeof s === "string" && s.length > n ? `${s.slice(0, n)}…` : s || "";

  const envelope = {
    source: "chatgpt",
    sourceRecordId: `${turn.conversationId}:${turn.turnId}`,
    occurredAt: turn.occurredAt || new Date().toISOString(),
    mimeType: "application/json",
    body: {
      kind: "chatgpt_turn_delta",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      userText: turn.userText || "",
      assistantText: turn.assistantText || "",
      userTextPreview: preview(turn.userText),
      assistantTextPreview: preview(turn.assistantText),
      pageUrl: turn.pageUrl || null,
      occurredAt: turn.occurredAt || new Date().toISOString(),
    },
    provenance: {
      collector: "chatgpt-extension",
      extra: {
        kind: "chatgpt_extension_turn",
        pageUrl: turn.pageUrl || null,
      },
    },
  };

  try {
    const res = await fetch(`${settings.ingestUrl}/v1/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.ingestToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: typeof json.error === "string" ? json.error : `HTTP ${res.status}`,
      };
    }
    return { ok: true, key: json.key, contentHash: json.contentHash };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "cortex.chatgpt.turn") {
    postTurn(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true; // async
  }
  if (message?.type === "cortex.chatgpt.ping") {
    getSettings().then((s) =>
      sendResponse({
        ok: true,
        enabled: s.enabled,
        tokenSet: Boolean(s.ingestToken),
        ingestUrl: s.ingestUrl,
      }),
    );
    return true;
  }
  return false;
});
