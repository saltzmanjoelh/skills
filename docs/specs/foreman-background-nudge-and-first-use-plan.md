# Plan: foreman counts a background wait from progress, and watches on first use

Spec: `docs/specs/foreman-background-nudge-and-first-use.md`.

## The tournament

Two planners ran blind to each other, one aiming at the smallest change and
one at the most robust. They arrived at the same code change in
`mods/foreman/hooks/act.ts`, so the judgment turned on the tests. The robust
plan wins, because its tests pin down the state the change leaves behind as
well as the timing: further progress in a second turn, a turn without
progress, an idle stretch's state, and a status folder that is missing, then
empty, then holds the sub session's file. It also proposes one end-to-end
test through the real folder read, which proves that a missing folder
reaches `decide` as a listing that succeeded. The simplest plan's
contribution is grafted: keep the rewrite of the existing missing-folder
test small, by changing only its line that read a missing folder.

## Chosen approach

Neither fix adds a stored field or changes the shape of the ledger. Both
reuse fields the ledger already holds and already reads back after a
reload, `stretch.countFrom` and `acts.unseenWoke`.

1. **The `working` rule.** When a record is `working` without the
   `backgroundOnly` field and its progress differs from the stretch's, the
   rule ends the stretch only when it is an idle stretch (`wait` null). For a
   stretch of a background wait it writes a stretch for the same wait, with
   the new progress, no nudges, no last nudge, `woke` false and `countFrom`
   set to this read. `idleRule` already keeps a stretch whose `wait` and
   progress match, and already counts from the latest of `since`, `countFrom`
   and `lastNudgeAt`, so it needs no change. A record that next waits with a
   different `since` gets a fresh stretch there, as today.
2. **`decide`, a pairing with no owner.** It returns unchanged only when the
   listing failed (`listed` false). The one-day forgetting keeps requiring
   `folderExists`. `unseenRule` then runs on a read that found the folder
   missing, where the rows are empty, so it wakes once at five minutes with
   the "no status file" sentence. Pairings with an owner keep the guard on
   `!folderExists || !listed`, so nothing is freed, forgotten or announced
   as merged.
3. `hooks/register.tsx` does not change. `readFolder` already answers
   `found: []` with `exists: false` for a folder that does not exist, which
   makes `listed` true, and answers `found: null` with `exists: true` when
   the listing or the existence check fails, which makes `listed` false.

## Rejected alternatives

- **Creating the status folder.** The engine has no call that only creates
  a folder, so foreman would write a marker file. A foreman that recreated a
  folder someone removed would then read an existing, empty folder and free
  the slot of every sub session whose file had been there, which the guard
  for a missing folder exists to prevent.
- **A helper that builds a fresh stretch,** shared by the `working` rule and
  `idleRule`. One repeated object literal costs less than a new name.
- **Counting from the end of the turn rather than the read that saw the
  progress.** It needs a new field, and the spec asks for the read.

## Steps

1. Write the tests below and see the new ones fail.
2. Change the `working` rule and the pairing branch in `decide`, with their
   comments, the `idleRule` and `unseenRule` header comments, and the
   `countFrom` comment in `mods/foreman/types/index.d.ts`.
3. Update `mods/foreman/README.md`: the `working` row of the table, and the
   paragraph on a sub session that writes no status file.
4. Run the gates.

## Test plan

In `mods/foreman/tests/act.test.ts`, after the `waiting` helper:

- Progress in a turn of its own at 9 minutes, after a nudge at 5, with the
  same background wait from 10 minutes: nudges at 5, 14 and 19 and the
  background wake at 24. It fails on the current code, which nudges at 10
  and 15 and wakes at 20.
- The stretch after that turn: same `wait`, no nudges, no last nudge,
  `woke` false, `countFrom` at that read, and no effects. A second turn with
  more progress moves `countFrom` to its own read, and a turn without
  progress leaves the stretch as it is.
- Progress in a turn of its own after the stretch woke the parent at 15:
  nudges at 22 and 27 and a second wake at 32.
- A turn with progress followed by a wait with a new `since`: a fresh
  stretch counted from the new `since`, with `countFrom` null.
- Progress in a working turn still ends an idle stretch, and the next idle
  episode counts from its own start.
- A pairing with a desktop session id read with `folderExists: false` wakes
  once at five minutes with the "no status file" sentence, not at four, and
  records `unseenWoke`.
- The existing test of pairings that never wake keeps its pairing with no
  desktop session id, its failed listing and its released pairing, adds the
  first and the last with the folder missing, and drops only its line that
  read a missing folder.
- A folder that is missing, then empty, then holds the sub session's file
  wakes the parent once.
- With the folder missing, a day-old pairing with no owner is kept and no
  "Forgot ticket" line is logged.

In `mods/foreman/tests/acts.test.ts`, whose test world can model a missing
folder: on first use, with no status folder, a started sub session that
writes nothing wakes the parent at five minutes.

The existing tests of idle stretches, of the short turn that answers a
nudge, of progress seen in a background read, and of a missing folder that
frees nothing must pass unchanged.
