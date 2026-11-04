# Plan: a raised slot that no waiting session can take

Date: 2026-11-04. Spec: `docs/specs/foreman-raised-slot-wakes-when-list-hides-waiting.md`.

## Chosen approach

The most-robust plan won. One true-or-false mark, `slotsRaised`, is added to
foreman's stored ledger. `applyCommand` sets it when it stores a count higher
than the one in force on a parent that is already on. `decide` keeps it only
on a read whose list failed and clears it on every other read, in the line
that builds the read's base ledger. The existing wake block gains a second way
in, taken only when the mark was set, the read got the list, and an issue
still waits unclaimed. Nothing inside the block changes, so the kept sentence,
the cap of no more names than free slots, and the five-minute `keptAt` hold
are all reused as they are.

## Grafts

- From the simplest plan: the mark is set with a plain
  `.catch(() => undefined)`. `persistTickets` already logs a store write that
  fails, so a second log line would repeat it, and its wording would be wrong
  for the only other failure, a state update that throws. The catch keeps the
  command's answer and its scheduled read.
- From the most-extensible plan: a `withSlotsRaised` setter beside
  `withOffRefusal` in `tickets.ts`, which returns the ledger itself when the
  mark is already set, so `writeTickets` writes nothing for a change that
  changes nothing.
- From the judge: the wake's second way in requires `sessions.kind === 'read'`,
  not merely a list that did not fail. `decideNow` checks `needsList` against
  a ledger read before the update, while `decide` runs on a fresher one, so a
  waiting entry added in between could otherwise meet a read that never asked
  for the list, and the kept sentence would say foreman could not find a
  session in a list it never read. The mark is still cleared on that read, so
  a stale raise cannot wake the parent long after.

## Rejected alternatives

- Clearing the mark only on a read that got the list. A raise into an empty
  queue makes reads that do not ask for the list, so the mark would linger
  and could wake the parent when a queue formed much later, which the spec's
  third behaviour forbids.
- Making `needsList` ask for the list while the mark is set. It adds a list
  call that does not happen today, and a failed call would raise the
  list-failure notification for a raise into an empty queue.
- Clearing the mark after the wake block under its own condition. It puts the
  clear in a second place that a later early return could skip; the base
  ledger line covers every path.
- Logging a failed mark write in `applyCommand`. It repeats the log that
  `persistTickets` writes.
- An `isRaise` helper in `parent.ts`. It is a one-line comparison.
- Moving the `session.start` emptiness check into an `isTicketsEmpty` helper
  in `tickets.ts`. It would make a forgotten field less likely, but it is a
  refactor the spec does not ask for. It is a possible follow-up.
- Storing the raised count or a raise time in the mark, to close the race
  below. A stored count breaks the raise-then-lower edge case, and a time
  brings clock and damaged-number cases.

## Steps

1. Write the tests below in `mods/foreman/tests/queued.test.ts` and see the
   new-behaviour ones fail.
2. `mods/foreman/types/index.d.ts`: add `slotsRaised: boolean` to
   `ForemanTickets`, with a sentence in its comment saying it records that the
   person raised the slot count on a running parent and no read that got, or
   did not need, the desktop app's list has decided the raised slots since.
3. `mods/foreman/hooks/tickets.ts`: add `slotsRaised: false` to
   `TICKETS_EMPTY`; read `slotsRaised: t.slotsRaised === true` in `ticketsIn`,
   saying in its comment that a ledger from before the mark reads with it
   unset; add `withSlotsRaised`.
4. `mods/foreman/hooks/register.tsx`:
   - In `applyCommand`'s `slots` branch, set a `raised` flag inside
     `writeParent`'s change function on every run, as
     `p.isOn && command.count > slotsOf(p, currentOptions.slots)`, so the last
     run counts. `slotsOf` matters because a stored null means the option's
     count or the default, which is what reads count.
   - Inside `if (wasOn)`, before `later($, () => readNow($))`, run
     `if (raised) await writeTickets($, withSlotsRaised).catch(() => undefined)`.
     The `becomeParent` path is untouched, so it sets no mark.
   - Add `&& !held.slotsRaised` to the `isEmpty` check on `session.start`.
