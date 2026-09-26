const button = document.querySelector("#sync");
const output = document.querySelector("#status");
const pill = document.querySelector("#pill");

const copy = {
  NOT_YET_SYNCED: "Open your Kindle notebook, then sync one book.",
  OPEN_KINDLE_NOTEBOOK: "Open read.amazon.com/notebook first.",
  AMAZON_SIGN_IN_REQUIRED: "Sign into Amazon in the Kindle notebook, then try again.",
  KINDLE_NOTEBOOK_NOT_READY: "Kindle is still loading. Try again in a moment.",
  SAVED_LOCALLY: "Collected. My Anki is finishing the secure upload.",
  IMPORTED: "Your Kindle highlights are in My Anki."
};

function show(result) {
  const state = result?.status || result;
  output.textContent = copy[state?.code] || `Could not sync: ${state?.code || "unknown error"}`;
  pill.dataset.state = ["SAVED_LOCALLY", "IMPORTED"].includes(state?.code) ? "ready"
    : state?.code?.includes("REQUIRED") ? "issue" : "working";
  pill.textContent = state?.code === "IMPORTED" ? "Updated"
    : state?.code === "SAVED_LOCALLY" ? "Sending"
    : state?.code?.includes("REQUIRED") ? "Needs sign-in" : "Kindle sync";
}

chrome.runtime.sendMessage({ type: "get-status" }).then(show);
button.addEventListener("click", async () => {
  button.disabled = true;
  output.textContent = "Checking Kindle…";
  pill.dataset.state = "working";
  pill.textContent = "Checking";
  try {
    show(await chrome.runtime.sendMessage({ type: "sync-one-book" }));
  } finally {
    button.disabled = false;
  }
});
