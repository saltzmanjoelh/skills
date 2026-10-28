# Plan: builder names the background work a session waits on

Date: 2026-10-27. Spec: `docs/specs/builder-names-background-wait.md`.

Three planners wrote blind plans for this spec, one aiming for the smallest
change, one for the most robust change and one for the most extensible
change. A judge scored them against the spec and the owner's preferences. The
smallest plan won, because it meets every item of the spec's Behavior section
with no new file and the least state to keep correct. Six of its gaps are
closed with ideas taken from the other two plans, listed under Grafts.

## Chosen approach

Builder keeps one new state atom, `backgroundStarts`, a map from a task's key
(as `taskKeyOf` makes it) to the time the task started, in milliseconds since
the epoch. It lives beside the `background` list and has the same lifetime: a
hot reload keeps both, a restart starts both empty, and a `/clear` keeps both,
because `reopenForNextConversation` resets only the status memo. Nothing goes
into the status memo, so `statusMemoIn` and `backgroundWaitIn` do not change.

The pure rules go into `mods/builder/hooks/status.ts`, next to `taskKeyOf`,
where the other background rules already live:

- `HUNG_AFTER_MS = 15 * 60_000`. Its comment says it mirrors the moment
  foreman, at its default `idleMinutes` of 5, wakes the parent about a session
  that waits only on background work, and that it does not follow a different
  `idleMinutes` setting.
- `hungAtOf(startedAt)` returns `startedAt + HUNG_AFTER_MS`, and
  `isProbablyHung(startedAt, now)` returns `now >= hungAtOf(startedAt)`. This
  is the one rule that the line, the pane and the record share.
- `startOf(task, starts, now)` returns the recorded start, or `now` when there
  is none or it is not a finite number.
- `oldestTaskOf(tasks, starts, now)` returns the task with the earliest start
  and that start, or null for an empty list. Only a strictly earlier start
  replaces the current pick, so two equal starts keep the engine's order.
- `startsSeen(starts, tasks, now)` adds `now` for each listed task that has no
  start. `startsPruned(starts, tasks)` drops the starts of tasks that are no
  longer listed. `startBackgrounded(starts, key, at)` keeps the earlier of the
  stored time and `at`. `startWithout(starts, key)` drops one key. Each of them
  returns the same object when it changes nothing, so a caller can skip a
  write that would change nothing.

The line, the pane, the next step and the record read the two atoms through
`oldestTaskOf` and `isProbablyHung`, so they agree on the same moment.

Builder records starts at five points in `mods/builder/hooks/register.tsx`:

- `foreground` is typed to return `ToolCallResult`, which is safe because the
  `tool.call` hook is its only caller. When a call's result carries a
  `backgroundTaskId` that is a non-empty string, the call's `startedAt` is
  written for that key with `startBackgrounded`, before the `finally` drops
  the call's record. This covers a call started with `run_in_background` and
  one the person moved to the background, because both carry the id.
- `replaceBackground($, raw, isOwnTurnEnd)` keeps its list write where it is
  today and then writes `startsSeen`, and, only when `isOwnTurnEnd` is true,
  `startsPruned`. The `Stop` hook passes true and the `SubagentStop` hook
  passes false, so a subagent's end never drops a start. A refused write of
  the starts is caught, so the list and the ticker carry on.
- `removeBackground`, after its list write, drops the task's start with
  `startWithout`.
- `liveTick` reads the starts together with its other reads, before its
  `backgroundWrites` guard. After the guard passes, when a listed task has no
  start, it fires a `startsSeen` write without awaiting it. This repairs a
  refused write, a prune by an older copy of the module that was still
  running, and a crossed `Stop` and `SubagentStop`, all within a second. The
  rule that no await comes between the guard and the decisions still holds.
- `session.start` fills in a start for each listed task that has none, which
  covers a hot reload from a build that kept no starts.

