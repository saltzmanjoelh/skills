# A subagent's start is not a turn of the session's own

Written 2026-11-03. Seeded from a follow-up that the counsel filed, 7 of 7,
from the change that made builder record the end of each turn of the
session's own (see `docs/specs/foreman-counts-from-turn-end.md`). The issue
settles every question the interview would have asked, so no question was
put to the counsel or to the person.

## Goal

The engine raises `turn.start` both for a turn of the session's own and for
a subagent's run, which carries its `agentId`. Builder's handler in
`mods/builder/hooks/register.tsx` guards only the nudge flag on `agentId`.
For a subagent's start it still moves `ownTurnsStarted` on, sets
`turnRunning` and `busy`, clears `rateLimitSeen` and `pendingErrorTurn`, and
closes the session's own permission prompts in the status memo. The
`turn.complete` handler ignores a subagent's end, so nothing clears what the
start set.

A person then sees the session shown as busy after its turn ended, until
its next turn ends, whenever a subagent starts after the session's own turn
ended, as a background agent can. The checks that compare `ownTurnsStarted`
with a count saved earlier (the usage-limit hold, the replied turn's clear
of a hold, and the compaction at a turn's end) take the subagent's start for
a later turn of the session's own and give up when they should go ahead.
Clearing `pendingErrorTurn` and `rateLimitSeen` drops a usage-limit hold that
the session's own error turn should start.

The fix makes a subagent's start change none of the session's own state.

## Users and trigger

Any session that runs builder and launches subagents, which `/implement`
does at every stage. The trigger is a `turn.start` event that carries an
`agentId`, whether it comes while the session's own turn runs or after it
ended.

## Behavior

1. A `turn.start` that carries an `agentId` leaves `ownTurnsStarted`,
   `turnRunning`, `busy`, `rateLimitSeen` and `pendingErrorTurn` as they
   were, and does not change the status memo: the session's own permission
   prompts stay as they were, and so does the nudge flag, as today.
2. A `turn.start` without an `agentId` behaves exactly as today.
3. Both kinds of start still schedule the pane's refresh and pass the event
   on to the engine.
4. The comments on the handler and on the state it guards say that only a
   turn of the session's own changes them.

## Edge cases

- A subagent that starts while the session's own turn runs: the session is
  busy anyway, and the turn's end clears `busy` and `turnRunning`, because
  the end reads the count of turns started at its own start. Today such a
  start still clears `rateLimitSeen`, so a usage limit the turn hit before
  the subagent started is forgotten; after the fix it is kept.
- A subagent that starts while the session's own turn's end is still under
  way, in one of the end's awaits: the count does not move, so the
  compaction, the clearing of `busy` and the replied turn's clearing of a
  usage-limit hold all go ahead. Today each of them gives up.
- A subagent that starts during a saved usage-limit hold: `busy` and
  `turnRunning` stay false, so the resume prompt still comes at the resume
  time. Today the resume step sees a running turn and sends nothing.
- A subagent that starts after the session's own turn ended: `busy` and
  `turnRunning` stay false.
- A subagent that starts while a usage-limit hold is pending on the
  session's error turn: the pending error turn is kept, so a `StopFailure`
  that arrives afterwards still starts the hold.
- A subagent's start while a session's own permission prompt is open: the
  prompt stays open in the status file until the session's own turn ends.

## Non-goals

- What a subagent's end does, which already changes none of this state.
- Showing a running background subagent as busy, or reporting it in the
  status file in any new way; background work is reported by the session's
  own `Stop` hook, as today.
- The agent cards, which other handlers keep.
- Any change to foreman.

## Failure modes

- If the engine ever raised a turn of the session's own with an `agentId`,
  builder would no longer mark that turn busy. The engine's contract says
  `agentId` is set only for a subagent's run, and builder's other handlers
  already rely on that.

## Verification

- Builder tests in `mods/builder/tests/register.test.ts`, each failing on the
  code before this change:
  - A subagent that starts after the session's own turn ended leaves `busy`
    false, and its event still reaches the engine.
  - A subagent that starts while the session's own turn's end is under way
    leaves the compaction at that end to run and `busy` cleared afterwards.
  - A subagent that starts while a replied turn's end is under way leaves
    that end to take a usage-limit hold off.
  - A subagent that starts during the session's own turn, after the turn
    hit a usage limit, leaves the hold to start when the turn ends with an
    error.
  - A subagent that starts between a session's error turn and its
    `StopFailure` does not stop the usage-limit hold from starting.
  - A subagent that starts during a saved hold leaves the resume prompt to
    come at the resume time.
  - A subagent's start leaves the session's own open permission prompt in
    the status file.
- The existing tests pass unchanged, including the one that shows a
  subagent's start leaves the nudge flag alone.
- The gates in the project's `CLAUDE.md`.
