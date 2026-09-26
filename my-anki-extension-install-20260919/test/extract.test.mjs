import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../extract.js", import.meta.url), "utf8");
const context = { globalThis: {} };
vm.runInNewContext(source, context);
const { readAnnotations, pagination, extractReaderSession, parseReaderAnnotations, applyDates } = context.globalThis.KindleCollector;

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

const readerHtml = String.raw`<script>
var deviceToken = {"deviceSessionToken":"{enc:FAKE+TOKEN==}"};
var metadataResponse = JSON.parse('{\x22assetId\x22:\x22CR!AAAAAAAAAAAAAAAAAAAAAAAAAAAAA\x22}');
</script>`;
assert.deepEqual(JSON.parse(JSON.stringify(extractReaderSession(readerHtml))), {
  token: "{enc:FAKE+TOKEN==}", assetIds: ["CR!AAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]
});
const timestamp = Date.parse("2026-05-19T06:54:00.000Z");
const annotations = parseReaderAnnotations(JSON.stringify({ annotations: [
  { type: "kindle.highlight", context: "A saved highlight with enough matching context to be unique", start: 10, end: 20, modifiedTimestamp: timestamp },
  { type: "kindle.note", context: "ignored note", start: 1, modifiedTimestamp: timestamp }
] }));
assert.equal(annotations.length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(applyDates([
  { h: "A saved highlight with enough matching context to be unique and a longer ending", l: 42 },
  { h: "An unmatched highlight remains explicitly undated", l: 80 }
], annotations))), [
  { h: "A saved highlight with enough matching context to be unique and a longer ending", l: 42, d: "2026-05-19T06:54:00.000Z" },
  { h: "An unmatched highlight remains explicitly undated", l: 80 }
]);
console.log("extension extraction tests passed");
