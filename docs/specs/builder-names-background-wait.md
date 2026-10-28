# Builder names the background work a session waits on

Date: 2026-10-27.

## Goal

A sub session running `/implement` started its full user interface test run
as a background command and ended its turn. Builder's line above the prompt
said only `1 background command`, the pane's next step said `nothing to hand
over`, and the parent's foreman row for that sub session said `working · 1
background task running.` None of the three said what the session was waiting
on or for how long, so a test run that had been going for twenty minutes
looked exactly like one that had just started, and the person could not tell a
slow run from a hung one without opening the session and reading its
transcript.

The goal is that whenever a session's own background work runs, builder's
line, builder's pane and the parent's foreman row name the oldest piece of it
and show how long it has run, and that once it has run long enough to be
probably hung, all three say so in a warning style.

## Users and trigger

The person watching a session that runs builder, either in that session (the
line above the prompt and builder's pane) or from a parent session that runs
foreman (the sub session's row in foreman's pane). The trigger is any
background task of the session's own, as the engine reports it at the end of
the session's own turn or of one of its subagents: a Bash command started with
`run_in_background` or moved to the background by the person part way
through, a monitor, or a workflow. A background subagent is an agent, not a
task, and is shown as one already.

## Behavior

### Start times

1. Builder keeps a start time for each background task, keyed the way
   `taskKeyOf` keys tasks today: by the task's id, or by its kind and
   description when the engine gave no id. For a Bash call whose result
   carries a background task id, whether it was started with
   `run_in_background` or backgrounded by the person, the start time is the
   time that call started, which builder already records for each call of the
   session's own. For every other task (monitors, workflows, commands a
   subagent started, and any task builder never saw start) it is the time
   builder first sees the task in a turn-end report.
2. A task keeps its start time for as long as it stays in the list. Replacing
   the list at a turn end never resets the start time of a task that is still
   listed. The start times are kept in builder's state, so a hot reload of the
   mod keeps them. A start time is dropped once its task has left the list,
   and only when the session's own turn ends or a task's completion notice
   removes it, never at a subagent's end, which could arrive before the
   session's own report lists a task it has just moved to the background. The
   number of start times kept is therefore bounded by the tasks in the list.
3. The oldest task is the one with the earliest start time. Two tasks with the
   same start time are ordered as the engine listed them.
4. A task counts as probably hung once it has run 15 minutes from its start
   time. The limit is one named constant in builder, whose comment says it
   mirrors the moment foreman, at its default `idleMinutes` of 5, wakes the
   parent about a session that waits only on background work, and that it
   does not follow a different `idleMinutes` setting. A task that has run
   14 minutes 59 seconds is not marked, and one that has run 15 minutes is.
   One function decides this for the line, the pane and the status record,
   given the same moment.

### The line above the prompt

5. The background part of the line, which today reads `1 background command`
   or `<n> background commands` (or tasks), names the oldest task by its label
   and how long it has run, as `waiting on: <label> (<elapsed>)`, and counts
   the others after it, as `waiting on: <label> (<elapsed>) and 2 more`. The
   label is the one the task's row in the pane shows, its description or else
   its command, printed without control characters and cut to 40 characters.
   The elapsed time is written as the line writes every other duration today,
   such as `45s`, `7m 40s` or `1h 5m`, and it rises with the line's existing
   redraw every second while anything runs.
6. Once the oldest task is probably hung, the line leads with a warning that
   is never cut, built the way the stale-session warning is built:
   `builder: <label> has run <elapsed>, over 15 minutes; it may be hung`. The
   rest of the line follows after ` · `, without its own `builder: ` prefix,
   fitted to the width the warning leaves. Its background part then counts
   only the other tasks, as `1 more background command` or `2 more background
   tasks`, and is left out when there are none, so the hung task is not named
   twice. When the session is also stale, the stale warning comes first, the
   hung warning second without the `builder: ` prefix, and then the rest.
   Neither warning is ever cut, even on a terminal narrower than they are,
   just as the stale warning alone is not cut today.

### The next step

7. When `waitingOn` answers `nothing` and at least one background task of the
   session's own is in flight, the next step says `waiting on its background
   command` instead of `nothing to hand over`, with `commands` for several and
   `task` or `tasks` unless every task is a shell command, counted by the same
   rule the line uses. This is what the pane's `Next:` line shows. On the
   line above the prompt, where the background part already names the work,
   the next step leaves these words out and says only when the next look is,
   as it already does for running agents. `WaitingOn`, the poll intervals and
   the README's list of them do not change, so running checks, a failed check
   and a pending merge are still waited on, and polled every 90 seconds, while
   a background task runs.

### Builder's pane

8. Each row under Background carries how long its task has run, as
   `<status> <kind> · <label> (<elapsed>)`. The row of a task that is probably
   hung is drawn in yellow, as the pane draws its stale warning.

### The status record

9. Builder's status record gains an optional field, `oldestBackground`,
   written whenever at least one background task is in flight, whatever the
   state, and left out otherwise. It holds the oldest task's description,
   cleaned and checked for secrets as the descriptions in `backgroundOnly` are
   (and the empty string when the task has none), its start time as builder
   recorded it, and `hungAt`, the moment it counts as probably hung, which is
   the start time plus builder's 15 minutes. A task's command is never
   written. `backgroundOnly` and its meaning stay as they are, because
   foreman's idle rule reads it. No existing field changes meaning, so the
   record's `version` stays 1. The three values stay fixed while the same task
   is the oldest, so the field causes no extra writes as time passes; when the
   oldest task ends and another becomes the oldest, the record's text changes
   and it is written at once.

### Foreman's row

10. Foreman reads the field leniently. A field that is missing or not an
    object, or whose start time is not a finite number, reads as none. A
    `hungAt` that is not a finite number drops only the mark, and a
    description that is not a string reads as empty. A record from an older
    builder has no field and its row is drawn as today.
11. The row's state line gains, after builder's reason and before any `no
    update for` words, `waiting on: <description> (<elapsed>)`, where the
    description is printed without control characters, an empty one reads as
    `a background task`, and the elapsed time is foreman's clock at the moment
    it draws minus the start time, written in builder's duration format and
    never below zero. It rises with foreman's redraw every second.
12. Once foreman's clock reaches `hungAt`, the words read `waiting on:
    <description> (<elapsed>), it may be hung`, and the state line is drawn in
    foreman's warning colour. A row that is stale stays dimmed, and a row whose
    state is `needs-you` stays red, so the mark never makes a row look less
    urgent than it did.

## Edge cases

- A task the engine reports without an id is keyed by its kind and
  description, so two such tasks with different descriptions keep separate
  start times.
- A task builder never saw start, such as a command a subagent started or one
  that was already running when builder loaded, counts from when builder first
  saw it, so its elapsed time may read lower than the truth. That is accepted:
  it can only make the mark come late, never early.
- A task that finished without the engine reporting it, such as a monitor that
  raises no completion notice, stays in the list until the next turn end and
  keeps being named, as it is already counted today.
- A clock that reads earlier than a start time shows an elapsed time of zero.
- A label longer than 40 characters is cut, so the hung warning stays a
  bounded length.
- A foreman row whose file has stopped updating keeps a rising elapsed time,
  counted from the start time, and the `no update for` words beside it show
  that the record is old.
- A description that looks like a secret is written as the withheld text, and
  foreman's row shows that text.

## Non-goals

- Acting on a task. Builder only shows and marks a probably hung task; it
  never stops, nudges or restarts one, and its pane gains no button that does.
  A hung command is already bounded by the `/implement` rule that every
  background command carries its own time limit, and a mark is only a guess
  that a healthy long test run also earns.
- Any change to foreman's idle rule. It keeps counting from when the
  background-only wait began, so builder's mark and foreman's wake of the
  parent can come at different moments, and that is intended: the mark
  measures how long the task has run, while the idle rule measures how long the
  session has sat with nothing of its own running. For example, at the default
  `idleMinutes` of 5, a test run started 10 minutes before the session's turn
  ended is marked 5 minutes into the wait, and foreman wakes the parent 15
  minutes into it. The oldest task in flight started no later than the wait
  began, so at the default setting the mark never comes after the wake.
- Following foreman's `idleMinutes` setting. The 15 minutes is fixed in
  builder and matches foreman only at the default.
- Watching a background task's output, which the engine does not report.
- Rows in foreman's pane for sub sessions started without a ticket, which
  write no status record.
- Any change to how often builder polls the pull request, or to `WaitingOn`.
- Naming more than the oldest task in the status record. Foreman's row names
  only the oldest; the reason line already counts all of them.

## Failure modes

- If builder's state is lost, as after a restart of the session, the start
  times restart from when builder next sees each task, so elapsed times read
  low until the tasks end.
- If a Bash result's background task id does not match the id in the engine's
  turn-end report, every task falls back to the time builder first saw it.
  Verification checks the match once against the real engine.
- If builder cannot write its record, foreman's row keeps the last field it
  read, and the row turns stale after three minutes as it does today.
- A malformed field in a record makes foreman's row name no task rather than
  fail to draw.

## Verification

- Builder tests of the start times: a backgrounded Bash call takes the time
  its call started; any other task takes the time it was first seen; a task
  still listed keeps its start time when the list is replaced; a task that
  left the list loses its start time at the session's own turn end and not at
  a subagent's end; and the start times survive a reload of the module.
- Builder tests of the line: it names the oldest task with its elapsed time
  and counts the others; at 14 minutes 59 seconds it has no warning and at 15
  minutes the warning leads it and survives a narrow width uncut; a stale
  session's line has the stale warning first and the hung warning second;
  the hung task is not named again later on the line; a long label is cut to
  40 characters.
- Builder tests of the next step: with nothing else waited on, one shell task
  reads `waiting on its background command`, several read `commands`, and a
  mix reads `task` or `tasks`; with running checks and a background task it
  still reads `waiting on checks`; on the line the words are left out when the
  background part is shown.
- Builder tests of the pane: each Background row shows its elapsed time, and a
  probably hung task's row is yellow.
- Builder tests of the record: the field is present with a background task in
  any state and absent without one; its description is cleaned, withheld when
  it looks like a secret, and never the command; `hungAt` is the start time
  plus the constant; the compared text does not change as time passes;
  `backgroundOnly` is unchanged.
- Foreman tests: the reader turns a missing or malformed field into none and a
  bad `hungAt` into no mark; the state line names the task with the right
  elapsed time, never below zero; the mark appears at `hungAt` and not a
  millisecond before; a stale row stays dimmed and a `needs-you` row stays red;
  a record without the field draws as today.
- Once, against the real engine: a Bash call started with `run_in_background`
  returns a background task id equal to the id the turn-end report gives.
- The issue's own check, by hand: in a session with a watched pull request,
  start a background `sleep 1200` (the `sleep 600` the issue names ends before
  the 15-minute mark), end the turn, and see the line, the pane and the
  parent's foreman row name it with a rising elapsed time and turn to the
  warning style at 15 minutes.
- The gates in the project's `CLAUDE.md`.

## Decided by the counsel

- The engine's turn-end report of background work (BackgroundTaskSummary on Stop and SubagentStop) carries no start time, yet the line, the pane and foreman's row must each show how long a background task has run. Where should builder take each task's start time from? The counsel chose: For a Bash call that moved to the background (its result carries backgroundTaskId, whether it was started with run_in_background or backgrounded by the person part way through), the time that call started, which builder already records for its foreground calls; for every other task (monitors, workflows, and any task builder never saw start), the time builder first sees it in a turn-end report. 7 of 7 members voted for it.
- Past what elapsed time should builder mark a background task as probably hung, drawing it in the stale-session warning style on the line and in the pane? The issue says "past the ceiling" that the earlier foreman change added, but that change added no single ceiling builder can read: foreman's idle rule nudges a sub session after idleMinutes of waiting only on background work, nudges again after another idleMinutes, and wakes the parent after a third, counted from when the background-only wait began. The counsel chose: A fixed 15 minutes, as one named constant in builder, counted from the task's start: the time at which foreman, at its default idleMinutes of 5, wakes the parent about a session that waits only on background work. 6 of 7 members voted for it.
- Once a background task has run 15 minutes or more, how should builder's line above the prompt mark it, given that the line is a single dimmed button label and the stale-session warning on that line is a sentence that leads the line and is never cut? The counsel chose: Lead the line with a warning that is never cut, built the way withWarning builds the stale warning, such as "full UI test run has run 17:40, over 15 minutes; it may be hung", followed by the rest of the line; and draw that task's row under Background in the pane in yellow, as the pane draws its stale warning. 7 of 7 members voted for it.
- What should builder's status record carry so that foreman's row for a sub session can name the oldest background task with a rising elapsed time, and when should the record carry it? The counsel chose: A new optional field, written whenever at least one background task is in flight whatever the state, holding the oldest task's description (cleaned and secret-checked like the descriptions in backgroundOnly, never the command) and its start time as builder recorded it; foreman works out the elapsed time each time it draws the row. backgroundOnly stays as it is, because foreman's idle rule reads it. 7 of 7 members voted for it.
- Once a sub session's oldest background task has run 15 minutes or more, how should foreman's row for that sub session mark it as probably hung, and where should the 15-minute limit live so that foreman's row and builder's own line mark it at the same moment? The counsel chose: Builder writes, in the new field, the time at which the task counts as probably hung (its start time plus builder's 15 minutes), and foreman draws the row's state line in its warning colour, adding "it may be hung" after the task's name and elapsed time, once that time has passed; so the limit lives in builder alone and both mods mark it at the same moment. 7 of 7 members voted for it.
- When the only thing a session waits on is its own background work, how should builder's pane say so in its "Next:" line, which today reads "nothing to hand over", and should builder's waiting state, which also sets how often builder polls the pull request, change with it? The counsel chose: Only the wording changes: when waitingOn answers 'nothing' and at least one background task of the session's own is in flight, nextStep says "waiting on its background command" ("commands" for several, and "task" or "tasks" unless every one is a shell command, as runningPart counts them) instead of "nothing to hand over"; WaitingOn, the poll intervals and the README list stay as they are. 7 of 7 members voted for it.
- What does this change deliberately leave out, so that reviewers have a written reason to stop: in particular, should builder do anything to a task it marks as probably hung, and should foreman's idle rule start counting from the oldest task's start time so that its nudges line up with the new mark? The counsel chose: Builder only shows and marks; it never stops, nudges or restarts a task, and foreman's idle rule stays exactly as it is, counting from when the background-only wait began, so the mark and foreman's wake may come at different moments. Also out of scope: watching a task's output, rows for sub sessions started without a ticket, and any change to polling. 7 of 7 members voted for it.
