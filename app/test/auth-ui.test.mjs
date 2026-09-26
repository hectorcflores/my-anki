import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getScriptSource } from "./extract-script.mjs";

const source = getScriptSource();
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(source, /app\.addEventListener\("click"/,
  "the stable app root must own the account click handler across renders");
assert.match(source, /closest\?\.\("#accountBtn"\)/,
  "the delegated handler must target the Sign in/account button");
assert.match(source, /authApi\?\.signIn\(\)/,
  "the signed-out account button must start authentication");
assert.match(html, /signInWithPopup\(instance, provider\)/,
  "authentication must finish in the app origin instead of losing redirect state across origins");
console.log("PASS auth UI: re-rendered Sign in button remains connected");
