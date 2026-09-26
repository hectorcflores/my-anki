import assert from "node:assert/strict";
import crypto from "node:crypto";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { TextEncoder } from "node:util";

const html = readFileSync(new URL("../import.html", import.meta.url), "utf8");
const source = html.match(/async function stableImportId[\s\S]*?(?=async function importBatch)/)?.[0];
assert.ok(source, "stableImportId must remain present in the importer");
const context = { crypto: { subtle: crypto.webcrypto.subtle }, TextEncoder };
vm.createContext(context);
vm.runInContext(source, context);
const first = await context.stableImportId("same-batch-signature");
const second = await context.stableImportId("same-batch-signature");
const other = await context.stableImportId("different-batch-signature");
assert.equal(first, second, "the same Kindle batch always receives the same Firestore document id");
assert.notEqual(first, other, "different Kindle batches receive different ids");
assert.match(html, /response\.status!==409/, "an already-created batch is treated as a successful retry");
assert.doesNotMatch(html, /const id=crypto\.randomUUID\(\)/, "imports must not use a new random id on every retry");
assert.match(html, /signInWithPopup\(instance,provider\)/,
  "the importer must receive the authenticated user without cross-origin redirect state");
assert.match(html, /extension did not respond/,
  "a stale extension must produce a recovery instruction instead of hanging forever");
console.log("PASS import page: deterministic batch id and idempotent retry");
