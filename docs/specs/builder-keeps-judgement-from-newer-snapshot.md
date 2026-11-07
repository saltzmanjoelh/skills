# A stale label job keeps a judgement made from a newer snapshot

Date: 2026-11-06. Issue: a follow-up filed from the review of the change
that made the builder mod the single writer of a judgement `stuck` (see
`docs/specs/builder-sets-judgement-stuck.md`).

## Goal

A look stores its snapshot of the pull request outside the label queue and
then queues a state label job (`settleStateLabel` in
`mods/builder/hooks/register.tsx`). The job reads the snapshot when it
starts and then waits on GitHub. Meanwhile a newer look can store a snapshot
whose step gives the label the job is replacing, and the session can call
`mcp__builder__set_stuck`, which judges under that label. When the old job
saves its record of the new label, `saveLabelRecord` moves the judgement
onto the new label, because it cannot tell this judgement from one made
while the step gave no label. The next job then sees the step give the
judged label, not the label the judgement now carries, ends the judgement
and takes `stuck` off while the session is still asking the person.

After this change, a judgement records whether its label came from a step,
and `saveLabelRecord` moves only a judgement whose label did not, so a stale
job never moves a judgement made from a newer snapshot.

## Users and trigger

The session running `/implement`, when it calls the set_stuck tool while a
state label job that started from an older snapshot is still waiting on
GitHub. The person reads the label on the pull request.

## Behavior

1. **The marker.** A judgement may carry an optional field `fromStep: true`.
   It is written only when the judgement is marked and left out otherwise.
2. **When the tool marks a judgement.** The set_stuck tool marks the
   judgement when the step it reads gives a label. When the step gives no
   label and the tool judges again under the label of a judgement already
   recorded, the new judgement keeps that judgement's marker, marked or not.
   When the step gives no label, no judgement is recorded and the tool
   judges under the label the mod last recorded, the judgement is unmarked.
3. **The carry rule.** When `saveLabelRecord` finds a stored judgement that
   is newer than the one the job started from, and the judgement is under
   the label the job is replacing or the label of the job's starting
   judgement:
   - a marked judgement is carried unchanged, with its marker, unless the
     job's starting judgement was also marked and has the same label;
   - in that case the newer judgement may be a copy of the starting one,
     made again while the step gave no label, so it is moved onto the new
     record's label, unmarked, as today;
   - an unmarked judgement is moved onto the new record's label, as today,
     and the moved judgement is unmarked;
   - when the new record's label is `stuck`, the judgement is carried
     unchanged, marked or not, as today.

   A newer judgement under any other label is carried unchanged, with its
   marker, as today.
4. **The parser.** The record parser keeps `fromStep: true` and reads any
   other value, or none, as unmarked, keeping the judgement itself. A
   judgement whose label or time is of the wrong shape is still left out.
5. **Old records.** A judgement stored before this change has no marker, so
   it reads as unmarked and is treated exactly as on the base branch. An
   older mod reading a new record ignores the marker and keeps the
   judgement.
6. **The texts.** The doc comments on the judgement record in
   `mods/builder/hooks/step.ts`, on `serveSetStuck` and on `saveLabelRecord`
   say what the marker means and when it is written, carried and dropped.

## Edge cases

- The issue's race: a job replacing `in-review` with `waiting-on-author`
  waits before its save, a newer look's step gives `in-review`, and the
  session calls the tool. The judgement is marked, the job's save carries it
  unchanged onto the record of `waiting-on-author`, and the tool's own job,
  which reads the newer snapshot, keeps `stuck` on.
- The runs cannot be read and the tool is called again after a marked
  judgement made while a stale job waited: the new judgement keeps the
  marker, so that job, which started without it, does not move it.
- A job starts from a marked judgement and replaces its label, and while it
  waits the runs cannot be read and the tool judges again under that label:
  the copy is marked, but the job started from a marked judgement under the
  same label, so its save moves the copy onto the new label, unmarked, and
  `stuck` stays on once the step gives that label, as today.
- The case left as today: a job starts from a marked judgement under a label
  and ends it, a newer look's step gives that label again, and the tool
  judges before the job saves. The save moves the fresh judgement, and the
  next look takes `stuck` off, as on the base branch. Telling it apart from a
  copy would need the marker to record which snapshot it came from.
- The runs cannot be read and nothing marked is recorded: the judgement is
  unmarked and is moved onto the job's new label, as today, so `stuck`
  stays on once the step gives that label.
- A judgement moved onto a job's new label carries no marker, so a later
  stale job replacing that label moves it again, as any unmarked one.
- A marked judgement whose step later really changes to another label ends
  at the next look, as any judgement does when the step's label differs.

## Non-goals

- No change to which label each step gives, to the tool's answers or
  refusals, to `labelActionOf` or `isJudgementKept`, to the skill or step
  texts, to foreman, or to the label queue and record queue.
