import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const storage = new Map();
const createdTabs = [];
const reloadedTabs = [];
let internalListener;
let externalListener;
const chrome = {
  storage: { local: {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(key => storage.has(key)).map(key => [key, storage.get(key)]));
    },
    async set(values) { for (const [key, value] of Object.entries(values)) storage.set(key, value); },
    async remove(key) { storage.delete(key); },
  } },
  tabs: {
    async query(options) {
      if (options?.url) return [
        { id: 21, url: "https://hectorcflores.github.io/my-anki/app/import.html" },
        { id: 22, url: "https://hectorcflores.github.io/my-anki/app/" },
      ];
      return [{ id: 7, url: "https://read.amazon.com/notebook" }];
    },
    async get() { return { id: 7, url: "https://read.amazon.com/notebook" }; },
    async sendMessage() {
      return { ok: true, payload: { books: [{ asin: "B001", title: "Book", highlights: [{ l: 1, h: "Text" }] }] } };
    },
    async create(tab) { createdTabs.push(tab); return { id: 10 + createdTabs.length, ...tab }; },
    async reload(id) { reloadedTabs.push(id); },
  },
  action: { async setBadgeBackgroundColor() {}, async setBadgeText() {}, async setTitle() {} },
  runtime: {
    onMessage: { addListener(listener) { internalListener = listener; } },
    onMessageExternal: { addListener(listener) { externalListener = listener; } },
  },
};

const context = { chrome, console, Date, JSON, Promise, URL, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(readFileSync(new URL("../background.js", import.meta.url), "utf8"), context);

function invoke(listener, message, sender = {}) {
  return new Promise((resolve, reject) => {
    try {
      const asyncResponse = listener(message, sender, resolve);
      if (asyncResponse !== true) resolve(undefined);
    } catch (error) { reject(error); }
  });
}

const first = await invoke(internalListener, { type: "sync-one-book" });
assert.equal(first.ok, true);
assert.equal(createdTabs.length, 1, "the first collected batch opens the importer");
const externalBatch = await invoke(externalListener, { type: "get-kindle-batch" },
  { url: "https://hectorcflores.github.io/my-anki/app/import.html" });
assert.equal(externalBatch.batch.signature, first.batch.signature,
  "the published importer is accepted even when Chrome supplies sender.url instead of sender.origin");

await invoke(internalListener, { type: "sync-one-book" });
assert.equal(createdTabs.length, 1, "an active importer is not opened twice");

await invoke(externalListener, { type: "mark-kindle-import-failed", signature: first.batch.signature },
  { origin: "https://hectorcflores.github.io" });
await invoke(internalListener, { type: "sync-one-book" });
assert.equal(createdTabs.length, 2, "a failed importer can recover on the next collection");

await invoke(externalListener, { type: "mark-kindle-imported", signature: first.batch.signature },
  { origin: "https://hectorcflores.github.io", tab: { id: 21 }, url: "https://hectorcflores.github.io/my-anki/app/import.html" });
assert.deepEqual(reloadedTabs, [22], "success refreshes the review app without restarting the importer");
await invoke(internalListener, { type: "sync-one-book" });
assert.equal(createdTabs.length, 2, "an imported batch never opens another importer tab");

console.log("PASS extension background: retry after failure and no duplicate importer tabs");
