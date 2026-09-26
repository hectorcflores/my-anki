# Kindle extension plan

Status: proposal, not implemented. Prepared September 19, 2026.

## Product decision

Build a private Chrome extension for Hector first. It reads Kindle highlights through the Amazon session in his normal browser, uploads them securely, and lets the existing cloud pipeline update My Anki. Do not copy Amazon sessions to GitHub runners. This follows the browser-based approach documented by Readwise; it is not a claim to reproduce their proprietary implementation or reliability.

The necessary compromise is explicit: collection requires Chrome running on an awake, internet-connected Mac. The Mac need not remain on continuously. After an upload completes, cloud processing can continue with the Mac off. Amazon can still require a new sign-in, performed directly on Amazon. Neither stored passwords nor automated verification bypasses are part of this design.

## User experience

One-time setup: install the private extension, connect the same account used for My Anki, and sign into Amazon if needed. Begin with a manual “Sync now” action for validation, then enable automatic collection when Chrome starts and approximately every six hours while it is running. Resume interrupted work after wake/restart; no requirement to leave a tab or Codex open. The collector may create an inactive notebook tab while working and must close only tabs it created. Validate that inactive-tab behavior works before promising silent background operation.

Show separate, truthful states: “Checking Kindle”, “Highlights uploaded; preparing cards”, “Updated [time]”, “Waiting for connection”, and “Sign into Amazon”. Updated means the matching import has reached the published deck, not merely that a timer fired. A session rejection pauses Amazon collection until sign-in is completed and a deliberate retry succeeds. Ordinary connection failures retain pending work and retry with increasing delays.

## Existing code to reuse

- my-readwise/myreadwise/scraper.py: notebook extraction and pagination behavior. Port the relevant browser JavaScript; do not reuse cookie-export or browser-fingerprint manipulation.
- my-readwise/myreadwise/store.py: additive merging and duplicate handling.
- my-readwise/sync.py: existing import entry point. It needs a versioned extension adapter: do_import currently drops recency metadata, so passing its current JSON shape unchanged would regress freshness.
- my-readwise/.github/workflows/build-deck.yml: existing deck generation and deployed-byte verification.
- my-anki/app/index.html: existing Firebase identity and review/hidden-card persistence. Collection must preserve those records and stable card identities.

## Proposed data path

Chrome notebook tab -> extension durable queue -> private authenticated Firestore import inbox -> GitHub ingestion job -> existing library/Anki build -> verified deployment -> completion receipt visible in extension.

Reuse the existing Firebase project if its rules and available quotas permit. Extension authentication must use the supported Firebase Chrome-extension flow, with separate extension authorization and Hector's existing account identity. Do not assume the web app's login automatically signs the extension in. Limit inbox writes to the owner; other accounts must be denied. The GitHub worker authenticates using credentials scoped to ingestion where feasible, held only in GitHub secrets or workload identity. Never ship a GitHub token, service-account key, Amazon password, or Amazon cookies in extension code or uploads.

Start with an hourly cloud inbox check that exits cheaply if no work exists. Build only after a changed import; do not rebuild on every poll. GitHub scheduling may be delayed, so “immediate” delivery is not promised. Verify total account runner usage before selecting this schedule; approximately 720 minimum-minute polls/month plus existing jobs is a budget estimate, not a free-tier guarantee. A faster trigger is a later improvement if the delay is unacceptable.

Use versioned, bounded upload chunks with stable batch/chunk IDs, checksums, expected chunk counts, and a completion manifest. Validate ownership, schema, size and content before merging. Incomplete downloads or uploads never delete existing highlights and never count as full success. Retry/duplicate delivery must be safe. Preserve source book IDs, text, notes, locations, available dates, ordering, and observation time; unknown highlight dates remain unknown. Process only changed content, with a resumable initial scan and periodic full reconciliation so changes to older books are not permanently missed. Expire acknowledged staging data through the worker after a retention window; keep the durable library.

## Delivery sequence and gates

1. Prove collection. Install locally and manually collect a small known book, including pagination and notes. Compare results with the notebook. Run again with no duplicates. Prove access from normal Chrome without exporting Amazon credentials.
2. Prove secure delivery. Upload a small batch, validate permissions, import using existing identity rules, build, and verify the new expected card on the iPhone. Sign-in, secure cloud ingestion and recency preservation are the main unknown effort items.
3. Add recovery and automation. Persist progress before acknowledging work. Test lost network, laptop sleep, Chrome restart, terminated extension worker, duplicate upload, partial book download, expired application login, Amazon login wall, changed Amazon markup, Git conflict and failed deployment. Clearly distinguish retryable failures from sign-in-required and parser changes. Observe before changing extraction assumptions.
4. Migrate carefully. Once manual end-to-end delivery works, pause the old Amazon cloud scraper and the old Mac scraper for the pilot; preserve their configuration and backups. Keep cloud card generation running. Do not run two Amazon collectors as the steady state. Record actual import/deployment timestamps in monitoring, replacing exit-code-only success signals. Do not silence alerts merely to make the pilot look healthy.
5. Observe a seven-day pilot. Confirm repeated sync on separate days, deliberate offline/restart recovery, no duplicated cards or lost review/hide history, and a real newly created highlight reaching the phone. A failed Amazon session must produce an actionable sign-in state rather than endless retries. Seven days gives initial evidence, not proof that future authentication never fails.

## Costs and boundaries

Aim for no new recurring service subscription, using existing Firebase and GitHub capacity. Check actual usage and billing settings first; no automatic paid upgrade. Stop/defer and explain if free quotas are insufficient. Existing classify.py uses ANTHROPIC_API_KEY, so the present downstream system is not necessarily zero-cost. If zero total spend is required, use an explicitly agreed non-AI card-generation fallback or defer new classification when its allowed budget is exhausted.

Use a locally installed unpacked extension for this one-user pilot. Chrome Web Store distribution and any registration charge are out of scope. Also out of scope: Firefox, iPhone extensions, new Anki scheduling behavior, category changes, and a general product for multiple users.

## Estimate and first step

The previous 1–2 day estimate is reasonable only for a collection prototype, not for a complete reliable release. Plan roughly 3–5 focused development days for the initial integrated version, subject to authentication and ingestion findings, followed by the seven-day observation period. These are planning estimates, not a delivery guarantee.

First implementation milestone: manually collect one book through the extension and verify its highlights against Amazon without modifying the production library. No production changes have been made by writing this plan.

## Evidence

Readwise's documented approach and sign-in limitation: https://docs.readwise.io/readwise/docs/importing-highlights/kindle
Chrome alarms and sleep behavior: https://developer.chrome.com/docs/extensions/reference/api/alarms
Durable state across extension-worker termination: https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
Supported Firebase extension authentication: https://firebase.google.com/docs/auth/web/chrome-extension
Firestore quotas: https://firebase.google.com/docs/firestore/quotas
