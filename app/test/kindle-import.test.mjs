import assert from "node:assert/strict";
import { getScriptSource } from "./extract-script.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
import { createDevice, makeDeck } from "./device.mjs";

const UID = "hector-uid";
const source = getScriptSource();
const backend = createFakeFirestore();
const calls = [];
const firestore = {
  ...backend,
  fetch: async (url, options) => {
    calls.push({ url, body: options?.body ? JSON.parse(options.body) : null });
    return backend.fetch(url, options);
  },
};
const seed = {
  "my-anki.client.v1": "device-a",
  "my-anki.auth-migrated.v1": "1",
  "my-anki.fs-import.v1": new Date(0).toISOString(),
  "my-anki.migrated.v1": "1",
  "my-anki.reconcile.v1": "1",
};
const device = createDevice({ source, firestore, deck: makeDeck(["aaaaaaaaaaaaaaaa"]), localStorageSeed: seed });
device.setAuthUser({ uid: UID, email: "h@example.com", getToken: async () => "token" });

const projectId = device.run("FIREBASE.projectId");
const importName = `projects/${projectId}/databases/(default)/documents/my_anki/${UID}/imports/stable-import-id`;
backend.seedCreate(importName, {
  source: "my-anki-kindle-extension",
  collectedAt: new Date("2026-09-26T12:00:00Z"),
  books: [{ asin: "B001", title: "Fresh Book", author: "Author", highlights: [
    { text: "A fresh highlight", location: 42 },
  ] }],
});

await device.call("importKindleCards");
const firstIds = JSON.parse(JSON.stringify(device.run("cards.map(card => card.id)")));
assert.equal(firstIds.length, 2, "one imported highlight becomes exactly one new card");
assert.equal(new Set(firstIds).size, 2, "the imported card id is unique");
assert.equal(device.run("cards.find(card => card.book.title === 'Fresh Book').highlightedAt"), null,
  "a legacy import without an original date stays undated instead of using its collection time");
assert.ok(device.localStorage.getItem("my-anki.kindle-import-cursor.v1"), "the import cursor is saved");
assert.ok(device.localStorage.getItem("my-anki.kindle-imports.v1"), "the imported batch is cached locally");

const datedImportName = `projects/${projectId}/databases/(default)/documents/my_anki/${UID}/imports/stable-import-with-date`;
backend.seedCreate(datedImportName, {
  source: "my-anki-kindle-extension",
  collectedAt: new Date("2026-09-27T12:00:00Z"),
  books: [{ asin: "B001", title: "Fresh Book", author: "Author", highlights: [
    { text: "A fresh highlight", location: 42, highlightedAt: new Date("2026-05-19T06:54:00Z") },
  ] }],
});
await device.call("importKindleCards");
const datedIds = JSON.parse(JSON.stringify(device.run("cards.map(card => card.id)")));
assert.deepEqual(datedIds, firstIds, "date backfill upgrades the existing card instead of duplicating it");
assert.equal(device.run("cards.find(card => card.book.title === 'Fresh Book').highlightedAt"), "2026-05-19T06:54:00.000Z",
  "the original Kindle timestamp replaces the missing legacy date");

await device.call("importKindleCards");
const repeatedIds = JSON.parse(JSON.stringify(device.run("cards.map(card => card.id)")));
assert.deepEqual(repeatedIds, firstIds, "repeating import does not duplicate the card");

const importQueries = calls.filter(call => call.body?.structuredQuery?.from?.[0]?.collectionId === "imports");
assert.equal(importQueries.length, 3, "each explicit check performs one bounded imports query");
assert.equal(importQueries[0].body.structuredQuery.where, undefined, "a fresh device loads its complete import history once");
assert.equal(importQueries[1].body.structuredQuery.where?.fieldFilter?.op, "GREATER_THAN",
  "later checks request only imports after the saved cursor");
assert.ok(calls.every(call => !call.url.includes("/users/")), "My Anki never reads or writes Pomodoro's users collection");

// A quota response pauses the app until Firebase's daily reset. A second
// attempt must not touch the backend, protecting every app in the project.
const quotaBackend = createFakeFirestore();
let quotaCalls = 0;
const quotaFirestore = {
  ...quotaBackend,
  async fetch(url, options) {
    if (url.startsWith("https://firestore.googleapis.com/")) quotaCalls += 1;
    if (url.startsWith("https://firestore.googleapis.com/") && quotaCalls === 1) {
      return { ok: false, status: 429, json: async () => ({}) };
    }
    return quotaBackend.fetch(url, options);
  },
};
const quotaDevice = createDevice({ source, firestore: quotaFirestore, deck: makeDeck(["bbbbbbbbbbbbbbbb"]), localStorageSeed: seed });
quotaDevice.setAuthUser({ uid: UID, email: "h@example.com", getToken: async () => "token" });
await assert.rejects(quotaDevice.call("importKindleCards"), /HTTP 429/);
assert.ok(Number(quotaDevice.localStorage.getItem("my-anki.quota-pause-until.v1")) > Date.now(),
  "a 429 stores a pause through the next quota reset");
await quotaDevice.call("importKindleCards");
assert.equal(quotaCalls, 1, "a paused device makes no further Firebase request");

console.log("PASS Kindle import: one card, no duplicate, incremental reads, quota pause, Pomodoro path untouched");
