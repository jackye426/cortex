const DEFAULT_URL = "http://localhost:8787";

const ingestUrlEl = document.getElementById("ingestUrl");
const ingestTokenEl = document.getElementById("ingestToken");
const enabledEl = document.getElementById("enabled");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save");

async function load() {
  const stored = await chrome.storage.sync.get([
    "ingestUrl",
    "ingestToken",
    "enabled",
  ]);
  ingestUrlEl.value = stored.ingestUrl || DEFAULT_URL;
  ingestTokenEl.value = stored.ingestToken || "";
  enabledEl.checked = stored.enabled !== false;
}

async function save() {
  const ingestUrl = (ingestUrlEl.value || DEFAULT_URL).trim().replace(/\/$/, "");
  const ingestToken = ingestTokenEl.value.trim();
  const enabled = enabledEl.checked;

  await chrome.storage.sync.set({ ingestUrl, ingestToken, enabled });

  // Request optional host permission when URL is not localhost:8787
  try {
    const origin = new URL(ingestUrl).origin + "/*";
    const needOptional =
      !origin.includes("localhost:8787") &&
      !origin.includes("127.0.0.1:8787");
    if (needOptional) {
      await chrome.permissions.request({ origins: [origin] });
    }
  } catch {
    // ignore URL parse / permission errors; fetch will fail clearly later
  }

  statusEl.textContent = "Saved.";
}

saveBtn.addEventListener("click", () => {
  save().catch((err) => {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  });
});

load();
