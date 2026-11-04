# Plan: builder keeps a batch's back-off across wakes and keeps its release turn

Written 2026-11-03 for `docs/specs/builder-batch-wake-follow-ups.md`, from a
tournament of three plans: the simplest change, the most robust and the most
extensible. All three met the spec's Behavior section. The judge chose the
simplest plan, because the robust plan behaves the same with more code and
the extensible plan adds four helpers for one field and quietly changes what
a turn end does to a batch the deadline has already claimed.

## Chosen approach

Both fixes live in the pure functions of `mods/builder/hooks/batch.ts`.
`register.tsx` does not change, because the `agent.spawn` hook, the turn-end
handling and `withBatch` already apply these functions inside one
`changeBatches` write. The state stays at version 1.

- `Batch` in `mods/builder/types/index.d.ts` gains `retryBeforeSettle?: number`,
  documented beside `deadlineBeforeSettle`: saved with it at a turn end,
  restored with it by a wake, and dropped at the release.
- `isBatch` accepts `retryBeforeSettle` when it is absent or a finite number
  above zero, the same check as `retryMs`, and reads anything else as the
  empty state.
- `afterMemberStop`, in the branch that saves `deadlineBeforeSettle` because
  the batch is not fired, first takes any old `retryBeforeSettle` out of the
  batch and then saves `batch.retryMs` as `retryBeforeSettle` when it is
  defined. The fired branch keeps whatever the batch already holds, as it
  does today for `deadlineBeforeSettle`.
- `afterWake` takes `retryBeforeSettle` out with the other fields. When it
  restores `deadlineBeforeSettle`, it restores `retryMs` from
  `retryBeforeSettle`, or leaves the batch without a wait when none was
  saved. The branch that only clears a claim of the completion line drops
  the saved wait too.
- `released` strips `retryBeforeSettle` beside `deadlineBeforeSettle`.
- `afterDeadline`'s claim is unchanged: it keeps both saved fields, so a wake
  after a claim made inside the settle minute gets back the earlier deadline
  and its saved wait, and the doubled wait of that claim is dropped.
- The `held` helper in `afterDelivery` raises the count only when
  `isIdle && kept.releasing !== true`, so while a release turn is pending no
  held delivery from any batch raises it.
- Comments: the version-1 list of optional fields, `afterWake`,
  `afterMemberStop`, `afterDelivery` (any held delivery), and the `releasing`
  comment on `BatchState`, which also says that a release turn that never
  takes its first step leaves the mark set, so idle held deliveries reach the
  model until the next first step, which costs model turns and loses nothing.

## Grafts from the runners-up

- **A test of a stale saved wait** (robust plan): a turn end that saves a
  deadline while the batch has no wait drops a saved wait left over from the
  previous build. This is the path the take-out step in `afterMemberStop`
  exists for.
- **NaN and Infinity among the malformed values** (robust plan), because
  those are what the finite-number check actually rejects.
- **The note on a release turn that never takes its first step** (robust
  plan), in the `releasing` comment.
- **The earlier spec's Verification line** on the releasing member's
  notification is extended to a second open batch's delivery (robust plan).
- **`afterDeadlineSent` drops the saved wait** (extensible plan), checked in
  the read-back test, because a line the engine takes is the other release.
- **The existing round-trip test near line 700 of `batch.test.ts`** gains the
  new field (extensible plan).
- **The hook test sets the conversation's last message** to the second
  batch's report (the judge's own addition), because otherwise the first
  step is not answered before the fix either and the test cannot fail.

## Rejected alternatives

- **Helpers that save and strip both settle fields together** (extensible
  plan). Stripping both in every branch would drop a saved deadline in the
  fired branch, which no reachable sequence produces today but which would
  break the rule that a settle-minute claim's wait is cleared if one ever
  did. Four helpers for one field also cost more than they save.
- **Taking the saved wait out and putting it back in the fired branch**
  (robust plan). It does exactly what the plain spread does.
- **A nested object holding the deadline and the wait together, or state
  version 2.** The counsel chose a separate field, and a new version would
  make the two builds read each other's state as empty across a hot reload.
- **A per-batch releasing mark or a count of pending releases.** The spec
  accepts the one extra model turn another open batch's delivery may cost.

## Steps

1. Tests first in `mods/builder/tests/batch.test.ts`:
   - "a wait grown by refused lines survives a clean turn end and a second
     engine wake": from `wokenAfterLaterCompletionClaim()`, which covers the
     spec's chain steps 1 to 4, call `afterMemberStop` and `afterWake` for
     ALPHA, then check that `retryMs` is four minutes and that the claim at
     the restored deadline moves the next deadline four minutes on.
   - "a saved wait reads back, reads as the empty state in any other shape,
     and is dropped when the batch is released": the field round-trips
     through `batchStateIn`; `'x'`, 0, -1, NaN and Infinity read as empty; a
     release by delivery and `afterDeadlineSent` both leave no
     `retryBeforeSettle`.
   - "a turn end that saves a deadline with no wait drops a stale saved wait".
   - "a held delivery from a second open batch before the release turn's
     first step leaves the count at zero, so that step reaches the model":
     two batches, the first released while idle, an idle report from the
     second, then the count is 0 and `answersStep` is false.
   - The test near line 673 gains a check that `retryBeforeSettle` is
     undefined; the round-trip test near line 700 gains the field.
2. A hook test in `mods/builder/tests/batches.test.ts`: launch two agents at
   step t1:0 and two at step t1:1, end the turn, release the first pair while
   idle, deliver a report from the second pair with the conversation's last
   message set to it, then take step t3 and check that it is asked once and
   is not answered "Noted.".
3. Run the tests and see each new one fail, recording what each printed.
4. Make the code changes above and update the comments.
5. Edit the earlier plan in place: the `afterWake` bullet, "Found after
   judging" and Steps 1 and 2 describe the merged rule, in which a woken
   member ends at a clean turn end listing none of its own tasks or at a
   finished notification, the batch waits a settle minute for the report,
   and the deadline's timer submits the completion line when none comes.
6. Edit the earlier spec in place: Behavior items 1, 5 and 6, and the
   Verification line on the releasing member's notification.
7. Run the four gates for both mods.

## Test plan

The tests in steps 1 and 2 map onto the spec's Verification section: the
back-off chain run in order ends in a claim at the grown wait; the saved wait
reads back, rejects malformed values and is dropped at both releases; the
existing settle-minute test still finds no wait; the release case is run
both as a pure sequence and through the registered hooks. Each new test is
shown failing before its fix. One gap is accepted rather than tested: while
the previous build and this one run at once, the old `afterWake` keeps a
saved wait that the old `afterMemberStop` may then pair with a new deadline.
The existing clamp holds the resulting retry between one minute and one
hour, which the spec's Failure modes already accept.
