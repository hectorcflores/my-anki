/* Shared extraction helpers. This code only runs inside read.amazon.com. */
(() => {
  const BOOK_ROW = ".kp-notebook-library-each-book";
  const ANNOTATION_ROW = "#kp-notebook-annotations .kp-notebook-row-separator";

  function text(element) {
    return String(element?.innerText || element?.textContent || "").trim();
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

  globalThis.KindleCollector = { readBooks, readAnnotations, pagination };
})();
