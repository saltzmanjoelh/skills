# Plan: builder keeps an agent the engine wakes as a member of its batch

Written 2026-11-02 for `docs/specs/builder-keeps-woken-batch-members.md`, from
a tournament of three plans: the simplest change, the most robust and the
most extensible. The judge chose the most extensible plan, because it was the
only one that kept today's handling for an agent the engine wakes after its
batch was released. The other two wrote nothing on a wake, so such an agent
stayed in the remembered batch and its final report would be answered
"Noted." without the model for up to ten minutes.

## Chosen approach

Two pure functions in `mods/builder/hooks/batch.ts` decide what a resume
does, and `register.tsx` picks between them.

- `isEngineWake(prompt: string): boolean` returns `NOTICE.test(prompt)`. It
  reuses the anchored `NOTICE` pattern that `deliveryOf` reads, so a
  notification element means the same thing in both places: a whole element,
  closing tag included, at the very start of the text.
- `afterWake(state: BatchState, id: string): BatchState` keeps the agent in
  every batch that is not released, marks it as woken and counts it as
  running again, because its report or its turn end before it parked may
  have ended it. A woken member then ends at a clean turn end, one whose
  SubagentStop lists none of the background tasks that `afterTask` recorded
  from its own tool calls, or at a `completed` notification whose summary
  says the agent finished. When that ends the batch's last member,
  `afterMemberStop` does not release the batch but moves its deadline to a
  settle minute from then, so that the member's report, which normally
  follows within seconds, releases it with the completion line; when no
  delivery comes, the deadline's timer submits the completion line itself.
  Because a wake makes the batch incomplete again, `afterWake` clears a
  claim of that completion line and gives back the deadline that the turn
  end saved before the settle minute, together with the wait saved beside it
  as `retryBeforeSettle` (see `docs/specs/builder-batch-wake-follow-ups.md`).
  In a released, remembered batch it forgets the agent, as `afterResume`
  does, and drops a batch left with no members. It never releases a batch.
- In the `agent.spawn` hook, a resume calls
  `isEngineWake(e.prompt) ? afterWake(state, resumed) : afterResume(state, resumed, now)`
  inside one `changeBatches` write, as today's resume does.

The back-off lives in `afterDeadline` and one optional stored field.

- `BATCH_RETRY_CEILING_MS = 60 * 60_000` and `nextBatchRetry(ms)`, which
  returns `Math.min(ms * 2, BATCH_RETRY_CEILING_MS)`, the same shape as
  `nextStuckEvery` in `state.ts`.
- A private `retryOf(b)` reads `b.retryMs ?? BATCH_RETRY_MS` clamped to
  between one minute and one hour.
- `afterDeadline` claims a due batch as
  `{ ...b, fired: true, deadline: now + retryOf(b), retryMs: nextBatchRetry(retryOf(b)) }`,
  so the claims fall 1, 2, 4, 8, 16, 32 and then 60 minutes apart.
- `fireBatch`, `armBatch` and `rearmBatch` keep their logic, because they
  re-arm from `nextDeadline` after every claim. `rearmBatch` keeps its fixed
  one-minute retry after a refused read or write of the state, which is not a
  refusal of the line.

`Batch` in `mods/builder/types/index.d.ts` gains `retryMs?: number`. The state
stays at version 1, and a comment says why: a new version would make the old
and the new build read each other's state as empty across a hot reload, so a
batch whose reports were answered "Noted." would never get its line. `isBatch`
accepts an absent value, or a finite number above zero, and reads anything
else as the empty state, as it does for a bad `fired` mark.

## Grafts from the runners-up

- **A realistic `spawns` mock** (from the robust plan). It answers a resume
  with `e.resume.agentId` and leaves the id counter alone, as the engine does.
- **Timing in the test that a line taken after refusals ends the batch**
  (robust plan), so that it fails on the fixed one-minute retry.
- **Negative cases for `isEngineWake`** (robust plan): an element in the
  middle of the text, a leading space, an element without its closing tag,
  and an empty prompt.
- **A clamp at both ends of the stored wait** (robust plan), so that a
  malformed positive value cannot retry in a burst.
