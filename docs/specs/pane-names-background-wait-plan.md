# Plan: builder names the background work a session waits on

Date: 2026-10-27. Spec: `docs/specs/pane-names-background-wait.md`.

## Chosen approach

Three plans competed, written from the priors simplest-thing, most-robust and
most-extensible. The most-extensible plan won, because it keeps the least
state (one optional stamp on each stored task, with two writers) while making
the line, the pane rows and the status record read that one stamp through the
same helpers, so the three surfaces cannot disagree, and because its line
segments carry what the spec's verification checks under and past the
ceiling. Two ideas were grafted from the simplest plan and two from the
most-robust plan, named below.

The shape of the change:

1. **The stamp.** `BackgroundTask` gains an optional `seenAt`, the time
   builder first saw the task in the engine's list. It lives inside the
   existing `background` store value, so it survives a hot reload with the
   list and needs no new store key. One pure function, `mergeBackground(stored,
   fresh, now)`, placed in `mods/builder/hooks/status.ts` beside `taskKeyOf`
   (grafted from the simplest plan: `status.ts` already imports from
   `state.ts` and nothing imports the other way, so the key need not move and
   no re-export is needed), gives each fresh task the stored stamp under the
   same key, or `now` when none is stored, keeps the engine's order, and lets
   two id-less tasks with the same kind and description share the first
   stamp. Called as `mergeBackground(list, list, now)` it stamps a stored
   list's unstamped tasks, which is how a list an older build stored is
   stamped. A stamp that is not a finite number reads as missing (grafted
   from the most-robust plan's tests). `replaceBackground` in
   `mods/builder/hooks/register.tsx` reads the clock and merges inside its
   existing `update`; the `session.start` hook, which also runs at a hot
   reload, reads the list and, only when a task lacks a stamp, writes the
   merged list through `wroteBackground`. There is no third writer and no
   in-memory flag.
2. **One sort, one time, one ceiling test.** `sortedByFirstSeen(tasks, now)`
   is a stable sort by `seenAt ?? now`, used by the line for its oldest task
   and by the record for `tasks`. In `mods/builder/hooks/pane.tsx`,
   `BACKGROUND_CEILING_MS` is five minutes, with a comment naming it as
   builder's own copy of foreman's default idle threshold; `isPastCeiling(task,
   now)` and `taskTime(task, now)` give the ceiling test and the time with
   its `, past 5m` suffix, with the elapsed time clamped at zero (grafted from
   the most-robust plan) so a stamp in the future never prints a negative
   time. The line's part and the pane rows both use these two helpers.
3. **The line as segments.** The inner line builders return `LineSegment[]`
   (`{ text, isBackground, isPast }`); `fitLine` and `withWarning` take and
   return segments, cutting across them in order and dropping a segment the
   cut emptied; `withWarning` strips the `builder: ` prefix from the first
   segment only, so the stale sentence and a yellow part draw together.
   `abovePromptSegments` and `secondRowSegments` are exported, and
   `abovePromptLine` and `secondRow` return their joined text, so the string
   and the segments agree by construction. `runningPart` replaces the count
   with the oldest task named by description, else command, through
   `printable`, prefixed `waiting on: ` when it is the only part and
   `background: ` otherwise, ending ` and <n> more` when several run.
   `bandTree` draws the line button with today's plain string label unless a
   segment is past the ceiling, and only then draws three children, the text
   before, the part as a yellow `Text`, and the text after (grafted from the
   simplest plan, because that is the spec's wording and it keeps every
   existing text assertion on the button identical).
4. **The next step.** `nextStep` gains the background reason after running
   agents and before the pull request's states, with the noun chosen as the
   count chooses it today (moved into a small `backgroundNoun` helper), and
   leaves it out when the line already names the task. `waitingOn` and the
   `WaitingOn` type do not change, because `waitingOn` keys the poll interval
   and the spec asks for no poll change.
5. **The pane rows.** `backgroundLine(task, now)` appends ` · <taskTime>`, and
   `agentsTree` draws a past-ceiling row in yellow.
6. **The record.** `namedTasksOf(f, now)` sorts every task in flight by
   stamp, maps each to its cleaned or withheld text with its stamp, drops
   empty text, keeps three, and returns `{ tasks, taskSince }` where
   `taskSince` is the stamp of the first kept task; `recordOf` writes
   `backgroundOnly` as `{ since, tasks, taskSince }` in that fixed order and
   spreads `taskSince` in only when it exists, so a record with no named task
   has no such key and foreman's existing equality tests stay green.
   `version` stays `1`.
7. **Foreman.** `backgroundOnlyIn` in `mods/foreman/hooks/record.ts` reads
   `taskSince` with `timeOr` and includes it only when finite.
   `waitingWords(row, now)` in `mods/foreman/hooks/subs.ts`, beside
   `staleWords`, gives `waiting on: <printable(tasks[0], 120)> (<ageWords(now
   - taskSince)>)` or null, and `stateWords` in `mods/foreman/hooks/pane.tsx`
   pushes it after the reason and before the stale words. Nothing else in
   foreman changes.
8. **The README files.** Builder's README describes the new line part and its
   two prefixes, the next step's new reason, the pane rows' time, the ceiling
   and the suffix, what the time measures (the wait since builder first saw
   the task, which runs short of the real run time), that `past 5m` parts
   company with foreman's nudge when a project sets `idleMinutes`, and the
   record's ordered `tasks` and `taskSince`. Foreman's README gains one
   sentence on the row's new words.

## Rejected alternatives

- **Moving `taskKeyOf` from `status.ts` to `state.ts` with a re-export** (the
  most-robust and most-extensible plans). The judge checked the imports:
  `status.ts` imports from `state.ts` and nothing imports the other way, so a
  merge beside `taskKeyOf` in `status.ts` creates no cycle. The move would be
  churn with a re-export to keep, for no gain.
- **A `liveTick` self-heal with an `isStamping` flag** (the most-robust plan),
  to re-stamp tasks an older build's in-flight `replaceBackground` might
  write after a hot reload. The reload drops the old module's in-flight
  calls, the next `Stop` re-stamps through the merge anyway, and the self-heal
  would add a third writer and in-memory state inside a tick whose own
  comment forbids an `await` between its check and its decisions.
- **Falling back to the task's type when both description and command are
  empty** (the most-robust plan). The spec names description then command
  only, as the pane rows do today.
- **Marking only the yellow part in the segments** (the simplest plan). The
  spec's verification checks that the segments helper marks the background
  part and that a cut inside the part keeps the remainder marked, which
  must be testable under the ceiling as well as past it, so the segment
  carries `isBackground` and `isPast` separately.
- **Giving the button children whenever a background task exists** (the
  most-extensible plan as first written). The spec says the button takes a
  plain string today and three children only past the ceiling; keeping the
  plain label otherwise also keeps every existing text assertion identical.
- **A new `WaitingOn` value for background work.** `waitingOn` keys the poll
  interval, so a new value would change polling, which the spec does not ask
  for; the reason is computed in `nextStep` instead.

## Step sequence

Each step writes its tests first and sees them fail before making them pass.
The gates run after steps 4, 6 and 7.

1. **Types and the merge.** Add `seenAt?` to `BackgroundTask` and `taskSince?`
   to `backgroundOnly` in `mods/builder/types/index.d.ts`, with comments. Add
   `mergeBackground` and `sortedByFirstSeen` to `status.ts`. Tests in
   `mods/builder/tests/status.test.ts`: a present task keeps its stamp, a new
   task is stamped with `now`, a missing task is dropped, matching is by id
   and by kind plus description, duplicates share the first stamp, a
   non-finite stamp reads as missing, the engine's order is kept, and the
   sort is stable.
2. **The record.** Rework `namedTasksOf` and `recordOf`. Tests in
   `status.test.ts`: `tasks` oldest first whatever the list order, the wait's
   own first on ties, `taskSince` equals the stamp of the task `tasks[0]`
   names even when an older task with an empty description is skipped, no
   `taskSince` key when every description is empty, the key order `since,
   tasks, taskSince`, and the existing older-memo test unchanged.
3. **The line, the next step and the rows.** Add the ceiling, the two time
   helpers, the segment type, the segment-based builders, the new part, the
   next-step reason and the row time in `pane.tsx`. Tests in
   `mods/builder/tests/pane.test.ts`: one task alone reads `waiting on: <name>
   (<time>)`; beside a slow call or a running agent it reads `background:
   <name> (<time>)`; three tasks add ` and 2 more`; one millisecond under five
   minutes has no suffix and exactly five minutes has `, past 5m`; the
   segments mark exactly one background segment, their texts join to the
   string across a grid of views and widths, a cut inside the part keeps the
   remainder marked, a cut before the part leaves nothing marked, and the
   stale warning leads with the rest after it; `nextStep` reads `waiting on
   its background command` alone, comes before `waiting on checks` with
   pending checks, chooses `commands`, `task` and `tasks` by count and kind,
   and is left out when the running part is shown; `backgroundLines` end with
   the time and a past row carries the suffix. The seven existing assertions
   that read `1 background command` change to the new words.
4. **The hooks.** Change `replaceBackground`, add the `session.start` stamping
   write, and pass segments to `bandTree`, which draws the children only past
   the ceiling. Tests in `mods/builder/tests/register.test.ts`: a `Stop` with
   tasks writes stamps equal to the clock; a second `Stop` keeps them and
   stamps a new task at its own time; a reload over an older build's stored
   list stamps it at start, allowing for the one extra store read; with the
   band live, advancing the clock five minutes turns the line's button into
   children with a yellow `Text` and before that it is a plain label; the
   pane's first background row is yellow at the ceiling and plain before it;
   a ticketed session leaving its own turn writes `taskSince`. The 28
   existing assertions that read `1 background command` change. Run the four
   gates in builder.
5. **Foreman.** Add the tolerant read and `waitingWords`, and push it in
   `stateWords`. Tests in `mods/foreman/tests/record.test.ts` and the pane
   and subs tests: `taskSince` is read when finite, dropped when not, absent
   when missing; the row's words gain `waiting on: run the tests (7m)` with
   the field and stay as today without it or without `taskSince`; a stale row
   keeps its dimming.
6. **The README files**, as the chosen approach's point 8 says. Run the four
   gates in both mods.
7. **The verify loop** over every gate, then the pull request.

## Test plan against the spec's Verification

- The line: step 3.
- The list merge: step 1.
- The pane rows: step 3.
- The record: step 2.
- Hook-level: step 4.
- Foreman: step 5.
- The README files: step 6, checked by the reviewers, since no gate reads
  them.
- The gates: steps 4, 6 and 7.
- By hand: the spec's `sleep 600` check is left to the person, because it
  needs a live session with a watched pull request.
