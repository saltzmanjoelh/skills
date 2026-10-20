# Plan: an /implement session runs unattended

Spec: `docs/specs/implement-runs-unattended.md`. Written 2026-10-12 by a
plan tournament of three blind planners (simplest thing, most robust, most
extensible) and a judge.

## The choice

The most-robust plan won. It is the only one of the three that fits the
engine as it really behaves: it waits for a far-off reset in steps, because
a month is longer than the engine's longest timer; it counts an `sdk`
prompt as the person's, which is how a prompt typed in the desktop app
arrives; it checks that no turn is running with no await between that check
and the submit; and it reads the engine's list of agents before it decides,
so an agent the engine dropped cannot postpone the prompt for good. Its
full text follows the grafts below, and the grafts override it where they
differ.

## Grafts onto the winner

1. **Arm with a flag, as `ensureArmed` does** (from the simplest plan). An
   `isUnattendedArmed` module flag, false after a hot reload, makes
   `ensureArmed` arm the stuck timer and the hold timer once from the
   atoms, rather than cancelling and arming again on every hook. The hold
   is still armed when nothing is watched, so a hold during the spec stage
   comes back after a reload.
2. **One reset point in `recordWake`** (from the extensible plan). When a
   wake is recorded with `changed: true`, the interval goes back to 45
   minutes and the quiet time restarts. `watch()` already records its wake
   as changed, so this one place covers both "a look found the pull
   request changed" and "a new pull request is watched".
3. **Mark the session quiet in `refreshAgents`** (from the extensible
   plan) when the merge of the engine's list ends a card, so an agent whose
   end the mod learns only from the list restarts the quiet time.
4. **The stuck prompt quotes no GitHub text** (from the extensible plan).
   It names the pull request's number and the minutes, nothing else, so it
   adds no text from GitHub to the prompt.
5. **No look before the stuck prompt** (the judge). The robust plan's
   delivering look before each stuck prompt, and the new `'stuck'` wake
   source it needs, are dropped; the ordinary poll already hands changes
   over. The synchronous re-check before the submit stays: `turnRunning`,
   `isDelivering`, `isHeld`, `untoldOwnReads.size` and the stuck
   generation.
6. **A true restart in the restart test** (from the extensible plan and the
   judge). The generalised `restartable(on, keys)` helper puts `questions`
   and `busy` back to their defaults too, because a real restart starts the
   mod with none of its atoms.
7. **The time helper is `timeOfDay`** (from the simplest plan), so it is
   not confused with the existing `clockTime`, which formats durations. It
   writes UTC `HH:MM:SS` as `/pilot wakes` does, with the UTC date before
   it when the time is not on the same UTC day as now (spec item 9), and
   `/pilot wakes` switches to it.
8. **The needs-decision fix** (spec item 12, found by the judge): in
   `labelForQuestion`, when the label is already on the pull request, mark
   the question as labelled before returning, so `takeOffAnsweredLabels`
   takes it off once no question is open.
9. **Drop the `stuckEveryIn` range guard.** A plain finite-number check
   that falls back to 45 minutes is enough; the cheap `isDecidingHold`
   claim stays.

## Rejected alternatives, with reasons

- **The simplest plan as it stood.** It counted only `composer` and
  `bridge` as the person, so in the desktop app the person's prompt would
  neither reset the interval nor clear a hold, while its tests passed. Its
  hold timer had no cap and no check of the time when it fired, so a
  spend limit a month away would overflow the timer, resume at once, die,
  and hold again in a loop. It blocked `/pilot poll` during a hold, and its
  restart test was a hot reload.
- **The extensible plan's `unattended.ts` module and `Nudge` kind.** The
  seam serves a future feature the spec does not ask for, and its single
  uncapped nudge timer would spin at one millisecond for a month on the
  same far-off reset.
- **Quoting `stateLines` in the stuck prompt** (the robust plan). It
  widens the text from GitHub that reaches the session for no stated gain.
- **Listening to `session.measure`.** One read of `$.session.usage()` when
  the errored turn ends is enough, and a measurement never arrives while a
  held session makes no requests.
- **Keeping the hold or the interval in `$.store`.** The spec says neither
  survives a restart.

## Step sequence

Each step writes its tests first and sees them fail.

