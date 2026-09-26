import assert from "node:assert/strict";
import { getScriptSource } from "./extract-script.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
import { createDevice, makeDeck } from "./device.mjs";

const UID = "hector-uid";
const cardId = "aaaaaaaaaaaaaaaa";
const hiddenId = "bbbbbbbbbbbbbbbb";
const state = { st: "rev", ivl: 7, due: 123456, reps: 3, ef: 2.5, lapses: 0, intro: 100, __lastReviewAt: 300 };
const hiddenEvent = { id: "visibility-old", cardId: hiddenId, hidden: true, at: 250 };
const seed = {
  "my-anki.backend.v1": "my-reading-list-3fa75",
  "my-anki.srs.v2": JSON.stringify({ [cardId]: state }),
  "my-anki.migrated.v1": "1",
  "my-anki.cursor.v1": "2026-01-01T00:00:00.000Z",
  "my-anki.reconcile.v1": "1",
  "my-anki.quota-pause-until.v1": String(Date.now() + 86400e3),
  [`my-anki.visibility.v1.${UID}`]: JSON.stringify({ states: { [hiddenId]: hiddenEvent }, pending: [] }),
};
const firestore = createFakeFirestore();
const device = createDevice({ source: getScriptSource(), firestore, deck: makeDeck([cardId, hiddenId]), localStorageSeed: seed });
device.setAuthUser({ uid: UID, email: "h@example.com", getToken: async () => "token" });

device.call("prepareBackendMigration");
assert.equal(device.localStorage.getItem("my-anki.backend.v1"), "my-anki-hector");
assert.equal(device.localStorage.getItem("my-anki.migrated.v1"), null, "the old cloud baseline marker is reset");
assert.equal(device.localStorage.getItem("my-anki.cursor.v1"), null, "the old cloud cursor is reset");
assert.equal(device.localStorage.getItem("my-anki.quota-pause-until.v1"), null, "the old project's quota pause is reset");
assert.deepEqual(device.snapshotSrs(), { [cardId]: state }, "local scheduling state is preserved byte for byte");
const visibility = JSON.parse(device.localStorage.getItem(`my-anki.visibility.v1.${UID}`));
assert.equal(visibility.pending.length, 1, "the current hidden state is queued for the dedicated backend");
assert.equal(visibility.pending[0].id, hiddenEvent.id);

await device.call("migrateOrRebuild");
const baseline = Object.entries(firestore._dump()).find(([name]) => name.endsWith(`/my_anki/${UID}/meta/baseline`));
assert.ok(baseline, "the preserved schedule is published as the dedicated backend's baseline");
assert.deepEqual(baseline[1].state, { [cardId]: state });

console.log("PASS dedicated backend migration: schedule and hidden cards preserved, old cursors reset");
