# A failed list read keeps a freed slot for foreman's queue

Date: 2026-10-31. Issue: two follow-ups from the review of the change that
made foreman begin queued issues by itself when a slot frees (see
`docs/specs/foreman-starts-queued-issues.md`).

## Goal

A read of the desktop app's sessions list can fail on the same read in which
an active sub session's status file leaves the folder, which frees its slot.
Foreman then cannot claim the slot for a waiting issue, because a claim needs
the list to show the waiting session unarchived. Today the freed slot is left
over, so `decide` in `mods/foreman/hooks/act.ts` wakes the parent with "one
slot free; pick the next issue and start it." while an issue still waits in
the queue. The parent may then start an issue the person never queued, which
foreman queues behind the waiting one, and a read later the person is told
the queued issue began. A failed list read must never tell the parent to pick
a new issue while the queue holds one.

A second, smaller change: the regular expression `UNWATCHED_SHAPE` in
`mods/foreman/hooks/tickets.ts` also checks the target of a stored begin
message, so its name and comment describe only one of its two uses. A
maintainer who tightened the unwatched rule there would change, without
knowing it, which sessions a begin message may reach.

## Users and trigger

The parent session's model, which acts on every `foreman:` line, and the
person whose queue it serves. The failure needs the list read to fail, for
example because the desktop app's tool times out, on the read that sees a
merged sub session's status file gone. The rename matters to whoever edits
`tickets.ts`.

## Behavior

1. **A freed slot is carried over when the list could not be read.** On a
   read whose list was not read, after the queue's own step, each name left
   in the freed-slot list is a freed slot that no claim filled. When at least
   one sub session waits in the queue unclaimed, as `waitingUnclaimed` counts
   them, those names are added to a new ledger field, after any names already
   there, and this read adds no slot-free reason for them. The log says, for
   each, that foreman keeps the slot for the queue until the list can be
   read.
2. **The next read that reads the list decides it.** On a read whose list was
   read, the carried names go first in that read's freed-slot list, before
   the names of slots this read frees, and count as slots this read freed.
   The field is emptied. From there everything is as it is today: each claim
   takes the first name, so the begin line names the sub session whose slot
   it took, and a name left over wakes the parent with the slot-free line,
   with the number of slots free counted as today.
3. **Carried names are spent when nobody waits any more.** On a read whose
   list was not read, when no sub session waits in the queue unclaimed, the
   carried names count as slots this read freed and are handled as today: a
   name left over wakes the parent. The field is emptied. So a freed slot is
   never lost, even when the waiting issue began by itself or was forgotten
   before any list was read.
4. **The new field is read tolerantly.** A ledger written before the change
   has no such field and reads as holding none. Only strings that a wake line
   may carry as a name, as `isWhoName` decides, are kept, at most
   `MAX_PAIRINGS` of them, the newest.
5. **When the list was read, nothing changes.** In particular, a freed slot
   that the list does not let any waiting session take still wakes the
   parent at once, as the test "a freed slot that no waiting sub session can
   take, because the list leaves it out, still wakes the parent" checks.
6. **The texts that state the wake rule say the same.** The doc comment on
   `decide`, the foreman README's section on slots, Release and nudge and its
   section on the queue, and the "one slot free" section of
   `mods/foreman/skills/wake/SKILL.md` say that the slot-free line can come
   on a later read than the one that freed the slot, when that read could not
   read the list while an issue waited.
7. **The rename.** `UNWATCHED_SHAPE` becomes `WHOLE_LOCAL_ID`, and its comment
   says it is a whole desktop session id with nothing around it, which is all
   an unwatched entry and a begin message's target may be. Every use is
   updated; it is not exported and no test names it.

## Edge cases

- Several failed reads in a row, each freeing a slot: the names pile up in
  order and are all decided by the first read that reads the list.
- Two slots freed on one failed read with one unclaimed waiting session: both
  names are carried, and the next read that reads the list claims one and
  wakes the parent for the other, as it would have on the failed read with
  the list.
- The waiting session is archived or missing from a whole list by the time
  the list is read: `queueStep` drops or holds it, no claim takes the carried
  name, and the parent is woken for the slot.
- The only waiting sessions are claimed ones, whose begin message has not yet
  gone: they already count as busy, so nothing is carried and the freed slot
  wakes the parent at once, as today.
- The ledger is reloaded between the failed read and the next one: the field
  is stored, so the carried names survive.

## Non-goals

- The real desktop run of a queue of two issues, and the stall when a waiting
  session falls off the app's list of recent sessions. Both were filed with
  these items and need the person; they stay open elsewhere.
- Changing the deliberate wake when the list was read but does not show the
  waiting session surely unarchived.
- Reading the list again within the same read after it fails.
- Any change to how many slots are free, to `startWaits`, or to the text of
  any wake line.

## Failure modes

- If the list keeps failing while an issue waits, the carried names wait with
  it and the parent is not told to pick a new issue. That is the point: the
  queue owns the slot, and the log says each time why nothing moved.
- If the ledger write after the failed read fails, the carried names are lost
  as every other change of that read is, and the next read sees the slot as
  already free: a waiting session the list shows still claims it, with no
  name in its begin line.

## Verification

- A test in `mods/foreman/tests/queue.test.ts`, written first and seen to
  fail: a sub session's file leaves on a read whose list read failed while an
  unclaimed issue waits, and the decision has no slot-free reason and carries
  the name.
- Tests for the read after it: one whose list shows the waiting session
  claims it with the carried name in the begin effect and wakes nobody; one
  whose list leaves it out wakes the parent with one slot free; one where no
  session waits any more, on a failed read, spends the carried name with a
  wake.
- A test that a stored ledger without the field, and one with bad entries in
  it, read as holding only the good names.
- Every gate in the project's `CLAUDE.md` passes for builder and foreman.

## Decided by the counsel

- When foreman's read of the desktop app's sessions list fails on the same read in which an active sub session's status file leaves (so a slot frees), and an unclaimed issue waits in foreman's queue, what should that read do with the freed slot instead of waking the parent with "one slot free; pick the next issue and start it."? The counsel chose: Carry the freed slot's name over in foreman's ledger to the next read that reads the list, and let that read decide it exactly as if the slot had freed then: claim it for the waiting issue with the name, or wake the parent under the existing rule when the list does not show the waiting session surely unarchived. This adds a ledger field that is read tolerantly. 6 of 7 members voted for it.
