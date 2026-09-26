const LOCAL_BATCH = "latestLocalBatch";
const LOCAL_STATUS = "latestStatus";
const LAST_IMPORTED = "lastImportedSignature";
const LAST_OPENED = "lastOpenedImportSignature";
const IMPORTER_URL = "https://hectorcflores.github.io/my-anki/app/import.html";

function status(code, detail = "") {
  return { code, detail, updatedAt: new Date().toISOString() };
}
function signatureFor(batch) {
  return JSON.stringify((batch.books || []).map(book => ({
    asin: book.asin || "", title: book.title || "",
    highlights: (book.highlights || []).map(h => [h.l || 0, h.h || h.n || ""])
  })));
}
async function openImporterIfNeeded(batch) {
  const signature = batch.signature;
  const stored = await chrome.storage.local.get([LAST_IMPORTED, LAST_OPENED]);
  const opened = stored[LAST_OPENED];
  const openedSignature = typeof opened === "object" ? opened.signature : opened;
  const openedAt = typeof opened === "object" ? Number(opened.at) : 0;
  if (!signature || stored[LAST_IMPORTED] === signature) return;
  // Avoid duplicate importer tabs while one is active, but never let a closed
  // or failed importer suppress this batch forever. Older string-only values
  // have no timestamp and are therefore immediately eligible for recovery.
  if (openedSignature === signature && Date.now() - openedAt < 15 * 60e3) return;
  await chrome.storage.local.set({ [LAST_OPENED]: { signature, at: Date.now() } });
  await chrome.tabs.create({ url: IMPORTER_URL, active: true });
}
async function syncOneBook(sourceTabId) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = sourceTabId ? await chrome.tabs.get(sourceTabId) : activeTab;
  if (!tab?.id || !tab.url?.startsWith("https://read.amazon.com/notebook")) {
    const result = { ok: false, status: status("OPEN_KINDLE_NOTEBOOK") };
    await chrome.storage.local.set({ [LOCAL_STATUS]: result.status });
    return result;
  }
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "collect-one-book" });
    if (!result?.ok) throw new Error(result?.error || "KINDLE_EXTENSION_NOT_READY");
    const batch = { version: 1, collectedAt: new Date().toISOString(), source: "chrome-extension-local-pilot", ...result.payload };
    batch.signature = signatureFor(batch);
    const saved = status("SAVED_LOCALLY", "Your highlights are being added to My Anki.");
    await chrome.storage.local.set({ [LOCAL_BATCH]: batch, [LOCAL_STATUS]: saved });
    const highlightCount = batch.books[0]?.highlights?.length || 0;
    await chrome.action.setBadgeBackgroundColor({ color: "#4ade80" });
    await chrome.action.setBadgeText({ text: String(highlightCount) });
    await chrome.action.setTitle({ title: "My Anki: adding " + highlightCount + " Kindle highlights" });
    await openImporterIfNeeded(batch);
    return { ok: true, status: saved, batch };
  } catch (error) {
    const code = error.message === "AMAZON_SIGN_IN_REQUIRED" ? "AMAZON_SIGN_IN_REQUIRED" : error.message || "COLLECTION_FAILED";
    const saved = status(code);
    await chrome.storage.local.set({ [LOCAL_STATUS]: saved });
    return { ok: false, status: saved };
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "sync-one-book") { syncOneBook(sender.tab?.id).then(respond); return true; }
  if (message?.type === "get-status") {
    chrome.storage.local.get(LOCAL_STATUS).then(values => respond(values[LOCAL_STATUS] || status("NOT_YET_SYNCED")));
    return true;
  }
  return undefined;
});
// Only the published My Anki page can read the extracted batch. Amazon
// credentials remain in Chrome's Kindle tab and never enter this message.
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (sender.origin !== "https://hectorcflores.github.io") return;
  if (message?.type === "get-kindle-batch") {
    chrome.storage.local.get([LOCAL_BATCH, LOCAL_STATUS]).then(values => respond({
      batch: values[LOCAL_BATCH] || null,
      status: values[LOCAL_STATUS] || status("NOT_YET_SYNCED")
    }));
    return true;
  }
  if (message?.type === "mark-kindle-imported") {
    chrome.storage.local.set({
      [LAST_IMPORTED]: message.signature || "",
      [LOCAL_STATUS]: status("IMPORTED", "Your Kindle highlights are in My Anki.")
    }).then(async () => {
      const tabs = await chrome.tabs.query({ url: "https://hectorcflores.github.io/my-anki/app/*" });
      await Promise.all(tabs.map(tab => chrome.tabs.reload(tab.id)));
      respond({ ok: true });
    });
    return true;
  }
  if (message?.type === "mark-kindle-import-failed") {
    chrome.storage.local.get(LAST_OPENED).then(values => {
      const opened = values[LAST_OPENED];
      const openedSignature = typeof opened === "object" ? opened.signature : opened;
      if (openedSignature !== message.signature) return;
      return chrome.storage.local.remove(LAST_OPENED);
    }).then(() => respond({ ok: true }));
    return true;
  }
  return undefined;
});