1. Pure rules and their tests: in `hooks/state.ts`, the constants,
   `nextStuckEvery`, `exhaustedWindows`, `resumeAt` and `isPersonPrompt`;
   in `hooks/progress.ts`, `endedOf` extracted from `barOf`; in
   `hooks/text.ts`, `timeOfDay`; tests in `state.test.ts`,
   `progress.test.ts` and a `text` case where text helpers are tested.
2. The prompts in `hooks/prompts.ts`, the `View.usageHold` field and the
   hold words in `hooks/pane.tsx`, with `pane.test.ts` cases.
3. The stuck prompt in `hooks/register.tsx`: the atoms and module
   variables, `markQuiet`, `resetStuckEvery`, `armStuck`, `fireStuck`, the
   reset in `recordWake`, the quiet marks in `turn.complete` and
   `refreshAgents`, `turnRunning`, the person's prompt in `prompt.submit`,
   and arming through `ensureArmed`; the register tests for Verification
   bullets one to five and the stuck parts of the extra bullets.
4. The usage-limit hold in `hooks/register.tsx`: `isImplementing`,
   `decideHold`, `startHold`, `armHold` in steps of at most six hours,
   `resumeFromHold`, `clearHold`, the `classic.StopFailure` hook, the hold
   guards in `lookAt` (allowing `/pilot poll`) and `nextPoll`, and the
   `view()` field; the register tests for the hold bullets.
5. The needs-decision fix in `labelForQuestion`, with the restart test.
6. `mods/pilot/README.md`, `mods/pilot/types/index.d.ts` comments, and
   `skills/implement/SKILL.md` (spec items 13 and 14), which no gate reads.
7. The four gates.

## Test plan

The winner's test plan below, changed by the grafts: the restart test
resets `questions` and `busy` as well and then checks that the resumed
session's answered question takes `needs-decision` off; there is no
`'stuck'` wake to assert; and the extra tests in the spec's Verification
section (a hot reload during a hold and during a quiet stretch, a refused
stuck prompt, a 30-day spend limit, and the `sdk` and `task-notification`
origins) are all included.

---

## Plan (most-robust prior): an /implement session runs unattended

### Approach summary

I add two watchdogs to the pilot mod, each built the same way. A small record lives in atoms, so it survives a hot reload and is lost on a restart, which is the behaviour the spec asks for. A module timer is armed from that record, and every hook that already calls `ensureArmed` arms it again. A generation counter is bumped each time the record changes, so a timer that fires after its record has moved on does nothing.

The stuck prompt is a poll followed by a nudge. When it is due, it first checks every blocking condition. It then runs a delivering look (`lookAt($, 'stuck', 'deliver')`). If that look hands a change over, the change's turn is the turn and the stuck prompt is dropped. Only when nothing was handed over does it submit the stuck prompt. Before the submit it checks every synchronous guard again with no await in between, and it takes the same `isDelivering` claim that `deliver()` uses. This settles the "two signals at once" edge case by construction: the prompt can never go out beside a handover.

The usage-limit hold is decided at the end of the session's own turn when the reason is `error`. Because the types do not say whether `classic.StopFailure` fires before or after `turn.complete`, the decision can be finished from either hook. While the hold is on, `lookAt` returns before running `gh` and `nextPoll` answers null. The line then reads `waiting on the usage limit until <time>`. At the resume time a timer clears the hold, submits the resume prompt and schedules the poll again.

New code on the existing hook paths is wrapped in `.catch(() => undefined)`. A failure in a watchdog therefore cannot stop a handover, a hold or the turn-end looks, which work today.

### Data and state changes

`mods/pilot/types/index.d.ts`:
- `PluginState.pilot.quietSince: number | null` records when the session last went quiet. The default is null.
- `PluginState.pilot.stuckEvery: number` is the current stuck interval in milliseconds. The default is `STUCK_FIRST_MS`. It is read through a guard that turns any value that is not finite, or lies outside 45 to 360 minutes, back into 45 minutes.
- `PluginState.pilot.usageHold: UsageHold | null`, with `export type UsageHold = { until: number; since: number }`. It is read through a `holdIn` guard, so a malformed value reads as no hold.
- `Wake['source']` gains `'stuck'`, so `/pilot wakes` lists the look that a stuck prompt runs.

