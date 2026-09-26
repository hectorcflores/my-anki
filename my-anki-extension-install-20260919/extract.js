/* Shared extraction helpers. This code only runs inside read.amazon.com. */
(() => {
  const BOOK_ROW = ".kp-notebook-library-each-book";
  const ANNOTATION_ROW = "#kp-notebook-annotations .kp-notebook-row-separator";

  function text(element) {
    return String(element?.innerText || element?.textContent || "").trim();
  }

  // The notebook HTML does not expose a date per highlight. The Kindle web
  // reader does: its annotation response carries `modifiedTimestamp` for
  // each highlight. This is the JavaScript port of my-readwise/dates.py,
  // which previously supplied the original dates used by My Anki.
  const MIN_MATCH_CHARS = 20;
  const QUOTES = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "–": "-", "—": "-", "−": "-", " ": " ", "…": "..."
  };

  function normalize(value) {
    return String(value || "").normalize("NFKC")
      .split("").map((character) => QUOTES[character] || character).join("")
      .replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  }

  function compatible(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    const [short, long] = left.length <= right.length ? [left, right] : [right, left];
    return short.length >= MIN_MATCH_CHARS && long.startsWith(short);
  }

  function extractReaderSession(html) {
    const tokenMatch = String(html || "").match(/var\s+deviceToken\s*=\s*(\{.*?\})\s*;/s);
    if (!tokenMatch) return null;
    let token;
    try { token = JSON.parse(tokenMatch[1]).deviceSessionToken; } catch { return null; }
    if (!token) return null;
    const assetIds = [];
    const add = (id) => { if (id && !assetIds.includes(id)) assetIds.push(id); };
    for (const match of String(html).matchAll(/assetId(?:\\x22|")\s*:\s*(?:\\x22|")(CR![A-Z0-9]+)/g)) add(match[1]);
    for (const match of String(html).matchAll(/CR![A-Z0-9]{20,40}/g)) add(match[0]);
    return assetIds.length ? { token, assetIds } : null;
  }

  function parseReaderAnnotations(body) {
    const data = typeof body === "string" ? JSON.parse(body) : body;
    return (data?.annotations || []).flatMap((annotation) => {
      if (annotation.type !== "kindle.highlight" || !annotation.context || !annotation.modifiedTimestamp) return [];
      const start = Number(annotation.start ?? annotation.position ?? 0);
      const end = Number(annotation.end ?? start);
      const timestamp = Number(annotation.modifiedTimestamp);
      if (![start, end, timestamp].every(Number.isFinite)) return [];
      return [{ text: String(annotation.context), start, end, timestamp }];
    }).sort((left, right) => left.start - right.start || left.end - right.end);
  }

  function applyDates(highlights, annotations) {
    const ordered = highlights.map((highlight, index) => ({
      index,
      location: Number.isFinite(Number(highlight.l)) ? Number(highlight.l) : Number.MAX_SAFE_INTEGER,
      text: normalize(highlight.h)
    })).filter((highlight) => highlight.text).sort((left, right) => left.location - right.location);
    const candidates = annotations.map((annotation) => ({ ...annotation, text: normalize(annotation.text), used: false }));
    const output = highlights.map((highlight) => ({ ...highlight }));
    for (const highlight of ordered) {
      const match = candidates.find((annotation) => !annotation.used && compatible(highlight.text, annotation.text));
      if (!match) continue;
      match.used = true;
      output[highlight.index].d = new Date(match.timestamp).toISOString();
    }
    return output;
  }

  function readBooks(document) {
    return Array.from(document.querySelectorAll(BOOK_ROW)).map((element) => {
      const asin = element.id;
      const title = text(element.querySelector("h2")) || asin;
      const author = text(element.querySelector("p")).replace(/^By:\s*/i, "");
      const dateElement = document.getElementById(`kp-notebook-annotated-date-${asin}`)
        || element.querySelector("input[id^='kp-notebook-annotated-date-']");
      return {
        asin,
        title,
        author,
        annotated: text(dateElement?.value ? { innerText: dateElement.value } : dateElement)
      };
    }).filter((book) => book.asin);
  }

  function readAnnotations(document) {
    return Array.from(document.querySelectorAll(ANNOTATION_ROW)).flatMap((row) => {
      const highlightElement = row.querySelector(".kp-notebook-highlight:not(.aok-hidden)");
      const noteElement = row.querySelector(".kp-notebook-note:not(.aok-hidden)");
      const highlight = text(highlightElement);
      const note = text(noteElement).replace(/^Note:\s*/i, "");
      if (!highlight && !note) return [];

      const header = text(row.querySelector("#annotationHighlightHeader, #annotationNoteHeader"));
      const page = header.match(/Page:\s*([0-9ivxlcdm]+)/i)?.[1] || null;
      const rawLocation = row.querySelector("input[id='kp-annotation-location']")?.value;
      const location = Number.parseInt(rawLocation, 10);
      return [{
        h: highlight || null,
        n: note || null,
        l: Number.isFinite(location) ? location : null,
        p: page
      }];
    });
  }

  function pagination(document) {
    return {
      token: document.querySelector(".kp-notebook-annotations-next-page-start")?.value || "",
      state: document.querySelector(".kp-notebook-content-limit-state")?.value || ""
    };
  }

  globalThis.KindleCollector = {
    readBooks, readAnnotations, pagination,
    extractReaderSession, parseReaderAnnotations, applyDates
  };
})();
