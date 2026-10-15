# Plan: the pilot mod polls less where an event ends the wait

Spec: `docs/specs/pilot-polls-on-events.md`. Written 2026-10-09.

## Chosen approach

Two planners ran: one for the simplest change and one for the most robust.
They agreed on the shape, and the robust plan won on its tests and its
README layout. The code change is one constant: `POLL_MS.agents` in
`mods/pilot/hooks/state.ts` goes from 5 to 10 minutes. `register.tsx` does
not change, because the behaviour the change rests on already holds. When the
session's own turn ends, `armTurnEndLooks` sets looks at 10 and 40 seconds;
each calls `schedule` with `keepSooner`, which replaces a pending timer that is
due later than the new state's interval. A subagent's own `turn.complete`
(with an `agentId`) only updates its card. Both planners and the judge traced
this through the foreground and background subagent paths, a held change and
several subagents, and found no path that needs a code fix.

## Grafts

- From the simplest plan: the new hook test ends with the checks passing and
  asserts that the 90-second poll hands over a prompt saying the checks went
  from pending to passed. That proves the outcome the session gets, not only
  that a due time moved.
- Removed from the robust plan: its assertion that a subagent's finish alone
  leaves the next look where it was. The spec does not require that, and a
  later change that reschedules on the finish would be an improvement the test
  should not block.
- Softened from the robust plan: the status-line checks use `toContain` on the
  "next look in" part rather than the whole line, and the written `nextLook`
  carries the exact number.

## Rejected alternatives

- Rescheduling inside the subagent branch of `turn.complete`. It would bring
  the poll forward at the finish itself, but from a stored snapshot that may be
  stale, and it would hide whether the turn-end look does its job.
- A README table with a "why" column, as the simplest plan proposed. The
  explanations belong in prose around a list of facts, which is the owner's
  stated preference.
- A second hook test for several subagents. It retests `waitingOn` through
  the hooks without covering a new path.
- A test that reads the README. The counsel ruled it out.

## Steps

1. `mods/pilot/tests/state.test.ts`: add a test that `POLL_MS.agents` equals
   `POLL_MS.nothing`, and change the assertion that the open-question interval
   is greater than the subagent interval to greater than or equal
   (`toBeGreaterThanOrEqual` exists in the engine's test types). Run it and see
   the new test fail.
2. `mods/pilot/tests/register.test.ts`: add a `checksRunning` factory next to
   `failing`, and the hook test below. Run it and see it fail on the old
   constant.
3. `mods/pilot/hooks/state.ts`: change `agents` to `10 * 60_000`, and rewrite
   the comment above `POLL_MS` to say why a running subagent polls as slowly
   as nothing pending, and to point at the README section, saying that whoever
   changes an interval here or `NEW_HEAD_POLL_MS` updates it because no test
   reads it. Both tests pass.
4. Show the hook test fails with the turn-end look made not to reschedule:
   temporarily add `source !== 'turn-end'` to the condition before `schedule`
   at the end of `lookAt` in `register.tsx`, run the test, record the failure,
   and revert.
5. `mods/pilot/README.md`: cut the interval sentences from the paragraph at
   line 38 (from "While the pull request's head differs" to the end of the
   paragraph), end that paragraph with a pointer to the new section, and add
   "How often it looks at the pull request" before "The pane". The section is
   a short paragraph on what a look is and the CI event as the only pushed
   source; a bulleted list in the order `waitingOn` checks the states, each
   bullet giving the state, its interval and the event that ends the wait or
   that none is pushed; and prose on the new-head interval with its fallback
   after a held or refused handover, and on a look that only observes never
   putting off a poll. It names every key of `POLL_MS` and the new-head
   interval, and names no project.
6. Run the four gates.

## Test plan

| Spec verification item | How it is met |
|---|---|
| 1 | Step 1's assertions, failing first on the new equality. |
| 2 | The hook test: watch with checks running, a turn spawns a subagent listed as running in the engine and ends; after the 90-second poll the next look is 10 minutes away and no `gh pr view` runs for the next 5 minutes; the engine list marks the subagent completed, its `turn.complete` arrives, a session turn starts and ends; 10 seconds later the next look is 90 seconds away; the checks pass, and 90 seconds later a prompt says the checks went from pending to passed. It fails on the old constant and with the step 4 mutation. |
| 3 | The four gates in `CLAUDE.md`, reported with their counts. |
| 4 | Reviewers check the README section against `POLL_MS` and `NEW_HEAD_POLL_MS`; no gate reads it. |
| 5 | Done by the session at merge, outside the code. |
