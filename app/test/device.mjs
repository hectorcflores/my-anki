// Runs the app's inline script in its own vm context — one per simulated
// "device" — with just enough DOM/browser stubbing for it to boot and run
// its sync logic without a real browser. Two or more devices sharing one
// fake-firestore instance (see fake-firestore.mjs) simulate two of Hector's
// real devices signed into the same account.
//
// The script version is whatever the caller passes, so one device can run the
// pre-rename Brain Gym build while another runs the current one — which is how
// the migration scenarios exercise a staggered rollout.
import vm from "node:vm";
import crypto from "node:crypto";

function makeLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _dump: () => Object.fromEntries(store),
  };
}

function makeElement() {
  return { innerHTML: "", textContent: "", dataset: {}, addEventListener() {}, style: {} };
}

function makeDocument() {
  const elements = new Map();
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
}

// A small deck is enough to exercise the scheduler and sync paths; the exact
// content never matters to the sync bugs under test, only card ids do.
export function makeDeck(cardIds) {
  return {
    themes: [{ id: "t1", label: "Theme 1" }],
    books: [{
      id: "b1", title: "Test Book", author: "Author",
      highlights: cardIds.map((id) => ({ id, theme: "t1", text: `text-${id}`, loc: 1 })),
    }],
  };
}

export function createDevice({ source, firestore, deck, localStorageSeed = {}, localStorage: reuseLocalStorage }) {
  // Passing an existing localStorage (from a previous createDevice call)
  // simulates the same physical device reopening the app with new code —
  // exactly what "the app self-updates" means for an already-diverged
  // device, as opposed to a fresh install.
  const localStorage = reuseLocalStorage || makeLocalStorage(localStorageSeed);
  let capturedAuthCb = null;

  const sandbox = {
    console,
    crypto: { randomUUID: () => crypto.randomUUID() },
    localStorage,
    document: makeDocument(),
    navigator: { onLine: true },
    location: { reload() {} },
    fetch: (url, opts) => firestore.fetch(url, opts),
    addEventListener() {},
    setInterval() { return 0; },
    clearInterval() {},
    setTimeout() { return 0; },   // never fires — tests drive everything explicitly
    clearTimeout() {},
    confirm: () => true,
    ANKI: deck,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "app-inline.js" });

  // Mirrors the module script at the bottom of index.html: captures the
  // onAuthChange callback so the test can fire it on demand instead of
  // waiting on a real Firebase Auth round trip. The global was renamed with
  // the app, so both script versions are accepted here — that's what lets one
  // scenario drive an old device and a new one side by side.
  const syncGlobal = sandbox.MyAnkiSync ?? sandbox.BrainGymSync;
  if (!syncGlobal) throw new Error("device: script exposed neither MyAnkiSync nor BrainGymSync");
  syncGlobal.start({
    onAuthChange(cb) { capturedAuthCb = cb; },
    async signIn() {},
    signOutUser() {},
  });

  const device = {
    ctx: sandbox,
    // Simulates this device signing in — runs the exact same startup chain
    // production runs (importLegacyTenant -> flushOutbox -> migrateOrRebuild
    // -> reconcile, whichever of those exist in this script version) and
    // resolves once it's done.
    signIn(user) {
      if (!capturedAuthCb) throw new Error("device: sync global's start() never captured a callback");
      return capturedAuthCb(user);
    },
    // Sets the `let authUser`/`authState` bindings directly, bypassing the
    // full sign-in chain — for scenarios that want to call one sync
    // function in isolation rather than the whole startup sequence. Works
    // by bridging the value through a throwaway global property (so a
    // function like getToken survives the hop) and assigning it to the
    // existing lexical binding from a follow-up script in the same context.
    setAuthUser(user) {
      sandbox.__testUser = user;
      vm.runInContext("authUser = window.__testUser; authState = authUser ? 'in' : 'out'; delete window.__testUser;", sandbox);
    },
    // Direct call to any top-level function the script declares
    // (applyGrade, pullReviews, flushOutbox, migrateOrRebuild, reconcile —
    // the last only exists on script versions that define it).
    call(fnName, ...args) {
      const fn = sandbox[fnName];
      if (typeof fn !== "function") throw new Error(`device: no such function '${fnName}' in this script version`);
      return fn(...args);
    },
    has(fnName) { return typeof sandbox[fnName] === "function"; },
    // Evaluates an arbitrary expression/statement in the same shared
    // lexical scope the script ran in — vm.runInContext calls against the
    // same context share that scope, so this reads/writes live bindings
    // (srs, authUser, cursor, ...), not a snapshot from load time.
    run(expr) { return vm.runInContext(expr, sandbox); },
    // JSON round-trip: srs is plain JSON-shaped data, and objects returned
    // across the vm realm boundary compare unreliably with
    // node:assert/strict.deepStrictEqual otherwise (different Object/Array
    // constructors per realm).
    snapshotSrs() { return JSON.parse(JSON.stringify(device.run("srs"))); },
    localStorage,
  };
  return device;
}
