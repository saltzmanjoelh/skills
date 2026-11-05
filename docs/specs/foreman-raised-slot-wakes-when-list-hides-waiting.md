# A raised slot that no waiting session can take

Date: 2026-11-04. Issue: the neighbouring case that the spec for a raised
slot count while the desktop app's list fails left out and filed on its own
(see `docs/specs/foreman-raised-slots-while-list-fails.md`).

## Goal

When the person raises the slot count with `/start-foreman <n>` on a running
parent, `applyCommand` in `mods/foreman/hooks/register.tsx` stores the new
count and schedules a read. While an issue waits unclaimed in the queue, that
read begins the waiting session in the new slot when the desktop app's list
shows it unarchived. When the read gets the list but the list leaves the
waiting session out, does not show it surely unarchived, or the waiting entry
is a proposal card started less than five minutes ago, the new slot is
neither claimed nor announced. `decide` in `mods/foreman/hooks/act.ts` runs
its wake block only when a slot freed by name on that read, and a raised slot
has no name, so the parent hears nothing and the slot sits unused.

A freed slot in the same state wakes the parent once with the kept sentence,
so that the parent can send the begin message by hand. A raised slot should
do the same, so that a free slot is never lost without a word, whichever way
it became free.

## Users and trigger

The person, who raises the count, and the parent session's model, which acts
on every `foreman:` line. The case needs an issue waiting unclaimed in the
queue, a raise of the count to more than the stored one on a parent that is
on, and a read that gets the list but cannot begin the waiting session in the
new slot.

## Behavior

1. **A raise leaves a mark.** When `applyCommand` stores a count higher than
   the stored one on a parent that is already on, it sets a mark in foreman's
   stored ledger (`ForemanTickets` in `mods/foreman/hooks/tickets.ts`), in its
   own ledger update right after `writeParent` stores the count. Whether the
   count is higher is decided from the old count that `writeParent`'s change
   function sees. A count equal to or lower than the stored one sets no mark,
   and a count given to a session that is not yet a parent sets none.
   A second setter covers a raise that lands while a read is under way:
   `decideNow` in `register.tsx` reads the slot count before its ledger
   update, so such a read decides the raise with the old count and clears
   the mark. After that update it reads the parent settings again and sets
   the mark again when that parent is on and its count is higher than the
   count the read used, so the next read decides the raise with the new
   count. Both setters follow one rule, the mark is set only on a parent
   that is on and only for a higher count, and each names the other in a
   comment (see `docs/specs/foreman-raised-slot-read-setter-needs-parent-on.md`).
2. **The first read that gets the list decides the mark.** That read makes its
   claims as today. If slots are then still free and an issue waits
   unclaimed, the read runs the existing wake block as a freed slot does: it
   wakes the parent once with the existing kept sentence, naming the waiting
   keys in the queue's order but never more than there are free slots, and
   stamps the named waiting sessions with `keptAt`, so their slots are held
   for five minutes, as `docs/specs/foreman-kept-slot-reservation.md` says.
3. **Every read but a failed one clears the mark.** The read clears it in
   the ledger it already writes, whatever it decides, so a later read never
   decides the raised slots again. A read that did not ask for the list
   clears it too, because the list is asked for whenever anyone waits in the
   queue, but only a read that got the list can wake the parent for it. A
   read whose list fails leaves the mark in place, and wakes nobody, as
   `docs/specs/foreman-raised-slots-while-list-fails.md` says.
4. **Nothing waits, nothing is said.** When that read finds slots still free
   but nobody waiting unclaimed, because the queue is empty, every waiting
   session was claimed, or the only waiting entry is a proposal card nobody
   started for more than five minutes, it clears the mark and says nothing,
   as a raise does today. The dry-queue report stays tied to slots that a sub
   session freed.
5. **The README says so.** The queue section of `mods/foreman/README.md`
   says that a slot a raised count adds, which no waiting session can take,
   wakes the parent once with the kept sentence on the first read that gets
   the desktop app's list.

## Edge cases

- The person raises the count and lowers it again before the read: the mark
  stays, and the read decides with the free slots it counts, so no slot is
  free, nobody is woken, and the mark is cleared.
- The read that the raise schedules fails to get the list, and several reads
  after it fail too: the mark is kept across them, and only the first read
  that does not fail decides and clears it.
- The person raises the count while a read is under way, after it took the
  slot count and before its ledger update: that read clears the mark with
  the old count, then sets it again, because the parent is on and its count
  rose, so the next read decides the raise. A parent whose settings read as
  off at that point gets no mark.
- A sub session frees a slot on the same read that decides the mark: the
  read runs the wake block once, and the kept sentence names no more keys
  than there are free slots.
- A reload falls between the raise and the read: the mark is in the stored
  ledger, so the first read after the reload decides it. The emptiness check
  on `session.start` in `register.tsx`, which lists every ledger field,
  counts the new field, and `ticketsIn` in `tickets.ts` reads it, so a ledger
  that holds only the mark is not thrown away.