- **The version comment** (robust plan).
- **The README** (simplest and robust plans): the section "When a batch of
  agents finishes" says that the wait doubles up to an hour, and that an
  agent the engine wakes stays in its open batch.
- **The probe checks that only the fixed builder is loaded** (robust plan),
  because an old copy's `agent.spawn` would still forget the member.

## Found after judging

The judge asked whether a parking agent reports before it parks. The first
probe's log shows that it does: a report and a `completed` notification
arrive before the wake, and the final report, when the engine accepts one,
comes after it. That earlier report can end the member, so `afterWake`
reopens it rather than only keeping it. Later probes showed that a woken
agent often cannot report a second time and that its finished notification
often skips the prompt submission hook, so a woken member ends at a clean
turn end or at a finished notification, and the settle minute and the
deadline's completion line make sure the batch is still released once.

## Rejected alternatives

- **A wake that writes nothing** (simplest and robust plans). It leaves the
  agent in a released, remembered batch, so its final report is held without
  the model for up to ten minutes.
- **Deciding by whether a session step is under way.** The engine wakes an
  agent whenever its work ends, often during a session step, so this
  misreads the wake (decided by the counsel).
- **Checking that the notification names the agent's own task.** The id names
  the agent's shell task, which builder never sees.
- **State version 2**, for the reason in the version comment.
- **Backing off `rearmBatch` too.** That path cannot store a wait, and the
  spec scopes the back-off to a refused line.

## Steps

1. Tests first in `mods/builder/tests/batch.test.ts`: `isEngineWake` with its
   negatives; `afterWake` reopens an ended member of an open batch so that a
   later report from a still-running member is held, the woken member ends at
   a clean turn end that lists none of its own tasks, and its report within
   the settle minute releases the batch with the completion line, or the
   deadline's timer claims the completion line when no delivery comes;
   a wake after that turn end gives back the earlier deadline and the wait
   saved beside it; `afterWake` keeps
   a member of a fired batch and marks it running; `afterWake` forgets the
   agent in a released batch so its later report passes; `afterWake` never
   releases a batch; the gaps 1, 2, 4, 8, 16, 32, 60 and 60 minutes; a stored
   batch without a wait starts at one minute; a wait of 0, -1, NaN or a string
   reads as empty; a wait above an hour or below a minute is clamped; a line
   taken after refusals ends the batch.
2. Hook tests in `mods/builder/tests/batches.test.ts`, after making the
   `spawns` mock realistic: a member that reports, parks and is woken twice is
   held, ends at its clean turn end after the last wake, and the batch is
   released once, with the completion line, at the report that follows; a
   woken member that ends with plain text, whose finished notification never
   passes the hook, has the completion line submitted by the deadline's timer
   a settle minute later, once; a member resumed with the session's own text is forgotten
   and the rest are released as one batch; a member woken after its batch was
   released has its final report reach the model; a refused line is tried
   again after 1, 2, 4, 8, 16, 32, 60 and 60 minutes, and a person's prompt
   during a long wait carries the line naming the running members; a fired
   batch stored without a wait is tried one minute and then two minutes on;
   a line taken after refusals is not sent before its doubled time, ends the
   batch, and sends nothing more two hours later.
3. Run them and see each new test fail.
4. Write `isEngineWake`, `afterWake`, the back-off, the validator clause, the
   type field and the hook branch, and update the comments on `afterResume`,
   `afterDeadline`, `BATCH_RETRY_MS` and `fireBatch`.
5. Rename the test near line 413 of `batches.test.ts` and delete its last four
   lines.
6. Update the README section.
7. Show each new test failing when its hunk is reverted, then run the four
   gates for both mods.
8. Run the two headless probes on the desktop app's engine with only the
   fixed builder loaded, and record the results for the pull request.

## Test plan

The tests in steps 1 and 2 map onto the spec's Verification section: the
engine's wake keeps and reopens the member, the session's resume forgets it,
the refused line backs off on the stated schedule, an old stored batch starts
at one minute, and a line taken after refusals ends the batch. The rename
removes a half that could never fail; the person's-prompt case stays covered
by the hook test of a first step whose last message is a user message and by
the unit test of the frame check. The two headless probes are the evidence
from the real engine that the counsel required before the merge.
