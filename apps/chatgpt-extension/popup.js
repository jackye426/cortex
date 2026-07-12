const stateEl = document.getElementById("state");

chrome.runtime.sendMessage({ type: "cortex.chatgpt.ping" }, (res) => {
  if (chrome.runtime.lastError) {
    stateEl.textContent = chrome.runtime.lastError.message;
    return;
  }
  if (!res) {
    stateEl.textContent = "No response from background.";
    return;
  }
  stateEl.textContent = [
    res.enabled ? "Enabled" : "Disabled",
    res.tokenSet ? "token set" : "token missing",
    res.ingestUrl,
  ].join(" · ");
});