Every writer reads first and calls `update` only when its pure helper returns
a changed object, because `update` always writes and every write of a builder
atom asks for a status computation. The function given to `update` recomputes
from the stored value, so a write that crossed the read is not lost.

In `mods/builder/hooks/pane.tsx`, `View` gains `backgroundStarts` and the
words change:

- A small `taskLabel(task, max)` gives the description, else the command,
  through `printable`, and `a background task` when both are blank. The line
  passes 40. A `backgroundWords(tasks)` helper holds the noun rule that
  `runningPart` uses today, `background command` or `commands` when every
  task is a shell command and `background task` or `tasks` otherwise, so that
  `runningPart` and `nextStep` count the same way.
- `runningPart` ends with `waiting on: <label> (<elapsed>)`, followed by
  ` and N more` when there are other tasks. Once the oldest task is probably
  hung, it ends with `N more <backgroundWords(others)>` instead, or leaves the
  background part out when there are no others.
- `hungWarning(v)` returns `builder: <label> has run <elapsed>, over 15
  minutes; it may be hung`, with the minutes taken from `HUNG_AFTER_MS`, or
  null when nothing is hung. `warningOf(v)` returns the stale warning, the hung
  warning, or the stale warning, the separator and the hung warning without
  its prefix. `withWarning` uses `warningOf(v)` where it uses the stale
  warning today, and its fitting and its rule that the warning is never cut
  stay as they are.
- `nextStep` says `waiting on its <backgroundWords(v.background)>` when
  `waitingOn` answers `nothing` and a background task is in flight. When
  `isRunningShown` is true it leaves those words out, as it does for running
  agents. `lineAbove` passes true in both of its branches, and the flag's
  comment now says that it means the line already names what runs, in its
  running part or in its hung warning.
- `secondRow` does not say `idle` while a background task is in flight, so a
  hung task that is the only work gives the warning followed by
  `<stage>` alone.
- `backgroundLine(task, startedAt, now)` appends ` (<elapsed>)` and keeps its
  label as today. The Background rows draw a probably hung task's row with
  `color="yellow"`, and other rows keep their props.
- Elapsed times are `clockTime(Math.max(now - startedAt, 0))`.

In `mods/builder/hooks/status.ts`, `StatusFacts` gains `backgroundStarts`,
and `recordOf` writes `oldestBackground` whenever the background list is not
empty, whatever the state, right after `backgroundOnly`. The description goes
through `shownOrWithheld(description, TASK_CHARS)`, the command is never
read, and `hungAt` is `hungAtOf(startedAt)`. While the same task is the
oldest, the three values do not change, so `comparedTextOf` stays the same as
time passes and the field causes no extra writes. `mods/builder/types/index.d.ts`
gains the atom in `PluginState.builder` and the optional field in
`BuildStatus`, each with a comment, and `version` stays 1.

Foreman:

- `mods/foreman/hooks/text.ts` gains a copy of `clockTime`, named in its
  header comment's list of copies, and `tests/builder-drawn.ts` gains
  `clockTime` answers recorded from builder's function.
- `mods/foreman/hooks/record.ts` gains `RecordOldestBackground`, builder's type
  with `hungAt: number | null`, and `oldestBackgroundIn(raw)`. A value that is
  missing, not an object, an array, or has a start that is not finite reads as
  none. A `hungAt` that is not finite reads as null through `timeOr`. A
  description that is not a string reads as the empty string. `SubRecord`
  omits the field and adds it back with the looser type, and `recordIn` copies
  it in when present.
- `mods/foreman/hooks/subs.ts` gains `isProbablyHung(row, now)` and
  `waitWords(row, now)`, which returns `waiting on: <description> (<elapsed>)`
  with `, it may be hung` once `now` reaches `hungAt`, or null when the record
  has no field. An empty description reads `a background task`, the
  description is printed through `printable`, and the elapsed time is never
  below zero.
