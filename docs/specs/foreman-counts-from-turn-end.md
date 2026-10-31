# Foreman counts a background stretch from the end of a working turn

Written 2026-10-31. Seeded from a follow-up that the counsel filed, 7 of 7,
from the change that made foreman count a background wait from progress
(see `docs/specs/foreman-background-nudge-and-first-use.md`), and from the
design the owner recommended in a comment on that issue. The comment gave a
design and a fallback; the counsel chose between them (see "Decided by the
counsel"). The brief that started this session limited the change to what
the issue needs, because later work touches the same two mods.

## Goal

Foreman nudges a `/implement` sub session that waits only on background
work after `idleMinutes`, nudges it again `idleMinutes` later, and wakes
the parent `idleMinutes` after that. When the sub session makes progress in
a turn of its own and then goes back to the same background wait, foreman
today restarts the count from the read that first saw the progress, not
from the end of the turn. A turn that makes progress early and runs longer
than `idleMinutes` is therefore nudged the moment it ends, and the parent is
woken about one threshold early. With progress at minute 9 and a turn that
lasts until minute 20, the nudges come at 5, 20 and 25 and the wake at 30.

A long turn that does real work within one stage is missed entirely today,
because foreman's progress signal (`progressOf` in
`mods/foreman/hooks/act.ts`) is only the issue key, the stage, the stages
done and the pull request's number and state. A turn that fixes review
findings changes none of them.

The fix restarts the count from the end of a turn that did real work, and
still counts straight through the short turn that answers a nudge, so that
a sub session that only answers nudges still leads to a wake.

## Users and trigger

The owner runs a parent session with foreman, which starts `/implement` sub
sessions that run builder. The trigger is a sub session whose only running
work is background tasks and that runs a turn of its own, or a long answer
to a nudge that moves the work on, while the same background task keeps
running.

## Behavior

### Builder records the last turn

1. Builder recognises a foreman nudge. A turn of the session's own counts
   as started by a nudge when the text it starts with holds a
   `<cross-session-message …>` element whose body, with the white space
   around it removed, is exactly one of foreman's two nudge texts. That is
   the shape in which the desktop app delivers a message from another
   session, as a measured transcript shows.
2. The two nudge texts are declared once, as a type of string values in
   builder's state contract (`mods/builder/types/index.d.ts`). Builder's
   recogniser holds a list of them that the type check requires to name
   every value of the type, and foreman's two constants in
   `mods/foreman/hooks/desktop.ts` are each checked against that type, so
   rewording a nudge in foreman alone fails foreman's type check.
3. When a turn of the session's own ends, for whatever reason (an answer, a
   refusal, an error or an abort), builder records when it ended and
   whether a nudge started it. A subagent's turn records nothing.
4. Builder keeps that fact in its status memo, so a hot reload or a restart
   of the mod keeps it, and writes it into the status file as
   `lastTurn: { endedAt, answeredNudge }`. The field is optional: a file
   written before any turn ended, or by an older builder, has none.

### Foreman restarts from the turn's end

5. While a stretch of a background wait is counted and a read finds the
   record waiting only on background work with the same `since`, foreman
   looks at the record's `lastTurn`. When that turn ended after the
   stretch's current start (the read that last restarted it, or the wait's
   `since` when nothing restarted it), foreman restarts the stretch from the
   turn's end, with no nudges counted, no last nudge time and the woke flag
   cleared, when either of these holds:
   - the turn was not started by a nudge, or
   - the turn was started by a nudge, and foreman saw progress during a
     turn of the sub session's own since the stretch last started.
6. A turn started by a nudge during which foreman saw no progress is
   counted straight through, as today: the next nudge or the wake comes
   `idleMinutes` after the last nudge.
7. Progress that foreman sees during a turn of the sub session's own still
   restarts the stretch from that read, as today, and now also marks the
   stretch so that the end of that turn restarts it again, by point 5. The
   mark is stored in foreman's ledger with the stretch, and a stretch read
   from an older ledger without it counts as unmarked.
8. A stretch never moves backwards: a turn that ended at or before the
   stretch's current start changes nothing, so the same turn end restarts a
   stretch only once.
9. A record without `lastTurn` is counted exactly as today.
10. Stretches of an idle record (whose wait is none) are not changed.

### The README says so

