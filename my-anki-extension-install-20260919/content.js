/* global KindleCollector */
const NOTEBOOK = "https://read.amazon.com/notebook";
const READER = "https://read.amazon.com/";

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithBackoff(url, options = {}) {
  const waits = [0, 2_000, 8_000, 20_000];
  let response;
  for (const wait of waits) {
    if (wait) await pause(wait);
    try { response = await fetch(url, { credentials: "include", ...options }); }
    catch { response = null; }
    if (response && ![429, 503].includes(response.status)) return response;
  }
  if (!response) throw new Error("AMAZON_DATES_NETWORK_FAILED");
  return response;
}

async function addOriginalDates(book, highlights) {
  const shell = await fetchWithBackoff(`${READER}?asin=${encodeURIComponent(book.asin)}`);
  if (shell.status === 401 || shell.status === 403 || shell.url.includes("/ap/signin")) {
    throw new Error("AMAZON_SIGN_IN_REQUIRED");
  }
  if (!shell.ok) throw new Error(`AMAZON_DATES_READER_${shell.status}`);
  const session = KindleCollector.extractReaderSession(await shell.text());
  if (!session) throw new Error("AMAZON_DATES_SESSION_UNAVAILABLE");

  let sawEmptyResponse = false;
  for (const assetId of session.assetIds) {
    const guid = encodeURIComponent(`${assetId},${assetId}`);
    const url = `${READER}service/mobile/reader/getAnnotations?asin=${encodeURIComponent(book.asin)}&guid=${guid}&clientVersion=20000100`;
    const response = await fetchWithBackoff(url, { headers: { "x-adp-session-token": session.token } });
    if (!response.ok) continue;
    let annotations;
    try { annotations = KindleCollector.parseReaderAnnotations(await response.text()); }
    catch { throw new Error("AMAZON_DATES_RESPONSE_INVALID"); }
    if (annotations.length) return KindleCollector.applyDates(highlights, annotations);
    sawEmptyResponse = true;
  }
  if (sawEmptyResponse) return highlights;
  throw new Error("AMAZON_DATES_UNAVAILABLE");
}

async function fetchBook(book) {
  const highlights = [];
  let token = "";
  let state = "";

  for (let pageNumber = 0; pageNumber < 40; pageNumber += 1) {
    const params = new URLSearchParams({ asin: book.asin, contentLimitState: state });
    if (token) params.set("token", token);
    const response = await fetch(`${NOTEBOOK}?${params}`, { credentials: "include" });
    if (response.status === 401 || response.status === 403 || response.url.includes("/ap/signin")) {
      throw new Error("AMAZON_SIGN_IN_REQUIRED");
    }
    if (!response.ok) throw new Error(`AMAZON_REQUEST_FAILED_${response.status}`);

    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    highlights.push(...KindleCollector.readAnnotations(page));
    ({ token, state } = KindleCollector.pagination(page));
    if (!token) {
      try {
        const dated = await addOriginalDates(book, highlights);
        return { ...book, highlights: dated, datesMatched: dated.filter((highlight) => highlight.d).length };
      } catch (error) {
        if (error.message === "AMAZON_SIGN_IN_REQUIRED") throw error;
        // Dates are an enrichment. Keep the highlights safe and explicitly
        // undated if Amazon's undocumented reader endpoint changes.
        return { ...book, highlights, datesMatched: 0, datesError: error.message || "AMAZON_DATES_UNAVAILABLE" };
      }
    }
    await pause(350);
  }
  throw new Error("PAGINATION_INCOMPLETE");
}

async function collectOneBook() {
  if (document.querySelector("#ap_email, input[type='password']")) {
    throw new Error("AMAZON_SIGN_IN_REQUIRED");
  }
  const [book] = KindleCollector.readBooks(document);
  if (!book) throw new Error("KINDLE_NOTEBOOK_NOT_READY");
  return { books: [await fetchBook(book)] };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== "collect-one-book") return undefined;
  collectOneBook()
    .then((payload) => respond({ ok: true, payload }))
    .catch((error) => respond({ ok: false, error: error.message || "UNKNOWN_ERROR" }));
  return true;
});

function showPilotStatus(result) {
  const badge = document.createElement("div");
  const saved = result?.ok && result?.batch?.books?.[0];
  const count = saved?.highlights?.length || 0;
  badge.textContent = saved
    ? `My Anki · collected ${count} highlights`
    : `My Anki · ${result?.status?.code || "could not sync"}`;
  Object.assign(badge.style, {
    position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647",
    padding: "9px 12px", borderRadius: "999px", font: "600 12px system-ui, sans-serif",
    color: "#fafafa", background: saved ? "#166534" : "#7f1d1d",
    boxShadow: "0 8px 24px rgba(0,0,0,.2)"
  });
  document.body.append(badge);
}

// The extension collects the first visible book as soon as a signed-in Notebook is
// ready. This keeps collection independent from whether Chrome shows the popup.
window.setTimeout(() => {
  chrome.runtime.sendMessage({ type: "sync-one-book" })
    .then(showPilotStatus)
    .catch(() => showPilotStatus());
}, 1_500);