- `mods/foreman/hooks/pane.tsx`: `stateWords` puts `waitWords` after the
  reason and before `staleWords`. `subTree` uses the warning tone when the row
  is probably hung and its state's own tone is not red. The stale branch comes
  first, so a stale row stays dimmed.

Both READMEs describe the new words: builder's line, hung warning, next step,
Background rows and status file field, and foreman's row. Builder's polling
list does not change.

## Grafts

- **Keep the earlier of two start times (from the robust and extensible
  plans).** The smallest plan let a Bash call's start always override. Keeping
  the earlier time costs the same and stays correct when two writes cross.
- **Read before writing, and skip a write that changes nothing (from the
  robust plan).** `update` always writes, and every write of a builder atom
  asks for a status computation, so without this every turn end would write
  the starts even when nothing changed.
- **Refill missing starts from the live ticker (from the robust plan).**
  Without it, a refused write of the starts leaves a task on the `now`
  fallback for the whole wait, so the line reads `(0s)`, the task is never
  marked, and the record's start time moves on every status computation. The
  ticker is the one place that repairs that, an older copy's late prune and a
  crossed pair of turn ends.
- **Check the engine with `run_in_background` and a foreground sleep (from the
  robust and extensible plans).** The spec's Verification names that path. A
  call moved to the background by hand stays as a second case.
- **Update the key-order assertion in `tests/status.test.ts` (from the robust
  plan).** Placing the field after `backgroundOnly` changes the record's last
  keys, which that test checks.
- **A test that two tasks without ids and with different descriptions keep
  separate starts (from the extensible plan).** It is one of the spec's edge
  cases.
- **A test that a refused write of the starts still writes the list, the line
  and the record (from the robust plan).** It pins down the fault that the
  refill repairs.

## Rejected alternatives

- **Leaving the record's field out while the oldest task's start is unknown
  (robust plan).** Item 9 of the spec requires the field whenever a task is in
  flight. The ticker's refill already makes an unknown start last at most a
  second.
- **A new `background.ts` module (robust and extensible plans).**
  `status.ts` already holds `taskKeyOf` and the other pure background rules.
  A new module would force moving symbols that other files import, for a seam
  the spec does not need yet.
- **Moving `backgroundOf` out of `state.ts` (extensible plan).** It breaks
  imports in `register.tsx` and two test files and avoids no import cycle,
  because `state.ts` never imports the new module.
- **Keeping the next step's words on the line when only the hung warning names
  the task (extensible plan).** The warning has just named the work, so the
  words would repeat it.
- **A test in foreman's `act.test.ts` that the field leaves the idle rule
  alone (extensible plan).** It passes by construction, because `act.ts` never
  reads the field, so it proves nothing.
- **A third parameter for `nextStep` (robust plan).** The existing flag does
  the same job once its comment says what it now means.
- **Writing the starts of new tasks before the list (robust and extensible
  plans).** Keeping the list write first leaves it where the existing race
  tests expect it, and the ticker's refill covers the moment between the two
  writes.
- **A map stored as a list of entries to avoid keys like `__proto__` (robust
  plan).** The atom is stored as plain data and read by key lookups that the
  helpers guard with `Object.hasOwn`, so a list adds code without closing a
  real gap.

## Step sequence

1. Write the failing tests for the pure helpers in `tests/status.test.ts`:
   `startsSeen`, `startsPruned`, `startBackgrounded`, `startWithout`,
   `startOf`, `oldestTaskOf` and `isProbablyHung`. Then add the helpers and
   `HUNG_AFTER_MS` to `status.ts`, and the atom's type to `types/index.d.ts`.
2. Write the failing record tests in `tests/status.test.ts`, then add the
   field to `BuildStatus` and to `recordOf`.
3. Write the failing line, next step and pane tests in `tests/pane.test.ts`,
   then change `pane.tsx`, and update the existing wording assertions in
   `tests/pane.test.ts` one at a time.
