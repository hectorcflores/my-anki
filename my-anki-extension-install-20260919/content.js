/* global KindleCollector */
const NOTEBOOK = "https://read.amazon.com/notebook";

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    if (!token) return { ...book, highlights };
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