11. `mods/foreman/README.md` says, where it describes a background wait,
    that the count restarts from the end of a turn of the sub session's own,
    and from the end of an answer to a nudge that made progress, while an
    answer to a nudge that made none is counted through. `mods/builder/README.md`
    names the new status field.

## Edge cases

- The issue's example: a background wait from minute 0, a nudge at 5 and a
  short answer to it, then a turn of the sub session's own from 9 to 20
  with progress at 9. The count restarts at 20, so the nudges come at 25
  and 30 and the wake at 35.
- The same timeline where the turn from 9 to 20 makes no progress foreman
  can see, because it works within one stage: the count still restarts at
  20, since a nudge did not start that turn.
- The same timeline where a nudge started the turn from 9 to 20 and it made
  progress: the count restarts at 20.
- A sub session that only answers nudges with short turns and no progress:
  nudges at 5 and 10 and the wake at 15, as today.
- A turn started by the task notification of a background task that ended:
  it is not a nudge, so its end restarts the count. When the task that
  ended was the wait's own, the wait itself starts afresh anyway.
- A prompt that holds both a nudge and other text outside the
  cross-session element still counts as a nudge. That cannot come from
  foreman, which sends only the nudge text, and it errs towards an earlier
  wake, the harmless direction.
- Builder fails to recognise a nudge, for example because the desktop app
  changes its wrapping. Each answer to a nudge then restarts the count, and
  the parent would never be woken for a hung background task. The tests
  build the prompt from the shared constants in the measured shape, so a
  change on foreman's side is caught; a change in the desktop app's wrapping
  is not, and is listed under failure modes.
- A hot reload of builder in the middle of a turn: whether a nudge started
  the running turn is kept in the memo with the rest, so the turn's end is
  recorded correctly.

## Non-goals

- Changing idle stretches, the thresholds, the nudge texts or the wake
  sentences.
- The message channel from one mod to the other that later work adds, so
  that builder can tell foreman at once that its status changed. This
  change works through the status file alone.
- Builder's `isPersonPrompt`, which counts a message from another session
  as the person's prompt because it arrives with the SDK origin. That is a
  separate defect and is left as it is.
- Restarting the count from the end of a turn for a record whose wait has
  changed, which already starts a fresh stretch.
- Recognising messages from other sessions than foreman, or foreman's begin
  message, as anything but a turn of the session's own.

## Failure modes

- A status file that cannot be read, or one from an older builder, has no
  `lastTurn`, and foreman counts as it does today.
- A `lastTurn` whose fields are not a finite time and a boolean is read as
  absent, so a damaged file never restarts a stretch.
- If the desktop app ever delivers a session's message in another shape,
  builder stops recognising nudges, and a hung background wait is nudged
  without ever waking the parent. The owner would see repeated nudges in
  the sub session with no wake.

## Verification

- Foreman tests of `decide`, in `mods/foreman/tests/act.test.ts`:
  - The issue's example, with a turn of the sub session's own from 9 to 20
    that made progress at 9: no nudge between 20 and 25, nudges at 25 and
    30, the wake at 35. It fails on the code before this change.
  - A turn from 9 to 20 with no progress and no nudge behind it restarts
    the count at 20.
  - A nudge-started turn from 9 to 20 with progress restarts the count at
    20; one without progress is counted through, so a sub session that only
    answers nudges is nudged at 5 and 10 and wakes the parent at 15.
  - A record without `lastTurn` gives today's timeline, and the existing
    tests pass unchanged.
  - A turn end at or before the stretch's start restarts nothing.
  - An older ledger without the mark reads as unmarked.
- Builder tests:
  - The recogniser accepts each of the two nudge texts in the measured
    shape, built from builder's own list, and refuses a plain prompt, a
    cross-session message with other text, and a nudge text outside the
    element.
  - A turn started by a nudge and a turn not started by one each write
    `lastTurn` with their end time and the right flag; a subagent's turn
    end writes nothing; a memo without the field reads as none.
- The gates in the project's `CLAUDE.md`.

## Decided by the counsel

- How should foreman tell a long working turn of a sub session apart from the short turn that answers a foreman nudge, so that a background stretch restarts from the end of real work rather than from the read that first saw progress? The counsel chose: As the first option, but a turn that a nudge started also restarts the stretch from its end when foreman saw progress during it (the record's issue, stage, stages done or pull request changed), so a long answer to a nudge that moved the work on is treated like a turn of the session's own. 6 of 7 members voted for it.
