# Builder's background task id, checked against the real engine

Date: 2026-10-30.

## Goal

The change that made builder name the background work a session waits on (see
`docs/specs/builder-names-background-wait.md`) keys a background task's start
time by an id read in two places. When a Bash call moves to the background,
the `foreground` hook in `mods/builder/hooks/register.tsx` stores the call's
start time under the `backgroundTaskId` that the Bash result carries. At the
end of a turn, builder looks that start time up by the task's `id` in the
engine's list of background tasks. The tests supply both ids themselves, so
they cannot show that the engine gives the same value in both places. If it
did not, the lookup would miss without any error, and every backgrounded
command would count its running time from the end of the turn rather than
from its real start, so the time shown would read too short and the mark of
a probably hung command would come late.

The goal is to confirm once, against the real Claude Code engine, that the two
values are the same, to fix the lookup with a test if they are not, and to
record what the check showed in the Verification section of
`docs/specs/builder-names-background-wait.md`, which asks for this check.

## Users and trigger

The person who reads builder's line, builder's pane or a parent's foreman row
while a session waits on a backgrounded command, and the maintainer of
builder, who needs to know whether the key the start times use is sound. The
trigger is the one-time check that the earlier spec left open.

## Behavior

1. A check runs the real engine, not the test fixtures. It loads a throwaway
   probe mod that logs, for each of the session's tool calls, the result the
   engine returns, and, at each turn end, the `background_tasks` list the
   engine reports. It runs a session that starts a Bash command with
   `run_in_background` and then ends its turn while the command still runs.
2. The check passes when the `backgroundTaskId` in the Bash result equals the
   `id` of the same command in the turn-end list.
3. A command the person moves to the background part way through cannot be
   started by an unattended session, so the check reads the engine's own code
   for that path instead, and passes when the id that the engine returns in
   the result is the id it registers the task under.
4. When the check passes, builder's code does not change, and the Verification
   section of `docs/specs/builder-names-background-wait.md` records that the
   check was made, with the version of Claude Code it ran on, what each path
   gave, and how the second path was checked.
5. When the check fails, builder's lookup is changed to read the id that the
   turn-end list uses, a test in `mods/builder/tests/` shows a Bash result and
   a turn-end list in the shape the engine really gave and fails before the
   fix, and the record says what differed.

## Edge cases

- A task the engine reports without an id is keyed by its kind and
  description, as before. The check does not touch that rule.
- A command started by a subagent is not one of the session's own calls, so
  builder records no call start for it. The check covers only the session's
  own calls, which are the ones whose start builder records.

## Non-goals

- The missing context figure and the separate hand check of the running time,
  which the issue once held and which were removed from it on purpose.
- A test that runs the real engine on every change. The gates load the mods
  but run no session, and a probe that starts a real session costs a model
  call each time. The check is made once, and the record names the version
  it ran on.
- Keeping the probe mod in the repository. It is a throwaway, described in the
  record so that anyone can build it again.
- Watching for a later engine version that changes the ids. If that happens,
  the failure mode is the one the earlier spec already names: times read low
  and the mark comes late, never early.

## Failure modes

- If the check cannot run, because the engine refuses the probe or the session
  cannot start, the record says so and builder's code does not change, since
  no evidence of a mismatch exists.
- If a later engine version gives different ids, the running time reads too
  short until someone checks again. This change does not guard against that.

## Verification

- The check of behaviour 1 and 2 is run, and its two logged values are quoted
  in the record.
- The engine code for a command moved to the background by the person is read,
  and the record names what it showed.
- `docs/specs/builder-names-background-wait.md` records the result in its
  Verification section.
- If a fix was needed, its test fails before the fix and passes after it.
- The gates in the project's `CLAUDE.md` run. No gate reads `docs/`, so a
  change that touches only the specs is checked by its reviewers alone.
