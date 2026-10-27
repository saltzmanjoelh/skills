# Builder names the background work a session waits on, and for how long

Date: 2026-10-27.

## Goal

A sub session running `/implement` started a user interface test run in the
background and ended its turn so the engine could wake it when the run
finished. The run hung inside the test tool's collection of diagnostics, and
from the outside the session looked stopped. Builder's pane did know about the
task, but it said only `1 background command`, with no name and no time, and
the next step said `nothing to hand over`. The parent's foreman row, which is
drawn from builder's status record, showed the same bare count. A person
could not tell a session waiting on its tests from one that had hung.

After this change, builder's line above the prompt and its pane name the
background task the session waits on, say how long it has waited, and mark a
task that has run past the ceiling the earlier stall work added (see
`docs/specs/no-sub-session-stalls-unseen.md`) so that "still waiting" and
"probably hung" look different. The status record carries the oldest task's
description and start time, so foreman's row for the session shows the same
words and the same elapsed time.

## Users and trigger

The person who runs a session with builder loaded, with or without a foreman
ticket, and the person who runs a foreman parent whose pane lists that
session. The trigger is the engine's list of background tasks, which reaches
builder at the end of the session's own turn (the classic `Stop` event) and at
the end of each subagent's turn (`SubagentStop`), holding at least one task.

## Behavior

### When a task was first seen

1. The engine reports a background task as its id, type, status, description
   and command only, with no start time. Builder stamps each task with the
   time it first saw it in the engine's list, and keeps that stamp as a field
   of the task in its `background` store value, so it survives a hot reload.
   When a later list replaces the stored one, every task already stored keeps
   its stamp, matched by the key the status record already uses (the task's
   id, or its kind and description when the engine reported no id), and every
   task not stored before is stamped with the time of that replacement. A task
   that leaves the list takes its stamp with it, so a task that returns later
   under the same key begins again. A stored task from an older build that has
   no stamp counts as first seen when this build first reads it.
2. The elapsed time shown for a task everywhere below is the time since that
   stamp. It is how long the session has waited on the task since the turn
   end that reported it, and it runs short of the task's real run time by the
   time the task ran inside the turn that started it. The README says so.

### The line above the prompt

3. The background part of what runs names the oldest task, the one with the
   earliest stamp, by its description, or by its command when its description
   is empty, as the pane's background rows already do, printed without control
   characters and cut as the other parts are. The part ends with the task's
   elapsed time in the form the slow foreground call uses (`45s`, `1m 7s`,
   `1h 2m`). When the background part is the only running part the line
   names, with no slow foreground call named and no running agents, it reads
   `waiting on: <description> (<time>)`. When the line also names a call or
   agents, it reads `background: <description> (<time>)`, because the session
   is working beside the task rather than waiting on it. With several tasks
   in flight, the part ends with ` and <n> more`, counting the tasks it does
   not name. The part takes the place of today's count.
4. The ceiling is a constant in builder, `BACKGROUND_CEILING_MS`, five
   minutes, named in a comment as the same number foreman uses by default for
   its idle threshold. Once the named task's elapsed time reaches it, the
   time in the part gains the suffix `, past 5m`, as in
   `waiting on: full UI test run (7m 40s, past 5m)`, and the part is drawn in
   yellow, the colour the pane's stale warning uses. The line's button, which
   takes a plain string today, then takes three children: the text before the
   part, the part as a yellow `Text`, and the text after it. The helper that
   builds the line keeps returning the whole line as one string, so the width
   fitting, the stale warning and every test of the line's words work as
   today, and a sibling helper returns the same line as segments with the
   background part marked, built from the same pieces rather than by
   searching the fitted string. The segments always join to the string. When
   the width cuts the line inside the part, the yellow covers what remains of
   the part, and when the cut removes the part, nothing is yellow.
5. The next step gains a reason between running agents and the pull request's
   states: when no question is open, no agent runs and at least one
   background task is in flight, the next step reads
   `waiting on its background command`, with `commands`, `task` or `tasks`
   by the count and the kind, as the count's noun is chosen today, followed by
   the time of the next look as every reason is. It comes before the checks,
   the fix and the merge because it is the session's own work, as running
   agents are. When the line already names the task in its running part, the
   next step on the line leaves this reason out, as it leaves out the running
   agents, so the task is named once. In the pane, the next step shows it in
   full.

### The pane

6. Each row under the pane's `Background` heading gains the task's elapsed
   time after its description, in the same form as the line:
   `<status> <type> · <description> · <time>`. Once the task's elapsed time
   reaches the ceiling, the time gains the same suffix, `<time>, past 5m`, and
   the row is drawn in yellow. A row under the ceiling keeps the plain colour.

### The status record

