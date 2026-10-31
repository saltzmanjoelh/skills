# Plan: a failed list read keeps a freed slot for foreman's queue

Date: 2026-10-31. Spec: `docs/specs/foreman-failed-list-keeps-freed-slot.md`.

## Chosen approach

The simplest plan won, with four ideas grafted from the others. Three plans
competed, from three priors: the simplest change, the most robust and the
most extensible. All three met the spec and shared one core, so the judge
chose the one that adds the least on top and took four specific ideas from
the other two.

- A new required ledger field, `keptSlots: string[]`, holds the names of
  freed slots that a read which could not read the list kept for the queue,
  oldest first. `TICKETS_EMPTY` has it empty, and `ticketsIn` reads it with
  `strings(raw).filter(isWhoName).slice(-MAX_PAIRINGS)`. It does not remove
  repeats, because two sub sessions can carry the same issue key and each
  frees a real slot.
- In `decide`, the freed-slot list starts with the carried names, and
  `freed` starts at their count, so the names this read frees come after
  them and `queueStep`'s claims take the oldest name first. The ledger built
  after the pairings has the field emptied by default.
- At the end of `decide`, on a read whose list was not read while
  `waitingUnclaimed` (on the ledger after `queueStep`) is not empty, the
  names left over that pass `isWhoName` are stored in the field, with a new
  ledger built by a spread, and no slot-free reason is added for them. One
  log line is added for each name this read freed and kept. Otherwise the
  existing wake decides, as today.
- The hand-written `isEmpty` check in `session.start` in `register.tsx` also
  requires `keptSlots` to be empty, so a ledger that holds only kept names is
  not replaced by an older stored one on a resume or a hot reload.
- `UNWATCHED_SHAPE` becomes `WHOLE_LOCAL_ID`, with its new comment.
- The doc comment on `decide`, the comment above its wake, the README's
  sections on slots and on the queue, and the wake skill's "one slot free"
  section say that the slot-free line can come on a later read.

## Grafts

- **From the most robust plan, splitting the left-over names by
  `isWhoName`.** `pairingIn` accepts any non-empty ticket, so a damaged
  stored pairing makes `whoOf` return a name that `isWhoName` rejects. The
  next `ticketsIn` would drop that name and lose its slot without a word.
  Such a name wakes the parent at once instead of being kept.
- **From the most robust plan, a round trip through `ticketsIn`.** Tests of
  `decide` alone cannot catch a reader that is not wired in, because
  `writeTickets` runs `ticketsIn` on every update.
- **From the most extensible plan, an engine test in `queued.test.ts`.** The
  desktop app's list errors while a sub session's file leaves, and a later
  read that lists normally begins the waiting session with "in the slot
  ABC-1 freed". A variant starts from a stored ledger that holds the kept
  name, which reaches the `isEmpty` check.
- **From both, one assertion.** The existing test "a freed slot that no
  waiting sub session can take, because the list leaves it out, still wakes
  the parent" also checks that the field is empty.

## Rejected alternatives

- **A predicate `keepsFreedSlots` as a seam** for the later fix of a waiting
  session missing from an incomplete list. Nobody has designed that fix, so
  the seam would be built for a guess.
- **An `isEmptyLedger` helper.** A helper that still names each field by
  hand only moves the trap into `tickets.ts`. It would earn its place only by
  comparing every field against `TICKETS_EMPTY`, which is a refactor beyond
  this spec.
- **Tests of the `unread` case while someone waits.** `needsList` is true
  whenever the queue is not empty, so that case cannot happen in a real read.
- **Simplifying `freed > 0 && freedBy.length > 0`.** The two are now the
  same, but changing the check is churn.
- **Moving `WHOLE_LOCAL_ID` up beside `LOCAL_ID`.** It works where it is.

## Steps

1. Write the first test in `queue.test.ts` and see it fail: a file leaves on
   a failed read while an issue waits unclaimed, and the decision has no
   reason and keeps the name.
2. Add the field to the type, `TICKETS_EMPTY` and `ticketsIn`, and change
   `decide`, until that test passes.
3. Add the other queue tests, the `ticketsIn` test, the engine tests and the
   extra assertion, and the `isEmpty` clause.
4. The rename.
5. The comments and documents.
6. The gates, for builder and then foreman.

## Test plan

- `queue.test.ts`:
  - the failing first test;
  - the next read, when its list shows the waiting session: it begins the
    session with the carried name, wakes nobody and empties the field;
  - the next read, when its list leaves the waiting session out: it wakes
    the parent with one slot free;
  - a failed read with nobody waiting any more: it spends the name with a
    wake;
  - two slots freed on one failed read;
  - several failed reads in a row;
  - only claimed sessions waiting: nothing is kept;
  - a damaged-ticket name: it wakes the parent at once;
  - the extra assertion on the existing test.
- `tickets.test.ts`: an old ledger without the field, a field that is not a
  list, bad entries, the cap, and a JSON round trip through `ticketsIn`.
- `queued.test.ts`: the engine test and its restart variant.
- The gates in the project's `CLAUDE.md`. They do not read the README or the
  wake skill, so the report says so.
