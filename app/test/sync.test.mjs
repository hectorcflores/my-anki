// Self-contained sync-convergence test suite for brain-gym. One command,
// one clear pass/fail per scenario, zero browser/console involved:
//
//   node brain-gym/test/sync.test.mjs
//
// Each bug runs as a pair: "red" against the last commit (HEAD, before any
// of this round's fixes) to prove the scenario actually exercises the bug,
// and "green" against the working tree (whatever is currently on disk) to
// prove the fix. This is the harness the previous session's interactive
// browser debugging was replaced with — see the plan for why.
import assert from "node:assert/strict";
import { getScriptSource } from "./extract-script.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";
import { createDevice, makeDeck } from "./device.mjs";

const HEAD = getScriptSource("HEAD");
const FIXED = getScriptSource();

const UID = "hector-uid";
const CLIENT_A = { "brain-gym.client.v1": "device-a" };
const CLIENT_B = { "brain-gym.client.v1": "device-b" };
function user() { return { uid: UID, email: "h@example.com", getToken: async () => "tok" }; }

function docName(dev, relPath) {
  return `projects/${dev.run("FIREBASE.projectId")}/databases/(default)/documents/${relPath}`;
}
function seedReview(fs, dev, id, { cardId, grade, clientId, ts }) {
  fs.seedCreate(docName(dev, `brain_gym/${UID}/reviews/${id}`), { cardId, grade, reviewedAt: new Date(ts), clientId });
}
function seedBaseline(fs, dev, state) {
  fs.seedCreate(docName(dev, `brain_gym/${UID}/meta/baseline`), { state, takenAt: new Date(0) });
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

// ---- S1: own-clientId row, card missing locally (bug #1) ----
await scenario("S1 red (HEAD) — own orphan row stays lost forever", async () => {
  const fs = createFakeFirestore();
  const dev = createDevice({ source: HEAD, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_A });
  dev.setAuthUser(user());
  seedReview(fs, dev, "r1", { cardId: "c1", grade: 2, clientId: "device-a", ts: 1000 });
  await dev.call("pullReviews");
  assert.equal(dev.snapshotSrs().c1, undefined);
});
await scenario("S1 green (fixed) — own orphan row is recovered", async () => {
  const fs = createFakeFirestore();
  const dev = createDevice({ source: FIXED, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_A });
  dev.setAuthUser(user());
  seedReview(fs, dev, "r1", { cardId: "c1", grade: 3, clientId: "device-a", ts: 1000 });
  await dev.call("pullReviews");
  const c1 = dev.snapshotSrs().c1;
  assert.ok(c1);
  assert.equal(c1.reps, 1);
  assert.equal(c1.__lastReviewAt, 1000);
});

// ---- S2: baseline-create race, loser drops its own history (bug #2) ----
function seedLocalHistory(dev, obj) { dev.run(`srs = ${JSON.stringify(obj)}; saveSrs(srs);`); }
await scenario("S2 red (HEAD) — race loser never learns the winner's baseline", async () => {
  const fs = createFakeFirestore();
  const devA = createDevice({ source: HEAD, firestore: fs, deck: makeDeck(["a1", "b1"]), localStorageSeed: CLIENT_A });
  const devB = createDevice({ source: HEAD, firestore: fs, deck: makeDeck(["a1", "b1"]), localStorageSeed: CLIENT_B });
  devA.setAuthUser(user()); devB.setAuthUser(user());
  seedLocalHistory(devA, { a1: { st: "rev", ivl: 3, due: 0, reps: 1, ef: 2.5, lapses: 0, intro: 100, __lastReviewAt: 100 } });
  seedLocalHistory(devB, { b1: { st: "rev", ivl: 3, due: 0, reps: 1, ef: 2.5, lapses: 0, intro: 200, __lastReviewAt: 200 } });
  await devA.call("migrateOrRebuild");
  await devB.call("migrateOrRebuild");
  assert.equal(devB.snapshotSrs().a1, undefined);
});
await scenario("S2 green (fixed) — race loser merges the winner's baseline in", async () => {
  const fs = createFakeFirestore();
  const devA = createDevice({ source: FIXED, firestore: fs, deck: makeDeck(["a1", "b1"]), localStorageSeed: CLIENT_A });
  const devB = createDevice({ source: FIXED, firestore: fs, deck: makeDeck(["a1", "b1"]), localStorageSeed: CLIENT_B });
  devA.setAuthUser(user()); devB.setAuthUser(user());
  seedLocalHistory(devA, { a1: { st: "rev", ivl: 3, due: 0, reps: 1, ef: 2.5, lapses: 0, intro: 100, __lastReviewAt: 100 } });
  seedLocalHistory(devB, { b1: { st: "rev", ivl: 3, due: 0, reps: 1, ef: 2.5, lapses: 0, intro: 200, __lastReviewAt: 200 } });
  await devA.call("migrateOrRebuild");
  await devB.call("migrateOrRebuild");
  const b = devB.snapshotSrs();
  assert.ok(b.a1, "B should have merged A's baseline card");
  assert.ok(b.b1, "B should keep its own card");
});

// ---- S3a: rebuild double-applies a grade already reflected in the baseline
// (bug #3 — the single-row case) ----
await scenario("S3a red (HEAD) — rebuild double-applies a baseline-tied grade", async () => {
  const fs = createFakeFirestore();
  const devA = createDevice({ source: HEAD, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_A });
  const c1 = gradeState(devA, "undefined", "c1", 3, 1000);
  seedBaseline(fs, devA, { c1 });
  seedReview(fs, devA, "r1", { cardId: "c1", grade: 3, clientId: "device-a", ts: 1000 });

  const devB = createDevice({ source: HEAD, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_B });
  devB.setAuthUser(user());
  await devB.call("migrateOrRebuild");   // srs empty -> rebuildFromLog
  assert.equal(devB.snapshotSrs().c1.reps, 2, "expected the pre-fix double-apply (reps 1 -> 2)");
});
await scenario("S3a green (fixed) — rebuild does not double-apply", async () => {
  const fs = createFakeFirestore();
  const devA = createDevice({ source: FIXED, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_A });
  const c1 = gradeState(devA, "undefined", "c1", 3, 1000);
  seedBaseline(fs, devA, { c1 });
  seedReview(fs, devA, "r1", { cardId: "c1", grade: 3, clientId: "device-a", ts: 1000 });

  const devB = createDevice({ source: FIXED, firestore: fs, deck: makeDeck(["c1"]), localStorageSeed: CLIENT_B });
  devB.setAuthUser(user());
  await devB.call("migrateOrRebuild");
  assert.deepEqual(devB.snapshotSrs().c1, c1);
});

// ---- S3b: rebuild's out-of-order replay discards pre-log (baseline-only)
// history for a card with multiple logged rows (bug #3 — the multi-row
// case flagged in review: replay-from-undefined loses history the log
// never carried) ----
await scenario("S3b red (HEAD) — replay-from-scratch loses pre-sync history", async () => {
  const fs = createFakeFirestore();
  const devA = createDevice({ source: HEAD, firestore: fs, deck: makeDeck(["c3"]), localStorageSeed: CLIENT_A });
  // A pre-sync grade at t=100 that was NEVER logged (sync wasn't on yet),
  // then two post-sync grades that WERE logged.
  let c3 = gradeState(devA, "undefined", "c3", 3, 100);
  c3 = gradeState(devA, JSON.stringify(c3), "c3", 3, 1000);
  c3 = gradeState(devA, JSON.stringify(c3), "c3", 3, 2000);
  seedBaseline(fs, devA, { c3 });   // baseline captured after all three
  seedReview(fs, devA, "r1", { cardId: "c3", grade: 3, clientId: "device-a", ts: 1000 });
  seedReview(fs, devA, "r2", { cardId: "c3", grade: 3, clientId: "device-a", ts: 2000 });

  const devB = createDevice({ source: HEAD, firestore: fs, deck: makeDeck(["c3"]), localStorageSeed: CLIENT_B });
  devB.setAuthUser(user());
  await devB.call("migrateOrRebuild");
  assert.equal(devB.snapshotSrs().c3.reps, 2, "expected the pre-fix loss of the pre-sync grade (reps 3 -> 2)");
});
await scenario("S3b green (fixed) — baseline-seeded replay keeps pre-sync history", async () => {
  const fs = createFakeFirestore();
  const devA = createDevice({ source: FIXED, firestore: fs, deck: makeDeck(["c3"]), localStorageSeed: CLIENT_A });
  let c3 = gradeState(devA, "undefined", "c3", 3, 100);
  c3 = gradeState(devA, JSON.stringify(c3), "c3", 3, 1000);
  c3 = gradeState(devA, JSON.stringify(c3), "c3", 3, 2000);
  seedBaseline(fs, devA, { c3 });
  seedReview(fs, devA, "r1", { cardId: "c3", grade: 3, clientId: "device-a", ts: 1000 });
  seedReview(fs, devA, "r2", { cardId: "c3", grade: 3, clientId: "device-a", ts: 2000 });

  const devB = createDevice({ source: FIXED, firestore: fs, deck: makeDeck(["c3"]), localStorageSeed: CLIENT_B });
  devB.setAuthUser(user());
  await devB.call("migrateOrRebuild");
  assert.deepEqual(devB.snapshotSrs().c3, c3);
});

// ---- S4: end-to-end self-heal of two ALREADY-diverged real devices ----
// Phase 1 runs HEAD (the pre-fix code Hector's two real devices are
// running today) to fabricate the exact same divergence he saw in
// production — via the same bug #3 mechanism as S3a, reached through the
// real applyGrade/migrateOrRebuild functions rather than hand-seeded state.
// Phase 2 reopens the SAME two devices (same localStorage, same server)
// with the fixed code and expects them to converge with zero manual steps.
await scenario("S4 — two already-diverged devices self-heal on next open, no manual steps", async () => {
  const fs = createFakeFirestore();
  const deck = makeDeck(["c1", "c2", "c3"]);

  // Phase 1 (HEAD): A is the original device, grades a few cards for real
  // and becomes the sync baseline.
  let devA = createDevice({ source: HEAD, firestore: fs, deck, localStorageSeed: CLIENT_A });
  devA.setAuthUser(user());
  for (const [cardId, grade] of [["c1", 3], ["c2", 3], ["c3", 3]]) {
    devA.call("applyGrade", cardId, grade);
  }
  await drainOutbox(devA);
  await devA.call("migrateOrRebuild");   // A has local history -> becomes the baseline
  const aBeforeReopen = devA.snapshotSrs();

  // B is a brand-new second device pulling that history for the first
  // time — this is exactly the bug #3 double-apply path.
  let devB = createDevice({ source: HEAD, firestore: fs, deck, localStorageSeed: CLIENT_B });
  devB.setAuthUser(user());
  await devB.call("migrateOrRebuild");

  const bDiverged = devB.snapshotSrs();
  assert.notDeepEqual(bDiverged, aBeforeReopen, "fixture check: phase 1 should have produced real divergence");

  // Phase 2 (fixed code): same two devices "reopen the app" — same
  // localStorage, same server — after the fix ships. Nothing manual.
  devA = createDevice({ source: FIXED, firestore: fs, deck, localStorage: devA.localStorage });
  devA.setAuthUser(user());
  await devA.call("migrateOrRebuild");   // already migrated -> just pullReviews
  await devA.call("reconcile");

  devB = createDevice({ source: FIXED, firestore: fs, deck, localStorage: devB.localStorage });
  devB.setAuthUser(user());
  await devB.call("migrateOrRebuild");
  await devB.call("reconcile");

  assert.deepEqual(devA.snapshotSrs(), devB.snapshotSrs(), "both devices should converge to the identical state");
  assert.equal(devA.snapshotSrs().c1.reps, 1, "converged state should match a single, correct application of each grade");
  assert.equal(devA.snapshotSrs().c2.reps, 1);
});

async function drainOutbox(dev) {
  for (let i = 0; i < 1000 && dev.run("loadOutbox()").length; i++) {
    await new Promise((r) => setImmediate(r));
  }
  if (dev.run("loadOutbox()").length) throw new Error("drainOutbox: outbox never emptied");
}

// ---- S5: a failure mid-rebuild must not leave the cursor past unresolved
// rows (bug #4) ----
await scenario("S5 red (HEAD) — a failed pull still advances the cursor past unresolved rows", async () => {
  const fs = createFakeFirestore();
  const dev = createDevice({ source: HEAD, firestore: fs, deck: makeDeck(["c0", "c2"]), localStorageSeed: { ...CLIENT_B, "brain-gym.migrated.v1": "1" } });
  dev.setAuthUser(user());
  seedReview(fs, dev, "r0", { cardId: "c0", grade: 2, clientId: "device-a", ts: 500 });
  await dev.call("pullReviews");   // settle to a realistic non-null cursor first
  const cursorBefore = dev.run("loadCursor()");

  // Out-of-order arrival for c2: server sees the later-reviewedAt row
  // first (an earlier flush), so the second row needs the needsRebuild
  // per-card fallback query — that's the call this test fails.
  seedReview(fs, dev, "r_early", { cardId: "c2", grade: 3, clientId: "device-a", ts: 2000 });
  seedReview(fs, dev, "r_late", { cardId: "c2", grade: 3, clientId: "device-a", ts: 1000 });
  fs.failOnce((url, opts) => {
    const body = opts.body && JSON.parse(opts.body);
    return body?.structuredQuery?.where?.fieldFilter?.field?.fieldPath === "cardId";
  });
  await assert.rejects(() => dev.call("pullReviews"));
  assert.notEqual(dev.run("loadCursor()"), cursorBefore, "expected the pre-fix bug: cursor already moved past the unresolved row");
});
await scenario("S5 green (fixed) — a failed pull leaves the cursor untouched, retry recovers", async () => {
  const fs = createFakeFirestore();
  const dev = createDevice({ source: FIXED, firestore: fs, deck: makeDeck(["c0", "c2"]), localStorageSeed: { ...CLIENT_B, "brain-gym.migrated.v1": "1" } });
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

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
