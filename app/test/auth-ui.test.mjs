import assert from "node:assert/strict";
import { getScriptSource } from "./extract-script.mjs";

const source = getScriptSource();
assert.match(source, /app\.addEventListener\("click"/,
  "the stable app root must own the account click handler across renders");
assert.match(source, /closest\?\.\("#accountBtn"\)/,
  "the delegated handler must target the Sign in/account button");
assert.match(source, /authApi\?\.signIn\(\)/,
  "the signed-out account button must start authentication");
console.log("PASS auth UI: re-rendered Sign in button remains connected");
