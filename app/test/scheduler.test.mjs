// Daily-limit tests. The sync suite covers the one class of bug that can't be
// reproduced by clicking; this one covers the other — a queue whose size
// depends on what day it is and how far behind you are, which takes a week of
// not opening the app to observe by hand.
//
//   node app/test/scheduler.test.mjs
import assert from "node:assert/strict";
import { getScriptSource } from "./extract-script.mjs";
import { createDevice } from "./device.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";

const source = getScriptSource();
const DAY = 864e5;

// Two themes, so the pill arithmetic has something to be wrong about.
function deckOf(counts) {
  const highlights = [];
  for (const [theme, n] of Object.entries(counts))
    for (let i = 0; i < n; i++)
      highlights.push({ id: `${theme}-${i}`, theme, text: `text ${theme} ${i}`, loc: i });
  return {
    themes: Object.keys(counts).map((t) => ({ id: t, label: t })),
    books: [{ id: "b1", title: "Test Book", author: "Author", highlights }],
  };
}

function device(deck) {
  return createDevice({ source, firestore: createFakeFirestore(), deck });
}

// A card in review state, overdue by `daysAgo`, last actually reviewed then.
function reviewCard(daysAgo) {
  const at = Date.now() - daysAgo * DAY;
  return { st: "rev", step: 0, ef: 2.5, ivl: 10, due: at, reps: 3, lapses: 0,
           intro: at - 30 * DAY, __lastReviewAt: at };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("a backlog is capped at MAX_REVIEWS_PER_DAY, not dumped in one session", () => {
  // 260 overdue cards is a month away from a deck this size.
  const d = device(deckOf({ work: 160, health: 100 }));
  const cap = d.run("MAX_REVIEWS_PER_DAY");
  d.run(`srs = Object.fromEntries(cards.map(c => [c.id, ${JSON.stringify(reviewCard(7))}]))`);
  const q = d.run("buildQueue()");
  assert.equal(q.cards.length, cap);
  assert.equal(q.backlog, 260 - cap);
});

test("the cap spends oldest-due-first, so nothing is starved", () => {
  const d = device(deckOf({ work: 260 }));
  d.run(`srs = {}; cards.forEach((c, i) => srs[c.id] = { st: "rev", ef: 2.5, ivl: 10, reps: 3,
          lapses: 0, due: Date.now() - (260 - i) * ${DAY}, intro: 0, __lastReviewAt: 0 })`);
  const ids = d.run("buildQueue().cards.map(c => c.id)");
  const expected = d.run("cards.slice().sort((a,b) => srs[a.id].due - srs[b.id].due)"
    + `.slice(0, MAX_REVIEWS_PER_DAY).map(c => c.id)`);
  assert.deepEqual([...ids], [...expected]);
});

test("learning cards are never held back by the review cap", () => {
  // The cap is fully spent by overdue reviews; a card mid-learning-step still
  // has to come back this session or the grade that put it there was a lie.
  const d = device(deckOf({ work: 260 }));
  d.run(`srs = Object.fromEntries(cards.map(c => [c.id, ${JSON.stringify(reviewCard(7))}]))`);
  d.run(`srs["work-0"] = { st: "lrn", step: 0, ef: 2.5, ivl: 0, due: Date.now() - 60e3,
          reps: 0, lapses: 0, intro: Date.now(), __lastReviewAt: Date.now() }`);
  const q = d.run("buildQueue()");
  assert.ok([...q.cards.map(c => c.id)].includes("work-0"));
  assert.equal(q.cards.length, d.run("MAX_REVIEWS_PER_DAY") + 1);
});

test("new cards get only what is left under the review cap", () => {
  // Anki v3's limit order, which is the whole reason this app needs no
  // separate "pause new cards when behind" rule: reviews are taken first, and
  // new cards fill whatever room is left beneath the same cap.
  const d = device(deckOf({ work: 160, health: 100 }));
  const cap = d.run("MAX_REVIEWS_PER_DAY");
  const newLimit = d.run("NEW_PER_DAY");
  const overdue = (n) => d.run(
    `srs = Object.fromEntries(cards.slice(0, ${n}).map(c => [c.id, ${JSON.stringify(reviewCard(7))}]))`);
  const freshInQueue = () => d.run("buildQueue().cards.filter(c => !srs[c.id]).length");

  overdue(cap + 5);        // cap fully spent by the backlog
  assert.equal(freshInQueue(), 0);

  overdue(cap - 5);        // five slots left, so five new cards, not twenty
  assert.equal(freshInQueue(), 5);

  overdue(10);             // an ordinary day never reaches the cap
  assert.equal(freshInQueue(), newLimit);
});

test("today's reviews spend the budget, so reopening the app can't refill it", () => {
  const d = device(deckOf({ work: 260 }));
  const cap = d.run("MAX_REVIEWS_PER_DAY");
  d.run(`srs = Object.fromEntries(cards.map(c => [c.id, ${JSON.stringify(reviewCard(7))}]))`);
  // Ten of them already graded today — an older intro, so they count as
  // reviews rather than as today's new cards.
  d.run(`cards.slice(0, 10).forEach(c => { srs[c.id].__lastReviewAt = Date.now();
          srs[c.id].due = Date.now() + 5 * ${DAY} })`);
  assert.equal(d.run("reviewsDoneToday()"), 10);
  assert.equal(d.run("buildQueue().cards.length"), cap - 10);
});

test("a new card introduced today does not eat the review budget", () => {
  const d = device(deckOf({ work: 260 }));
  d.run(`srs = {}; cards.slice(0, 10).forEach(c => srs[c.id] = { st: "lrn", step: 1, ef: 2.5,
          ivl: 0, due: Date.now() + 6e5, reps: 0, lapses: 0,
          intro: Date.now(), __lastReviewAt: Date.now() })`);
  assert.equal(d.run("reviewsDoneToday()"), 0);
  assert.equal(d.run("newIntroducedToday()"), 10);
});

test("the pill numbers add up to All", () => {
  const d = device(deckOf({ work: 160, health: 100 }));
  d.run(`srs = Object.fromEntries(cards.slice(0, 20).map(c => [c.id, ${JSON.stringify(reviewCard(2))}]))`);
  const all = d.run("dueCards('all').length");
  const work = d.run("dueCards('work').length");
  const health = d.run("dueCards('health').length");
  assert.equal(work + health, all);
  assert.ok(all > 0);
});

test("an untouched deck still opens with exactly NEW_PER_DAY cards", () => {
  const d = device(deckOf({ work: 160, health: 100 }));
  assert.equal(d.run("dueCards('all').length"), d.run("NEW_PER_DAY"));
  assert.equal(d.run("buildQueue().backlog"), 0);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
