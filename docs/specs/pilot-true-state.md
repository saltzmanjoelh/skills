# The pilot line and pane show the true state

Written 2026-10-14.

## Goal

Four places where the pilot mod shows a person something that is not true are
fixed. A finished background task no longer stays on the pilot line after a
late read stops the live ticker. A usage-limit hold no longer outlives a turn
that proved the limit has lifted. A counsel question in its second round shows
why it is voting again. An agent's output button opens the agent pane at once.

## Users and trigger

The person watching a session that runs `/implement`, on the pilot line above
the prompt and in the pilot pane. Each case below is something they see go
wrong today.

## Behavior

### A late read of the background list

1. The live ticker never lets a read of the background list that began before
   a newer write of that list decide what the in-memory ids hold, or whether
   the ticker stops. Today `liveTick` sets `backgroundIds` from its own read
   and then cancels the ticker, even when `replaceBackground` wrote a newer
   list while that read was answered, and `ensureLive` did nothing because the
   ticker was still set.
2. So after any interleaving of a tick's read with a turn end's replacement
   of the list, the ids hold the newer list, and the ticker is running
   whenever that list holds a task. A task the newer list holds is taken off
   by its notification row as usual, and the line shows the true count.

### A hold that outlives a clean turn

3. A turn of the session's own that ends with reason `answer` or `refusal`
   takes a saved usage-limit hold off, the way the person's prompt does: no
   resume prompt, and the poll and the stuck prompt start again. Those are the
   two reasons that mean the API replied, so the limit is not in force. This
   applies whatever started the turn, a task notification included.
4. A turn that ends with reason `aborted` leaves the hold as it is, because
   an interrupted turn may never have reached the API. The person who
   interrupted it can clear the hold with a prompt. A turn that ends with
   reason `error` goes on deciding whether to hold, as today.
5. The hold's save also checks, once it has been written, whether a turn of
   the session's own started since the error turn ended, as it already checks
   for the person's prompt. That covers a turn that started while the error
   turn's end was still deciding the hold, not only one that started while
   the hold was being written. If one did, and that turn has already ended
   with `answer` or `refusal`, the hold is taken off, so a whole turn that
   started and ended before the hold was saved cannot leave a hold behind. If
   that turn is still running, its own end decides by item 3.

### Round 1 while round 2 votes

6. While a counsel question's round 2 is being voted on, the pane draws, under
   the `round 2 · voting` line, round 1's tally exactly as a finished round
   draws it, labelled `Round 1:`: the tally per option counted against the
   members who took part, and the members without a vote with their reasons.
7. Round 1's tally lists only the options round 1 had. The options round 1's
   proposals added are named as new on their own line, with no count, so the
   pane never shows an added option with a count of 0 from a round it was not
   in. The lean is drawn last, as today.

### The output button

8. Pressing an agent's `output` button opens the agent pane at once, showing
   `Reading the messages.` until that agent's messages are read, and then the
   messages, or why they could not be read, as today. The read starts when the
   button is pressed and the pane's draws share it, as they do today.

### The older specs

