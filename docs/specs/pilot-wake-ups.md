# The pilot mod starts no repeated, noisy or missing turns

Issue: SAL-281, covering SAL-258, SAL-162 and SAL-270.
Written 2026-10-13.

## Goal

Every turn the pilot mod starts costs the session a full re-read of its
context, and a turn the mod fails to start can leave an unattended session
waiting for good. This change fixes three cases in `mods/pilot`:

- Right after the watch tool reports a pull request's state, a poll can read
  no record of what the session was told and send the whole state again
  (SAL-258).
- A check that completes again with the same passing result starts a turn
  that tells the session nothing (SAL-162).
- After a hot reload during a usage-limit hold, a refused read of the hold
  can leave an unattended session with no timer and no poll at all
  (SAL-270).

## Users and trigger

A session running `/implement` with the pilot mod watching its pull request.
The first case needs a poll to start in the moment between the watch tool
claiming its told record and writing it. The second happens whenever a
workflow reruns on a label change or a bot posts the same commit status
again. The third needs a hot reload of the mod's hooks during a hold and a
refused read of the hold at the same moment.

## Behavior

1. **No handover while a told record is being written.** `tell` counts
   itself as writing from the moment it claims its number until its write
   has finished or failed. While any `tell` is writing, whichever look or
   tool started it, a delivering look (a poll, or the held handover at a
   turn's end) hands nothing over. It checks this at both points where
   `deliver` chooses what to hand over, with no await between the check and
   the choice. It also gives up at once when the count is raised at the
   moment it notes the number of the read last recorded as told, with no
   await between the two, because a read of the told record begun while a
   write is in flight can answer with the old record after the write has
   landed and the count has dropped, and neither later check would see it.
   The next poll compares the pull request with the record as
   written, so a change is delayed by at most one poll and never lost. In
   particular, a poll that starts while the watch tool's told write is in
   flight never hands the session the state the watch tool has just
   reported. The count lives in `tell` itself, so no caller has to remember
   a mark, and it is lowered in a `finally` around the whole of `tell`, so a
   `promptedKey` read or a store write that fails still stops counting and no
   early return leaves it raised. The stuck prompt is dropped while the count
   is raised too, beside its other checks, because a turn about the state
   being recorded has just come. A store write that never settles would hold
   handovers back for good, which is the hazard the existing marks already
   accept, and the comment says so. The comment in `deliver` that lists what
   keeps the told record it reads up to date names the count instead of the
   callers that happen to hold a mark or a claim.
2. **A check that passes again is not news.** A check name whose newest run
   completed again, passing as it passed before, changes neither the
   fingerprint nor the wording of the prompt: no `Check "<name>" passed
   again.` sentence, and it does not count towards "N checks completed
   again". A check that completes again and fails, as it failed before,
   still changes the fingerprint and is named as failing again. A move
   between states (failed to passed, pending to passed, passed to failed)
   is news as before. Commit statuses follow the same rule, since they are
   checks to the mod. The wake log follows the fingerprint, so a passing
   repeat is not counted as a change there either.
3. **A refused read of the hold at arming arms a retry.** When
   `armUnattended`'s own read of the usage-limit hold is refused, it arms a
   retry of the whole arming step `RESUME_FALLBACK_MS` (15 minutes) later, in
   the hold's timer slot and under the hold's current number. When the retry
   fires it reads the hold again and arms the hold's timer if a hold is on,
   and the stuck timer if none is. A refused read at the retry arms the same
   retry again. A new hold or a clear moves the hold's number on, and the
   retry then does nothing, because what moved the number arms what
   follows. The error still reaches `ensureArmed`, so a later hook may arm
   the right timer sooner; a retry that fires after that arms the same
   timer again, which is harmless. The one exception is a slot that already
   holds a retry of the decision after a clear, under the hold's current
   number: the retry of the arming step is not armed over it. That retry
   keeps the session armed and arms itself again when it fails, whereas the
   arming step would find no hold, arm only the stuck timer, and with
   nothing watched leave the session with no timer and no resume. The rule
   comment above `stuckTimer` names this case, so that what it promises
   matches the code.

## Edge cases

- A told record that an older build saved, with a completion time for a
  passing check, compares as the same state as a fresh read of that check,
  because `isSameState` recomputes both fingerprints with the current rule.
  The upgrade starts no turn.
- A rerun of a passing check that a poll sees while it runs shows as
  pending, so pending to passed is a move and is handed over. A rerun of a
  GitHub Actions workflow also shows as an unfinished run with a new
  attempt, which changes the fingerprint on its own.
- A rerun of a passing check that starts and finishes between two polls,
  with no other change, starts no turn. The session needs nothing from a
  check that stayed passed; if it was waiting on that check, the stuck
  prompt reaches it. Nobody has watched this live (see "Decided by the
  counsel").
- A check listed twice, an old run beside a rerun, is still judged by its
  newest run, as before.
- The watch tool's `tell` and a delivering look's own `tell` can both be
  writing; the count covers both, and a delivering look's own write never
  blocks itself, because `deliver` makes its last check before it submits
  and calls `tell` only after.
- A hot reload resets the count to zero with the other module state. A
  write in flight across a reload then finishes in the old module; the next
  poll compares against whatever was written, as for the other counters.
- The retry of the arming step and the hold's timer share one slot, so a
  hold armed later cancels a pending retry, and a retry that arms the hold's
  timer replaces itself. A pending retry of the decision after a clear is
  never replaced by the retry of the arming step (see Behavior 3).

## Non-goals

- The unfinished-workflow-run part of the fingerprint is unchanged. A
  workflow triggered by `pull_request: labeled` therefore still costs up to
  two turns when a poll sees it unfinished: one when it appears and one when
  it finishes. The turn when it finishes is what wakes the `/implement`
  merge step, which ends its turn waiting on unfinished runs. The turn when
  it appears is the only signal for a run that never finishes and never
  registers a check, such as one held at `action_required`. No issue is
  filed, because nobody has measured the cost.
- The mod does not watch the session's commands for `gh run rerun` or
  `gh workflow run`, and keeps no record of reruns.
- Nothing outside `mods/pilot` changes, except this spec, its plan, and the
  SAL-162 bullet in the Non-goals of `docs/specs/pilot-checks-and-runs.md`,
  which is rewritten to point here. `mods/pilot/README.md` changes only if
  it describes a passing check that completes again.

## Failure modes

- A told write that throws ends its count in a `finally`, so handovers
  resume at the next poll and the change is handed over then.
- A store that keeps refusing the hold's read keeps the retry going every 15
  minutes; nothing is sent while the hold cannot be read.

## Verification

Tests in `mods/pilot/tests`, each seen to fail before its change and pass
after it:

- `github.test.ts`: a check that completes again and passes, the same as
  before, gives the same fingerprint and no sentence; one that completes
  again and fails gives a different fingerprint and `Check "<name>" failed
  again.`; a move from failed to passed and from pending to passed is still
  named. The existing tests that expect `passed again` are turned round.
- `register.test.ts`, SAL-162: a poll that reads a check passing again, with
  nothing else changed, submits no prompt; the existing test of an overtaken
  poll that hands over "a rerun that passed" still hands over the move from
  failed to passed.
- `register.test.ts`, SAL-258: the watch tool's told write is held (through
  `storeHoldingTold`) while a poll runs under the new watch; the poll submits
  no prompt; after the write lands, the next poll with nothing changed
  submits none either, and a real change after that is handed over. A
  failed told write does not stop later handovers.
- `register.test.ts`, SAL-270: with the hooks loaded afresh over a saved
  state (`reloadedOver`) and the first read of the hold refused, the session
  start arms a retry; 15 minutes later it arms the hold's timer when a hold
  is saved, and the resume comes once at the saved time, and it arms the
  stuck timer when none is, and the stuck prompt comes. A retry whose own
  read is refused arms another retry.
- All four gates in the project's `CLAUDE.md` pass.

Nobody watched the SAL-162 change on a live pull request with checks; this
repository runs none.

## Decided by the counsel

- When a check on the watched pull request completes again with the same passing result it had before (today the prompt says `Check "<name>" passed again.`), should that still change the pilot mod's fingerprint and start a turn of the session? The counsel chose No. A check that completes again and passes, the same as it last passed, no longer changes the fingerprint or produces a sentence. A check that fails again still does. The mod does not try to tell whether the session itself reran the check: a rerun of a failed check that passes is a move from failed to passed, which is still news, and a rerun the session asks of a passing check usually shows pending first, which is also a move., 6 of 6.
- When `armUnattended`'s own read of the usage-limit hold is refused (SAL-270), what should the mod arm so the unattended session is never left with no timer? The counsel chose Arm a retry of the whole arming step at RESUME_FALLBACK_MS (15 minutes), in the hold's timer slot. When it fires, it reads the hold again and arms the hold's timer if a hold is on, and the stuck timer if none is. A refused read at that retry arms the same retry again., 6 of 6.
- A workflow triggered by `pull_request: labeled` will still start turns after this change, because each unfinished workflow run is in the fingerprint by its id and attempt (a turn when it appears, another when it finishes). Should this pull request also do something about that? The counsel chose No. Leave the unfinished-run part of the fingerprint as it is and say so in the spec's Non-goals, with the reason: the merge step waits on unfinished runs and the mod starts its turn when they finish, so the finish turn is needed; file nothing., 5 of 6.
- SAL-162's "Done when" says "Someone has watched whether this is noisy in practice." This repository has no checks, and no pull request with checks is being watched. How should this pull request treat that condition before merging and marking SAL-162 done? The counsel chose Treat the owner's 2026-10-13 instruction in SAL-281 (decide with the counsel) as replacing the watch condition. Verify with tests only, say in the spec and the pull request that nobody watched it live, and mark SAL-162 done on merge., 6 of 6.
- To close SAL-258, what should a delivering look (a poll, or the held handover at a turn's end) do when it finds that a record of what the session was told has been claimed but not yet written? The counsel chose Hand nothing over whenever any told record's write is in flight, whichever look or tool claimed it. The next poll compares the pull request with the written record, so a change is delayed by at most one poll and never lost, as the other guards in deliver already do., 6 of 6.