New module variables in `register.tsx`, following the comment style of `armed` and `timer`:
- `stuckTimer` and `stuckGen`.
- `holdTimer` and `holdGen`.
- `turnRunning`. This is a synchronous mirror of `busy`. It is set first in `turn.start` and cleared first in `turn.complete`, so the last check before a submit needs no await.
- `rateLimitSeen`. It is set by a main-loop `StopFailure` with error `rate_limit` and cleared at `turn.start`.
- `pendingErrorTurn: { endedAt } | null`. It is a main-loop error turn that is still waiting for its signals, and it is cleared at `turn.start`.
- `isDecidingHold`, a synchronous claim so that the two hooks cannot both start a hold.

Nothing new goes into `$.store`. Keeping a hold or the interval across a restart is a non-goal.

### Files touched

**`mods/pilot/hooks/state.ts`** (pure rules, with unit tests)
- Constants `STUCK_FIRST_MS = 45 * 60_000`, `STUCK_CEILING_MS = 360 * 60_000`, `RESUME_AFTER_RESET_MS = 60_000` and `RESUME_FALLBACK_MS = 15 * 60_000`. Above them goes a comment pointing to the README section, like the comment above `POLL_MS`.
- `nextStuckEvery(ms)` returns `Math.min(ms * 2, STUCK_CEILING_MS)`.
- `stuckEveryIn(raw)` is the guard for the atom.
- `exhaustedWindows(raw: unknown): SessionRateLimit[]`. It accepts anything, keeps only object entries whose `percentUsed` is a finite number of 100 or more, and returns an empty list when `rateLimits` is not an array.
- `resumeAt(exhausted, endedAt): number`. It takes the latest parsable `resetsAt` of the exhausted windows. With none, the answer is `endedAt + 15m`. A latest time at or before `endedAt` (already past) gives `endedAt + 1m`. Otherwise the answer is `latest + 1m`. An unparsable `resetsAt` is ignored.
- `isPersonPrompt(origin, text)`. It is true for `composer`, `bridge` and `slack-ping`, and for `sdk` when `isCiMonitorEvent(text)` is false. It is false for `plugin`, `task-notification`, `scheduled-trigger`, `peer*`, `auto-continuation`, `unclassified` and the rest. The engine never shows the mod its own `$.prompt.submit`, but a check on `plugin` stays in anyway.

**`mods/pilot/hooks/progress.ts`**
- I extract `endedOf(progress, pr, watchSince): 'MERGED' | 'CLOSED' | null` from `barOf`'s two lines, and `barOf` calls it. The hold's test of "work has ended" is then the same function as the bar's, so the two cannot drift apart (spec item 7).

**`mods/pilot/hooks/text.ts`**
- `clockAt(at: number): string` returns `new Date(at).toISOString().slice(11, 19)`. This is the format `/pilot wakes` already writes. The `wakes` command in `register.tsx` switches to it, so "as the mod writes other clock times" stays true by construction.

**`mods/pilot/hooks/prompts.ts`**
- `stuckPrompt(s: Snapshot | null, number, quietMs)` returns lines such as: "pilot: nothing has happened on pull request #N for 45 minutes." The prompt then tells the session to check with `gh` whether what it waits on is real, to take the first step of the list in `/implement` that applies, or to end the turn if the wait is real. When the mod has a snapshot, it adds `stateLines(s)` under "As the mod last read it:" with the same warning about quoted names that `changePrompt` carries. Minutes are written as a whole number, such as 45, 90, 180 or 360.
- `resumePrompt(stageLabel | null)` returns "pilot: the usage limit has reset. Carry on /implement from the stage you were in (<stage>)." The stage in brackets is left out when no stage has been reported.

**`mods/pilot/hooks/pane.tsx`**
- `View.usageHold: number | null` holds the resume time.
- `nextStep` checks the hold first, before the `at === null` "not polling" branch, and returns `waiting on the usage limit until ${clockAt(hold)}`.
- `secondRow`, with nothing watched and pilot started, ends with that same text in place of `idle` while a hold is on. A hold during the spec or the plan therefore shows too.
- The pane's `Next:` line uses `nextStep`, so it follows on its own.

