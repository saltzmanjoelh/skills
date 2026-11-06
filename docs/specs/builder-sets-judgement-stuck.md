# The mod is the single writer of a judgement stuck

Date: 2026-11-05. Issue: a follow-up filed from the spec interview of the
change that stopped a failed label edit or read from leaving a stale `stuck`
(see `docs/specs/builder-stale-stuck-after-failed-label-edit.md`).

## Goal

The builder mod sets the pull request's state label from the step it
chooses, through a state label job that waits in the shared label queue
(`requestStateLabel` and `settleStateLabel` in
`mods/builder/hooks/register.tsx`). The session also puts `stuck` on by its
own judgement, today by running `gh pr edit` itself. When it does that after
the step's label changed but before the queued job's first read of the
labels, the job cannot tell that `stuck` from one that was on before the
change, and removes it. A person then sees a pull request the session judged
stuck shown as in review or ready to merge, and nothing puts `stuck` back.

After this change, the session asks the mod to set a judgement `stuck`
through a builder tool, `set_stuck`. The mod records the judgement before it
edits anything, so the state label job always knows which `stuck` is a
judgement, keeps it while the step's label stays the one it was judged
under, and the race is gone. The guessing rules that tried to tell a
judgement `stuck` from an older one are removed.

## Users and trigger

The session running `/implement`, at the points where a step's text or the
skill tells it to set `stuck` and ask the person: a check that failed for a
reason outside the code, the person declining to merge without checks, a
review request that fails or comes back, a push that fails, and commits that
could not be listed. The person reads the label on the pull request.

## Behavior

1. **The tool.** `mcp__builder__set_stuck` takes no input. It works only on
   the pull request the session watches.
2. **When it refuses.** It refuses, and says why, when nothing is watched,
   when the stored snapshot is of another pull request, or when the pull
   request is merged or closed. A refusal records nothing and edits nothing.
3. **The label it is judged under.** The tool works out the label the step
   gives from the stored snapshot, as the state label job does. When the
   step gives no label, as while the runs could not be read, it uses the
   label the mod last recorded, and refuses when there is none. When the
   step already gives `stuck` by itself (Over a limit), or the step gives no
   label and the label last recorded is `stuck`, it answers
   that `stuck` already follows from the step, records no judgement, and
   edits nothing.
4. **Record first.** The tool saves a judgement in the state label record:
   the label it is judged under and the time. With no record yet, it saves a
   record whose label is that label, with the judgement. When the store
   refuses the save, the tool answers with an error, which the session
   reports to the person, and it edits nothing.
5. **Then edit, and wait.** After the save, the tool runs the state label job
   in the label queue and waits for it. It answers that `stuck` is on, or
   that the edit failed and the mod will put `stuck` on at its next look
   because the judgement is recorded. Either way the session carries on with
   asking the person, and never edits the label itself.
6. **The job keeps a judgement.** While the record holds a judgement and the
   label the step gives equals the label it was judged under, the job makes
   the pull request carry `stuck` and no other state label: it puts `stuck`
   on when it is missing, removing the other state labels in the same edit,
   and removes any other state label beside it. The record is not changed.
7. **The job ends a judgement.** When the label the step gives differs from
   the label the judgement was made under, the job writes the new label,
   removes `stuck` and every other state label it saw, and saves a record of
   the new label with no judgement, once every edit succeeded. A failed edit
   or read keeps the judgement, so the next look tries again.
8. **No label from the step.** When the step gives no label, the job ends no
   judgement and writes no new label. While a judgement is recorded, it
   keeps `stuck` as point 6 says, as though the step's label were unchanged,
   so a judgement made while the runs could not be read still puts `stuck`
   on. With no judgement it changes nothing, as today. The Merged step is
   the exception: it changes nothing even while a judgement is recorded,
   because a merged pull request shown as stuck would mislead the person.
9. **A `stuck` with no judgement.** When the record holds no judgement, the
   job keeps today's plain rules: with no record, it records the label the
   step gives without writing it and leaves a `stuck` that is on, removing any
   other state label beside it; while the step's label equals the recorded
   one, it does nothing; when the step's label differs, it writes the new
   label and removes every other state label it saw, `stuck` included. The
   read after that edit removes every state label other than the one it
   added.
