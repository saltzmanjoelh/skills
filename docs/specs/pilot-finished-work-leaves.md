# Finished work leaves the pilot line and pane

Written 2026-10-14.

## Goal

The pilot line above the prompt and the pilot pane never present work that has
finished as still running, and `/pilot` never tells a person who has just typed
`/pilot` to type it. This finishes what `pilot-shows-what-runs.md` promised,
"nothing on it stays wrong for long", in the three places where the reviews of
two later pull requests found it does not hold.

## Users and trigger

A person watching an `/implement` session, at the desk or from another device.

- **A dropped agent.** The engine drops an agent from its list while the mod's
  stored status for it still says running. The pane then shows
  `running Explore · about dropped · - · 5s` among the dimmed finished rows,
  with a duration that never moves. Everywhere else in the mod, "running"
  means `isRunning`, which is false for such an agent.
- **A finished background command.** A background shell command finishes while
  the session is idle. The engine wakes the session with a task notification,
  but that turn is interrupted or ends on an error, so no Stop hook runs. The
  line keeps saying `1 background command`, and the live ticker keeps redrawing
  every second and reading the agent list every five seconds, until the next
  turn end, which may be hours later.
- **A `/pilot` reply that tells the person to type `/pilot`.** A person types
  `/pilot` on a terminal under the width the engine needs, or in an app that
  places no panes. The reply says that typing `/pilot` or widening the terminal
  shows the pane, telling them to do what they just did.

## Behavior

1. **A dropped agent says so.** When the engine's list no longer names an
   agent (`isListed === false`) and its stored status is pending, running or
   waiting, its row in the pane, as text and as a drawing, shows
   `no longer listed` in place of the stored status. The row stays dimmed, its
   mark is the finished mark rather than the running one, and its time is the
   frozen one it shows today (until the list last named it). An agent whose
   stored status is already a finished one (completed, failed, killed, idle)
   keeps that word whether or not it is listed. Nothing stored changes; this
   is how the row is worded.
2. **A finished background task leaves when its notification is drawn.** The
   mod hooks the drawing of the transcript's user-message rows. On a row whose
   origin is a task notification and whose task carries an id and a status of
   `completed`, `failed` or `killed`, the mod removes the task with that id
   from its background list. Any other row, a notification with no id, or one
   with another status, changes nothing. An id that is not in the list changes
   nothing and writes nothing. The hook only ever removes; it never adds a
   task. The hook passes the row on unchanged, so the transcript draws as
   before.

   The engine's redraw request redraws every instance any of the mod's render
   hooks may select, so with this hook the live ticker's once-a-second redraw
   reaches every user-message row in the transcript while anything runs.
   Measured in the test kit, a composer row was drawn 11 times in 10 seconds of
   live ticking, against once without the hook, and narrowing the hook's
   matcher by the row's props does not narrow the redraw. An ordinary row then
   costs the hook's origin check before it is passed on, plus the engine's own
   redraw of the row. To keep an ended notification row from costing more, the
   mod keeps the ids of its background list in memory. The replacement at a
   turn end and the removal refresh them from what they wrote, and the live
   ticker refreshes them from the store at every tick whose reads no write of
   the list overtook, so ids that writes answered out of order left behind are
   put right within a second while anything runs. A tick that a write overtook
   decides nothing, and the next tick reads again (`pilot-true-state.md`). A
   row whose task is not among them, which is every subagent's and every task
   already taken off, starts no removal and reads nothing. Until the ids are
   first known after the module loads, every ended row's task is checked.
3. **Every subagent's end refreshes the background list.** The engine's
   SubagentStop carries the same session-wide `background_tasks` list as the
   session's own Stop. When that field is present and is a list, the mod
   replaces its background list with it, filtered as the Stop's is (a
   subagent is not counted twice). When the field is missing, the list is left
   alone, because an older engine sends none and its absence says nothing
   about the session's work.
4. **The session's own turn end still replaces the whole list,** as today.
   The live ticker still stops as it does today: once the list is empty and
   nothing else runs, it stops after its one idle read. Every tick now also
   reads the list and refreshes the ids that item 2 describes, except a tick
   whose reads a write of the list overtook, which neither refreshes the ids
   nor stops (`pilot-true-state.md`).
