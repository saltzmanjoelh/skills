# Plan: a subagent's start is not a turn of the session's own

Written 2026-11-03 for `docs/specs/builder-subagent-start-is-not-own-turn.md`.

## Chosen approach

Two planners ran, one for the simplest change and one for the most robust.
Both proposed the same code change, and the judge chose the most robust plan
for its tests.

At the top of the `turn.start` handler in `mods/builder/hooks/register.tsx`,
a start that carries an `agentId` schedules the pane's refresh and passes the
event on, and returns before any await:

```ts
if (e.agentId !== undefined) {
  refreshLater($)
  return next(e)
}
```

The path for a turn of the session's own stays as it is. Its memo change no
longer needs the condition on `agentId`, so it becomes
`afterTurnStart(afterLoopEnd(memo, ''), isForemanNudge(e.text))`. The
comments on the handler and on `turnRunning`, `rateLimitSeen`,
`ownTurnsStarted` and `pendingErrorTurn` say that only a turn of the
session's own changes them. No state is added, so a restart, a hot reload, a
resumed or cleared session and two copies of the mod behave as today.

## Grafts

- From the judge: a test for a subagent that starts during the session's own
  turn after the turn hit a usage limit. This is the one way a start during
  the turn itself does harm today, because it clears `rateLimitSeen`.
- From the judge: one subagent test also checks that the event reached the
  engine, which covers the spec's third Behavior point.

## Rejected alternatives

- Holding the `session.usage` read to start a subagent during a turn's end,
  as the simplest plan proposed. The test kit takes one hook per event, and
  the compaction tests' setup already owns that hook, so the test could not
  be built as written. A gated bottom `turn.complete` hook holds the end at
  `next(e)`, after it has read the turn count and before both count checks,
  which is exactly where the old code goes wrong.
- Counting running subagents, or showing a background subagent as busy. The
  spec leaves both out.

## Steps

1. Write the tests below in `mods/builder/tests/register.test.ts` and see
   each fail on today's code.
2. Change the handler and the comments.
3. See the tests pass, then run the gates.

## Test plan

Each test fails on the code before the change.

1. A subagent that starts after the session's own turn ended leaves the
   status `idle` and never writes `busy` true, and its event reaches the
   engine (modelled on the test of a subagent's turn end near line 11537,
   with `writtenState`).
2. A subagent that starts while the session's own turn's end is held at a
   gated bottom `turn.complete` hook, registered before `reviewing()`: the
   compact command runs once, `busy` is cleared, and the change held during
   the turn is handed over with the reload line (modelled on the held-change
   compaction test near line 12660).
3. A subagent that starts while a replied turn's end waits on its write of
   `busy` false (`writeWaits`, registered before `holdOnWindow`): the
   usage-limit hold comes off, a look runs and no resume prompt comes
   (modelled on the tests near lines 9849 and 9885).
4. A subagent that starts during the session's own turn after
   `rateLimited($)`: the turn's error end still starts the hold (modelled on
   the test near line 9527).
5. A subagent that starts between an error turn's end and its late
   `StopFailure` of `rate_limit`: the hold starts, and the resume prompt
   comes at its time (modelled on the test near line 9538).
6. A subagent that starts during a saved hold: the resume prompt comes at
   the resume time (modelled on `holdOnWindow` tests near line 8964).
7. A subagent that starts while the session's own permission prompt is
   open: the status stays `needs-you` until the session's own turn ends
   (modelled on the tests near lines 11337 and 12151).
