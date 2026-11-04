# Builder keeps a batch's back-off across wakes and keeps its release turn

Written 2026-11-03. Seeded from an issue in the owner's tracker that collected
three follow-ups the counsel filed from the change described in
`docs/specs/builder-keeps-woken-batch-members.md`. The questions the issue
left open were put to the counsel.

## Goal

Builder holds the reports of agents launched together in one model step and
wakes the session's model once, when the whole batch has ended. Two rare
sequences still break that promise, and one document still teaches a rule
the code no longer follows:

- **A refused line loses its back-off.** When the engine keeps refusing the
  line builder submits at a batch's deadline, the wait before the next try
  doubles up to an hour. A chain of engine wakes and turn ends can restore
  the batch's earlier deadline without the wait that went with it, so the
  tries fall back to once a minute. A person whose hook keeps refusing
  plugin prompts then sees one every minute instead of one an hour.
- **A held delivery from another batch can take the release turn.** When a
  batch is released while the session is idle, the turn that carries the
  completion line has to reach the model. A held delivery from a second,
  still-open batch that arrives before that turn's first step raises the
  count of turns builder answers without the model, and the release turn
  can then be answered with "Noted.", so the model never sees that the
  batch finished.
- **The plan describes the first design.** The plan for keeping woken batch
  members says a woken member ends at its report. The spec and the code end
  it at a clean turn end or at a finished notification, after a settle
  minute.

## Users and trigger

Any session that has the builder mod loaded and launches two or more
background agents in one step. The first fix matters only when the engine
refuses builder's deadline or completion line and a member is woken more
than once around a turn end. The second matters only when two batches are
open at once and one is released while the session is idle.

## How the back-off is lost

The stored batch carries `deadline`, the time of its next claim, and
`retryMs`, the wait that claim will add. When a turn end ends a batch's last
member, `afterMemberStop` moves the deadline to one minute from then, the
settle minute, and saves the deadline it replaces as `deadlineBeforeSettle`
unless the deadline has already claimed the batch. When the engine later
wakes a member, the batch is incomplete again, and `afterWake` restores that
saved deadline and drops `retryMs`, so that the doubled wait of a claim made
inside the settle minute does not carry over.

The saved deadline can itself be the time of a retry with a grown wait:

1. The deadline claims the batch and its deadline line is refused, so the
   batch is fired and `retryMs` has grown.
2. A woken member ends at its turn end. The batch is fired, so nothing is
   saved, and the deadline becomes the settle minute's end or stays sooner.
3. The completion line is claimed and refused, so `retryMs` grows again.
4. The engine wakes another member. The wake clears the claim of the
   completion line and the fired mark, and keeps `retryMs`.
5. That member ends at a clean turn end. The batch is no longer fired, so
   its deadline is saved as `deadlineBeforeSettle`.
6. The engine wakes a member again. The saved deadline comes back, and
   `retryMs` is dropped, so the next claim waits one minute.

## Behavior

1. **The wait is saved beside the deadline it belongs to.** When a turn end
   saves `deadlineBeforeSettle`, it also saves the batch's `retryMs` at that
   moment as `retryBeforeSettle`, or nothing when the batch has no wait. A
   wake that restores the saved deadline restores that wait with it, or
   leaves the batch without one when none was saved. The wait of a claim
   made inside the settle minute is still cleared, because it was never
   saved. A batch released, or claimed by the deadline, keeps none of these
   saved fields once they no longer apply, as `deadlineBeforeSettle` is
   handled today. The state stays at version 1: the previous build reads a
   value with the new field as it reads any other, and this build reads a
   value without it as a batch whose earlier deadline had no wait.
2. **No held delivery raises the count while a release turn is pending.**
   When a delivery that arrives while the session is idle releases a batch,
   builder clears its count of turns to answer without the model and marks
   the state as releasing until the release turn's first step. While that
   mark is set, a held delivery from any batch, released or still open,
   leaves the count alone, so the release turn always reaches the model. A
   held delivery after that first step raises the count as usual. If the
   other batch's delivery gets a turn of its own before the release turn,
   that turn reaches the model once, which costs one model turn and loses
   nothing.
3. **The earlier documents state the rules as merged.** The plan for keeping
   woken batch members is edited in place so that it describes the merged
   design: a woken member ends at a clean turn end that lists none of its own
   tasks, or at a finished notification, the batch waits a settle minute for
   the member's report, and the deadline's timer submits the completion line
   when none comes. The earlier spec's Behavior items 1, 5 and 6 are edited
   in place to state the two rules above. This spec keeps the reasons.

