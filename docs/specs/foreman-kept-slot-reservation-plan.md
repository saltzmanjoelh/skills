# Plan: foreman reserves a kept slot for the parent's hand begin

Date: 2026-11-03. Spec: `docs/specs/foreman-kept-slot-reservation.md`.

## Chosen approach

Three planners worked from the spec, each with a different aim: the simplest
change, the most robust one, and the one easiest to extend. All three came to
the same core design. A judge chose the extensible plan, with three ideas
taken from the robust plan and one test fix that every plan had missed.

- A waiting pairing's `queue` object gains an optional field,
  `keptAt?: number`, declared in `mods/foreman/types/index.d.ts`. It holds the
  time of the read that woke the parent with the kept sentence. The field is
  optional rather than null, so a ledger without a stamp is stored exactly as
  before, and the many existing `{ place, claim }` assertions stay true.
- One pure predicate in `mods/foreman/hooks/tickets.ts` defines a
  reservation:

  ```ts
  export const isReserved = (p: ForemanPairing, now: number, goneMs: number) =>
    p.standing === 'active' && p.queue !== null && p.queue.claim === null
      && p.queue.keptAt !== undefined && now - p.queue.keptAt >= 0 && now - p.queue.keptAt <= goneMs
  ```

  A stamp in the future is not a reservation, so a damaged stamp or a clock
  that moved back can never hold a slot past the next read.
- `queueIn` reads the stamp with `numberOr`, and also rejects negative values,
  so a missing or damaged stamp reads as no stamp and the ticket is kept.
- `waitingUnclaimed` leaves reserved pairings out.
- In `mods/foreman/hooks/act.ts`:
  - `freeSlots` subtracts the reserved pairings. They cannot overlap the
    claimed ones, which have a claim, or the unseen starts, which have no
    queue.
  - In `queueStep`'s first pass, the progress check and the over check run
    first, so either one ends a reservation as the spec's point 6 says. After
    them, a pairing whose stamp exists but is no longer a reservation gets one
    log line and loses its stamp: `The slot kept for <who> is no longer kept,
    because its waiting session showed no progress within five minutes.`
  - The claim loop skips reserved pairings.
  - `decide` stamps the pairings in `firstInQueue` with `keptAt: now`, only
    when the outcome's reason kind is `slot-kept`, because `slotOutcome` also
    returns a wake for the slot-free sentence. It stamps by object identity,
    through `new Set(firstInQueue)`, so duplicate tickets in a damaged ledger
    cannot widen the stamp. The stamp lands even when the sentence speaks of
    "the issues waiting in its queue", because `firstInQueue` is taken before
    the names are checked.
  - The comments above `freeSlots` and `decide` each gain a sentence about the
    reservation.
- `startWaits` needs no change, because it is right once `freeSlots` and
  `waitingUnclaimed` change.
- The wake skill's kept-sentence section and the README's account of the queue
  change in wording, as the spec's points 9 and 10 say.
- `wake.ts` and `register.tsx` do not change.

## Grafts

- **Stamping by object identity, from the robust plan.** It keeps the stamp to
  exactly the sessions the sentence stands for, even when `ticketsIn` keeps
  two pairings with the same ticket.
- **A restart test, from the robust plan.** It is the only test that proves the
  stamp survives a reload, which is why the spec keeps the stamp in the
  ledger.
- **Rejecting negative stamps in the reader, from the robust plan.** It is one
  condition, and it keeps obviously damaged values out.
- **Updating the existing kept test, from the simplest plan.** The test in
  `queue.test.ts` that keeps a slot and later begins the session asserts the
  queue as `{ place: 1, claim: null }` and begins the session three minutes
  later. Both assertions change: the queue carries the stamp, and the begin
  moves past the lapse.

## Rejected alternatives

- **A due time for the lapse, from the robust plan.** `queueStep` has no due
  times in scope, so this would need new plumbing. Reads come at least every
  two minutes, and `isReserved` ends the hold at `GONE_MS` on its own, so a
  late lapse line only delays the claim until the next read.
- **Dropping a stamp found on a claimed pairing, and building claims from a
  queue without the stamp, from the robust plan.** Both defend against a state
  the code never makes: a stamped pairing is never claimed, and a lapsed stamp
  is cleared before the claim loop runs.
- **A two-sided bound, `Math.abs(now - keptAt) <= GONE_MS`, from the robust
  plan.** It would treat a stamp up to five minutes in the future as a
  reservation. The ledger is one file on one machine, so a future stamp is
  damage, and the extensible plan's one-sided bound lapses it at once.
- **Separate exported `keptLapsed` and `keptFor` functions, from the
  extensible plan.** The lapse is the stamp-age check inside `isReserved`
  turned around, and the stamp in `decide` is a few lines. Naming hooks for
  the pane and for a hand-begin report would serve non-goals.
- **A stamp that is null instead of absent.** It would change every stored
  ledger and many existing assertions, for no gain.

## Steps

1. Write the tests below, and see each fail on the base branch.
2. Add the field to the type, and change `queueIn`, `isReserved` and
   `waitingUnclaimed` in `tickets.ts`.
3. Change `freeSlots`, `queueStep` and `decide` in `act.ts`, with their
   comments.
4. Update the existing kept test in `queue.test.ts`, and any other test the
   gates show to depend on a begin soon after a kept sentence.
5. Rewrite the wake skill's kept-sentence section and the README's account of
   the queue.
6. Run the gates.

## Test plan

Each test maps to the spec's Verification section.

1. **The race** (`queue.test.ts`). With one slot, a read frees a slot while the
   first waiting session is not shown open. The kept sentence names it and its
   queue holds the stamp. A read one minute later whose list shows the second
   waiting session open gives no begin effect and no claim for it. On the base
   branch the second session is claimed.
2. **A second slot frees during the reservation** (`queue.test.ts`). The kept
   sentence then names the next unclaimed session, never the reserved one.
3. **No claim for a reserved session** (`queue.test.ts`). Reads at one, two and
   four minutes whose lists show the reserved session open give no claim and
   no begin. On the base branch it is claimed.
4. **The lapse** (`queue.test.ts`). The first read more than `GONE_MS` after the
   stamp, with the session shown open, logs the lapse line once, clears the
   stamp and begins the session. A later read logs no second line. A stamp in
   the future lapses on the next read.
5. **The early ends** (`queue.test.ts`). A reserved session whose record shows
   progress leaves the queue and still counts as busy. One that the list shows
   over is dropped with the existing line, with no held key and no
   notification.
6. **The counting rules** (`queue.test.ts`). With one stamped waiting session,
   `freeSlots` is one lower than without the stamp, `waitingUnclaimed` leaves
   the session out, and `startWaits` with two slots is false, which it would
   not be if the session were counted both as busy and as owed a slot. After
   `GONE_MS` all three give their unstamped values.
7. **The reader** (`tickets.test.ts`). A stamp survives a write and a read. A
   pairing with no stamp, or with a string, `true`, an object, a negative
   number or a number that is not finite, reads with no stamp and keeps its
   place, its claim and its ticket.
8. **A restart** (`queued.test.ts`). With a fresh stamp in the stored ledger
   and a second waiting session that the list shows open, a restart gives no
   begin and no wake, and the stamp is unchanged. The kept prompt's existing
   engine test also asserts that the ledger's waiting pairing holds the stamp.