4. Write the failing start-time tests in `tests/register.test.ts`, then add the
   atom and the five writers to `register.tsx`, and update the existing
   wording assertions there one at a time.
5. Write foreman's failing tests, then change `record.ts`, `text.ts`, `subs.ts`
   and `pane.tsx`.
6. Update both READMEs.
7. Run the gates, then the check against the real engine and the issue's hand
   check.

## Test plan

Each item maps to the spec's Verification section.

- **Start times.** `tests/status.test.ts` covers the pure helpers: a first
  sighting adds a start, a listed task keeps its start, a prune drops only
  tasks that are no longer listed, the earlier time wins, a missing or
  non-finite start reads as `now`, ties keep the engine's order, and two tasks
  without ids and with different descriptions keep separate starts.
  `tests/register.test.ts` covers the hooks: a Bash call that runs 30 seconds
  and returns a `backgroundTaskId` counts from the call's start once a turn
  end lists it; a monitor counts from its first turn end; a second turn end
  keeps the start; a subagent's end with an empty list keeps the start and the
  session's own turn end then drops it; a completion notice drops it; a hot
  reload keeps the starts; a reload over a list saved without starts fills
  them in; a refused write of the starts still writes the list, and the
  ticker fills the start within a tick.
- **The line.** `tests/pane.test.ts` checks that the oldest task is named with
  ` and 2 more`; that there is no warning at 14 minutes 59 seconds and a
  leading warning at 15 minutes; that the warning is returned whole at widths
  narrower than it; that the stale warning comes first and the hung warning
  second without its prefix; that the rest reads `1 more background command`
  or leaves the part out, so the hung task is not named twice; that a label
  longer than 40 characters is cut; and that `secondRow` does not say `idle`
  when the hung task is the only work.
- **The next step.** `tests/pane.test.ts` checks `command`, `commands`, `task`
  and `tasks`; that running checks with a task in flight still read
  `waiting on checks`; and that the line leaves the words out.
  `tests/state.test.ts` keeps its checks of `POLL_MS` and `waitingOn`
  unchanged.
- **The pane.** `tests/pane.test.ts` checks the rows' elapsed times, and
  `tests/register.test.ts` checks, on a mounted pane, that a probably hung row
  is yellow and a fresh row has no colour.
- **The record.** `tests/status.test.ts` checks that the field is present in
  the working, needs-you and background-only states and absent with no task;
  that the description is cleaned, a secret is withheld, and a task with no
  description writes the empty string rather than its command; that `hungAt`
  is the start plus `HUNG_AFTER_MS`; that `comparedTextOf` is the same at two
  moments 20 minutes apart; that `backgroundOnly` is unchanged; and the
  updated key-order assertion. The foreman session test in
  `tests/register.test.ts` checks the written file end to end.
- **Foreman.** `tests/record.test.ts` checks the lenient reader's cases.
  `tests/subs.test.ts` checks the words, an elapsed time never below zero, the
  empty description, and the mark at `hungAt` and not one millisecond before.
  `tests/register.test.ts` checks the warning colour at `hungAt`, that a stale
  row stays dimmed, that a `needs-you` row stays red, and that a record
  without the field draws as before. `tests/art.test.ts` checks that the
  `clockTime` copy gives builder's answers.
- **The real engine, once.** Start `sleep 1200` with `run_in_background`, run a
  foreground `sleep 30`, and end the turn. The line reads at least 30 seconds
  at once only if the Bash result's id matches the turn-end report's id. A
  `sleep 1200` moved to the background by hand is the second case.
- **The issue's hand check.** With a watched pull request, a background
  `sleep 1200` shows a rising elapsed time on the line, the pane and foreman's
  row, and all three take the warning style at 15 minutes.
- **The gates** from the project's `CLAUDE.md`, in order. They read neither
  README, so the README changes are checked only by review.