5. **The person's `/pilot` and the tool get different replies when the pane
   waits.** The open-pane logic takes who asked. Both replies say the pane
   waits and is not drawn yet and quote the engine's reason exactly. The
   `mcp__pilot__open_pane` tool's reply goes on to say that, when the reason is
   the terminal's width, typing `/pilot` or widening the terminal shows it.
   The `/pilot` command's reply says only that widening the terminal shows it
   when the reason is the width. When the pane is placed, both say
   `The pane is open.` as today.

## Edge cases

- An agent the engine drops and later lists again reads running again, since
  the word is derived from `isListed` at each draw.
- A card saved by an older build with no `isListed` field counts as listed,
  as `isRunning` already treats it, so it keeps its stored word.
- A notification row whose task id names a background subagent removes
  nothing, because subagents are kept out of the background list already.
- A notification row drawn after a Stop already replaced the list finds no
  match and writes nothing.
- A SubagentStop whose `background_tasks` is an empty list empties the
  background list, as a Stop's empty list does today.
- A subagent's Stop (the `classic.Stop` event carrying `agent_id`) is still
  ignored, as today; only `classic.SubagentStop` is read.
- The band line press, the pane toggle and the progress tool's automatic
  opening discard the reply, so which wording they get does not matter; they
  keep the tool's.

## Non-goals

- Changing what is stored for an agent, or when cards are pruned.
- Time-boxing the background list, or labelling it as a snapshot.
- Stopping the live ticker from treating background work as running.
- Reading the transcript, or any engine list of background tasks (there is
  none), to learn which tasks still run.
- Any change to the line's wording for background work, or to the poll
  ticker that runs while a look is scheduled.

## Failure modes

- If the notification row's task id does not match the id the Stop hook
  reported, nothing is removed and the line behaves as it does today until the
  next turn end. It never hides work that is still running. The generated
  engine types say the ids are the same task's id; no test of the real engine
  has shown it, and the mod's tests can only use fake rows.
- If the engine never draws the notification row (no attached surface), the
  SubagentStop refresh and the next turn end still clear the list, as today.
- If writing the list from the render hook throws, the row still draws: the
  hook passes the row on whatever the write does.

## Verification

Tests in `mods/pilot/tests`, run by `claude plugin test .`:

- `pane.test.ts`: the dropped running agent's text row reads
  `no longer listed Explore · about dropped · - · 5s`; a dropped agent whose
  stored status is completed keeps `completed`; the drawn row's text and mark
  for a dropped running agent are the finished ones (`art.test.ts` if the mark
  is decided there).
- `register.test.ts`, background list: after a Stop with a shell task, a
  drawn notification row for that id with status `completed` empties the line
  of `1 background command`; one with another id, with no id, with status
  `running`, or with another origin leaves it; a second draw of the same row
  writes nothing; an ended subagent's row and a row whose task already left
  the list read nothing; a task a later subagent's list puts back is taken off
  again at the row's next draw; after the list is empty and nothing runs, the
  live ticker stops.
- `register.test.ts`, SubagentStop: a SubagentStop carrying `[]` empties the
  list; one carrying a monitor and a shell task shows `2 background tasks`;
  one without the field leaves the list.
- `register.test.ts`, the replies: with the pane placed, the tool and
  `/pilot` both say the pane is open; with the pane waiting for width, both
  quote the reason, the tool's reply mentions typing `/pilot`, and the
  command's does not.
- The four gates in `CLAUDE.md` pass.

## Decided by the counsel

- How should the pilot mod stop showing a background command that has finished while the session sits idle? The counsel chose Drop each task from the background list when the engine draws the notification row for it, which carries the finished task's id and how it ended, and also take a fresh list from every subagent's end (SubagentStop carries the same session-wide list as Stop). The session's own turn end still replaces the whole list., 7 of 7.
- The new hook on transcript rows makes the mod's once-a-second redraw request redraw every user-message row in the transcript while anything runs. How should pull request 44 deal with that? The counsel chose Accept the cost. The hook returns at once for rows that are not ended-task notifications, so each extra redraw is cheap; record the measured behaviour in the spec, correct its 'costs only the check' wording, and skip the timer for ended notifications whose task is a subagent (those can never be in the background list)., 6 of 7.