7. The record's `backgroundOnly` field, present only while the state is
   `working` and background work is the only thing running, orders `tasks` by
   first-seen stamp, oldest first, over every task in flight, dropping empty
   descriptions and withholding secret-shaped ones as today. Because every
   task the wait began with was seen at or before the wait's `since` and every
   task that joined later was seen after it, the wait's own tasks still come
   first. The field gains `taskSince`, the first-seen stamp of the task whose
   description is `tasks[0]`, so the words and the time always belong to the
   same task. When `tasks` is empty, because every description was empty,
   `taskSince` is left out. `since` keeps its meaning as the start of the
   background-only wait, which foreman's idle rule counts from. No existing
   field changes meaning, so `version` stays `1`. The record never writes a
   task's command, so a task with an empty description cannot head `tasks`.
8. Foreman's reader of the field takes `taskSince` as it takes `since`, as a
   finite number or nothing, and reads a record without it as today. When the
   row's record carries the field with at least one task and a `taskSince`,
   the row's state words gain `waiting on: <tasks[0]> (<age>)` after the
   reason, with the task printed as the reason is and the age in foreman's
   whole-minute form (`7m`, `1h 3m`). The row keeps the plain tone of a
   working row, and a stale row is dimmed as today. Nothing else in foreman
   changes.

## Edge cases

- Two tasks the engine reported without ids and with the same kind and
  description share one key, so they share the stamp of the first.
- A task first seen at a subagent's end while the session's own turn still
  runs is stamped then, so its time counts from that moment, and the line
  reads `background:` until the turn, its calls and its agents are done.
- A task whose elapsed time has reached the ceiling is marked while the
  session's own turn runs too, since the stamp does not depend on the state.
- A project that sets foreman's `idleMinutes` option to another number sees
  builder's `past 5m` and foreman's first nudge part company, because builder
  cannot read foreman's options. The README says so.
- The stale warning and a task past the ceiling can show together: the stale
  sentence leads the line as today, and the rest follows with the part in
  yellow.
- A session with no foreman ticket writes no record, as today, and still gets
  the line, the pane rows and the next step.
- An older foreman reading a newer record ignores `taskSince` and draws the
  row as today. A newer foreman reading an older record finds no `taskSince`
  and draws the row as today.
- A withheld description reaches foreman's row as the withheld text, as it
  reaches the wake sentence today.
- A surface that drops the colour of a `Text` child still shows the suffix,
  so the two states stay apart in words.
- A task that finishes while the session is idle leaves the list when the
  transcript draws its notification, as today, and its stamp goes with it.

## Non-goals

- Any change to foreman's rules for a background-only wait, the sentences of
  its nudges and wakes, its tones or its stale dimming. Foreman's row gets no
  warning tone past the ceiling; the parent is told of a long wait by the
  nudges and the wake the earlier stall work added.
- A shared place for the ceiling that both mods read. Builder copies
  foreman's default by hand, because one mod cannot read another's store or
  options.
- Watching a task's output, or a truer start time by matching the Bash call
  that started a task to its id. The engine's task summary has neither, and
  the first-seen stamp is within seconds of the real start in the case the
  issue describes.
- Showing the task in foreman's row outside a background-only wait, or a new
  field in the record beside `backgroundOnly`.
- Changing the time format of the slow foreground call, the agent rows or
  foreman's ages, or writing durations in a clock form such as `7:40`.
- Raising the status record's `version`.
- Changes to the engine.

## Failure modes

- If the `background` store value cannot be written, the stamps are lost
  with the list, as the list is today, and the next turn end rebuilds both.
- If the status record cannot be written, foreman's row shows the last record
  it read, as today.
- If a surface drops the yellow, the suffix still marks the state.
- If the engine stops sending the list of background tasks, nothing is
  named, as today.

## Verification

- Builder tests of the line: one task alone reads
  `waiting on: <description> (<time>)`; the same task beside a slow call or a
  running agent reads `background: <description> (<time>)`; several tasks add
  ` and <n> more`; a task under five minutes has no suffix and one at five
  minutes has `, past 5m`; the segments helper marks the background part and
  its segments join to the string; the next step reads
  `waiting on its background command` when nothing else applies, comes
  before `waiting on checks`, and is left out of the line when the running
  part names the task.
- Builder tests of the list merge: a task present in the stored list and the
  new one keeps its stamp, a new task is stamped with the replacement's time,
  a task missing from the new list is dropped, and tasks are matched by the
  record's key.
- Builder tests of the pane rows: each row ends with the time, and a row past
  the ceiling carries the suffix.
- Builder tests of the record: `tasks` is ordered oldest first, `taskSince`
  is the stamp of the task `tasks[0]` names, `taskSince` is left out when
  `tasks` is empty, and an older memo reads as before.
- Builder hook-level tests: a `Stop` with background tasks stamps them, a
  second `Stop` keeps the stamps, and the drawn line's part and the drawn pane
  row are yellow at the ceiling and plain before it.