9. Each older rule this changes is edited where it stands, saying what the
   rule now is and pointing to this spec: point 5 of `pilot-counsel.md` (what
   the pane shows), rule 11 and the `task-notification` verification line of
   `implement-runs-unattended.md` (what clears a hold), and items 2 and 4 of
   `pilot-finished-work-leaves.md` (the ticker's refresh of the ids).

## Edge cases

- A write of the background list lands while a tick's read is answered and
  the newer list is empty: the ids hold the empty list and the ticker may stop
  after its idle read, as today.
- A removal by a notification row lands while a tick's read is answered: the
  ids hold what the removal wrote, not the tick's older read.
- A task-notification turn during a hold ends with `answer`: the hold comes
  off. Its prompt alone still neither resets the interval nor clears the hold.
- A hold's save is refused: nothing is taken off, as today.
- Taking the hold off at a turn end is refused: the hold stays on and its
  timer still brings the resume, as today when the person's clear is refused.
- A turn ends with `answer` while a later turn starts, fails on the limit and
  saves a hold before this turn's end reads the hold: this turn's end leaves
  that later hold alone.
- A question whose round 1 tally has no member without a vote: round 1 is
  drawn without that line, as a finished round is.
- A question in round 2 whose round 1 added no option: impossible today,
  because round 2 follows only a proposal; if it happens, no "new" line is
  drawn.
- The output button is pressed for a second agent while the pane shows the
  first: the pane switches to the second agent and shows `Reading the
  messages.` until its read is done.
- Opening the pane is refused: the button's press fails as it does today; the
  read already started is kept for the next draw.

## Non-goals

- Guarding against a reused background task id. The engine does not promise
  ids are unique within a session, so an old notification row drawn again
  after a resume could remove a newer task with the same id, until the next
  turn end rewrites the list. Nobody has seen an id reused.
- Changing what starts a hold, when it resumes, or how the line words it.
- Changing what a finished counsel round draws, or how the counsel counts.
- Changing how the agent pane draws messages once they are read.

## Failure modes

- A tick whose read is overtaken by a write skips that tick's decision; the
  next tick, a second later, reads again. The line is never wrong for longer
  than a tick while something runs.
- A hold wrongly kept after an `aborted` turn lasts until the person's next
  prompt or the resume time. A hold wrongly taken off restarts the poll, and
  the next turn that dies on the limit starts a fresh hold.

## Verification

Tests in `mods/pilot/tests`, run by `claude plugin test .` among the
repository's four gates, each seen to fail on the code before this change:

- A tick's read of the background list held with `answerWaits` while a Stop
  writes a task: afterwards the ticker still runs, the ids hold the task, and
  the task's notification row takes it off.
- A hold whose save is held while a turn starts and ends with `answer`: the
  hold is off once the save lands, and the poll and the stuck prompt are armed.
- A saved hold, then a turn ends with `answer`, and separately with
  `refusal`: the hold comes off with no resume prompt. With `aborted`: the
  hold stays.
- A task-notification prompt during a hold leaves it on; that turn's end with
  `answer` takes it off.
- A question in round 2 after a rerun: the pane draws `Round 1:` with round
  1's tally over round 1's options only, the members without a vote, and the
  added options named as new with no count.
- The output button pressed while the message read is held: the agent pane is
  open and shows `Reading the messages.`; once the read is answered it shows
  the messages.

Each test releases what it holds on purpose, so a wrong fix fails the test
rather than leaving the suite waiting. The pull request names the commit each
test was seen to fail on. Nobody checked the four fixes in a live session,
because the races cannot be brought about on purpose there.

## Decided by the counsel

- While a counsel question's round 2 is being voted on, what should the pilot pane show of round 1? The counsel chose Round 1's tally exactly as a finished round draws it (the tally per option and any members without a vote), labelled "Round 1:", under the "round 2 · voting" line, with the options round 1 added named as new, 7 of 7.
- When the session's own turn ends without an error while a usage-limit hold is saved, what should take the hold off? The counsel chose Both: the turn-start check after the save, and any later turn end without an error, 4 of 7.
- The counsel decided that a turn end without an error takes a saved usage-limit hold off. Which turn end reasons should count for that? The counsel chose Only 'answer' and 'refusal', the two reasons that mean the API replied; 'aborted' leaves the hold as it is, 4 of 7.
- The issue about a late read of the background list also notes an open question: the engine does not promise background task ids are unique within a session, so an old notification row drawn again after a resume could remove a newer task with the same id. Is guarding against that in scope for this run? The counsel chose Out of scope: the spec lists it as a non-goal, because nobody has seen an id reused and the engine's ids look unique, 7 of 7.
- Where should this run's changed rules be written down: in this run's new spec alone, or also as edits to the older specs whose rules they change? The counsel chose A new spec for this run, plus a short edit in each older spec whose rule changes (point 5 of pilot-counsel.md for the round 2 pane, rule 11 and the task-notification verification line of implement-runs-unattended.md for the hold, and the backgroundIds sentence in pilot-finished-work-leaves.md if it states the ticker's ordering), each pointing to the new spec, 6 of 7.
- How should the spec say its four fixes are verified? The counsel chose Tests in mods/pilot/tests only, each written to fail on today's code first (a held read for the ticker race and for the output button, a held save for the hold, and a drawn rerun tally for the pane), run by the repository's four gates, 7 of 7.
