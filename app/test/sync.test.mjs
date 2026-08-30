// Self-contained sync-convergence test suite. One command, one clear
// pass/fail per scenario, zero browser and zero network involved:
//
//   node app/test/sync.test.mjs
//
// Three families of scenarios live here.
//
// S* are regressions for the multi-device sync bugs found in 2026-08. They
// run against the working tree only; the "red" halves that used to prove each
// bug against pre-fix code retired with the commit that fixed them, since the
// code they needed no longer exists on any branch this repo will ever build.
//
// M* cover the Brain Gym -> My Anki migration: the localStorage key rename,
// the one-time copy of the Firestore collection, and every ordering a real
// two-device rollout can produce while one device is still running the old
// build. Those scenarios need genuine old code to run against, which is what
// the `brain-gym-import` tag at the root of this repo is for — a
// content-identical copy of the app as it shipped before the rename.
//
// B* cover the manual sync button added in 2026-08: the press guard, and the
// two ways a pull that lands while an answer is on screen could damage the
// session it lands in.
import assert from "node:assert/strict";
import { getScriptSource } from "./extract-script.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
import { createDevice, makeDeck } from "./device.mjs";

const OLD = getScriptSource("brain-gym-import");   // the Brain Gym build
const NEW = getScriptSource();                     // the working tree

const UID = "hector-uid";
const OLD_ROOT = "brain_gym", NEW_ROOT = "my_anki";
const CLIENT_A = { "my-anki.client.v1": "device-a" };
const CLIENT_B = { "my-anki.client.v1": "device-b" };
const OLD_CLIENT_A = { "brain-gym.client.v1": "device-a" };
const OLD_CLIENT_B = { "brain-gym.client.v1": "device-b" };
function user() { return { uid: UID, email: "h@example.com", getToken: async () => "tok" }; }

function docName(dev, relPath) {
  return `projects/${dev.run("FIREBASE.projectId")}/databases/(default)/documents/${relPath}`;
}
function seedReview(fs, dev, id, { cardId, grade, clientId, ts, root = NEW_ROOT }) {
  fs.seedCreate(docName(dev, `${root}/${UID}/reviews/${id}`), { cardId, grade, reviewedAt: new Date(ts), clientId });
}
function seedBaseline(fs, dev, state, root = NEW_ROOT) {
  fs.seedCreate(docName(dev, `${root}/${UID}/meta/baseline`), { state, takenAt: new Date(0) });
}
// Computes exactly what applyGrade(cardId, grade) at time `ts` would have
// produced, using the sandboxed script's own schedule()/hash() — so a
// hand-built fixture is byte-identical to what the real app would store.
// JSON round-tripped: the raw vm return value's prototype belongs to that
// device's own realm, which makes assert.deepEqual (strict) report a
// mismatch against a same-shaped plain object even when every field matches.
function gradeState(dev, prevExpr, cardId, grade, ts) {
  const raw = dev.run(`(() => { const s = schedule(${prevExpr}, ${grade}, ${ts}, hash(${JSON.stringify(cardId)})); s.__lastReviewAt = ${ts}; return s; })()`);
  return JSON.parse(JSON.stringify(raw));
}

// Every review document currently under one collection root, by document id.
function reviewsIn(fs, root) {
  const out = {};
  for (const [name, fields] of Object.entries(fs._dump())) {
    const marker = `/documents/${root}/${UID}/reviews/`;
    const at = name.indexOf(marker);
    if (at !== -1) out[name.slice(at + marker.length)] = fields;
  }
  return out;
}

