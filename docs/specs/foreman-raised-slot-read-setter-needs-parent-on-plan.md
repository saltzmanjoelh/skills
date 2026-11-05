# Plan: the read sets the raised-slot mark again only on a parent that is on

Spec: `docs/specs/foreman-raised-slot-read-setter-needs-parent-on.md`.

## Chosen approach

Two planners worked blind, one aiming for the simplest change and one for the
most robust, and a judge compared them. Both made the same change to the code
and differed only in their test. The most-robust plan won, because its test
answers the parent as off inside a window whose edges the code fixes, so the
test does not depend on which part of the mod reads the parent first.

The code change, in `decideNow` in `mods/foreman/hooks/register.tsx`, replaces
the line after the read's ledger update with two lines. The first reads the
parent settings again into `settingsAfter`, a name that sits beside the
`settings` that the read took at its start. The second sets the mark only when
`settingsAfter.isOn` holds and its count is higher than the count the read
used. The read of the parent stays outside the `.catch` that guards the ledger
write, so a failed read fails the read as it does today.

The comment above those lines says why the setter exists and that it follows
the same rule as the setter in `applyCommand`. A comment sentence in
`applyCommand`, beside its own setter, says that `decideNow` sets the mark a
second time by the same rule, and that a change to one setter is made to the
other.

## Grafts

- From the simplest plan, the test also records, in its one `state.set` hook,
  whether any ledger write after the window opened carried the mark. That
  catches a mark that was set and later cleared before the final check, which
  the final check alone would miss.
- The test checks that the stored parent is still on with two slots, so the
  off answer is shown never to have reached the store.

## Rejected alternatives

- **A single off answer to the next read of the parent after the read's ledger
  write**, which the simplest plan proposed. The pane's view reads the parent
  on every draw, and a ticker redraws every second, so a render can take that
  one answer before the setter does. The setter then reads the real parent,
  which is on, and sets the mark, so the test fails with correct code
  depending on timing.
- **A window that closes at the next write of any key.** A retry of the
  ledger update, or another write, could close it early. The window closes at
  the write of `nextReadAt`, which `readAndSchedule` makes right after
  `decideNow` returns and also in its failure branch.
- **A check that no prompt follows after two more minutes.** That asserts a
  silence the spec does not ask this change to test.
- **A shared function for the rule**, rejected by the counsel in favour of the
  rule written at each setter with comments that name each other.

## Steps

1. Write the new test in `mods/foreman/tests/queued.test.ts`, next to the
   existing test of a raise during a read, and see it fail against today's
   code on its mark checks.
2. Change the setter in `decideNow` and its comment, and add the comment
   sentence in `applyCommand`.
3. Run the new test, the existing test of a raise during a read, and the whole
   foreman suite.
4. Run every gate in the project's `CLAUDE.md`.

## Test plan

The new test is named 'a raise that lands while a read is under way leaves no
mark when the parent reads as off after the read\'s ledger update'. It starts
from the same queue and list as the existing test of a raise during a read.

- One `state.set` hook. When the flag for a raise during a read is set and the
  read writes the ledger, the hook clears the flag, runs `foreman($, '2')`,
  opens the window, and then lets the read's ledger write go on. While the
  window is open, it records any ledger write that carries the mark. A write
  of `nextReadAt` closes the window.
- One `state.get` hook. While the window is open, every read of the parent
  answers a parent that is off with two slots, and the hook counts those
  reads.
- The checks: the raise ran, at least one read of the parent was answered as
  off, the window closed, no ledger write in the window carried the mark, the
  stored parent is still on with two slots, and the ledger holds no mark.

Against today's code, the setter reads the off parent with two slots, which is
more than the one slot the read used, and sets the mark, so the test fails on
its mark checks. The existing test of a raise during a read stays as the test
that a parent that is on gets the mark again.