- Foreman tests: `taskSince` is read as a finite number or nothing; the row's
  words gain `waiting on: <task> (<age>)` with the field and stay as today
  without it or without `taskSince`.
- The README's sections on the line, the pane and the status file describe
  the new words, the ceiling and what the time measures.
- The gates in the project's `CLAUDE.md`.
- By hand: start a background `sleep 600` in a session with a watched pull
  request and end the turn; the line, the pane and the parent's foreman row
  name it with a rising elapsed time, and past five minutes the line's part
  and the pane row turn yellow with the suffix.

## Decided by the counsel

- The engine reports a session's background tasks only as id, type, status, description and command, with no start time. Where should builder count a background task's elapsed time from, for the line above the prompt, the pane's Background rows and the status record? The counsel chose: From when builder first saw the task in the engine's list, at the end of the session's turn or of a subagent's turn that reported it; kept per task across turns and a hot reload, so the number shown is how long the session has waited on the task, which runs a little short of its real run time, and the README says so. 6 of 7 members voted for it.
- The issue says the line and the pane switch to the warning style once a background task runs past "the ceiling" the earlier stall work added. That ceiling is foreman's idle threshold (5 minutes by default, set in foreman's options) applied to the status record's background-only wait, and builder cannot read foreman's options. What ceiling should builder use for its own warning style? The counsel chose: A constant of 5 minutes in builder, named as the same number foreman uses by default for its idle threshold, counted from the task's own first-seen time, so the time shown beside a task and the warning agree: a task shown at over 5 minutes is drawn in the warning style, whether or not the session's own turn is also running. 5 of 7 members voted for it.
- The issue's example for the line is "waiting on: full UI test run (7:40)", a clock form, but the line already names a slow foreground call with clockTime's form, "running: <label> (1m 7s)", and the pane's agent rows and foreman's rows use words too (45s, 1m 7s, 1h 2m; foreman's ageWords gives 5m, 1h 3m). In what form should the line, the pane's Background rows and foreman's row print a background task's elapsed time? The counsel chose: In clockTime's existing form, 45s, 1m 7s, 1h 2m, the same as the slow foreground call beside it on the line and the agent rows in the pane, so one line never mixes two time formats; foreman's row prints the same value with its own ageWords (whole minutes, 7m, 1h 3m), as its stale rows already do. 7 of 7 members voted for it.
- The issue asks that builder's status record carry the oldest background task's description and start time, so that foreman's row for the session shows the same words and the same elapsed time as builder's line. The record already has `backgroundOnly: { since, tasks }`, present only while the session is working and background work is the only thing running, where `since` is when that wait began and `tasks` holds up to three descriptions, the wait's own first. What should the record carry? The counsel chose: Extend `backgroundOnly`: order `tasks` by first-seen time so `tasks[0]` is the oldest task's description, and add `taskSince`, the oldest task's first-seen time; the field stays present only during a background-only wait, and foreman's row adds `waiting on: <tasks[0]> (<age since taskSince>)` when the field is there, reading a record without `taskSince` as before. 6 of 7 members voted for it.
- The issue's example for the line is "waiting on: full UI test run (7:40)". The line also names a slow foreground call ("running: <label> (<time>)") and the running agents, and a background task can be in flight while those run too. What should the line's background part say when the session is doing other work beside the background task? The counsel chose: `waiting on: <description> (<time>)` only when the background part is the only running part the line names, with no slow foreground call and no running agents; otherwise `background: <description> (<time>)` (`and <n> more` for several), because a session with an agent or a call running is working beside the task, not waiting on it. 6 of 7 members voted for it.
- The issue says that once a background task runs past the ceiling, the line and the pane mark it "with the same warning style the stale-session warning uses". In the pane that warning is yellow text. On the line, which is one plain, dimmed button whose label is a string, the stale warning is a leading sentence that is never cut, with the rest of the line after it. How should the line and the pane mark a background task that has run past 5 minutes? The counsel chose: Words and colour: the background part's time gains a suffix naming the ceiling, as in `waiting on: full UI test run (7m 40s, past 5m)`, the same suffix appears on the task's pane row, and both the line's part and the pane row are drawn in yellow, so a surface or a test that sees only text still tells the two states apart. 5 of 7 members voted for it.
- The issue asks that foreman's row for a sub session show the same words and elapsed time as builder's line. Foreman's rules for a background-only wait (a nudge after idleMinutes, a second nudge, then a wake) are not part of the issue. Where does this change stop on foreman's side, and what is explicitly out of scope? The counsel chose: Foreman's row gains `waiting on: <task> (<age>)` from the record's new field, in the row's plain tone, and nothing else in foreman changes: its nudge and wake rules, the sentences they send, its stale dimming and its tones stay as they are. Out of scope: any warning tone on foreman's row, a shared place for the ceiling that both mods read, watching a task's output, and changes to the engine. 5 of 7 members voted for it.
