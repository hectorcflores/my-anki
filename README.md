# My Anki

Spaced repetition over my Kindle highlights, at
[hectorcflores.github.io/my-anki/](https://hectorcflores.github.io/my-anki/).

The app opens into a single daily stack of at most five distinct cards, with
no category selector. Two places are reserved for the freshest unseen Kindle
highlights, shown first; three are for due reviews, oldest due date first.
If either pool is short, the other fills the remaining places. Cards already
reviewed today count toward these limits, including after reopening the app. Exact highlight timestamps
break ties within a day; missing dates sort last. Existing non-fiction and
quality filters remain, but small categories no longer exclude eligible cards.

Static site, no build step, no backend. Add it to your home screen and it runs
offline as a standalone app.

Named Brain Gym until 2026-08, when it moved out of the
[hectorcflores.github.io](https://github.com/hectorcflores/hectorcflores.github.io)
repo into this one to make room for a native iOS app alongside the web app.
History before that point lives in the old repo; the `brain-gym-import` tag
here is the last pre-rename state of the code, kept because the sync tests
run migration scenarios against it.

## Layout

| Path | What |
|------|------|
| `index.html` | Redirect from `/my-anki/` to the app |
| `app/index.html` | The whole app: shadcn-zinc styling, SM-2 scheduler, review UI, sync |
| `app/data.js` | The deck — `window.ANKI = { themes, books }`, generated nightly |
| `app/sw.js` | Service worker; network-first with an offline cache |
| `app/manifest.webmanifest`, `app/icon*` | Home-screen install metadata |
| `app/geist-*.woff2` | Self-hosted Geist, so nothing loads from a third party |
| `app/test/` | Deterministic multi-device sync suite (below) |

Firestore security rules for this app are **not** kept here. All three apps on
this Firebase project share one ruleset, and publishing replaces the whole
thing, so it lives in one place:
[`my-pomodoro/firestore.rules`](https://github.com/hectorcflores/my-pomodoro/blob/main/firestore.rules).

## How the review works

Each card is either **source recall** (a highlight on the front — which book
is this from, and why did you save it?) or **question recall** (a generated
question on the front, the highlight as the answer).

After revealing, grade it: **Again** and **Hard** walk the card through short
learning steps (minutes, not days) before it graduates; **Good** graduates it
or multiplies its interval by the ease (~2.5×); **Easy** jumps further and
raises ease. The label under each button shows exactly when that choice
brings the card back — and that promise is real: a card graded "back in 6m"
genuinely waits out those 6 minutes, it does not just reappear after a few
other cards.

Scheduling state lives in `localStorage` under `my-anki.srs.v2`.

There is one limit: **five distinct cards per local calendar day**. Both new
cards and due reviews use it. Again and Hard may bring the same learning card
back later that day without using another slot. Finishing five cards cannot
refill the stack by reopening the app. Missing days never raises the daily
limit; older reviews retain their due dates and wait for a place on a later day.

The limit is derived from saved review state and shared once devices sync.
Simultaneous offline devices cannot enforce an account-wide limit atomically;
use one device at a time or let sync complete when switching. Reviews already
done before installing this smaller limit still count today.

The count includes today's learning cards waiting to return. Rebuilding a
session restores these waiting cards from saved state, and due learning steps
take priority at the next question boundary. The current answer is preserved.
The four grading rules and historical review replay are unchanged by this
queue/UI change; this is not a full canonical-Anki scheduler migration.

The footer carries the deck's own provenance — the day the nightly job
published it, and the newest Kindle highlight it was built from, going amber at
three days. It is the only place the highlight pipeline is visible from inside
the app, and without it a sync that quietly died looks exactly like a stretch
of days with nothing new to highlight.

## Multi-device sync

Sign in with Google from the chip in the header. Signed out, the app is fully
usable offline with zero network calls; grades queue locally and follow the
account once you sign in.

Storage is a Firestore **append-only log of every grade** — the same shape
Anki's own revlog uses — under `my_anki/<uid>/reviews`, with a one-time
`meta/baseline` snapshot of whatever history a device had before it first
synced. `srs` is just that log folded through the scheduler; nothing is ever
edited or deleted, so a wiped device recovers completely by replaying it, and
two devices grading the same card both count instead of one overwriting the
other.

The status pill in the header shows syncing / synced / offline. Failures also
log to the console as `My Anki sync:` warnings.

**The pill is also the button.** Sync otherwise happens only on implicit
triggers — app open, tab foregrounded, network back, and a 15-minute timer —
which covers the normal case but leaves no way to *ask*, which is exactly what
you want when the phone and the laptop disagree and you are holding both. Tap
it and it pushes, pulls, and rechecks the deck. A second tap while one is in
flight is ignored for 30 seconds; the window is a timestamp rather than a flag
because no request here has a timeout, and a flag would leave the button dead
for the life of the tab if one ever hung. The automatic triggers deliberately
do not share that guard, so a hung request can never take all of them down at
once. Signed out, the pill still reads "Local only" and does nothing.

A pull that arrives while an answer is on screen folds into `srs` immediately
but waits to rebuild the visible queue, the same way a new deck or a new app
build waits — rebuilding would have cleared the answer being read.

### Migrating off Brain Gym

Two one-time steps run automatically and are safe to re-run:

- **Keys.** Every `brain-gym.*` localStorage key is copied to `my-anki.*` on
  first load. The originals are deliberately left in place as the rollback,
  and because the old app kept working from them until its forwarder shipped.
- **Cloud data.** `brain_gym/<uid>` is copied into `my_anki/<uid>` on first
  sign-in, preserving document ids (so two devices racing to migrate produce
  one copy) and the original `clientId` on each row. The old collection is
  never written to and never deleted — it is the rollback.

Because the old app could outlive the migration on a device whose service
worker hadn't picked up the forwarder, two safety nets stay in place until
both devices are confirmed on this build: grades stranded in the old outbox
are scavenged into this one on every open, and one bounded query per open
looks for anything written to the old collection after the import ran. Both
can be deleted once the old app is gone from every device.

## Tests

```bash
node app/test/sync.test.mjs
node app/test/scheduler.test.mjs
```

`scheduler.test.mjs` covers the five-card cap, two-fresh/three-review and freshest-first
selection, missing days, no refill after completion, waiting-card restoration,
and same-day highlight timestamps.

`sync.test.mjs` is a deterministic harness — an in-memory Firestore plus one `vm` context per
simulated device — for the one class of bug that can't be reproduced by
clicking: two devices racing to sync. It runs in under a second and needs no
browser and no network (the fake refuses any non-Firestore URL outright, so a
test can never touch real data).

`S*` scenarios are regressions for the sync bugs found in 2026-08. `M*` cover
the Brain Gym migration, running the real pre-rename code — extracted from the
`brain-gym-import` tag — as one device against the current build as another,
which is how the staggered-rollout orderings get exercised.

## Updating the deck

`app/data.js` is generated in
[my-readwise](https://github.com/hectorcflores/my-readwise): a nightly GitHub
Action (`build-deck.yml`) picks books highlighted recently, tags every
highlight with a theme, an aligned/tangential verdict, and often a recall
question via Claude, then builds this file and pushes it here. It also stamps
the file with `generated` (the build date) and `latest` (the newest highlight
in the whole library, with its book) — the two facts the app's footer reads.

To ship a new deck by hand: replace `app/data.js`, bump `CACHE` in
`app/sw.js`, push. GitHub Pages redeploys on push to `main`.

## Local preview

```bash
cd app && python3 -m http.server 8790
```
