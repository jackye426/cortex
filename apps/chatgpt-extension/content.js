/**
 * Content script on chatgpt.com / chat.openai.com.
 * Observes completed assistant turns in the DOM and notifies the background SW.
 * Does NOT call OpenAI backend-api or read auth cookies.
 */

(function () {
  const SENT = new Set();
  const MAX_SENT = 500;
  let debounceTimer = null;

  function conversationIdFromUrl() {
    const m = location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return m ? m[1] : `anon:${location.pathname}`;
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || "").trim();
  }

  /**
   * ChatGPT commonly marks turns with data-message-author-role.
   * We pair the latest user message before each finished assistant message.
   */
  function collectTurns() {
    const nodes = [
      ...document.querySelectorAll("[data-message-author-role]"),
    ];
    /** @type {{ role: string, text: string, id: string }[]} */
    const messages = [];
    for (const node of nodes) {
      const role = node.getAttribute("data-message-author-role") || "";
      if (role !== "user" && role !== "assistant") continue;
      const text = textOf(node);
      if (!text) continue;
      const id =
        node.getAttribute("data-message-id") ||
        node.id ||
        `${role}:${hashString(text).slice(0, 16)}`;
      messages.push({ role, text, id });
    }
    return messages;
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function remember(key) {
    SENT.add(key);
    if (SENT.size > MAX_SENT) {
      const first = SENT.values().next().value;
      SENT.delete(first);
    }
  }

  function isStreaming() {
    // While generating, ChatGPT often shows a stop button or streaming cursor.
    if (document.querySelector('button[aria-label="Stop streaming"]')) {
      return true;
    }
    if (document.querySelector('button[data-testid="stop-button"]')) {
      return true;
    }
    return false;
  }

  function emitCompletedPairs() {
    if (isStreaming()) return;

    const messages = collectTurns();
    const conversationId = conversationIdFromUrl();
    let lastUser = null;

    for (const msg of messages) {
      if (msg.role === "user") {
        lastUser = msg;
        continue;
      }
      if (msg.role !== "assistant" || !lastUser) continue;

      const turnId = `${lastUser.id}→${msg.id}`;
      const key = `${conversationId}:${turnId}`;
      if (SENT.has(key)) continue;

      // Require non-trivial assistant reply
      if (msg.text.length < 2) continue;

      remember(key);
      chrome.runtime.sendMessage(
        {
          type: "cortex.chatgpt.turn",
          payload: {
            conversationId,
            turnId,
            userText: lastUser.text,
            assistantText: msg.text,
            pageUrl: location.href,
            occurredAt: new Date().toISOString(),
          },
        },
        (result) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "[cortex] message failed",
              chrome.runtime.lastError.message,
            );
            SENT.delete(key);
            return;
          }
          if (!result?.ok) {
            console.warn("[cortex] ingest failed", result?.error);
            // Keep in SENT to avoid hammering; user can reload to retry after fixing config
          } else {
            console.info("[cortex] ingested", result.key);
          }
        },
      );
    }
  }

  function scheduleScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(emitCompletedPairs, 800);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  scheduleScan();
  console.info("[cortex] ChatGPT capture content script active");
})();
