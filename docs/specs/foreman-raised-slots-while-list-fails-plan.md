# Plan: a raised slot count while the desktop app's list fails

Date: 2026-11-04. Spec: `docs/specs/foreman-raised-slots-while-list-fails.md`.

## Chosen approach

The simplest plan won. No code under `mods/foreman/hooks` changes. One test
goes in `mods/foreman/tests/queued.test.ts`, right after the test "raising
the slot count begins the waiting sub sessions in the new slots", and one
sentence goes in the README. The test reuses the file's helpers
(`queueOfTwo`, `minutesPass`, `begins`, `ledger`) and adds none.

## Grafts

- From the robust plan: check that the command answers `slotsAnswer(4)`,
  which proves the raise took the path of a parent that is already on, the
  path that schedules the read.
- From the robust plan: after the first good read, let two more minutes
  pass and check that nothing begins twice, as the existing raise test
  does.
- From the robust plan: check that the ledger keeps no slot name after the
  list returns, as well as while it fails.
- Added while writing this plan: raise the count to four, not three. One
  slot is busy and two sessions wait, so one new slot is left over, which
  exercises the spec's edge case of a raise that adds more slots than
  issues wait.

## Rejected alternatives

- A second deliberate break in `decide`'s wake condition. The judge found
  it would not make the no-wake check fail, because nothing is freed or
  kept in this case, so it proves nothing.
- Checking the begin messages sent to each waiting session by count. It
  adds nothing beyond checking that no session was begun.
- Placing the README sentence in the paragraph about begin messages that
  fail. The paragraph that already mentions raising the count is the
  natural place.
- A shared helper for raising the count, as a seam for the filed follow-up.
  It would wrap two lines; the follow-up's test can sit beside this one and
  use the existing `doubtful` helper.

## Steps

1. Write the test. While the list fails for three minutes after the raise,
   check: no session begun, no prompt to the parent's model, no slot name in
   the ledger, every waiting session's claim still empty, the only
   notification the list-failed one, and the pane showing the existing line
   that no queued issue was begun or dropped. Then the list returns and one
   minute passes: both waiting sessions begin, no prompt, one joined
   notification with both "in a free slot." sentences, no slot name in the
   ledger. Two more minutes: still only those two begins.
2. Run it and see it pass, since it pins behaviour that already holds.
3. Make the deliberate break: in `queueStep` in `mods/foreman/hooks/act.ts`,
   let `isShown` treat a failed list (`look === null`) as showing every
   session. Run the test, see it fail at the check that no session began,
   and revert the break so `git diff` on `act.ts` is empty.
4. Add the README sentence in the queue section's paragraph that begins "On
   every read while a slot is free", after the sentence that ends "as after
   the person raises the slot count with `/start-foreman <n>`.": "While the
   desktop app's list of sessions cannot be read, a slot that a raised
   count adds stays free and wakes nobody, and the first read that reads the
   list fills it."
5. Run every gate in the project's `CLAUDE.md`.

## Test plan

The test in step 1 covers the spec's Behavior points 1 and 2 and both edge
cases. Step 3 is the spec's check that the test can fail. The gates cover
the type checks, the mods' tests and their manifests; none reads the README,
so only the reviewers check its sentence.
