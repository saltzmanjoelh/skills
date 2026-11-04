# Plan: builder records how long its issue takes, and foreman adds the times up beside the cost

Written 2026-11-03 for `docs/specs/session-time-beside-cost.md`. Three planners
worked blind, from the simplest change, the most robust change and the change
easiest to extend; a judge compared them against the spec and checked their
claims against the code.

## Chosen approach

The simplest plan won. It copies the design of the cost change (see
`docs/specs/session-token-cost-plan.md`) and adds the least new state: one
value in builder's state, copied whole to one store key per session, and new
fields inside foreman's existing ledger entries, with no new pairing field and
no new top-level ledger field. Its state therefore creates the fewest edge
cases on a restart, a resumed or cleared session, a hot reload and two copies
running at once. Its weaknesses are mended by the grafts below.

**Builder.**

- A new pure module, `mods/builder/hooks/timing.ts`, holds the rules, so the
  tests check them without the engine. Every rule hands back the same object
  when nothing changes, so a rerun of a reducer, or a second copy applying
  the same change, changes nothing.
  - `timingIn(raw, sessionId)` reads a stored or held value. A value that is
    damaged in any part, or that is stamped with another session id, reads as
    none.
  - `emptyTiming(sessionId, now)` starts a record whose start is `now`.
  - `afterStage(t, title, stage, now)`: a title that differs from the stored
    one resets the stages and stores the new title; a stage already present
    keeps its first stamp; otherwise the stage is appended with `now`.
  - `afterPr(t, {repo, number, state}, now)`: a different pull request
    replaces the stored one and resets both stamps; the first `OPEN` stamps
    the opening; the first `MERGED` stamps the merge, closes the open state
    at the merge and freezes the totals.
  - `afterState(t, state, now)`: nothing happens after the merge or when the
    state is the open one. Otherwise the stretch since the open state began is
    added to that state's total and the new state opens at `now`, in one
    returned value. The first state ever opened begins at the record's start.
  - `afterPackage(t, head, now)` and `afterReview(t, head, now)` follow the
    spec's round rules, keeping the newest 20 entries and counting the older
    ones.
  - `statesAt(t, now)` gives the totals with the open state counted up to the
    read, or up to the merge once it is stamped.
  - `recordTiming(t, now)` builds the status file's field, and
    `timingLines(t, now)` the pane's words.
  - Every duration is clamped at zero, and a superseded entry's end is never
    before its start.
- A new state atom, `timing`, holds the value for the session. It is copied
  whole to `$.store` under `timing:<session id>` by a chain of writes shaped
  like the usage chain, keyed by the value's own session id, and pruned after
  14 days without an update or when it reads as damaged.
- Each stamp is taken with `$.clock.now()` in the hook or tool that sees the
  event:
  - stages in the progress tool and in `reportSeen`, so a stage the mod
    reports itself is stamped too;
  - the pull request opening and merging at the two places that write the
    `pr` atom, `watch()` and `lookAt()`;
  - rounds in the package tool, beside the update that records the package,
    and in post_review once the review is posted.
- State changes are applied in `writeStatus`, the only place that works out
  the status state, after its generation check and before `recordOf`, inside
  its own error handling so that a timing failure never drops a status write.
- `recordOf` writes the `timing` field with the totals as of the write.
  `comparedTextOf` replaces the totals with null in the copy it compares, so
  the open state counting up does not make every pass a changed write and
  wake the parent every minute. A change of state is still caught by the
  `state` field.
- The pane gains a timing section after the usage section.

**Foreman.**

- The type of a ledger entry gains `timing`, the last reading of the owner's
  `timing` field, and `queuedMs`, which is null when unknown and 0 when the
  ticket was begun without waiting. An entry that holds only times has zero
  counts and an unknown dollar figure, so every existing reader of the counts
  stays valid.
- `earlier` gains `times`, the four folded sums, each null when unknown.
- `record.ts` reads `timing` with a type-equality guard against builder's
  type, beside the existing guards.
- `withReadings` takes the owner's `timing` reading beside its spending: the
  per-state totals keep the larger value, the stamps and rounds take the
  newest reading, and a reading without them keeps the stored ones.
