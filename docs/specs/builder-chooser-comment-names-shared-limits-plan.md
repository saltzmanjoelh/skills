# Plan: the step chooser's comment names the shared limits

Date: 2026-11-06. Spec: `builder-chooser-comment-names-shared-limits.md`.

## Chosen approach

Two planners competed, one aiming for the smallest change and one for the
most robust result, and a judge compared them against the spec. The robust
plan won. Both plans replace only the comment above the review-request block
in `chooseStep`, in `mods/builder/hooks/step.ts`, and keep its first four
lines, which explain the time limits and are still correct. The lines after
them are replaced with text that says the pushes and rounds limits are read
through `limitsPassedIn` and so are not copied, lists the conditions that
`overdueAtLimitStep` does copy by hand in the order its code checks them,
says that the open question is left out on purpose, gives the purpose, and
says that a change to the copied conditions must change
`overdueAtLimitStep` too.

The new lines are these, with the file's two-space indent:

```
  // overdueAtLimitStep in github.ts reads the pushes and rounds limits
  // through limitsPassedIn, as this function does, so those are not copied.
  // overdueAtLimitStep repeats by hand only the other conditions above: both
  // verdicts approve, the /code-review pass is recorded, the pull request
  // does not conflict, no check or run at the head failed, and no outside
  // reviewer has feedback or lacks a request. The open question is left out
  // on purpose, so its absence from this list is not an omission. The aim is
  // that the fingerprint counts an overdue reviewer only where this block is
  // reached. A change to the copied conditions must change
  // overdueAtLimitStep too.
```

## Grafts

- From the smallest-change plan, the judge took the point that every
  sentence must say what it is about. The winning text had two sentences
  that began with "It" right after a sentence about `chooseStep`, so the
  final text names `overdueAtLimitStep` and the open question instead.
- The closing sentence is rewrapped so that its last line is not a single
  word, and says "must change" to make the instruction plain.

## Rejected alternatives

- The smallest-change plan's text dropped the words "so those are not
  copied", which are what tell a reader that less is duplicated than the old
  comment said, and it left "Its purpose" and "changes it too" with no clear
  subject.
- Naming the merged and closed steps in the comment. `chooseStep` checks
  them above the block and `overdueAtLimitStep` does not, but the old
  comment was already silent on them, the spec's list leaves them out, and
  the list must say only what the code checks.

## Steps

1. Replace the comment lines in `step.ts` with the text above.
2. Check that every line is at most 78 columns wide.
3. Read `overdueAtLimitStep` in `mods/builder/hooks/github.ts` beside the new
   comment and tick each listed condition against its line.

## Test plan

- The spec's first verification: step 3 above.
- The spec's second verification: `git diff origin/main -- mods/builder`
  shows only changed comment lines in `step.ts`. This is checked by hand,
  not by a new test, because the spec rules out a test of the comment.
- The spec's third verification: all four gates of the project's
  `CLAUDE.md`, reported with the note that no gate reads the comment.
