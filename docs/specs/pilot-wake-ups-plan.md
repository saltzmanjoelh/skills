# Plan: the pilot mod starts no repeated, noisy or missing turns

Spec: `docs/specs/pilot-wake-ups.md`. Written 2026-10-13.

## Chosen approach

Three planners worked blind: the simplest change, the most robust one and
the most extensible one. A judge scored the most robust plan highest (8 of
10, against 7 for the extensible plan and 6.5 for the simplest). It was the
only one that closed the race in which a delivering look's read of the told
record begins during a write and answers with the old record after the write
has landed. The spec now says so in Behavior 1. The plan below is that plan
with the grafts listed after it.

1. **The passing rerun, in `mods/pilot/hooks/github.ts`.** A private helper,
   `isRepeatNews(state)`, answers whether a check that completed again in the
   same state is news: it is unless the state is `passed`. `fingerprintOf`
   leaves a check's completion time out when the repeat is not news, and
   `completedAgain` skips such a name, so the fingerprint and the wording
   always agree. The comments above `fingerprintOf`, `checkSentences` and
   `completedAgain` are rewritten to match. Nothing is stored differently;
   `isSameState` recomputes both fingerprints, so an older build's told record
   compares correctly.
2. **The refused hold read, in `mods/pilot/hooks/register.tsx`.**
   `setHoldTimer`'s boolean `isAfterClear` becomes a named kind of work,
   `'resume' | 'after-clear' | 'arm'`, chosen with a plain `switch`. `'arm'`
   runs `armingRetry($, gen)`, which does nothing when the hold's number has
   moved on and otherwise calls `armUnattended`. `armUnattended` notes the
   hold's number before its read of the hold; when that read is refused and the
   number has not moved, it calls `setHoldTimer($, gen, RESUME_FALLBACK_MS,
   'arm')` and rethrows to `ensureArmed`. When a retry's own read is refused,
   both `armUnattended`'s catch and `setHoldTimer`'s own catch arm the same
   retry in the same slot under the same number; the second cancels the first,
   which the comment says. The rule comment above `stuckTimer` names the retry.
3. **The repeated handover, in `mods/pilot/hooks/register.tsx`.** A module
   counter, `toldWrites`, beside `untoldOwnReads`. `tell` raises it immediately
   after `toldSeq = seq`, with no await between, and lowers it in a `finally`
   that covers everything after, including `promptedKey`, the queued write and
   `schedule`. `newestFor` answers null while it is raised, which covers both
   choice points in `deliver`. `deliver` also returns false at once when it is
   raised at the moment `toldSeqBeforeRead` is noted, read in the same step.
   `fireStuck` drops the stuck prompt while it is raised. Comments are
   rewritten: the counter's own (what raises it, who reads it, that a write
   that never settles holds handovers back, that a hot reload resets it), the
   block above `toldSeq`, `newestFor`'s list of null cases (now three), and the
   block in `deliver` that lists what keeps the told record up to date, which
   names the counter instead of the marks and the claim.
4. **Documents.** The bullet about the passing rerun in the Non-goals of
   `docs/specs/pilot-checks-and-runs.md` is rewritten to say this change
   settled it, as the counsel decided on 2026-10-13, and that nobody watched
   it live.
   `mods/pilot/README.md` does not describe a passing check completing again,
   so it is unchanged.

## Grafts

- **From the extensible plan, one rule for what a repeat means.** Both
  `fingerprintOf` and `completedAgain` call `isRepeatNews`, because if they
  disagreed the session would get a turn whose prompt says nothing, which is
  the passing rerun again. It is not exported, since nothing outside `github.ts` uses
  it.
- **From the extensible plan, two tests.** Seven failing reruns and two
  passing ones give `7 checks completed again.`; a check passing again beside
  an added label gives only the label sentence. They are the only tests of
  the spec's counting and wording clauses.
- **From the simplest plan, a small switch rather than a lookup table** for
  the hold timer's kinds of work.
- **From the simplest plan, where the counter is raised:** after the claim,
  not before the `seq < toldSeq` check, which matches "from the moment it
  claims its number".
- **From the judge, a test of the stuck prompt** while a told write is held,
  which no plan had.

## Rejected alternatives

- **An inline timer for the arming retry (the simplest plan).** It copies
  `setHoldTimer`'s slot handling by hand and has to remember both to cancel
  the slot and to catch `armHold`'s rethrow; routing it through
  `setHoldTimer` gets both for free.
- **A merged `isTellPending()` predicate (the extensible plan).** It folds the
  marks and the counter into one name, which makes the comments in `deliver`
  and `newestFor` that must name each reason harder to write truly.