10. **The guessing rules go.** The note of what the first successful read
    after a change saw (`noteAfterRead`, the `note` field, `staleNoteKeys`)
    and the rule that kept a `stuck` appearing between the read and the edit
    (`labelsToRemoveAfterEdit`'s exception) are removed.
11. **Old records.** A record that holds a `note` or a `derived` field from
    before this change reads as a record with no judgement. Those fields are
    ignored and dropped at the record's next save.
12. **The texts.** The State labels section, "Commits the pull request lacks"
    and "Outside reviewers" in `skills/implement/SKILL.md`, and every step
    text in `mods/builder/hooks/step.ts` that tells the session to set
    `stuck`, name the tool instead of `gh pr edit`. The State labels section
    says what the tool answers and that the session never edits a state
    label itself. The paragraph on the state label in `mods/builder/README.md`,
    the comment above `STATE_LABELS` in `mods/builder/hooks/github.ts`, and
    the doc comments on the record, `labelActionOf` and `settleStateLabel`
    describe the judgement instead of the note.

## Edge cases

- The issue's race: the step's label changes, the session calls the tool
  before the queued job ran. The tool records the judgement under the new
  label, so the job keeps `stuck`.
- The session calls the tool while a state label job for an older step waits
  in the queue: the tool's job and the waiting one read the record and the
  snapshot when they run, one at a time, so both see the judgement.
- Someone takes `stuck` off by hand while the judgement holds: the next look
  puts it back.
- The edit fails, then the step's label changes before any look succeeds:
  the judgement ends at the first successful look, and the new label is
  written. The session's judgement was about a state that has passed.
- A judgement `stuck` can stay on after what blocked the pull request has
  gone, for as long as the step's label stays the same. That matches the
  rule on the base branch.
- A session started before this change, running the old skill text, edits
  the label itself. Its `stuck` has no judgement, so it is kept while the
  step's label stays the recorded one and removed when it changes. The race
  this change cures still applies to such a session.
- The session calls the tool twice under the same label: the second call
  replaces the judgement's time and changes nothing else.
- A restart keeps the record and its judgement, because both are in the
  store.

## Non-goals

- No tool or option to clear a judgement; it clears only when the step's
  label changes.
- No reason text stored, shown or posted.
- No change to `needs-decision`, to which label each step gives, or to
  foreman.
- No migration of old records beyond ignoring and dropping their `note` and
  `derived` fields.
- The skill and step texts change only to name the tool where they say to
  set `stuck`.
- A `stuck` the session sets on the Merged step, where the skill asks for it
  when commits could not be listed, is refused; the session still asks the
  person, as the skill says.

## Failure modes

- The store refuses the judgement: the tool answers with an error and edits
  nothing, and the session tells the person, so no `stuck` sits on the pull
  request without a judgement behind it.
- The edit or a read fails: the judgement stays recorded and the next look
  puts `stuck` on.
- The final save after a judgement ends fails: the judgement stays, and since
  the step's label still differs, the next look ends it again.

## Verification

- Fake-world tests in `mods/builder/tests/register.test.ts`:
  - the issue's race: the step's label changes, the tool is called before
    the job ran, and `stuck` stays on with the judgement recorded under the
    new label;
  - the tool's answer when the edit succeeds and when it fails, and that the
    next look after a failed edit puts `stuck` on;
  - a `stuck` removed by hand while the judgement holds is put back;
  - a change of the step's label ends the judgement, writes the new label,
    removes `stuck`, and saves a record with no judgement;
  - each refusal: nothing watched, the snapshot of another pull request, a
    merged or closed pull request, and no label from the step with no
    record;
  - no label from the step with a record: the judgement is recorded under
    the recorded label and kept while the runs cannot be read;
  - a step that gives `stuck` by itself: no judgement recorded;
  - a refused store save: an error answer and no label edit;
  - a hand-set `stuck` with no judgement is removed when the step's label
    changes, and kept after a restart with no record.
- Unit tests in `mods/builder/tests/step.test.ts` of `labelActionOf` with and
  without a judgement, and of the record parser for a valid judgement, a
  judgement of the wrong shape, and an old `note` or `derived` field.
- The existing test that no step text tells the session to set a label the
  mod sets is extended: every step text that says to set `stuck` names the
  tool, and none says `gh pr edit` with `--add-label`.
- The four gates in the project's `CLAUDE.md` pass. No gate reads
  `skills/implement/SKILL.md`, so its reviewers check it.

## Decided by the counsel

- How should the builder mod learn about, and keep, a `stuck` label that the session puts on by its own judgement, so that a state label job waiting in the label queue never removes it? The counsel chose: A new builder tool that the session calls to set a judgement stuck. The tool works out the label the step gives at that moment from the stored snapshot, stores a judgement in the state label record (the step's label at the call and the time), and puts `stuck` on through the same label queue. The state label job keeps `stuck` on, and puts it back if it is missing, while the step's label equals the one stored with the judgement, and clears the judgement and writes the new label once the step's label differs. 7 of 7 members voted for it.
- Once a builder tool records judgement `stuck` labels, what should the state label job do with a `stuck` that it finds on the pull request with no judgement recorded, such as one put on by a session still running the old skill text or by a person by hand? The counsel chose: Remove the note and the rule for a `stuck` that appears between the read and the edit. A `stuck` with no judgement recorded is left alone while the step's label stays the recorded one and removed when the step's label changes, as any other old state label is. Keep only the rule for a missing record, so a restart never removes a `stuck`. 6 of 7 members voted for it.
- When the session calls the new builder tool to set a judgement stuck, in what order should the tool record the judgement and edit the label, what should it answer, and what happens when the edit on GitHub fails? The counsel chose: Record the judgement in the store first, then run the edit in the label queue and wait for it. Answer that `stuck` is on, or that the edit failed and the mod will put `stuck` on at its next look because the judgement is recorded. The session never edits the label itself, and carries on with asking the person either way. Only a failure to save the judgement to the store is answered as an error, which the session reports to the person. 7 of 7 members voted for it.
- When should the new tool that sets a judgement stuck refuse a call, and what should it do when the step it reads gives no state label, or already gives `stuck` by itself? The counsel chose: The tool takes no pull request number and works only on the watched pull request. It refuses, saying why, when nothing is watched, when the stored snapshot is of another pull request, or when the pull request is merged or closed. When the step gives no label, as while the runs could not be read, it records the judgement against the label the mod last recorded, or refuses when there is none. When the step already gives `stuck` by itself, it answers that `stuck` already follows from the step and records no judgement. 7 of 7 members voted for it.
- What should this change deliberately leave out? The counsel chose: Narrow: no tool or option to clear a judgement (it clears only when the step's label changes), no reason text stored, shown or posted, no change to needs-decision, to which label each step gives, or to foreman, and no migration of old records beyond ignoring the old note field. The skill and step texts change only to name the tool where they say to set `stuck`. 7 of 7 members voted for it.