const results = [];
async function scenario(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}`);
    console.log(String(e.stack || e).split("\n").map((l) => "        " + l).join("\n"));
  }
}

async function drainOutbox(dev) {
  for (let i = 0; i < 1000 && dev.run("loadOutbox()").length; i++) {
    await new Promise((r) => setImmediate(r));
  }
  if (dev.run("loadOutbox()").length) throw new Error("drainOutbox: outbox never emptied");
}

// A device running the pre-rename build, with real history: grades every
// (card, grade) pair for real, flushes them to the old collection, and
// publishes the baseline — i.e. exactly the state Hector's devices are in
// before they pick up the rename.
async function oldDeviceWithHistory(fs, deck, seed, grades) {
  const dev = createDevice({ source: OLD, firestore: fs, deck, localStorageSeed: seed });
  dev.setAuthUser(user());
  // One card at a time, each flush allowed to finish — a person grading with
  // think time in between. Batching them without awaits would trip the old
  // build's mid-flush drop (S6) and quietly give these fixtures a shorter log
  // than they claim to have.
  for (const [cardId, grade] of grades) {
    dev.call("applyGrade", cardId, grade);
    await drainOutbox(dev);
  }
  await dev.call("migrateOrRebuild");
  return dev;
}

// ---- S1: own-clientId row, card missing locally ----
await scenario("S1 — own orphan row is recovered, not skipped", async () => {
  const fs = createFakeFirestore();
  const dev = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_A });
  dev.setAuthUser(user());
  seedReview(fs, dev, "r1", { cardId: "c1", grade: 3, clientId: "device-a", ts: 1000 });
  await dev.call("pullReviews");
  const c1 = dev.snapshotSrs().c1;
  assert.ok(c1);
  assert.equal(c1.reps, 1);
  assert.equal(c1.__lastReviewAt, 1000);
});

// ---- S2: baseline-create race, loser must not drop its own history ----
function seedLocalHistory(dev, obj) { dev.run(`srs = ${JSON.stringify(obj)}; saveSrs(srs);`); }
await scenario("S2 — baseline race loser merges the winner's baseline in", async () => {
  const fs = createFakeFirestore();
  const devA = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["a1", "b1"]), localStorageSeed: CLIENT_A });
  const devB = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["a1", "b1"]), localStorageSeed: CLIENT_B });
  devA.setAuthUser(user()); devB.setAuthUser(user());
  seedLocalHistory(devA, { a1: { st: "rev", ivl: 3, due: 0, reps: 1, ef: 2.5, lapses: 0, intro: 100, __lastReviewAt: 100 } });
  seedLocalHistory(devB, { b1: { st: "rev", ivl: 3, due: 0, reps: 1, ef: 2.5, lapses: 0, intro: 200, __lastReviewAt: 200 } });
  await devA.call("migrateOrRebuild");
  await devB.call("migrateOrRebuild");
  const b = devB.snapshotSrs();
  assert.ok(b.a1, "B should have merged A's baseline card");
  assert.ok(b.b1, "B should keep its own card");
});

// ---- S3a: a rebuild must not double-apply a grade already in the baseline ----
await scenario("S3a — rebuild does not double-apply a baseline-tied grade", async () => {
  const fs = createFakeFirestore();
  const devA = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_A });
  const c1 = gradeState(devA, "undefined", "c1", 3, 1000);
  seedBaseline(fs, devA, { c1 });
  seedReview(fs, devA, "r1", { cardId: "c1", grade: 3, clientId: "device-a", ts: 1000 });

  const devB = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_B });
  devB.setAuthUser(user());
  await devB.call("migrateOrRebuild");
  assert.deepEqual(devB.snapshotSrs().c1, c1);
});

// ---- S3b: a rebuild must keep history the log never carried ----
await scenario("S3b — baseline-seeded replay keeps pre-sync history", async () => {
  const fs = createFakeFirestore();
  const devA = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c3"]), localStorageSeed: CLIENT_A });
  // A pre-sync grade at t=100 that was NEVER logged (sync wasn't on yet),
  // then two post-sync grades that WERE logged.
  let c3 = gradeState(devA, "undefined", "c3", 3, 100);
  c3 = gradeState(devA, JSON.stringify(c3), "c3", 3, 1000);
  c3 = gradeState(devA, JSON.stringify(c3), "c3", 3, 2000);
  seedBaseline(fs, devA, { c3 });   // baseline captured after all three
  seedReview(fs, devA, "r1", { cardId: "c3", grade: 3, clientId: "device-a", ts: 1000 });
  seedReview(fs, devA, "r2", { cardId: "c3", grade: 3, clientId: "device-a", ts: 2000 });

  const devB = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c3"]), localStorageSeed: CLIENT_B });
  devB.setAuthUser(user());
  await devB.call("migrateOrRebuild");
  assert.deepEqual(devB.snapshotSrs().c3, c3);
});

// ---- S4: two devices in ordinary use stay converged ----
await scenario("S4 — a second device joining an account converges and stays converged", async () => {
  const fs = createFakeFirestore();
  const deck = makeDeck(["c1", "c2", "c3"]);

  const devA = createDevice({ source: NEW, firestore: fs, deck, localStorageSeed: CLIENT_A });
  devA.setAuthUser(user());
  for (const [cardId, grade] of [["c1", 3], ["c2", 3], ["c3", 3]]) devA.call("applyGrade", cardId, grade);
  await drainOutbox(devA);
  await devA.call("migrateOrRebuild");   // A has local history -> becomes the baseline

  const devB = createDevice({ source: NEW, firestore: fs, deck, localStorageSeed: CLIENT_B });
  devB.setAuthUser(user());
  await devB.call("migrateOrRebuild");   // B is brand new -> rebuilds from the log
  assert.deepEqual(devB.snapshotSrs(), devA.snapshotSrs(), "a joining device must land on the same state");
  assert.equal(devA.snapshotSrs().c1.reps, 1, "each grade applied exactly once");

  // B grades, A picks it up; then the reverse. Neither drifts.
  devB.call("applyGrade", "c1", 3);
  await drainOutbox(devB);
  await devA.call("pullReviews");
  assert.deepEqual(devA.snapshotSrs(), devB.snapshotSrs(), "A must fold B's grade to the same state");

  devA.call("applyGrade", "c2", 2);
  await drainOutbox(devA);
  await devB.call("pullReviews");
  assert.deepEqual(devB.snapshotSrs(), devA.snapshotSrs(), "and the same in the other direction");
});

// ---- S5: a failure mid-rebuild must not advance the cursor past unresolved rows ----
await scenario("S5 — a failed pull leaves the cursor untouched, retry recovers", async () => {
  const fs = createFakeFirestore();
  const dev = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c0", "c2"]), localStorageSeed: { ...CLIENT_B, "my-anki.migrated.v1": "1" } });
  dev.setAuthUser(user());
  seedReview(fs, dev, "r0", { cardId: "c0", grade: 2, clientId: "device-a", ts: 500 });
  await dev.call("pullReviews");
  const cursorBefore = dev.run("loadCursor()");

  seedReview(fs, dev, "r_early", { cardId: "c2", grade: 3, clientId: "device-a", ts: 2000 });
  seedReview(fs, dev, "r_late", { cardId: "c2", grade: 3, clientId: "device-a", ts: 1000 });
  fs.failOnce((url, opts) => {
    const body = opts.body && JSON.parse(opts.body);
    return body?.structuredQuery?.where?.fieldFilter?.field?.fieldPath === "cardId";
  });
  await assert.rejects(() => dev.call("pullReviews"));
  assert.equal(dev.run("loadCursor()"), cursorBefore, "cursor must not move until the rebuild it depends on has fully resolved");

  await dev.call("pullReviews");   // retry, no failure armed this time
  const c2 = dev.snapshotSrs().c2;
  assert.ok(c2, "retry should recover the card the first attempt failed on");
  assert.equal(c2.reps, 2, "both out-of-order rows should be folded in, oldest reviewedAt first");
});

// ---- S6: grades made while a flush is in flight must still reach the log ----
// Found while building the migration fixtures below: the old build snapshotted
// the outbox, awaited a write, then stored `snapshot.slice(1)` — erasing any
// grade queued during the round trip. Nothing looked wrong locally (the grade
// was already in `srs`), it simply never reached the log or the other device.
// Runs as a pair, since the bug is real code that shipped.
async function gradesThatReachedTheLog(source, fs, deck, seed, grades) {
  const dev = createDevice({ source, firestore: fs, deck, localStorageSeed: seed });
  dev.setAuthUser(user());
  for (const [cardId, grade] of grades) dev.call("applyGrade", cardId, grade);   // no awaits between
  await drainOutbox(dev);
  return { dev, logged: new Set(Object.values(reviewsIn(fs, source === OLD ? OLD_ROOT : NEW_ROOT)).map(r => r.cardId)) };
}
await scenario("S6 red (Brain Gym build) — a grade queued mid-flush is dropped from the log", async () => {
  const fs = createFakeFirestore();
  const { logged } = await gradesThatReachedTheLog(OLD, fs, makeDeck(["c1", "c2", "c3"]), OLD_CLIENT_A,
    [["c1", 3], ["c2", 3], ["c3", 3]]);
  assert.ok(logged.size < 3, `expected the pre-fix drop, but all ${logged.size} grades were logged`);
});
await scenario("S6 green — every grade reaches the log, whatever the flush timing", async () => {
  const fs = createFakeFirestore();
  const { dev, logged } = await gradesThatReachedTheLog(NEW, fs, makeDeck(["c1", "c2", "c3"]), CLIENT_A,
    [["c1", 3], ["c2", 3], ["c3", 3]]);
  assert.deepEqual([...logged].sort(), ["c1", "c2", "c3"], "all three grades must be in the shared log");
  // And a second device rebuilding purely from the log lands on the same state.
  await dev.call("migrateOrRebuild");
  const other = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c1", "c2", "c3"]), localStorageSeed: CLIENT_B });
  await other.signIn(user());
  assert.deepEqual(other.snapshotSrs(), dev.snapshotSrs(), "the other device must reconstruct the same state");
});

// ---- M1: the ordinary migration — same device, new build, nothing changes ----
await scenario("M1 — importing Brain Gym preserves this device's state exactly", async () => {
  const fs = createFakeFirestore();
  const deck = makeDeck(["c1", "c2", "c3"]);
  const oldDev = await oldDeviceWithHistory(fs, deck, OLD_CLIENT_A, [["c1", 3], ["c2", 2], ["c3", 4]]);
  const before = oldDev.snapshotSrs();
  const oldReviewIds = Object.keys(reviewsIn(fs, OLD_ROOT));
  const oldDocCount = fs._docCount();
  assert.ok(oldReviewIds.length >= 3, "fixture check: the old build should have logged its grades");

  // Same physical device reopening on the new build: same localStorage.
  const dev = createDevice({ source: NEW, firestore: fs, deck, localStorage: oldDev.localStorage });
  await dev.signIn(user());

  assert.deepEqual(dev.snapshotSrs(), before, "review state must survive the migration untouched");
  const migrated = reviewsIn(fs, NEW_ROOT);
  for (const id of oldReviewIds) assert.ok(migrated[id], `review ${id} should have been copied across`);
  assert.equal(Object.keys(reviewsIn(fs, OLD_ROOT)).length, oldReviewIds.length, "the old collection must not be modified");
  assert.ok(fs._docCount() > oldDocCount, "fixture check: the copy should have added documents");
  // The keys came across, and the originals are still there as the rollback.
  const ls = dev.localStorage._dump();
  assert.equal(ls["my-anki.srs.v2"], ls["brain-gym.srs.v2"], "srs must be copied, not moved");
  assert.equal(ls["my-anki.client.v1"], "device-a", "the client id must come across or own rows look foreign");
});

// ---- M2: the staggered rollout — one device migrates while the other hasn't ----
await scenario("M2 — a device still on Brain Gym converges once it migrates too", async () => {
  const fs = createFakeFirestore();
  const deck = makeDeck(["c1", "c2", "c3"]);
  const oldA = await oldDeviceWithHistory(fs, deck, OLD_CLIENT_A, [["c1", 3], ["c2", 3]]);
  // B is a second device already sharing the account on the old build.
  const oldB = createDevice({ source: OLD, firestore: fs, deck, localStorageSeed: OLD_CLIENT_B });
  oldB.setAuthUser(user());
  await oldB.call("migrateOrRebuild");
  assert.deepEqual(oldB.snapshotSrs(), oldA.snapshotSrs(), "fixture check: both old devices start converged");

  // A picks up the new build and grades a card — that grade lands in the new
  // collection, somewhere B cannot see yet.
  const newA = createDevice({ source: NEW, firestore: fs, deck, localStorage: oldA.localStorage });
  await newA.signIn(user());
  newA.call("applyGrade", "c3", 3);
  await drainOutbox(newA);

  // Meanwhile B, still on the old build, grades a different card into the old
  // collection.
  oldB.call("applyGrade", "c1", 2);
  await drainOutbox(oldB);

  // B migrates. Its late grade has to come across, and A's has to be folded in.
  const newB = createDevice({ source: NEW, firestore: fs, deck, localStorage: oldB.localStorage });
  await newB.signIn(user());
  await newA.call("pullReviews");

  assert.deepEqual(newA.snapshotSrs(), newB.snapshotSrs(), "both devices must converge after the staggered migration");
  assert.equal(newA.snapshotSrs().c3.reps, 1, "A's post-migration grade counted exactly once");
  assert.equal(newA.snapshotSrs().c1.reps, 2, "B's old-build grade must survive the migration, counted once");
});

// ---- M3: both devices migrate at once ----
await scenario("M3 — a migration race copies each review once and converges", async () => {
  const fs = createFakeFirestore();
  const deck = makeDeck(["c1", "c2"]);
  const oldA = await oldDeviceWithHistory(fs, deck, OLD_CLIENT_A, [["c1", 3], ["c2", 3]]);
  const oldB = createDevice({ source: OLD, firestore: fs, deck, localStorageSeed: OLD_CLIENT_B });
  oldB.setAuthUser(user());
  await oldB.call("migrateOrRebuild");
  const oldCount = Object.keys(reviewsIn(fs, OLD_ROOT)).length;

  const newA = createDevice({ source: NEW, firestore: fs, deck, localStorage: oldA.localStorage });
  const newB = createDevice({ source: NEW, firestore: fs, deck, localStorage: oldB.localStorage });
  await newA.signIn(user());
  await newB.signIn(user());

  assert.equal(Object.keys(reviewsIn(fs, NEW_ROOT)).length, oldCount, "each review copied exactly once, no duplicates");
  assert.deepEqual(newA.snapshotSrs(), newB.snapshotSrs(), "both devices converge");

  // Re-running the import is a no-op.
  const countBefore = fs._docCount();
  const reopened = createDevice({ source: NEW, firestore: fs, deck, localStorage: newA.localStorage });
  await reopened.signIn(user());
  assert.equal(fs._docCount(), countBefore, "a second run of the import must not write anything");
  assert.deepEqual(reopened.snapshotSrs(), newA.snapshotSrs(), "and must not change local state");
});

// ---- M4: a device with nothing local rebuilds the whole history ----
await scenario("M4 — a wiped device rebuilds full history through the migration", async () => {
  const fs = createFakeFirestore();
  const deck = makeDeck(["c1", "c2", "c3"]);
  const oldDev = await oldDeviceWithHistory(fs, deck, OLD_CLIENT_A, [["c1", 3], ["c2", 2], ["c3", 4]]);
  const expected = oldDev.snapshotSrs();

  // Brand-new install: empty localStorage, only what's on the server.
  const dev = createDevice({ source: NEW, firestore: fs, deck, localStorageSeed: { "my-anki.client.v1": "device-fresh" } });
  await dev.signIn(user());
  assert.deepEqual(dev.snapshotSrs(), expected, "a fresh device must reconstruct the pre-migration state");
});

// ---- M5: the localStorage key copy ----
await scenario("M5 — renamed keys are copied once, originals left intact", async () => {
  const fs = createFakeFirestore();
  const seed = {
    "brain-gym.srs.v2": JSON.stringify({ c1: { st: "rev", reps: 4, __lastReviewAt: 900 } }),
    "brain-gym.client.v1": "device-a",
    "brain-gym.migrated.v1": "1",
    "brain-gym.cursor.v1": "2023-11-14T22:13:20.005Z",
    "brain-gym.newcount.v1": "7",
  };
  const dev = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: seed });
  const ls = dev.localStorage._dump();
  for (const suffix of ["srs.v2", "client.v1", "migrated.v1", "cursor.v1"]) {
    assert.equal(ls[`my-anki.${suffix}`], seed[`brain-gym.${suffix}`], `${suffix} should be copied across`);
    assert.equal(ls[`brain-gym.${suffix}`], seed[`brain-gym.${suffix}`], `${suffix} original should be left as the rollback`);
  }
  assert.equal(ls["my-anki.newcount.v1"], undefined, "dead legacy state should not be carried over");
  assert.equal(ls["my-anki.keys-migrated.v1"], "1");
  assert.equal(dev.snapshotSrs().c1.reps, 4, "the copied state is what the app actually loaded");

  // Reopening must not overwrite state the new build has since changed.
  dev.run(`srs = { c1: { st: "rev", reps: 99, __lastReviewAt: 5000 } }; saveSrs(srs);`);
  const reopened = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c1"]), localStorage: dev.localStorage });
  assert.equal(reopened.snapshotSrs().c1.reps, 99, "the copy must not re-run over newer state");
});

// ---- M6: grades the old app queued but never sent ----
await scenario("M6 — grades stranded in the old outbox are recovered and shared", async () => {
  const fs = createFakeFirestore();
  const deck = makeDeck(["c1", "c2"]);
  const oldDev = await oldDeviceWithHistory(fs, deck, OLD_CLIENT_A, [["c1", 3]]);
  const migrated = createDevice({ source: NEW, firestore: fs, deck, localStorage: oldDev.localStorage });
  await migrated.signIn(user());
  const before = migrated.snapshotSrs();
  assert.equal(before.c2, undefined, "fixture check: c2 unseen so far");

  // The old home-screen app is opened offline after the migration and grades
  // c2; the row lands in its own outbox and goes nowhere.
  migrated.localStorage.setItem("brain-gym.outbox.v1", JSON.stringify([
    { id: "stranded-1", cardId: "c2", grade: 3, reviewedAt: new Date(9_000_000).toISOString() },
  ]));

  const reopened = createDevice({ source: NEW, firestore: fs, deck, localStorage: migrated.localStorage });
  await reopened.signIn(user());
  await drainOutbox(reopened);

  const c2 = reopened.snapshotSrs().c2;
  assert.ok(c2, "the stranded grade must be folded into local state");
  assert.equal(c2.reps, 1);
  assert.equal(reopened.localStorage.getItem("brain-gym.outbox.v1"), "[]", "the old queue must be emptied so it can't replay");
  assert.ok(Object.values(reviewsIn(fs, NEW_ROOT)).some(r => r.cardId === "c2"), "and must reach the shared log");

  // The other device sees it like any other review.
  const other = createDevice({ source: NEW, firestore: fs, deck, localStorageSeed: CLIENT_B });
  await other.signIn(user());
  assert.deepEqual(other.snapshotSrs(), reopened.snapshotSrs(), "the second device converges on the recovered grade");
});

// ---- M7: a stranded grade that predates something already applied ----
await scenario("M7 — an out-of-order stranded grade is replayed, not folded backwards", async () => {
  const fs = createFakeFirestore();
  const deck = makeDeck(["c1"]);
  const oldDev = await oldDeviceWithHistory(fs, deck, OLD_CLIENT_A, [["c1", 3]]);
  const dev = createDevice({ source: NEW, firestore: fs, deck, localStorage: oldDev.localStorage });
  await dev.signIn(user());
  // A newer grade on the new build...
  dev.call("applyGrade", "c1", 3);
  await drainOutbox(dev);
  const lastApplied = dev.run("srs.c1.__lastReviewAt");

  // ...and only now an OLDER grade surfaces from the old app's queue.
  dev.localStorage.setItem("brain-gym.outbox.v1", JSON.stringify([
    { id: "stranded-old", cardId: "c1", grade: 2, reviewedAt: new Date(lastApplied - 5000).toISOString() },
  ]));

  const reopened = createDevice({ source: NEW, firestore: fs, deck, localStorage: dev.localStorage });
  await reopened.signIn(user());
  await drainOutbox(reopened);
  await reopened.call("pullReviews");

  assert.equal(reopened.localStorage.getItem("brain-gym.outbox.v1"), "[]");
  const other = createDevice({ source: NEW, firestore: fs, deck, localStorageSeed: CLIENT_B });
  await other.signIn(user());
  assert.deepEqual(other.snapshotSrs(), reopened.snapshotSrs(),
    "a device replaying the log from scratch must land where the recovering device did");
});

// ---- M8: the old app writes to the old collection after everyone migrated ----
await scenario("M8 — a grade written to the old collection post-migration is recovered", async () => {
  const fs = createFakeFirestore();
  const deck = makeDeck(["c1", "c2"]);
  const oldDev = await oldDeviceWithHistory(fs, deck, OLD_CLIENT_A, [["c1", 3]]);
  const devA = createDevice({ source: NEW, firestore: fs, deck, localStorage: oldDev.localStorage });
  await devA.signIn(user());
  const devB = createDevice({ source: NEW, firestore: fs, deck, localStorageSeed: CLIENT_B });
  await devB.signIn(user());
  assert.deepEqual(devA.snapshotSrs(), devB.snapshotSrs(), "fixture check: both migrated and converged");

  // The old home-screen app, still installed and still online, flushes a grade
  // into the old collection — after both devices finished importing.
  seedReview(fs, devA, "stray-1", { cardId: "c2", grade: 3, clientId: "device-a", ts: 9_500_000, root: OLD_ROOT });

  const reopened = createDevice({ source: NEW, firestore: fs, deck, localStorage: devA.localStorage });
  await reopened.signIn(user());
  const c2 = reopened.snapshotSrs().c2;
  assert.ok(c2, "the stray must be recovered even though it was written by this device's own old build");
  assert.equal(c2.reps, 1);

  await devB.call("pullReviews");
  assert.deepEqual(devB.snapshotSrs(), reopened.snapshotSrs(), "and must reach the other device too");
});

// Wraps a fake Firestore so a scenario can count what actually went over the
// wire. Only `fetch` is used by the device harness; everything else passes
// through untouched.
function countingFirestore(fs) {
  const calls = [];
  return { ...fs, calls, fetch: (url, opts) => { calls.push(url); return fs.fetch(url, opts); } };
}

// ---- B1: the press guard ----
// The pill is a button now, and buttons get double-tapped. Two presses in the
// same tick must cost exactly one sync: `pullReviews` has no guard of its own,
// and two concurrent pulls share one cursor.
await scenario("B1 — a double press costs exactly one sync", async () => {
  async function press(times) {
    const fs = createFakeFirestore();
    const spy = countingFirestore(fs);
    const dev = createDevice({ source: NEW, firestore: spy, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_A });
    dev.setAuthUser(user());
    seedReview(fs, dev, "r1", { cardId: "c1", grade: 3, clientId: "device-b", ts: 1000 });
    await Promise.all(Array.from({ length: times }, () => dev.call("syncNow")));
    return { fetches: spy.calls.length, srs: dev.snapshotSrs() };
  }
  const one = await press(1);
  const two = await press(2);
  assert.ok(one.fetches > 0, "fixture check: a single press does talk to the server");
  assert.equal(two.fetches, one.fetches, "the second press must be a no-op while the first is in flight");
  assert.deepEqual(two.srs, one.srs, "and must leave the same state behind");
  assert.equal(one.srs.c1.reps, 1, "the foreign review is folded exactly once");
});

// ---- B2: a pull that lands mid-answer ----
// Folding into `srs` is always safe and always immediate. Rebuilding the
// visible queue is not: newSession() returns revealed:false, so doing it while
// an answer is on screen hides the answer being read.
await scenario("B2 — a pull mid-answer folds now and rebuilds later", async () => {
  const fs = createFakeFirestore();
  const dev = createDevice({ source: NEW, firestore: fs, deck: makeDeck(["c1", "c2"]), localStorageSeed: CLIENT_A });
  dev.setAuthUser(user());
  dev.run("session.revealed = true; pendingApply = null;");
  seedReview(fs, dev, "r1", { cardId: "c1", grade: 3, clientId: "device-b", ts: 1000 });
  await dev.call("pullReviews");

  assert.equal(dev.run("session.revealed"), true, "the answer on screen must survive the pull");
  assert.equal(dev.run("pendingApply"), "session", "the rebuild is deferred, not dropped");
  assert.equal(dev.snapshotSrs().c1.reps, 1, "but the review itself is folded immediately");

  dev.run("session.revealed = false;");
  assert.equal(dev.run("applyDeferred()"), true, "the next grade is the safe moment");
  assert.equal(dev.run("pendingApply"), null);
});

// ---- B3: precedence between deferred actions ----
// reload > deck > session. Without an explicit rank, a deferred session
// rebuild arriving after a deck swap would drop the fresh deck and leave this
// device on a stale catalog.
await scenario("B3 — a deferred session rebuild never clobbers a pending deck", async () => {
  const dev = createDevice({ source: NEW, firestore: createFakeFirestore(), deck: makeDeck(["c1"]), localStorageSeed: CLIENT_A });
  dev.run("session.revealed = true; pendingApply = null;");
  dev.run(`whenSafe({ deck: ${JSON.stringify(makeDeck(["c1", "c2"]))} })`);
  dev.run('whenSafe("session")');
  assert.equal(dev.run("pendingApply && pendingApply.deck ? 'deck' : pendingApply"), "deck",
    "the fresher deck must survive a session rebuild queued behind it");
  dev.run('whenSafe("reload")');
  assert.equal(dev.run("pendingApply"), "reload", "and a reload still beats both");
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
