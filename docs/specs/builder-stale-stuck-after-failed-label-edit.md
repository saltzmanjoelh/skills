# A failed label edit or read leaves no stale stuck

Date: 2026-11-04. Issue: a follow-up filed from the review of the change that
made the builder mod set the pull request's state label itself (see
`docs/specs/builder-sets-labels-stages-and-lists-commits.md`).

## Goal

The builder mod derives a state label (`in-review`, `waiting-on-author`,
`ready-to-merge` or `stuck`) from the step it chooses and sets it on the pull
request. The session may also put `stuck` on by its own judgement, and the mod
leaves that `stuck` alone until the label that follows from the step changes.

To tell such a judgement `stuck` from an older one after an edit that failed,
`settleStateLabel` in `mods/builder/hooks/register.tsx` notes the derived label
in the stored record, and `labelActionOf` in `mods/builder/hooks/step.ts`
counts "the derived label equals the noted one" as "the step has not changed".
Today the note is saved before the labels are read, and it is never cleared
when the step goes back to the recorded label. So after one failed read or
edit, a `stuck` that was already on before the step changed is taken for a
judgement made after it, and the mod records the new label without writing
it. A person then sees `stuck` on a pull request that is back in review or
ready to merge, until the step changes again.

The trace: the record says `ready-to-merge`, a judgement `stuck` is on, and
the step changes to Review this head. The edit that adds `in-review` and
removes `stuck` fails, or the read of the labels fails. On the next look the
noted label equals the derived one and `stuck` is on, so the label is only
recorded and `stuck` stays.

After this change, a `stuck` that was on before the step's label changed is
removed at the next look that succeeds, and a `stuck` the session puts on
after a successful read is still left alone.

## Users and trigger

The person reading the pull request's labels, and the session, which reads
them to decide what to do. The failure needs a `gh pr edit` or a
`gh pr view` of the labels to fail, for example because of a network error
or a rate limit, on the job that follows a change of the step's label.

## Behavior

1. **The note records what a read saw.** The note is the label the step gave
   at a job that did not finish, together with whether that job's read of the
   labels saw `stuck`. It is saved only after the read of the labels succeeded
   and the watch is still on this pull request, and before any edit, so a
   failed edit keeps it. A read that fails saves no note.
2. **The first successful read decides.** A job whose derived label differs
   from the recorded one saves a note when the record has no note for that
   label. A note for another label is replaced. A note for the same label is
   kept as it is, so a later read cannot turn an older `stuck` into one that
   looks set by judgement. With no record at all, no note is saved, because
   the rule for a missing record already applies.
3. **How the note is used.** While `stuck` is on, the derived label is only
   recorded, with any other state label beside `stuck` removed, when there is
   no record, or when the record's note, as it stood before this job, is for
   the derived label and says its read did not see `stuck`. In every other
   case the derived label is written and `stuck` is removed with the other
   state labels the read saw.
4. **The note is cleared when the step goes back.** When the derived label
   equals the recorded one and the record holds a note, the note is removed
   from the record. Nothing else changes and no label is edited.
5. **A finished job saves no note.** When a job saves its new record, after
   every edit it needed succeeded, the record holds the label and the time
   and no note.
6. **Old records.** A record written before this change may hold a `derived`
   field saved before the read. The new note is stored under a different
   field, and the old field is ignored, so such a record reads as a record
   with no note.
7. **The texts that describe the note say the same.** The doc comments on
   `settleStateLabel`, `labelActionOf` and the record type, and the paragraph
   on the state label in `mods/builder/README.md`, describe the note as a
   record of what a successful read saw.

## Edge cases

- The edit fails after a read that saw `stuck`: the next look writes the
  derived label and removes `stuck`. This is the issue's trace.
- The read fails before any read succeeded: no note, so the next successful
  look writes the derived label and removes any `stuck` it sees.
- The edit fails after a read that did not see `stuck`, and the session then
  puts `stuck` on: the next look records the derived label without a write and
  leaves `stuck` on, as the existing test for this case requires.
- The step goes from one label to another and back, with failures in between:
  each new label replaces the note with what its own first successful read
  saw, and a return to the recorded label clears it.
- The derived label is `stuck` itself: the rules above treat it like any other
  label, as today.
- A restart keeps the record and its note, because both are in the store.

## Non-goals

- The narrow race in the shared label queue: a state label job that waits
  in the queue can remove a judgement `stuck` that the session put on after
  the step changed but before the job's first read. This change leaves it as
  it is, and a follow-up issue tracks the cure the reviewers suggested, a
  single writer, with the session asking the mod to set a judgement `stuck`
  instead of editing the label itself.
- A `stuck` the session puts on while every read fails: with no successful
  read the mod cannot tell it from an older one, so the next successful look
  removes it, and the session can put it on again.
- No change to which label each step gives, to the step texts, or to the
  `implement` skill.
- No migration of old records beyond ignoring their `derived` field.

## Failure modes

- A failed read or edit saves no new label record and is tried again at the
  next look, as today.
- A failed write of the note itself, to the store, means the next job sees no
  note and counts the step as changed, so it writes the derived label.

## Verification

- A fake-world test in `mods/builder/tests/register.test.ts`: a
  `ready-to-merge` record, `stuck` on, the step changes to Review this head,
  and the edit fails; the next look adds `in-review` and removes `stuck`, and
  the record then says `in-review` with no note.
- The same with the read of the labels failing instead of the edit.
- A test that the note is cleared when the step goes back to the recorded
  label, and that a later change of the step then removes an older `stuck`.
- The existing test 'a stuck the session sets after an edit failed is kept
  while the label the step gives stays the same' still passes, with its
  record expectations changed to the new note.
- Unit tests of `labelActionOf` for a note that saw `stuck`, a note that did
  not, a note for another label, and no note; and of the record parser for a
  valid note, a note of the wrong shape, and an old `derived` field.
- The four gates in the project's `CLAUDE.md` pass.

## Decided by the counsel

- How should the builder mod tell a `stuck` label that was already on the pull request before the step's label changed (which it must remove) from a `stuck` the session set by its own judgement after the change (which it must leave alone), once an edit or a read of the labels has failed in between? The counsel chose: Note, at the first job after the step's label changes whose read of the labels succeeds, the new label together with whether that read already saw `stuck`, and save that note only after the read succeeds. A later job treats a `stuck` as the session's judgement only when the note is for the same label and its read did not see `stuck`; otherwise it writes the new label and removes `stuck`. The note is also cleared when the step goes back to the label the mod last set. 7 of 7 members voted for it.
- What should this change deliberately leave out, given that the issue also describes a known narrow race (a label job delayed in the shared label queue removes a judgement `stuck` the session set before the job's first read), for which reviewers suggested a single writer, with the session telling the mod about a judgement `stuck` through the mod instead of editing the label itself? The counsel chose: Narrow: change only the note and its use (when it is saved, what it holds, clearing it), the tests, and the README paragraph and doc comments that describe the note. Leave the queue race and the single-writer design out, and file one follow-up issue for the single writer so the race is tracked on its own. 7 of 7 members voted for it.