- **Ending the count before `schedule` (the simplest plan).** The spec says
  the `finally` covers the whole of `tell`.
- **Raising the counter from `watch` before `update(run)` (the robust
  plan's second addition).** A poll left by the previous watch can fire in
  the awaits between `update(run)` and `tell`'s claim, find no told record
  for the new pull request, and hand over the whole state. It is a
  different window from the repeated handover's, the fix would contradict the spec's rule
  that the count lives in `tell` alone, and the poll would have to finish a
  `gh` read inside a few store calls, so it needs a stalled store. It is not
  filed: the run allows one follow-up, for a problem a person could run
  into, and this one needs a stall. A reviewer who judges otherwise can
  raise it, and a cleaner fix is for `watch` to claim its number before
  `update(run)`.
- **Waiting for the write inside `deliver`.** The counsel rejected it: it
  adds an await inside the ordered region and misses a write that is still
  reading `promptedKey` and so not yet queued.
- **Recording the session's reruns.** The counsel rejected it.

## Steps

Each step writes its tests first and sees them fail, then makes them pass,
and is committed on its own.

1. The passing rerun: tests in `github.test.ts` and `register.test.ts`, then
   the change in `github.ts`.
2. The refused hold read: tests in `register.test.ts`, then the change in
   `register.tsx`.
3. The repeated handover: tests in `register.test.ts`, then the change in
   `register.tsx`.
4. The Non-goals bullet in `docs/specs/pilot-checks-and-runs.md`.
5. All four gates.

## Test plan

**`github.test.ts`**

- Turn round "a name whose state moved gets only its move, and a passing
  rerun is named as passing again" (around line 241): the move is still
  named, and a passing rerun of a passing check keeps its fingerprint and
  gives no `passed again`. Fails before: the fingerprints differ.
- Turn round the test of two runs of one name completing at the same time
  (around line 321): passed at T1 before, failed and passed at T2 after,
  give the same fingerprint and neither `failed again` nor `passed again`.
  Fails before.
- New: a commit status that passes again keeps its fingerprint; one that
  fails again changes it and is named as failing again. The passing half
  fails before.
- New: seven failing reruns and two passing ones give
  `['7 checks completed again.']`. Fails before (`9 checks completed
  again.`).
- New: seven passing repeats and one failing repeat give only
  `['Check "tests" failed again.']`. Fails before (`8 checks completed
  again.`).
- New: a check passing again beside an added label gives only the label
  sentence. Fails before.
- New: moves from failed to passed and from pending to passed are still
  named. A guard, which passes before too.
- New: a told record an older build saved, carrying a stale fingerprint and
  a passing check at T1, is the same state as a fresh read passing at T2.
  Fails before.

**`register.test.ts`, the passing rerun**

- New: a poll that reads a check passing again, with nothing else changed,
  submits no prompt, and the wake log calls it unchanged. Fails before.
- Rework the overtaken-poll test (around line 3195) so the session is told a
  failure, the held poll reads the failure again, and the newer look stores
  a pass: one prompt naming the move from failed to passed, none saying
  `failed again`, and the told record passed at the newest time. As it
  stands it would submit nothing after the change.
- The failed-again test around line 1693 stays as a guard.

**`register.test.ts`, the refused hold read** (`refusedReads(on, 'usageHold')`
registered before `reloadedOver`, and `refusal.reads` asserted to be zero after
the session start, so the refused read is `armUnattended`'s)

- New: loaded afresh during a hold with the first read refused, the resume
  comes once at the saved time and not again. Fails before: nothing is
  armed.
- New: loaded afresh with no hold and the first read refused, the stuck
  prompt comes after the retry. Fails before. If another path arms it, the
  test asserts the timing the retry gives.
- New: a retry whose own read is refused arms another, and the resume still
  comes once. Fails before.

**`register.test.ts`, the repeated handover** (`storeHoldingTold`)

- New: with the watch tool's told write held, a poll under the new watch
  submits nothing; once the write lands, the next poll with nothing changed
  submits nothing; a later real change is handed over. Fails before.
- New: with the watch tool's write held and then the poll's read of the told
  record held, releasing the write and then the read leaves no prompt.
  Fails before, and fails with only the two later checks.
- New: with a told write held across the stuck timer's time, no stuck prompt
  comes; once it lands, the stuck prompt does. Fails before.
- New: a told write that fails does not stop later handovers. It passes
  before the change, because there is no counter; it guards the `finally`,
  and is shown failing by moving the decrement out of the `finally` for one
  run, which the pull request says.

**Gates.** All four gates in the project's `CLAUDE.md`. No gate reads
`docs/`.
