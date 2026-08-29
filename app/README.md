# Brain Gym

Spaced repetition over my Kindle highlights, at
[hectorcflores.github.io/brain-gym/](https://hectorcflores.github.io/brain-gym/).

The app opens straight into a review session — there is no browse view. Theme
pills at the top switch decks (Investing, Finance, Growth, Relationships,
Mindfulness) and show each deck's due count. Only highlights aligned with
their source book's core subject enter a deck; tangential ones are filtered
out upstream.

Static site, no build step, no backend. Add it to your home screen and it runs
offline as a standalone app.

## Files

| Path | What |
|------|------|
| `index.html` | The whole app: shadcn-zinc styling, SM-2 scheduler, review UI, optional sync |
| `data.js` | The deck — `window.ANKI = { themes, books }` |
| `firestore.rules` | Security rules for the optional Firestore sync (see below) |
| `sw.js` | Service worker; network-first with an offline cache |
| `manifest.webmanifest`, `icon*` | Home-screen install metadata |
| `geist-*.woff2` | Self-hosted Geist, so nothing loads from a third party |

## How the review works

Each card is either **source recall** (a highlight on the front — which book
is this from, and why did you save it?) or **question recall** (a generated
question on the front, the highlight as the answer).

After revealing, grade it: **Again** and **Hard** walk the card through short
learning steps (minutes, not days) before it graduates; **Good** graduates it
or multiplies its interval by the ease (~2.5×); **Easy** jumps further and
raises ease. The label under each button shows exactly when that choice
brings the card back — and that promise is real: a card graded "back in 6m"
genuinely waits out those 6 minutes (a "waiting" screen with a live countdown
shows if that's literally the only thing left in the session), it does not
just reappear after a few other cards.

Scheduling state lives in `localStorage` under `brain-gym.srs.v2` — per
browser, and per device unless sync is turned on (below). New cards are
capped at 20 per deck per day.

## Multi-device sync (optional)

Off by default — the app is fully usable, offline, with zero network calls,
until you turn this on. What it buys you: reviewing on your phone and your
laptop shares one schedule instead of silently drifting into two.

It's a Firestore project storing an **append-only log of every grade** — the
same shape Anki's own revlog uses. `srs` (the state above) is just that log
folded through the scheduler; nothing is ever edited or deleted, so a wiped
device recovers completely by replaying it, and two devices grading the same
card both count instead of one quietly overwriting the other.

**One-time setup**, once you (or whoever's helping you) have a Firebase
project with Firestore enabled and `firestore.rules` published to it: open
the app once with

```
https://hectorcflores.github.io/brain-gym/#fb_api_key=YOUR_API_KEY&fb_project_id=YOUR_PROJECT_ID&sync_key=YOUR_PRIVATE_SYNC_SECRET
```

— the fragment (everything after `#`) never leaves the browser, and is wiped
from the visible URL right after being read. Use the *same* URL, with the
*same* `sync_key`, on every device you want sharing this schedule. Pick your
own `sync_key`; it's never sent anywhere as plaintext, only a SHA-256 hash of
it is (that hash is what partitions the data — there's no login, no account).

**If you already have local review history** on the device you enable sync on
first, that history becomes the shared baseline everyone else builds on. A
brand-new device just pulls whatever's already there. One edge case worth
knowing: if two devices both have *independent* pre-sync history and enable
sync at the exact same cold moment, only the first to reach the server
becomes the baseline — the other device's un-synced history stays local-only.
In practice this doesn't come up if you enable sync on one device, use it a
little, then open the setup link on the next one, rather than doing both at
once.

There's no visible sync status indicator by design — sync failures log to
the browser console (`console.warn`) rather than adding UI for something
that should just work quietly. If something seems off, open devtools and
look for `Brain Gym sync:` warnings, or check the Firestore console directly
for review documents under `brain_gym/<your sync key's hash>/reviews`.

## Updating the deck

`data.js` is generated in [my-readwise](https://github.com/hectorcflores/my-readwise):
a nightly GitHub Action (`build-deck.yml`) picks books highlighted recently
(`myreadwise/recency.py`), tags every highlight with a theme, an
aligned/tangential verdict, and often a recall question via Claude
(`classify.py` → `data/tags.json`), then builds this file
(`build_deck.py`). See that repo's `README.md` for the full pipeline.

To ship a new deck by hand: replace `data.js`, bump `CACHE` in `sw.js`, push.
GitHub Pages redeploys on push to `main`.

## Local preview

```bash
cd brain-gym && python3 -m http.server 8790
```
