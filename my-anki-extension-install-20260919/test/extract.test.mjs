import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../extract.js", import.meta.url), "utf8");
const context = { globalThis: {} };
vm.runInNewContext(source, context);
const { readAnnotations, pagination } = context.globalThis.KindleCollector;

function element({ text = "", value = "", queries = {} } = {}) {
  return { innerText: text, textContent: text, value, querySelector: (selector) => queries[selector] || null };
}

const row = element({ queries: {
  ".kp-notebook-highlight:not(.aok-hidden)": element({ text: "A saved highlight" }),
  ".kp-notebook-note:not(.aok-hidden)": element({ text: "Note: A saved note" }),
  "#annotationHighlightHeader, #annotationNoteHeader": element({ text: "Page: 7" }),
  "input[id='kp-annotation-location']": element({ value: "42" })
} });
const document = {
  querySelectorAll: (selector) => selector.includes("row-separator") ? [row] : [],
  querySelector: (selector) => ({
    ".kp-notebook-annotations-next-page-start": element({ value: "next" }),
    ".kp-notebook-content-limit-state": element({ value: "state" })
  })[selector] || null
};

assert.deepEqual(JSON.parse(JSON.stringify(readAnnotations(document))), [{ h: "A saved highlight", n: "A saved note", l: 42, p: "7" }]);
assert.deepEqual(JSON.parse(JSON.stringify(pagination(document))), { token: "next", state: "state" });
assert.deepEqual(JSON.parse(JSON.stringify(readAnnotations({ querySelectorAll: () => [element()] }))), []);
console.log("extension extraction tests passed");