- `withQueued(t, ticket, ms)` creates or updates an entry, keeping the larger
  queue time.
- Queue time uses the pairing's existing `pairedAt`, which is set when the
  ticket is reserved and is overwritten only by `beginOne`'s success path.
  That path computes `now - pairedAt` in the same update that overwrites it.
- `folded` adds the four sums of each folded entry into `earlier.times`.
- The pane shows a time line under each row's spending line and a summed line
  after the sub sessions' spending, worded as summed over sub sessions that
  run side by side.

## Grafts from the runners-up

1. **The first open state counts from the session's start** (from the robust
   plan). Without it the stretch before the first status write is never
   counted, and the three parts do not add up to the elapsed time that the
   Goal says they divide.
2. **The zero queue time is written after an accepted start** (from the
   robust plan), in `afterStart` and in `withAnswer`'s re-add, only when the
   start does not wait. Writing it at reservation would leave an orphan entry
   for every refused, held or failed start, because removing a pairing never
   removes its ledger entry.
3. **A pull request that replaces a merged one resumes the clock** (from the
   robust plan). When the stored pull request had merged and a different one
   is watched, the open state resumes from now, so the frozen stretch is not
   counted again and a wrongly watched merged pull request does not freeze the
   clock for good.
4. **Error handling and clamps** (from the robust plan): the timing change in
   `writeStatus` has its own error handling, and every duration is clamped,
   so a timing failure never drops a status write and a clock that goes back
   never makes a total fall.
5. **Both READMEs are updated** (from the extensible plan): builder's
   describes the `timing` field and the pane lines, and foreman's describes
   the time line, the summed line and the ledger fields beside its spending
   paragraphs.

## Rejected alternatives

- **A new queued stamp on the pairing** (robust and extensible plans). The
  existing `pairedAt` already holds the reservation time until the begin
  message, and the extensible plan's field defaulted to it. A new field needs
  a reader change, and pairings queued before the change would read as
  unknown.
- **Optional or nullable spending counts** (robust and extensible plans).
  Foreman's current reader drops an entry whose counts are missing, so an old
  copy during a hot reload would delete exactly the entries that hold only
  times, and every counts reader in `spend.ts` would have to change.
- **A separate top-level `earlierTime` field** (robust and extensible plans).
  It forces a change to the emptiness check at foreman's start; nesting the
  sums inside `earlier` does not.
- **A queue time for a sub session that began before the begin message**
  (robust and extensible plans). The robust plan's builder start minus the
  queue stamp is close to zero for a session that may have waited for hours,
  because a waiting sub session loads builder at once. The extensible plan's
  time of foreman's read is forbidden by the spec's first behavior. That queue
  time stays unknown on purpose.
- **Applying state changes only after a successful file write** (extensible
  plan). The spec's failure mode keeps the times in the store when the file
  cannot be written.
- **Leaving the timing key out of the `state.set` hook** (robust and
  extensible plans). It is safe, but stamps would reach the file only at the
  next unrelated write or the minute's forced write. Leaving the key in costs
  one extra pass after a change, and the loop ends because the change hands
  back the same object once the state is recorded.

## Where the plan refines the spec

- **Unticketed sessions keep no split.** The spec's third behavior adds up
  the time in each state of the status record, and builder works out that
  state only in a ticketed session, because only a ticketed session writes a
  status file. A session without a foreman ticket still stamps the start, the
  stages, the pull request and the rounds, and its pane shows the elapsed time
  with the split shown as not kept, never as zero.
- **A carried-over review at a superseded head** adds a zero-length entry
  marked carried over, because the head has no open entry.
- **A pull request first seen merged** gets a merge stamp and no opening
  stamp.

## State kept and its edge cases