- No migration of old judgements, which read as unmarked.
- No fix for a look storing its snapshot outside the label queue, the root
  of a stale job; the marker makes a stale job harmless here without it.
- No tool answer that says whether a judgement was marked.
- No pure function extracted from `saveLabelRecord` for its own tests.

## Failure modes

- A malformed marker reads as unmarked, so the judgement behaves as on the
  base branch and is never dropped for it.
- A store that refuses the save keeps the record as it was, as today, and
  the next look tries again.

## Verification

- Fake-world tests in `mods/builder/tests/register.test.ts`:
  - the issue's race, as in the first edge case: after the job's save
    `stuck` stays on, the record holds the marked judgement unchanged, and
    the tool answers that `stuck` is on. On the base branch this test fails,
    because the save moves the judgement onto `waiting-on-author`;
  - a judgement made again from a stored marked one while the runs cannot be
    read keeps `fromStep` and survives the same stale job;
  - the two existing tests where a judgement made while the runs could not
    be read moves onto the job's new label still pass unchanged, and assert
    that the moved judgement carries no `fromStep`.
- Unit tests in `mods/builder/tests/step.test.ts` of the parser:
  `fromStep: true` round trips, and any other value or none reads as
  unmarked and keeps the judgement.
- The four gates in the project's `CLAUDE.md` pass.

## Decided by the counsel

- How should the builder mod tell a set_stuck judgement made from a newer snapshot whose step gives the label a running state label job is replacing, which must be kept as it is, apart from one made while the step gave no label, which must still be moved onto the job's new label? The counsel chose: The judgement records where its label came from. serveSetStuck saves it with a marker when the label came from the step itself, and without it when the step gave no label and the label came from the judgement or record already stored. saveLabelRecord moves only an unmarked judgement onto the new label, and carries a marked one unchanged. A judgement stored before this change has no marker and is treated as today. 7 of 7 members voted for it.
- When set_stuck is called while the step gives no label and a judgement is already recorded, the tool judges again under that judgement's own label. Should the new judgement carry the marker that says its label came from the step, and what should a judgement that saveLabelRecord moved onto a job's new label carry? The counsel chose: A judgement made again from the stored judgement's label keeps the stored judgement's marker, because its label still came from a step at the first call. A judgement that saveLabelRecord moves onto the job's new label is unmarked, and a carried-unchanged judgement keeps its marker. 5 of 7 members voted for it.
- What should this change deliberately leave out? The counsel chose: Narrow: only the marker and the carry rule in saveLabelRecord change, with the doc comments on the record, serveSetStuck and saveLabelRecord and the paragraph in docs/specs/builder-sets-judgement-stuck.md that the change contradicts. No change to which label each step gives, to the tool's answers or refusals, to labelActionOf or isJudgementKept, to the skill or step texts, to foreman, or to the label queue and record queue; no migration of old judgements, which read as unmarked; no fix for a look storing its snapshot outside the label queue. 7 of 7 members voted for it.
- How should the marker be stored in the judgement, and how should the record parser treat a marker of the wrong shape? The counsel chose: An optional boolean field on the judgement, `fromStep: true`, written only when the judgement is marked and left out otherwise. The parser keeps `fromStep: true` and reads any other value, or its absence, as unmarked, keeping the judgement itself, so a malformed marker never drops a judgement and errs toward today's behaviour. 7 of 7 members voted for it.
- How will we know the change works: which tests should the spec require? The counsel chose: Fake-world tests in mods/builder/tests/register.test.ts: the issue's race (a job replacing in-review with waiting-on-author waits before its save, a newer look's step gives in-review, the tool judges marked, and after the save stuck stays on, the record holds the marked judgement unchanged, and the tool answers that stuck is on); a re-made judgement from a stored marked one while the runs cannot be read keeps fromStep and survives the same stale job; the two existing move tests still pass and assert the moved judgement carries no fromStep. Unit tests in mods/builder/tests/step.test.ts of the parser: fromStep: true round trips, any other value or none reads as unmarked and keeps the judgement. Plus the four gates. 7 of 7 members voted for it.
- The spec's carry rule conflicts with its own Verification section. A judgement is marked under in-review, a state label job starts from it and replaces in-review with waiting-on-author, and while that job waits before its save the runs become unreadable and set_stuck judges again under the stored judgement's label, keeping its marker. Under the spec's carry rule the job's save carries that marked judgement unchanged, so once the runs can be read and the step gives waiting-on-author, the judgement ends and stuck comes off, which breaks the existing test that expects it to move onto waiting-on-author and keep stuck. How should the spec resolve this? The counsel chose: Add one exception to the carry rule: a marked newer judgement is carried unchanged unless the job's starting judgement was also marked and has the same label, in which case it may be a re-made copy of that starting judgement and is moved onto the new label, unmarked, as on the base branch. The existing test near line 16444 keeps passing unchanged. One rare case stays as on the base branch: the job ends a marked judgement under a label, a newer look's step gives that label again, and the tool judges before the job saves. 7 of 7 members voted for it.
