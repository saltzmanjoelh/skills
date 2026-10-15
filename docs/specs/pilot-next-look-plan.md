# Plan: a session that just pushed never looks dead (SAL-159)

Spec: docs/specs/pilot-next-look.md. Tournament run 2026-10-08.

## Chosen approach

The simplest plan won, with three ideas grafted from the most robust plan.

The mod records when its next look is due, and whether that look was
shortened because a new head waits to be handed over, in one `$.state`
value. The scheduler compares the pull request's head with the head of the
snapshot the session was last told (read from `$.store` through `told()`)
and uses 90 seconds while they differ. A look about 10 seconds after each
of the session's own turns ends is what tells the mod about a pushed head.
One pure function builds the "what is next" text for both the line above
the prompt and the pane, and a 30-second timer asks for a redraw while a
look is scheduled.

## Grafts from the runners-up

- **A generation counter in `schedule()`** (most robust). Every look now
  calls `schedule()`, so overlapping calls are normal. The counter is taken
  before any await; a call that finds a newer one has started returns
  without touching the timer or the due time, and the cancel, the new timer
  and the due-time write happen with no await between them.
- **Reschedule wherever the mod records a state as told** (most robust).
  `tell()` calls `schedule()` at its end, which covers delivery, the
  review tool's look, the desktop app's CI event and `watch()`, so the
  interval returns to normal at once after any handover.
- **A guarded scheduler** (most robust). An error inside `schedule()`
  writes no due time (shown as `not polling`) and clears `armed`, so the
  next hook re-arms; the poll's `.finally` gets its own `.catch`.
- **The skill checks the watch saw the push** (most robust). Under
  `Checks: none`, if the head `mcp__pilot__watch` reports is not the
  commit just pushed, the session ends the turn as under `Checks: expected`
  and says why.
- **Pass the snapshot just fetched into `schedule()`** (most robust,
  narrowed). `lookAt` passes its snapshot, so the new-head comparison never
  rests on a state read a still-running hook might see stale.

## Rejected, with reasons

- **A `'new-head'` entry in `WaitingOn` and `POLL_MS`** (most extensible).
  `waitingOn` describes the pull request and the person; "the mod has
  something to hand over" is the mod's own state. Mixing them changes the
  meaning of an existing type and of every call to it.
- **A `toldHead` copy in `$.state`** (most extensible). It duplicates the
  store, must be reseeded after a reload, and adds exactly the stale-read
  path the engine's behaviour makes risky. `told()` reads the store.
- **No end-of-turn look** (most extensible). Without it the mod learns of
  a pushed head only at the next ordinary poll, up to ten minutes later,
  which is the defect the issue exists to fix.
- **`1 agent running`** (most robust). The spec's text is
  `<k> agents running`, and its tests check exact wording.
- **A general validator for the due time.** A finite-number check in the
  view is enough.

## Steps

1. `types/index.d.ts`: add `NextLook = { at: number; isNewHead: boolean }`
   and `nextLook: NextLook | null` to `PluginState.pilot`.
2. `hooks/state.ts`: add `NEW_HEAD_POLL_MS = 90_000` and a pure
   `pollFor(s, toldHead, cards, asked)` returning `{ ms, isNewHead }`;
   `isNewHead` when the pull request is open, a told head exists and the
   heads differ. `waitingOn` and `POLL_MS` stay unchanged.
3. `hooks/pane.tsx`: `timeUntil(at, now)` (`now`, `under a minute`, or
   whole minutes rounded up), `nextStep(v)` in the spec's order with
   `not polling` first, `View.nextLook`; `abovePromptLine` becomes
   `pilot: #n state · checks ci · <next step>`; the pane's `Waiting on`
   line becomes `Next: <next step>.`.
4. `hooks/register.tsx`: the `nextLook` atom; module variables
   `scheduleGen`, `ticker` and `turnEndTimer`; the rewritten guarded
   `schedule($, known?)`; `lookAt` calls `schedule($, s)`; `tell()` calls
   `schedule($)`; on the session's own `turn.complete`, a held change is
   delivered at once as now, otherwise an observe-mode look is armed about
   10 seconds out on `turnEndTimer`; `view()` passes `nextLook`.
5. The redraw ticker: confirm the redraw call in the engine's types, then
   a 30-second `$.clock.every` that asks for a redraw, cancelled whenever
   no look is scheduled. Check the 15-day pruning test's run time; if it is
   slow, have that test stop watching first rather than slow the ticker.
6. `skills/implement/SKILL.md`: "When a turn ends" splits on
   `Checks: expected` and `Checks: none` as the spec says, with the
   watch-failed and wrong-head fallbacks; the first half's point 4 refers
   to it. `mods/pilot/README.md` gets a paragraph on the next-look line.

## Test plan

Mapped to the spec's Verification:

- The session's turn ends with the head changed and nothing held; after
  about 10 seconds the mod looks, the line reads
  `new head, handing over in 2m`, no prompt comes before 90 seconds and one
  comes at 90 seconds. Fails without the end-of-turn look or the new-head
  rule.
- After that handover the next poll is 10 minutes out again; a second test
  hands over through the CI event and checks the same. Fails if `tell()`
  does not reschedule.
- Wording tests for every case of Behavior 5, plus `7m`, `under a minute`,
  `now`, `not polling` for a missing and a malformed due time, and that
  `waiting on nothing` never appears.
- A redraw is requested while a look is scheduled, and stops once the pull
  request merges.
- Two overlapping `schedule()` calls leave exactly one poll chain, and the
  due time is the newer call's.
- The gates from `mods/pilot`: `tsc`, `claude plugin test`,
  `claude plugin validate`.