- **Builder: one value per session**, in the `timing` atom and under
  `timing:<session id>` in the store. It holds the start, the title and
  stages, the pull request with its two stamps, the open state and when it
  began, the closed totals, the rounds, the count of older rounds, and the
  time of the last change.
  - A restart seeds from the store, so the open state comes back and its
    stretch is counted once. The time builder was unloaded lands in the state
    that was open, the spec's known gap.
  - A resumed session with the same id carries on. A cleared session gets a
    new id, so the held value reads as another session's and a fresh record
    starts; every store key comes from the value's own id, so the old record
    is never stored under the new key.
  - A hot reload keeps the atom. The write chain and the last stored text are
    module variables that reset, which costs at most one extra store write.
  - Two copies around a hot reload: only the copy whose generation matches
    applies state changes, and the stamp rules keep the first stamp, so a
    rerun counts nothing twice. Two processes on one session id are not
    solved, as for usage.
  - A refused store write leaves the value in the atom, and the next change
    writes the newest value again.
- **Foreman: new fields in existing entries.** An old copy during a hot reload
  keeps the entries and drops the new fields on its next write; the times
  come back at the next status read, except a queue time stored in that
  window.

## Steps

1. Add builder's types (`BuildTiming`, `TimingLedger` and their parts) and
   `BuildStatus.timing?`, keeping `version` at 1. Write `timing.ts` as typed
   stubs so the type gate passes, then `tests/timing.test.ts`, and see it
   fail on its assertions.
2. Implement `timing.ts`.
3. Change `status.ts`: `StatusFacts.timing`, the field in `recordOf`, and the
   compared text. Test in `tests/status.test.ts`.
4. Wire `register.tsx`: the atom and the store chain, `startTiming` at session
   start beside `startUsage`, the stamps in the tools and the watch, and the
   state change in `writeStatus`. Test in `tests/register.test.ts`.
5. Draw builder's pane. Test in `tests/pane.test.ts`.
6. Add foreman's types, the reading guard and `timingIn` in `record.ts`, and
   the tolerant readers in `tickets.ts`.
7. Change `spend.ts`: `withReadings`, `withQueued`, the fold and the time
   sums and words.
8. Change foreman's `register.tsx`: `beginOne`, `afterStart` and `withAnswer`,
   and `view()`. Then draw foreman's pane.
9. Update both READMEs, and run the four gates for both mods.

## Test plan

**Builder, with a fake clock.**

- A stage reported twice keeps its first stamp, a new title resets the
  stages, and a stage the mod reports itself is stamped: `timing.test.ts`,
  and `register.test.ts` through the progress tool and a watch.
- The opened and merged stamps come from the first watch that sees each:
  `timing.test.ts`, and `register.test.ts` with a watch and then polls.
- A state change adds the stretch and moves the start in one store write, and
  an open state counts up to the read: `timing.test.ts`, and a ticketed
  `register.test.ts` world checking the stored value. A reload test seeds an
  open state and checks the stretch is counted once.
- The first state counts from the start, so the totals add up to the elapsed
  time: `timing.test.ts`.
- The totals stop growing after the merge, and a different pull request after
  a merge resumes the clock without counting the frozen stretch:
  `timing.test.ts`.
- The round rules, including the cap of 20: `timing.test.ts`, and one round
  through the package and post_review tools in `register.test.ts`.
- A damaged stored record reads as none and a fresh record starts at the
  current time: `timing.test.ts` and `register.test.ts`.
- The status record carries `timing` and stays version 1, and the compared
  text ignores the growing totals: `status.test.ts`.
- A timing failure does not drop the status write: `register.test.ts`.
- The pane's timing lines, an open round counting up, and the unticketed
  split shown as not kept: `pane.test.ts`.

**Foreman.**

- Queue time is the difference from the reservation to the begin message,
  and a ticket begun without queuing gets zero, not unknown; a refused start
  leaves no entry: the queue tests through `world.ts`, and
  `register.test.ts`.
- An entry can hold times with no spending: `spend.test.ts`.
- A file's times enter the owner's entry and a fork's file changes nothing:
  `spend.test.ts`, and `record.test.ts` for the reading guard.
- The totals never fall, and a reading without stamps keeps the stored ones:
  `spend.test.ts`.
- Past 200 entries the fold keeps the four sums unchanged: `spend.test.ts`,
  with `tickets.test.ts` reading old and new ledgers.
- A row and the sums show unknown, never zero, when times are missing:
  `spend.test.ts` and a pane draw.

**Gates and hand check.** The four gates pass for both mods, and the hand
check in one real ticketed `/implement` session stays manual.
