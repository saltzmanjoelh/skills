# Foreman counts a background wait from progress, and watches on first use

Written 2026-10-30. Seeded from an issue in the owner's tracker that holds
two follow-ups of the change that keeps a sub session from stalling unseen
(see `docs/specs/no-sub-session-stalls-unseen.md`). The counsel decided to
file both, 7 of 7 each, and the owner later narrowed the issue to exactly
these two. The issue settled what each problem is and that both are to be
fixed, and no product question was left open, so no question was put to
the counsel or the owner.

## Goal

Foreman exists so that a `/implement` sub session never sits stuck without
someone being told. Two gaps remain in the rules that the earlier change
added.

1. **An early nudge after progress during a turn.** A sub session that waits
   only on background work is nudged after `idleMinutes`, again after
   another `idleMinutes`, and then the parent is woken. When the sub session
   makes progress during a turn of its own (for example answering a nudge
   and moving on to another stage) while the same background task keeps
   running, foreman's `working` rule in `mods/foreman/hooks/act.ts` throws
   the stretch away. When that turn ends and the record waits only on
   background work again, a fresh stretch counts from the wait's original
   start rather than from the progress, so the sub session is nudged again
   at once and the parent is told about five minutes early. The claim
   checker of the earlier change reproduced nudges at 5, 9 and 14 minutes
   and a wake at 19, instead of about 14, 19 and 24.
2. **A stall on first use.** Builder writes status files into
   `<config>/foreman/builds`, and nothing creates that folder before builder
   writes its first file there. Foreman's five-minute "no status file" wake
   runs only on a read that listed a folder that exists. So on a machine, or
   under a configuration folder, where no sub session has ever written a
   status file, a sub session started without builder writes nothing, the
   folder never appears, the wake never comes, and foreman still keeps that
   sub session's turn-end notes from the parent. Nobody is told.

## Users and trigger

The owner runs a parent session with foreman, which starts `/implement` sub
sessions that run builder. The triggers are a sub session whose only running
work is background tasks and that makes progress in a turn of its own, and a
started sub session whose ticket no status file carries while the status
folder does not exist.

## Behavior

### A background stretch counts from progress seen during a turn

1. While a stretch of a background wait is being counted for a pairing, and
   a read finds the record `working` without the `backgroundOnly` field (a
   turn of its own is running) and with progress since the stretch began,
   foreman does not throw the stretch away. It keeps the stretch for the
   same wait, takes the new progress as the stretch's progress, sets the
   number of nudges back to zero, forgets the last nudge's time, clears
   the flag that says the stretch already woke the parent, and counts from
   the time of that read.
2. When the record next waits only on background work with the same
   `since`, the stretch goes on counting from that read: the first nudge
   comes `idleMinutes` after the read that saw the progress, the second
   `idleMinutes` later, and the wake `idleMinutes` after that.
3. When the record next waits on background work with a different `since`,
   it is a new wait and starts a fresh stretch, as today.
4. A stretch of idleness (one whose wait is none) is not changed: progress
   during a `working` record still ends it, as today, and the next idle
   episode counts from that episode's own start.
5. A `working` record without the field and without progress keeps the
   stretch as today, so the short turn that answers a nudge does not reset
   the count.

### The "no status file" wake runs when the folder is missing

6. A read whose listing found that the status folder does not exist runs
   the "no status file" wake for pairings with no owner exactly as a read
   of an existing, empty folder does. A missing folder holds no status
   file, so every such pairing is judged as one that no status file carries:
   an active pairing with a desktop session id and no owner wakes the
   parent once, `GONE_MS` (five minutes) after it was paired, with the
   sentence `<who> has written no status file <n> minutes after it started,
   so foreman cannot watch it.`
7. A read whose listing failed for any other reason (`listed` false) still
   runs no such wake, as today, because the folder may hold files the read
   could not see.
8. Everything else that a missing folder holds back stays held back: no
   pairing with an owner is freed or forgotten, no merge is announced for a
   file that seems to have left, and a pairing with no owner is not
   forgotten after a day. Foreman still logs once that the status folder is
   missing.
9. Foreman writes nothing to the disk for this. It does not create the
   status folder.

### The README says so

10. `mods/foreman/README.md` says, in the `working` row of its table, that
    progress during a turn of the sub session's own starts the count again
    from the read that saw it, and, in the paragraph on a sub session that
    writes no status file, that a read which found the status folder
    missing counts as one that found no file, while a listing that failed
    for another reason does not.

## Edge cases

- A sub session whose progress comes in the same read as its background
  wait (the record has the field and new progress) already counts from that
  read today, and keeps doing so.
- A sub session that makes progress in a turn of its own after the stretch
  already woke the parent gets a new stretch for the same wait, so a wait
  that is still hung after further progress is reported again. That is
  accepted for the same reason the earlier change accepted repeated reports:
  telling the parent too often is harmless where staying silent is not.
- A status folder that disappears after builder wrote files in it: pairings
  with owners keep their slots, as today, and a pairing with no owner wakes
  the parent at five minutes, which is true, since no file carries its
  ticket.
- A pairing with no desktop session id, from a proposal card that may never
  have started, is still left out of the wake whether or not the folder
  exists.
- The folder appears between two reads: the next read lists it, and the
  wake already given is not given again, because the pairing records it.

## Non-goals

- Creating the status folder, in foreman or in builder. The engine has no
  call that only creates a folder, so foreman would have to write a marker
  file into it. Worse, a foreman that recreates a folder someone removed
  would then read an existing, empty folder, and free the slot of every
  sub session whose file had been in it, which is exactly what the guard
  for a missing folder exists to prevent.
- Changing how idle stretches count, the thresholds, the nudge text or the
  wake sentences.
- Forgetting a day-old pairing with no owner while the folder is missing.
- The ledger field that a hot reload could miss, which the owner removed
  from the issue on purpose.

## Failure modes

- If the check for whether the folder exists itself fails, the read counts
  the folder as existing and the listing as failed, as today, so no wake is
  given on that read; the next read tries again.
- A sub session that is slow to write its first status file, more than five
  minutes after it started, wakes the parent once with the "no status file"
  sentence on first use, as it already does when the folder exists.

## Verification

- Foreman tests of `decide`, in `mods/foreman/tests/act.test.ts`:
  - A background wait from `T0`, nudged at 5 minutes, whose record is
    `working` without the field and with new progress at 9 minutes, and
    waits on the same background work again from 10 minutes, is nudged at
    14 and 19 minutes and wakes the parent at 24, not earlier. The test
    fails on the code before this change.
  - The stretch after that progress keeps the wait's `since`, has no nudges
    and counts from the read that saw the progress.
  - A background wait whose record changes `since` after such a turn starts
    a fresh stretch.
  - The existing tests for idle stretches, for the short turn that answers a
    nudge, and for progress seen within a background read pass unchanged.
  - A pairing with a desktop session id read with `folderExists: false`
    wakes once at five minutes with the "no status file" sentence and not
    again; read with `listed: false` it never wakes; a pairing with no
    desktop session id never wakes either way.
  - With `folderExists: false`, a pairing with an owner whose file is
    absent keeps its slot, and a pairing with no owner older than a day is
    kept.
- The gates in the project's `CLAUDE.md`.