## Edge cases

- **No refused line before the settle minute.** No wait is saved, so a wake
  leaves the batch without one, and the next claim waits one minute, as
  today.
- **A claim inside the settle minute, then a wake.** The batch gets back its
  earlier deadline and the wait saved beside it; the doubling of the
  settle-minute claim is dropped, as today.
- **Several wakes and turn ends in a row.** Each turn end that saves a
  deadline saves the wait beside it, and each wake that restores one
  restores both, so the wait never shrinks below what refusals grew.
- **A value stored by the previous build** has no saved wait; a wake then
  behaves as it does today.
- **The releasing member's own notification** before the release turn's
  first step still leaves the count alone, as today.
- **Two batches released one after another while idle** each clear the
  count and set the mark, so both release turns reach the model.

## Non-goals

- **The fixed one-minute retry after a failed read or write of the state**
  stays as it is: that path cannot store a wait.
- **The doubling at claim time** stays: the wait doubles when the deadline
  claims a batch, not once a refusal is confirmed. A line the engine takes
  drops or releases the batch, so the doubled wait is never read.
- **The extra model turn** that another open batch's delivery may cost while
  a release turn is pending stays accepted.
- **A run on the desktop app's engine.** Both fixes change only how stored
  state is updated, and no probe can make the engine refuse a line several
  times on demand.

## Failure modes

- **A saved wait that is malformed** makes the stored state read as empty,
  as any malformed batch field does, so every delivery reaches the model
  as it would without builder.
- **A wrong saved wait** can only lengthen or shorten the next retry, held
  between one minute and one hour by the existing clamp.
- **A delivery whose turn reaches the model** because the count was left
  alone costs one model turn and loses nothing.

## Verification

- `batch.test.ts` runs the back-off chain above in order through
  `afterDeadline`, `afterMemberStop` and `afterWake`, and checks that the
  claim after the second wake waits the grown wait, not one minute. It
  also checks that the saved wait reads back, that a malformed one makes the
  state read as empty, that a release drops it, and that the existing test
  of a wake after a settle-minute claim still finds no wait.
- `batch.test.ts` runs an idle release, then a held delivery from a second
  open batch, then the first step, and checks that the count stays at zero
  and the first step is not answered.
- `batches.test.ts` drives the same release case through the registered
  hooks and checks that the release turn's first step reaches the model.
- Each new test is shown failing before its fix, and the report states what
  each printed then.
- The four gates pass for both mods.

## Decided by the counsel

- How should a batch keep its back-off wait across the chain of a refused deadline line, an engine wake that clears a pending completion claim, the last member ending at its turn end, and a second engine wake? The counsel chose: Store the wait beside the deadline it belongs to: when a turn end saves deadlineBeforeSettle, also save the batch's retryMs then as retryBeforeSettle, and have a wake that restores the deadline restore that wait too, so the wait of a claim made in the settle minute is still cleared. 7 of 7 members voted for it.
- While a batch's release turn has not yet taken its first step, what should a held delivery from a different batch that is still open do to the count of turns builder answers without the model? The counsel chose: Leave the count alone: while the state is marked as releasing, no held delivery from any batch raises it, so the release turn always reaches the model, and if the other batch's delivery gets a turn of its own it may reach the model once. 7 of 7 members voted for it.
- How should the stale plan for keeping woken batch members, and the earlier spec's passages that these two fixes change, be brought in line with the code? The counsel chose: Edit both earlier documents in place: rewrite the plan's stale passages so it describes the design as merged (a woken member ends at a clean turn end or a finished notification, the settle minute, the claimed completion line), and update the earlier spec's Behavior items 1, 5 and 6 to state the new rules, with this change's own new spec holding the reasons. 5 of 7 members voted for it.
- Which neighbouring behaviours should this change deliberately leave as they are? The counsel chose: Keep to the three issue items: leave the fixed one-minute retry after a failed read or write of the state, leave the wait doubling at claim time rather than at a confirmed refusal, and leave the one extra model turn another open batch's delivery may cost. 7 of 7 members voted for it.
- What evidence should show these two code fixes work before the merge? The counsel chose: Unit tests in batch.test.ts that run each chain of events in order (the back-off chain ending in a claim at the grown wait; an idle release, a held delivery from a second open batch, then a first step that reaches the model), plus a hook test in batches.test.ts that drives the release case through the registered hooks, each shown failing before its fix. 7 of 7 members voted for it.