**`mods/pilot/hooks/register.tsx`**
- **Atoms:** `quietSince`, `stuckEvery` and `usageHold`.
- **`isImplementing($)`** reads `run`, `progressIn(progress)` and `pr` (through `isDrawable`). It returns false when both run and progress are null. Otherwise it returns `endedOf(...) === null`.
- **`markQuiet($, at?)`** sets `quietSince` to now, then calls `armStuck`.
- **`resetStuckEvery($)`** sets `stuckEvery` to 45 minutes, then calls `armStuck`.
- **`armStuck($)`** works like `schedule`. It increments `stuckGen`, then reads `run`, `pr`, `usageHold`, `quietSince` and `stuckEvery`. If the generation moved during those awaits, it returns. Otherwise it cancels `stuckTimer`. It arms nothing when the hold is on, nothing is watched, the pull request is not OPEN, or `quietSince` is null. Otherwise it arms `$.clock.after(max(at - now, 0), () => void fireStuck($, gen).catch(...))`.
- **`fireStuck($, gen)`** runs these steps in order:
  1. It returns if `gen !== stuckGen`.
  2. It awaits `refreshAgents($)`, with a catch, so that an agent card the mod holds as running but the engine has dropped does not block the prompt forever.
  3. It reads the conditions: a watch and an OPEN pull request, `!busy`, `!turnRunning`, no `isRunning` agent, no unanswered question, no hold, and `now - quietSince >= stuckEvery`.
  4. When a condition fails, it calls `markQuiet($)`. "Postpone until the condition clears and the session has then been quiet for the interval" thus becomes "check again one interval later". Every condition that clears in the normal way (a turn ends, an agent ends, an answered question's turn ends) already restarts the quiet time, so the approximation only matters in odd cases. The re-arm guarantees the watchdog never goes silent for good.
  5. When `isDelivering`, `isHeld` or `untoldOwnReads.size > 0` holds, it drops the prompt and calls `markQuiet` (the "two signals at once" case).
  6. It runs `const seen = await lookAt($, 'stuck', 'deliver')`. If `seen?.delivered`, it returns, because the change's turn is the turn. If the read changed, `lookAt` has already reset the interval and bumped `stuckGen`, so step 7 aborts.
  7. It checks again with no await before the submit: `gen === stuckGen`, `!turnRunning`, `!isDelivering`, `untoldOwnReads.size === 0`, and `isCurrentWatch(r)`. Then it claims `isDelivering = true` and calls `$.prompt.submit({ text: stuckPrompt(...) })` inside a `try/finally` that releases the claim.
  8. If the prompt is accepted, it sets `stuckEvery` to `nextStuckEvery` and calls `markQuiet`. If it is refused, or the submit throws, it calls `markQuiet` with the interval unchanged ("tries again at the next interval"; a refused prompt never reached the session, so it does not back off).
- **Hold:**
  - `decideHold($, endedAt)` is guarded by `isDecidingHold`. It does nothing unless `isImplementing`. It reads windows with `try { exhaustedWindows((await $.session.usage()).rateLimits) } catch { [] }`. After that await it reads `rateLimitSeen` again, because a `StopFailure` may have landed meanwhile. It holds when windows exist or the flag is set. Otherwise it leaves `pendingErrorTurn` in place for a `StopFailure` that comes later.
  - `startHold($, until, since)` writes `usageHold`, sets `pendingErrorTurn` to null, increments `holdGen`, cancels `commandLooks`, calls `armStuck` (which cancels the stuck timer), calls `schedule($)` (whose `nextPoll` answers null, so no poll timer and `nextLook` null) and calls `armHold`.
  - `armHold($)` arms `holdTimer` for `min(until - now, HOLD_CHECK_MS)`, where `HOLD_CHECK_MS` is 6 hours. A timer for a spend limit a month away therefore never meets a 2^31 ms overflow of `setTimeout`. A timer that wakes early just arms again.
  - `resumeFromHold($, gen)`:
    - If the generation is stale, or the hold is gone, it returns.
    - If `now < until`, it calls `armHold` and returns.
    - If `!isImplementing`, it calls `clearHold` with no prompt (spec item 11).
    - Otherwise it calls `clearHold` first. If `turnRunning` or `busy` is true, it stops there, because a turn is already running and an `error` at its end holds again by the same rule. If not, it claims `isDelivering`, submits `resumePrompt`, then calls `schedule($)` and `markQuiet`.
    - If the prompt is refused, or the submit throws, it holds again until `now + RESUME_FALLBACK_MS` ("the next resume rule").
  - `clearHold($)` writes `usageHold` as null, increments `holdGen`, cancels `holdTimer`, calls `schedule($)` and calls `armStuck`.
- **`ensureTimers($)`** arms the hold from the atom when there is one, and otherwise calls `armStuck`. It does not need `run`, so a hold during the spec stage is armed again after a reload. It is called from `session.start` (beside `ensureArmed`), `prompt.submit`, `turn.complete` and `ensureArmed`. Arming is cancel-then-set, so calling it twice leaves one timer.
- **`lookAt`:** at the top, before `fetchSnapshot`, it returns null when `usageHold` is set and the source is not `'command'`. With this, no turn-end look, command look, session-start look, CI-event look or pending poll runs `gh` during a hold. `/pilot poll` stays allowed because the person asked for it. Where the look stores its result and `!isSameState(shown, s)` is true, it also calls `void resetStuckEvery($).then(() => markQuiet($))` with a catch.
- **`nextPoll`:** it returns null while `usageHold` is set.
- **`watch()`:** after `tell`, it calls `resetStuckEvery` and `markQuiet`, with a catch. A new watch resets the interval, and the quiet time counts from the watch. That is what makes "the stuck prompt then counts from the restart" true whatever the atoms held.
- **`prompt.submit`:** first `void ensureTimers($)`. Then, when `isPersonPrompt(e.origin, e.text)` is true, it awaits `personStarted($)` with a catch: `clearHold` when a hold is on, with no resume prompt, and `resetStuckEvery` either way. It does not touch the quiet time; the person's turn restarts it when it ends.
- **`turn.start`:** `turnRunning = true`, `rateLimitSeen = false` and `pendingErrorTurn = null`, all before the existing `busy` write.
- **`turn.complete` (main loop):** first `turnRunning = false`. Then the existing `busy = false`. Then `endedAt = now`. When `e.reason === 'error'`, it sets `pendingErrorTurn = { endedAt }` synchronously and then awaits `decideHold`. If a hold started, it returns `next(e)` without the held-change delivery and without `armTurnEndLooks`. `isHeld` stays true, so the resume turn's end hands the change over. Otherwise it calls `markQuiet($, endedAt)` and runs the existing held-delivery and turn-end-look code unchanged.
- **`turn.complete` (agentId):** it adds `markQuiet` after the card update.
- **New `on('classic.StopFailure', ...)`** with `.catch(($, e, next) => next(e))`, as `classic.Stop` has. When `e.agent_id === undefined` and `e.error === 'rate_limit'`, it sets `rateLimitSeen = true`. If `pendingErrorTurn` is set, no turn runs and no decision is in progress, it calls `decideHold($, pendingErrorTurn.endedAt)`. This covers either firing order.
- **`view()`:** it adds `usageHold: holdIn(await read($, usageHold))?.until ?? null`. The band subscribes to the atom, so starting or clearing a hold redraws without a ticker.

**`mods/pilot/README.md`**
- A new section, "When the session goes quiet, and when a usage limit runs out". It covers the quiet time, the five conditions, the label rule, the 45/90/180/360 backoff and the 360-minute ceiling, the three resets, the look the stuck prompt runs first, the hold's two signals, the resume rules (resetsAt plus one minute, otherwise 15 minutes, and one minute after the turn when resetsAt is already past), that no `gh` runs during a hold except `/pilot poll`, what clears a hold, how a refused prompt is retried, and that neither survives a restart while both survive a hot reload.
- The band section's list of "last part" phrases adds `waiting on the usage limit until <time>`.
- The polling section says that a hold stops the poll.

**`skills/implement/SKILL.md`**
- At "With the pull request open", add "a stuck prompt" to the list of turns, and a sentence: it enters the list from the top like any other; check with `gh` first, and end the turn if the wait is real.
- After step 5, or in the intro to "Before the pull request": a turn the mod starts after a usage limit carries on the stage it names.
- Rewrap "Resuming" to the file's width of 76 columns. Its line 524 is currently 81 characters. Add that a usage-limit hold and the stuck prompt's interval do not survive a restart, so a resumed session starts with neither, and its stuck prompt counts from the watch.

### Test plan, item by item against the spec's Verification section

All of these go in `mods/pilot/tests/register.test.ts` unless another file is named. New helpers:
- `usageAnswers(on)` hooks `session.usage` and sets `rateLimits`, or makes the call throw.
- `quietTurn($, id)` runs `turn.start` followed by `turn.complete` with reason `answer`.
- `erroredTurn($, id)` does the same with reason `error`.
- `stuckPrompts(prompts)` filters the recorded prompts for "nothing has happened".
- `restartable(on, keys)` generalizes `restartableCounsel`: for the listed keys it answers the default until the mod writes them.

Each test uses `mock.clock(on, { now: Date.parse('2026-10-12T00:00:00Z') })`, so `resetsAt` can be compared with `$.clock.now()`.

1. **The backoff: 45, 90, 180, 360, then 360.** Watch, then settle. At 45m − 1s there are zero stuck prompts; at 45m there is exactly one. After `quietTurn`, there are none at 90m − 1s and two at 90m, and the same pattern holds for 180, 360 and 360. Without the feature there are none. Without the doubling the second comes at 45. Without the ceiling the fifth comes at 720.
2. **Blocking conditions.** One test each:
   - (a) A held `AskUserQuestion` (`heldTools`) and 3 hours pass: zero.
   - (b) A spawned agent still listed as running (`engineAgents`) and 3 hours pass: zero. Then it ends with `turn.complete` and `agentId`, and the prompt comes 45 minutes after that end.
   - (c) `turn.start` with no completion and 3 hours pass: zero. After the completion, it comes 45 minutes later.
   - (d) A session start and a progress report with no watch, and 3 hours pass: zero.
   - (e) A pull request with the `stuck` label fires at 45 minutes.
   
   Each fails when its guard is removed, and (e) fails if the label is counted as waiting on the person.
3. **Resets.**
   - (a) Fire once and end the turn, so the interval is 90. Then set `world.pr` to failing checks. The poll hands the change over, the turn ends, and the next stuck prompt comes 45 minutes later, not 90.
   - (b) The same setup, but `$.prompt.submit` with origin `composer`, followed by a turn: 45 minutes again.
   - (c) A prompt with origin `task-notification` and its turn: still 90. This proves only the person resets.
   
   (a) and (b) fail without `resetStuckEvery` on those paths.
4. **A question open for twelve hours.** A held `AskUserQuestion`, then 12 hours of `clock.advance`. `world.calls` contains `--add-label needs-decision` and no `--remove-label`, there are zero stuck prompts, and polls ran: `gh pr view 7` was called more than 60 times. It fails if the question guard is removed.
5. **A restart over the same store.** Watch, open a held question, and advance 30 minutes. Then `restartable(on, ['quietSince', 'stuckEvery', 'usageHold'])` and `watch($)` again, which runs `session.start` and the watch tool. The label is taken off, as today. There is no stuck prompt at 45m − 1s after the restart and one at 45m. It fails if the watch does not restart the quiet time (the prompt would come 15 minutes after the restart) or without the feature.
6. **A hold on a window at 100 percent.** `usageAnswers` gives `five_hour` at 100 percent with `resetsAt = T0 + 2h`. Watch, then `erroredTurn`, then settle. The line is `pilot: #7 open · checks passed · waiting on the usage limit until 02:01:00`. Then `world.calls = []` and the clock advances by 2h + 1m − 1s. No call starts with `gh `, and there is no prompt, even though the turn-end looks were due at 10 and 40 seconds. One second later there is exactly one prompt containing "the usage limit has reset", and a later advance shows `gh pr view 7` again. It fails without the `lookAt` guard (turn-end looks would run `gh`), without the `nextPoll` guard (polls), or without the resume.
7. **A hold on `StopFailure` alone.**
   - (a) `$.classic.StopFailure({ error: 'rate_limit' })` then `erroredTurn`, with `session.usage` throwing. The resume prompt is absent at 15m − 1s and present at 15m. Then the resume turn starts, gets another `StopFailure`, and ends with `error`. It holds again, with the line showing the new time, and a second resume prompt comes 15 minutes after that end.
   - (b) For robustness, the order is reversed: `turn.complete` with `error` first, then `StopFailure`. It still holds.
   
   These fail without the `StopFailure` hook, without the catch around `usage()`, or without the late-signal path.
8. **No hold.**
   - (a) An error with no window and no `StopFailure`: the line keeps `next look in …`, and `gh` runs at the 10-second look.
   - (b) No watch and no progress, with a window at 100 percent: no hold line and no prompt after 3 hours.
   - (c) A watched pull request that has merged (`world.pr.state = 'MERGED'` and a look), then an error turn with a window: no hold.
   - (d) A positive counterpart: progress reported (`spec`) with no watch holds, and the line reads `pilot: spec · waiting on the usage limit until …`.
   
   (a) through (c) fail if the conditions are loosened; (d) fails if the progress branch is dropped.
9. **The person's prompt clears a hold.** Hold as in test 6, then `$.prompt.submit` with origin `composer`. The line drops the hold text, and advancing past the resume time gives zero resume prompts while polls run again. It fails without `personStarted`.

Extra robustness tests:
- A hot reload during a hold: `session.start` again. One resume prompt comes, not two, at the original time.
- A hot reload during a quiet stretch: `session.start` at 30 minutes, and the stuck prompt still comes at 45, not 75.
- A stuck prompt refused by a test `prompt.submit` hook returning `{ drop }` is retried 45 minutes later, and the interval is not doubled.
- A `resetsAt` already in the past resumes one minute after the turn ended.
- A spend limit at 140 percent with `resetsAt` 30 days away gives no resume after 25 days and the resume at 30 days plus one minute. This exercises the chunked timer.
- A stuck prompt that comes due while a held change is being handed over is dropped. This uses `world.hold` to keep the delivering look in flight.

`mods/pilot/tests/state.test.ts`:
- `resumeAt`: latest of several windows, none, none with a time, a past time, an unparsable time.
- `exhaustedWindows`: not an array, malformed entries, 99.9 compared with 100, past 100.
- The `nextStuckEvery` sequence.
- `isPersonPrompt` for every origin kind, including an `sdk` CI event.

`mods/pilot/tests/pane.test.ts`: `nextStep` and `abovePromptLine` with `usageHold` set, and `secondRow` with no pull request. The `view()` factory gains `usageHold: null`.

`mods/pilot/tests/progress.test.ts`: `endedOf` gives the same answers as the existing `barOf` cases.

Gates: the four from `CLAUDE.md`, in order. They do not read `README.md` or `SKILL.md`, so the report should say that.

### Risks

- **Which origins count as the person.** Treating `sdk` prompts that are not CI events as the person's is a judgement. In the desktop app, typed prompts probably arrive as `sdk`, but an SDK host's own automation would also reset the interval or clear a hold. The cost is one missed resume prompt, which the stuck prompt covers later.
- **The time on the line is UTC.** `clockAt` follows the `/pilot wakes` format as the spec asks, but a person in another timezone may misread "until 02:01:00". I would raise this as a follow-up and not decide it here.
- **Postponing is approximate.** A blocked check restarts the quiet time instead of tracking when the condition cleared. The prompt therefore comes between 0 and one interval after a condition clears without a turn end. In return the watchdog can never stop for good, and the plan says this openly.
- **`busy` could stay true.** If a turn's `turn.complete` never arrives, the stuck prompt waits forever. I add no timeout, because that would guess at the engine's guarantees.
- **The stuck prompt runs one look first.** That is one extra `gh pr view` every 45 minutes or more, and it records a `stuck` wake. A slow poll look that started earlier can still hand a real change over after the stuck prompt went out. That is a second prompt about a real change, never a duplicate.
- **`session.usage()` could hang.** It is awaited inline inside `turn.complete`. Its documentation says the plain call is free, so I accept this and do not add a race.

### What I deliberately do not do

- I do not resume after `overloaded`, `server_error` or any other API error.
- I do not use `session.measure` as a fallback for `usage()`. The spec says the hold then rests on `StopFailure` alone.
- I do not persist the hold or the interval in `$.store`.
- I do not count the `stuck` label, background shell tasks or monitors as blocking the stuck prompt. The spec lists exactly five conditions.
- I do not run the stuck prompt with no pull request watched, and I do not run either watchdog outside `/implement`.
- I do not reset the interval for a turn the mod starts, for an answered question, or for task notifications.
- I do not change `POLL_MS`, the handover rules, or how `/pilot poll` behaves, except that it is allowed during a hold.
- I do not carry out the by-hand follow-up procedure. It is filed as its own issue, as the spec says.

### Critical Files for Implementation
- `mods/pilot/hooks/register.tsx`
- `mods/pilot/hooks/state.ts`
- `mods/pilot/hooks/pane.tsx`
- `mods/pilot/tests/register.test.ts`
- `mods/pilot/README.md`
- Also: `mods/pilot/types/index.d.ts`, `mods/pilot/hooks/prompts.ts`, `mods/pilot/hooks/progress.ts`, `mods/pilot/hooks/text.ts`, `skills/implement/SKILL.md`