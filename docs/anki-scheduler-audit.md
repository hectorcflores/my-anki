# Anki scheduler audit

## Verdict and scope

My Anki implements a custom approximation of Anki's SM-2 scheduling, not the canonical scheduler. Its basic grading direction is sound, but confirmed differences affect when cards return. The highest-priority defect is losing waiting learning cards when a session is rebuilt; this is a functional problem independent of the choice between SM-2 and FSRS.

Inspection date: September 12, 2026. App revision: `ae951286f8aec885208e3a028992dce49e559da5`. Reference: official [Anki 26.08.1](https://github.com/ankitects/anki/releases/tag/26.08.1), published August 5, 2026, using its SM-2 path and matching the app's fixed learning/relearning settings. Initial inspection also used upstream main `2fae55543cfaa82880b84787b09b0ebf06ac9e29`; the cited discrepancies were checked against the release. No assumption is made about any user's Anki preferences. FSRS is a different supported scheduler and is not implemented here.

This was a code inspection and execution of synthetic cases against the app's actual inline JavaScript. No personal review state was read or modified, and no scheduler changes were made. The existing daily-limit suite passed 8/8 and the sync suite passed 19/19. Those results do not establish canonical interval correctness.

## What the answer buttons mean

The buttons assess recall, not how important, interesting or intrinsically difficult a highlight is. Again means recall failed. Hard means the answer was correct but difficult or uncertain to retrieve. Good means correct recall with ordinary effort. Easy means correct recall without effort. Forgetting and then recognizing the revealed answer belongs under Again, not Hard. These distinctions follow the [official studying manual](https://docs.ankiweb.net/studying.html#answer-buttons).

The app uses the right four labels, but provides no explanation of these meanings beside them. The source-recall prompt also combines recalling a book with remembering why a passage was saved. That subjective second part lacks a displayed expected answer unless a useful note exists, making consistent self-grading harder. This is a card-design issue, not a scheduler calculation error.

## Confirmed findings

### P1: Waiting learning cards disappear from the active session after rebuilding

[app/index.html:1575](/Users/hectorcflores/Documents/projects/my-anki/app/index.html:1575) creates a session from currently due cards and always initializes an empty pending list. A card whose next step is still five minutes away enters neither list. Category changes, reopening the app, sync-driven rebuilding and deck replacement can all take this route.

Reproduction: give one learning card a due time ten minutes in the future; rebuild the session; then advance its due time into the past and call `promotePending()`. The session still has zero queued and zero pending cards, while `dueCards('all')` correctly returns one. The record is not deleted, but there is no pending timer to restore it in that session. Another rebuild after it is due can recover it. The empty-session screen can meanwhile show “Deck clear” or “Nothing due.”

Recommendation: rebuild pending learning/relearning cards from saved scheduling state as well as the ready queue, and test category switching, reopening and incoming sync during a learning delay.

### P2: Relearning Hard repeats too soon; Easy can overshoot

[app/index.html:495](/Users/hectorcflores/Documents/projects/my-anki/app/index.html:495) treats Again and Hard identically in relearning. With the configured single ten-minute step, Anki's Hard delay is fifteen minutes. The app gives ten. When the stored post-lapse interval is one day, Anki's SM-2 relearning Easy gives two days; the app can give three because it adds its own random variation. Both discrepancies were reproduced with a synthetic relearning card.

Sources: [Anki 26.08.1 step rules](https://github.com/ankitects/anki/blob/26.08.1/rslib/src/scheduler/states/steps.rs#L38) and [relearning implementation](https://github.com/ankitects/anki/blob/26.08.1/rslib/src/scheduler/states/relearning.rs#L187).

### P2: The random interval adjustment can defeat Hard's minimum growth

[app/index.html:518](/Users/hectorcflores/Documents/projects/my-anki/app/index.html:518) applies its lower bound before random variation, allowing that variation to lower the final interval again. A two-day review card, with `reps=3` and seed `3`, receives another two-day interval after Hard. With the matching Hard multiplier, canonical Anki enforces at least three days after adjustment.

The app also varies a two-day interval between two and three days, whereas the reference fuzz calculation does not vary intervals below 2.5 days. The broader percentage ranges differ too. Recommendation: reproduce canonical bounded interval adjustment rather than merely changing the random seed.

Sources: [review constraints](https://github.com/ankitects/anki/blob/26.08.1/rslib/src/scheduler/states/review.rs) and [fuzz bounds](https://github.com/ankitects/anki/blob/26.08.1/rslib/src/scheduler/states/fuzz.rs).

### P2: Overdue reviews ignore the extra time successfully remembered

[app/index.html:518](/Users/hectorcflores/Documents/projects/my-anki/app/index.html:518) uses only the stored interval and ease. Canonical SM-2 incorporates lateness into Good and Easy. A ten-day card with ease 2.5 has a Good base of 25 days on time, versus 37.5 when ten days late, before rounding, constraints and variation. The app returned 28 days in both cases with the same seed.

This can schedule unnecessary repetitions after a break. It is not evidence that memory is lost or that every interval is wrong. Source: [Anki's non-early review calculation](https://github.com/ankitects/anki/blob/26.08.1/rslib/src/scheduler/states/review.rs).

### P2: Day intervals are exact elapsed time instead of Anki study days

[app/index.html:479](/Users/hectorcflores/Documents/projects/my-anki/app/index.html:479) makes a day equal to 24 hours from the answer. Daily limits reset at local midnight through `dateStr()`. Anki uses a configurable study-day boundary, defaulting to 4 a.m. Review cards scheduled for tomorrow become available at that day's boundary, rather than at the previous answer's clock time.

Example: a one-day card answered at 10 p.m. will not be ready in this app the next morning. In Anki's default day model it can be. Exact elapsed time is a possible product choice, but is not canonical equivalence. Source: [Anki scheduler preferences](https://docs.ankiweb.net/preferences.html#scheduler).

### P2: Due learning cards are appended behind remaining cards

[app/index.html:1540](/Users/hectorcflores/Documents/projects/my-anki/app/index.html:1540) promotes an expired learning step to the end of the current queue. Reproduction with another queued card returns the order `other, learning-card`. With a long queue, a one-minute learning delay can become much longer before the card is displayed.

Anki gives due short learning steps preference over review and new cards. This should be fixed at a safe question boundary without interrupting an answer on screen. Source: [learning steps and day boundaries](https://docs.ankiweb.net/deck-options#day-boundaries).

## What is already aligned, or an intentional simplification

For new cards, the configured one- and ten-minute steps produce Again at one minute, Hard at five minutes thirty seconds (displayed as six minutes), Good at ten minutes, and Easy graduation around four days. Good at the final step graduates to a one-day review interval. Those are broadly consistent with the selected SM-2 settings; the rounded six-minute label is not itself a bug.

Review ease starts at 2.5 and has a floor of 1.3. Again reduces it by 0.20, Hard by 0.15, Good leaves it unchanged, and Easy adds 0.15. A lapse enters the configured relearning step. The base Hard and Easy multipliers follow the familiar SM-2 settings, though the later interval handling differs as noted above.

The app strictly waits out learning delays when its pending list survives. Anki defaults to allowing learning cards early when nothing else remains; that option can be disabled. Strict waiting is therefore a defensible preference, not inherently a defect. I retract the earlier implication that showing such a card early is always an Anki violation. Sources: [preferences](https://docs.ankiweb.net/preferences.html#scheduler), [SM-2 overview](https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html).

Suspension at eight review lapses broadly matches Anki's default leech handling, but this app has no visible way to restore a suspended card. The omission is a recovery/usability gap. Anki supports manually unsuspending and editing troublesome cards. Source: [Leeches](https://docs.ankiweb.net/leeches.html).

The app has no maximum review interval cap, and its daily-limit accounting and interday-learning treatment are simplified. These remain additional compatibility differences; this inspection prioritized short-step behavior, queue survival and review interval calculations. It is not a complete port certification.

## Recommended next step

First fix pending-card reconstruction and learning priority, then relearning Hard/Easy, bounded interval variation and overdue handling. Explicitly choose study-day semantics and whether to retain strict waits. Add conformance examples based on the selected Anki release, including cross-day cases and mid-learning session changes.

Do not silently replace the scheduler and replay all past grades through new rules. The sync system rebuilds card states by calling the current scheduling function on historical answers. A formula change could therefore change existing due dates during recovery or across differently updated devices. A versioned scheduler or explicit migration policy is required before shipping interval changes.

This audit does not recommend a simultaneous FSRS migration. Faithful SM-2 behavior and FSRS adoption are separate decisions; fixing the confirmed queue bugs is useful either way.