## Non-goals

- A slot whose five-minute hold for the kept sentence ran out while its
  waiting session still does not show. It stays silent, as the reservation
  spec decided.
- A count given to a session that is not yet a parent, which has no queue.
- Any new wake text, or a sentence of its own for raised slots.
- Any dry-queue report for a raise.
- Any wake while the list fails.
- Any change to how free slots are counted.

## Failure modes

- If the ledger write that sets the mark fails after the higher count was
  stored, that raise gets today's silence: the new slot is still filled by
  the first read whose list shows a waiting session, but no kept sentence is
  sent for it. The existing write-failure log records the failed write.
- If the list never comes back, the mark stays, the slot stays free and
  nobody is woken, as for a freed slot.

## Verification

Tests in `mods/foreman/tests/queued.test.ts`, each written first and seen to
fail against today's code where it describes new behaviour:

- With one slot, one session busy and two waiting, the count is raised to
  two, and the read gets a list that leaves the waiting sessions out. The
  parent's model gets exactly one prompt, the kept sentence naming the first
  waiting key, and that session is stamped with `keptAt`. A later read sends
  no second prompt.
- The same with the only waiting entry a proposal card started less than
  five minutes ago: the kept sentence names it.
- The list fails on the read the raise schedules and on the next read, then
  comes back leaving the waiting session out: no prompt goes while the list
  fails, and one kept sentence goes on the first read that gets the list.
- A raise and then a lowering before the read: no prompt, and the ledger
  holds no mark afterwards.
- A raise with an empty queue: no prompt, no dry-queue report, and the
  ledger holds no mark afterwards.
- A count given to a session that is not yet a parent leaves no mark. The
  mark is written only when the parent was already on before the command,
  so that check, rather than the comparison of counts, is what this test
  guards.
- 'a raise that lands while a read is under way is decided by a later
  read, which sends the kept sentence': the read's setter marks a parent
  that is on again, and the next read sends one kept sentence.
- 'a raise that lands while a read is under way leaves no mark when the
  parent reads as off after the read's ledger update': the read's setter
  checks that the parent is on.
- A ledger that holds only the mark survives a `session.start` reload.
- Every gate in the project's `CLAUDE.md` passes for builder and foreman.

## Decided by the counsel

- When the person raises foreman's slot count with /start-foreman <n> while an issue waits unclaimed in the queue, and the read that the raise schedules does get the desktop app's session list, but the list leaves the waiting session out, does not show it surely unarchived, or the waiting entry is a proposal card started less than five minutes ago, the new slot is neither claimed nor announced: decide() in mods/foreman/hooks/act.ts runs its wake block only when freed > 0 && left.length > 0, and a raised slot has no name, so freed stays 0 and the parent hears nothing. What should this change do? The counsel chose: Wake the parent once with the existing kept sentence for a raised slot nobody could take, as a freed slot does: mark the read that the raise schedules (or the first later read that gets the list, if that one fails) as owing a decision for the raised slots, run the existing wake block for it, stamp the named waiting sessions with keptAt so their slots are held for five minutes, and add a test in mods/foreman/tests/queued.test.ts plus a README sentence. 4 of 7 members voted for it.
- The raise now leaves a mark that the first read which gets the desktop app's list must decide. When that read finds, after its claims, that slots are still free but nobody waits unclaimed in the queue (the queue is empty, every waiting session was claimed, or the only waiting entry is a proposal card nobody started for more than five minutes), what should it do with the mark? The counsel chose: Clear the mark and say nothing, as a raise does today: the person has the command's own answer, and the dry-queue report stays tied to slots that a sub session freed. 7 of 7 members voted for it.
- Which slot-count commands should leave the mark that the next read which gets the desktop app's list must decide for raised slots, and what clears the mark? The counsel chose: Only a count higher than the stored one sets the mark, and nothing but the first read that gets the list clears it. That read decides with the free slots it counts, so a later lowering simply leaves no slot free and wakes nobody. 5 of 7 members voted for it.
- What should this change explicitly leave out, so reviewers have a written reason to stop? The counsel chose: Leave out every other free slot that sits silent: a slot whose five-minute hold for the kept sentence ran out while its waiting session still does not show, a count given to a session that is not yet a parent (which has no queue), any new wake text or a sentence of its own for raised slots, any dry-queue report for raises, any wake while the list fails, and any change to how free slots are counted. 7 of 7 members voted for it.
- Where should the mark for raised slots be kept, given that it must reach the first read that gets the desktop app's list, possibly after a reload? The counsel chose: In foreman's stored ledger (ForemanTickets in mods/foreman/hooks/tickets.ts), set by applyCommand in its own ledger update right after writeParent stores a higher count, and cleared by decide() in the ledger the read already writes. It survives a reload; if the ledger write fails after the count was stored, that raise gets today's silence. 7 of 7 members voted for it.
