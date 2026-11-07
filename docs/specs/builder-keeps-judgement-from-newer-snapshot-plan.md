# Plan: a stale label job keeps a judgement made from a newer snapshot

Spec: `docs/specs/builder-keeps-judgement-from-newer-snapshot.md`. Date:
2026-11-06.

## Chosen approach

The most-robust plan won. The judgement gains an optional `fromStep?: true`.
The parser keeps the marker only when it is exactly `true`. The set_stuck
tool marks a judgement whose label came from the step, and a judgement it
makes again from a stored judgement keeps that judgement's marker.
`saveLabelRecord` carries a marked newer judgement unchanged, except when
the job's own starting judgement was also marked and has the same label,
because then the newer judgement may be a copy of it; that one, and every
unmarked one, is moved onto the new label without a marker, as today.

## Grafts from the runners-up

- From the simplest plan: the parser test lists the malformed markers one
  by one (`false`, `'true'`, `1`, `null`, `{}` and none), and wrong-shaped
  judgements that carry `fromStep: true` are still left out. It also keeps
  the exact assertions at lines 16099 and 16141 of `register.test.ts`
  unchanged, as the standing proofs of the two unmarked cases.
- From the most-extensible plan: the exception's boolean has an `is` name,
  `isMaybeCopyOfStart`, to match `isNewer` and `isUnderReplacedLabel`.
- From the judge: the test of a judgement made again must end with the runs
  readable and the step giving `in-review`, and check that `stuck` stays on,
  because while the runs cannot be read the base branch keeps `stuck` too.

## Rejected alternatives

- The carry rule without the exception, with the test near line 16444
  reseeded with an old unmarked judgement. A judgement made again from the
  job's own marked starting judgement would then end and take `stuck` off,
  which the base branch gets right. The counsel rejected it, 7 of 7.
- Never marking a judgement made again while the step gives no label. It
  overturns an earlier counsel decision and lets a stale job move a copy of
  a judgement made from a newer snapshot.
- An exported constructor `stuckJudgement(label, at, fromStep)`. It is a new
  abstraction for two call sites, and its boolean argument is easy to
  misread where it is called.
- A marker that records which snapshot the label came from. It would close
  the one case left as today, but it overturns the decided storage shape.
- Re-reading the snapshot inside `saveLabelRecord`, or storing a look's
  snapshot inside the label queue. Both are beyond the spec's non-goals.

## State

The only new state is the marker, inside the existing state label record in
the store. It survives a restart and a resumed or cleared session, because
the record is keyed by the pull request. After a hot reload, or beside an
older copy of the mod, an older parser drops the marker and an older save
moves a marked judgement, which is the base branch's behaviour. Two copies
at once each have their own record queue, as before this change.

## Steps

1. Tests first, in `mods/builder/tests/step.test.ts` beside the record
   parser test near line 885: `fromStep: true` round trips; each malformed
   marker reads back as a judgement whose keys are exactly `label` and `at`
   (`toEqual` ignores fields whose value is undefined); a wrong label or a
   missing time with `fromStep: true` still leaves the judgement out.
2. Tests first, in `mods/builder/tests/register.test.ts` beside the test
   near line 16580:
   - The issue's race. A watch records `in-review`. With
     `world.labelAnswers = [JSON.stringify(['in-review'])]`, a held
     `world.labelsHold` and `world.pr = changesRequested(...)`, a second
     watch starts a job that writes `waiting-on-author` and holds before its
     save. Then `world.pr = openPullRequest({ labels: world.pr.labels })` and
     a 30-minute clock advance make a poll store a snapshot whose step gives
     `in-review`. `setStuck` records `{ label: 'in-review', at, fromStep:
     true }`. After the release the answer says `stuck is on o/r#7`, the
     pull request carries only `stuck`, the record is `waiting-on-author`
     with the marked judgement unchanged, and `stuck` is still on 30
     minutes later. On the base branch the save moves the judgement and the
     tool answers that no judgement is recorded.
   - A judgement made again from a stored marked one. The same set-up up to
     the first `setStuck`; then `world.runsReadsToFail = 100`, a poll, and a
     second `setStuck`, whose judgement is marked. After the release both
     answers say `stuck` is on and the record holds the second marked
     judgement unchanged. Then the runs are readable and the step gives
     `in-review`, and `stuck` stays on.
   - The tests near lines 16444 and 16491 stay as they are, and gain an
     assertion that the moved judgement has no `fromStep`; the test near
     16444 also asserts that the copy holds `fromStep: true` before the save.
   - Exact assertions on a marked judgement gain `fromStep: true`: lines
     15852, 15879, 15886 and 16335.
   Run the tests and see the new ones fail.
3. `mods/builder/hooks/step.ts`: add `fromStep?: true` to `StuckJudgement`;
   `judgementIn` returns the marker only when it is `true`; rewrite the doc
   comment above `StuckJudgement` and `LabelRecord`.
4. `mods/builder/hooks/register.tsx`, `serveSetStuck`: compute
   `isFromStep = derived !== null || record?.judgement?.fromStep === true`
   and build the judgement with or without the key, never with
   `fromStep: undefined`; extend the doc comment.
5. `mods/builder/hooks/register.tsx`, `saveLabelRecord`: after the existing
   carry branch, compute
   `isMaybeCopyOfStart = before?.fromStep === true && stored.label === before.label`;
   carry `stored` unchanged when `stored.fromStep === true && !isMaybeCopyOfStart`;
   otherwise move it unmarked as today. Rewrite the first rule of the doc
   comment into the marked case, its exception and the unmarked case.
6. `docs/specs/builder-sets-judgement-stuck.md`: Behavior point 4 says the
   judgement also carries the marker, citing the new spec; the edge case
   "The session calls the tool twice under the same label" says the second
   call can also add the marker; the edge case about a job waiting in the
   queue points to the new spec for a job already running.
7. Run the tests, then the four gates in `CLAUDE.md`.

## Test plan

The tests in steps 1 and 2 map to the spec's Verification section: the
issue's race, the judgement made again from a stored marked one, the two
existing move tests unchanged with no `fromStep` on the moved judgement, and
the parser's round trip and malformed markers. The four gates follow.
