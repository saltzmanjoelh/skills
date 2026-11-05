# The read sets the raised-slot mark again only on a parent that is on

Date: 2026-11-04. Issue: a follow-up that the counsel filed from the change
that makes a raised slot, which no waiting session can take, wake the parent
with the kept sentence (see
`docs/specs/foreman-raised-slot-wakes-when-list-hides-waiting.md`).

## Goal

Two places set foreman's raised-slot mark. `applyCommand` in
`mods/foreman/hooks/register.tsx` sets it when the person raises the count on
a parent that is on. `decideNow` in the same file sets it a second time, in
the line after its ledger update, when the stored count rose while the read
was under way, because that read decided the raise with the old count and
cleared the mark. The spec of the mark named only the first setter, so a
maintainer who trusted it could remove the second, which reopens that race,
or change it without knowing why it exists. The second setter also never
checks that the parent is on, which the first one does.

This change makes the second setter follow the same rule as the first, and
writes both setters into the spec of the mark.

## Users and trigger

A maintainer who reads the spec of the mark before changing either setter,
and the parent session's model, which gets the kept sentence the mark leads
to. The code case needs a raise that lands while a read is under way, on a
session whose parent settings read as off when the read reads them again
after its ledger update.

## Behavior

1. **The read's setter checks the parent.** After its ledger update,
   `decideNow` reads the parent settings once, keeps them in a variable, and
   sets the mark again only when that parent is on and its count is higher
   than the count the read used. A parent that is off gets no mark, whatever
   its count.
2. **The rule stays at each setter.** `applyCommand` is not changed. Each
   setter carries a comment that names the other, so that a change to one is
   made to both.
3. **The spec of the mark names both setters.**
   `docs/specs/foreman-raised-slot-wakes-when-list-hides-waiting.md` is
   amended in place: its first Behavior item names both setters and the rule
   they share, an edge case covers a raise that lands while a read is under
   way, and its Verification names the test of the read's setter. This spec
   states the change and points there.

## Edge cases

- A raise that lands while a read is under way, on a parent that is on: the
  read sets the mark again, and the next read decides the raise with the new
  count, as today.
- The same raise, when the parent reads as off after the ledger update: no
  mark is set. No foreman command turns a parent off today; only
  `session.start`, loading a stored parent, can make the settings read as
  off.

## Non-goals

- Clearing a mark already in the ledger of a session that is not on. Such a
  mark is never read while the parent is off, because `readAndSchedule`
  returns before it reads anything, and the first read that gets the list
  after the parent is on again clears it.
- Any command or path that turns a parent off.
- Any change to how the read in `decideNow` clears the mark, or to the setter
  in `applyCommand`.
- Any shared function for the rule.
- Any rewrite of the earlier change's plan,
  `docs/specs/foreman-raised-slot-wakes-when-list-hides-waiting-plan.md`,
  which stays a record of how that change was planned.
- Any change to what the kept sentence says or when it is sent.

## Failure modes

- If reading the parent settings again fails, the read fails as it does
  today, after its ledger update was written; nothing new can fail.
- If the ledger write that sets the mark again fails, it is caught as today
  and that raise gets today's silence.

## Verification

- A new test in `mods/foreman/tests/queued.test.ts`, written first and seen
  to fail against today's code: a raise lands while a read is under way, and
  when the read reads the parent again after its ledger update, a hook on
  `state.get` answers a parent that is off with the higher count. The ledger
  then holds no mark.
- The existing test 'a raise that lands while a read is under way is decided
  by a later read, which sends the kept sentence' still passes, as the test
  that a parent that is on gets the mark again.
- Every gate in the project's `CLAUDE.md` passes for builder and foreman.

## Decided by the counsel

- The read in decideNow (mods/foreman/hooks/register.tsx) sets the raised-slot mark again after its ledger update whenever the stored slot count rose during the read, but unlike the setter in applyCommand it does not check that the parent is on. Should this second setter also require the parent to be on? The counsel chose: Yes: read the parent settings once after the ledger update, and set the mark again only when that parent is on and its count is higher than the count the read used, as the setter in applyCommand checks. Add a test, and describe both setters in the spec of the raised-slot mark. 6 of 7 members voted for it.
- Where should the description of the second setter of the raised-slot mark (the one in decideNow, now to require a parent that is on) be written? The counsel chose: Amend the existing spec docs/specs/foreman-raised-slot-wakes-when-list-hides-waiting.md in place: Behavior 1 names both setters and the one rule they share, an edge case covers a raise that lands while a read is under way, and Verification names the test of the read's setter. The new spec for this change only states the change and points there. 6 of 7 members voted for it.
- Both setters of the raised-slot mark will now follow one rule: set the mark only on a parent that is on, and only when its count is higher than the count used before. Should that rule live in one shared function that both setters call, or stay written inline at each setter? The counsel chose: Inline at each setter: the read in decideNow keeps the re-read settings in a variable and checks isOn and the count in its own condition, applyCommand stays as it is, and a comment at each points to the other. 4 of 7 members voted for it.
- What should this change explicitly leave out, so reviewers have a written reason to stop? The counsel chose: Leave out: clearing a mark already in the ledger of a session that is not on; any command or path that turns a parent off; any change to how the read in decideNow clears the mark or to the setter in applyCommand; any shared function for the rule; any rewrite of the earlier change's plan; and any change to what the kept sentence says or when it is sent. 7 of 7 members voted for it.
- Which tests should verify the new check that the read's setter of the raised-slot mark makes, that the parent is on? The counsel chose: One new test in mods/foreman/tests/queued.test.ts: a raise lands while a read is under way, and when the read reads the parent again after its ledger update, a state.get hook answers a parent that is off with the higher count; the ledger then holds no mark. It is written first and seen to fail against today's code. The existing test of a raise during a read stays as the test that a parent that is on gets the mark again. Both are named in the amended spec's Verification, and every gate passes. 7 of 7 members voted for it.
