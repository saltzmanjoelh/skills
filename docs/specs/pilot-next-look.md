# A session that just pushed never looks dead

Written 2026-10-08.

## Goal

After a session pushes, the next turn comes quickly, and at every moment the
line above the prompt says what the mod will do next and when. A quiet
session can always be told from a dead one.

## Users and trigger

A person watching an `/implement` session. The trigger seen on 2026-10-08:
the session pushed round 1's fixes on its pull request, ended its
turn as the skill said, and the line read `waiting on nothing` for up to
ten minutes, so the person cancelled a run that was working.

## Behavior

1. **`/implement` ends the turn after a push only when the head will get
   checks.** With `Checks: expected` it ends the turn as now, and the mod
   starts the next one. With `Checks: none` it reads the new state with
   `mcp__pilot__watch`, which also records that state as told, and starts
   the list again from **Merged** in the same turn, so **Over a limit** is
   still checked after every push.
2. **The mod looks at the pull request when the session's turn ends.**
   About 10 seconds after each of the session's own turns ends, so that
   GitHub has had time to show a push, the mod reads the pull request once.
   A change held during the turn is still delivered at once, as now. This
   look is what tells the mod about a head the session just pushed; without
   it the shorter interval below would not start until the next ordinary
   poll, up to ten minutes later.
3. **The mod polls quickly while it has a new head to hand over.** When the
   pull request's head differs from the head in the snapshot the session
   was last told, the poll interval is the short one, 90 seconds, whatever
   else is waiting. Once the change is handed over, the interval goes back
   to what the other states set.
4. **The mod keeps the time of its next look.** Each time it schedules a
   poll it records when that poll is due, in the session's state, so the
   display can read it. With no poll scheduled (nothing watched, or the
   pull request merged or closed) the time is absent.
5. **The line above the prompt says what is next and when.** It reads
   `pilot: #<n> <state> · checks <ci> · <what is next>`, where the last part
   is the first of these that applies:
   - a new head not yet handed over: `new head, handing over in <time>`;
   - an open question: `waiting on your answer · next look in <time>`;
   - agents running: `<k> agents running · next look in <time>`;
   - checks running: `waiting on checks · next look in <time>`;
   - `ready-to-merge` set: `waiting on the merge · next look in <time>`;
   - otherwise: `nothing to hand over · next look in <time>`;
   - no poll scheduled: `not polling`.

   `<time>` is whole minutes rounded up (`7m`), or `under a minute` when
   less than 60 seconds remain. When the time has passed, the phrase reads
   `handing over now` or `next look due now` instead of `in <time>`. The
   words `waiting on nothing` never appear.
6. **The pane shows the same next step,** in place of today's
   `Waiting on <state>.` line, beside the existing `Last look:` line.
7. **The display stays current.** A relative time goes stale unless
   something redraws it, so while a look is scheduled the mod asks for a
   redraw at least every 30 seconds.

## Edge cases

- **The session pushes, then a poll hands the change over before the
  session's own turn ends.** The handover counts as telling the session;
  the interval returns to normal at once.
- **The head moves to a commit the session did not push** (another person,
  or a merge on GitHub). Same as a push: short interval until handed over.
- **A hot reload.** Module timers are dropped and re-armed by the next hook;
  the recorded due time may then lie in the past and shows as due now until
  the next poll reschedules it.
- **The time of the next look is earlier than now by more than an
  interval** (the machine slept). Shown as due now; the timer fires on wake.

## Non-goals

- A state for failed checks, and treating a check that completes again as
  a change (see `pilot-failed-checks.md`).
- Workflow runs that never register a check.
- Changing the intervals themselves other than the new-head case.

## Failure modes

- If the recorded due time cannot be read, the line shows `not polling`
  rather than a wrong time.
- If `mcp__pilot__watch` fails after a push under `Checks: none`, the
  session ends the turn as it would under `Checks: expected`, and says why.

## Verification

- A test: after watching, the session's turn ends with the head changed
  and nothing held; the look about 10 seconds later finds the new head and
  the next poll is scheduled 90 seconds out even though nothing else is
  waiting. It fails if the end-of-turn look or the new-head rule is
  removed.
- A test: once the change is handed over, the next poll is scheduled at the
  normal interval again.
- Tests on the line's text for each case in Behavior 5, including
  `under a minute`, `handing over now`, `next look due now` and
  `not polling`, and that `waiting on nothing`
  never appears. They fail if the wording is reverted.
- A test that a redraw is requested while a look is scheduled.
- Reading `skills/implement/SKILL.md`: "When a turn ends" and the first
  half's point 4 say to end the turn after a push only under
  `Checks: expected`, and to re-read with `mcp__pilot__watch` and start
  the list again under `Checks: none`.
- The gates: `tsc`, `claude plugin test`, `claude plugin validate`, from
  `mods/pilot`.