5. `mods/foreman/hooks/act.ts`, in `decide`:
   - In the line that builds the base ledger with `keptSlots: []`, add
     `slotsRaised: sessions.kind === 'failed' && input.tickets.slotsRaised`.
   - Before the wake block, `const raised = input.tickets.slotsRaised && sessions.kind === 'read'`.
     It reads the input ledger, because the base ledger has already cleared
     the field.
   - Change the guard to
     `(freed > 0 && left.length > 0) || (raised && unclaimed.length > 0)`.
   - Add a sentence to `decide`'s comment on the raised-slot path and on why
     clearing on a read that did not ask for the list is safe: `needsList`
     asks whenever the queue is not empty.
6. `mods/foreman/README.md`, queue section, after the sentence on a raised
   count while the list cannot be read: a slot that a raised count adds, which
   no waiting session can take, wakes the parent once with the kept sentence
   on the first read that gets the desktop app's list, and a raise while
   nobody waits unclaimed adds nothing to the command's own answer.
7. Run every gate in the project's `CLAUDE.md` for builder and foreman.

## Test plan

All in `mods/foreman/tests/queued.test.ts`. Waiting sessions that the list
does not show surely unarchived use the existing `doubtful` helper: leaving a
known id out of a complete list drops its pairing as missing, which never
reaches the wake.

1. **A raise with hidden waiting sessions.** `queueOfTwo`, then the list shows
   ABC-1 listed and ABC-2 and ABC-3 doubtful; `foreman($, '2')` and settle.
   The prompts are exactly the kept sentence naming ABC-2, nothing is begun,
   ABC-2's pairing has `keptAt` and ABC-3's has none, and the mark is clear.
   Three more minutes send no second prompt. Fails today.
2. **A proposal card under five minutes.** One slot, ABC-1 started and ABC-2
   started as a card, the list showing ABC-1; after a minute,
   `foreman($, '2')` and settle. The prompts are the kept sentence naming
   ABC-2, and the card's pairing has `keptAt`. Fails today.
3. **The list fails, then comes back.** `queueOfTwo` with doubtful waiting
   sessions and the list refused; `foreman($, '2')`, settle and a minute. No
   prompt, the mark is set, and the only notice is the list-failed one. The
   list comes back and a minute passes: exactly one kept sentence naming
   ABC-2, and two more minutes add none. Fails today.
4. **A raise, then a lowering before the read.** `queueOfTwo` with doubtful
   waiting sessions; `foreman($, '2')`, `foreman($, '1')`, settle and a
   minute. No prompt, and the mark is clear.
5. **A raise with an empty queue.** One slot and no starts; `foreman($, '3')`
   and settle. No prompt, no dry-queue report, and the mark is clear.
6. **A count to a session that is not yet a parent.** A store with an off
   parent of one slot and a ledger holding one waiting pairing shown doubtful;
   `foreman($, '3')` and settle. No prompt is sent, which a wrongly set mark
   would cause, and the mark is clear.
7. **A ledger that holds only the mark survives `session.start`.** Two cases,
   modelled on the reload tests in `acts.test.ts`: a ledger left in state that
   holds only the mark against an older stored ledger, after which an off
   start is refused as off and the mark is still set; and a stored ledger of
   only `{ slotsRaised: true }` with nothing in state, after which the mark is
   still set. Both fail today.
8. Every gate in the project's `CLAUDE.md` passes for builder and foreman.
   The gates do not read the README or `docs/`.

## Risks

- `decideNow` reads the slot count outside the ledger update, so a read
  already under way when the raise lands decides the mark with the old count
  and clears it. The review found this, so after its ledger update the read
  reads the slot count again, and when the count rose meanwhile it sets the
  mark again, so the next read decides the raise with the new count.
- A failed mark write, a reload between the count's write and the mark's,
  or two copies writing the same stored ledger each lose the mark. All fail
  toward today's silence, never toward a second wake.
- The raise path in the wake block depends on `unclaimed.length > 0` to stay
  out of the dry-queue branch. Test 5 guards it.
