# The step chooser's comment names the shared limits

Date: 2026-11-06. Seeded from a follow-up that the counsel filed while
reviewing the change that put time limits on requested outside reviews.

## Goal

The comment above the review-request block in `chooseStep`, in
`mods/builder/hooks/step.ts`, says that `overdueAtLimitStep` in
`mods/builder/hooks/github.ts` repeats by hand the conditions checked above
it. Since that change, both functions read the pushes and rounds limits
through one shared function, `limitsPassedIn`, so only the other conditions
are copied. A maintainer who reads the comment today would think more logic
is duplicated than really is. The comment should say exactly what is shared
and what is copied.

## Users/Trigger

A maintainer who edits the conditions in `chooseStep` that come before the
review-request block, and reads the comment to learn what else must change.

## Behavior

- The comment in `step.ts` says that `overdueAtLimitStep` reads the pushes
  and rounds limits through `limitsPassedIn`, as `chooseStep` does.
- It says that `overdueAtLimitStep` repeats by hand only these of the
  conditions above the block: both verdicts approve, the `/code-review` pass
  is recorded, the pull request does not conflict, no check or run at the
  head failed, and no outside reviewer has feedback or lacks a request. It
  also says that `overdueAtLimitStep` does not check whether the pull
  request is merged or closed, which `chooseStep` checks first.
- It keeps the existing points that the open question is left out, that
  the purpose is for the fingerprint to count an overdue reviewer only where
  the block is reached, and that a change to the copied conditions must
  change `overdueAtLimitStep` too.
- The list of copied conditions matches the code of `overdueAtLimitStep` at
  the time of the change.

## Edge cases

- The open question is checked in `chooseStep` but deliberately not in
  `overdueAtLimitStep`; the comment keeps saying so, so a reader does not
  take its absence from the list for an omission.

## Non-goals

- The comment above `overdueAtLimitStep` in `github.ts` stays as it is,
  because it is already accurate.
- No code changes. The duplication of the other conditions is not removed
  or refactored into a shared function.
- No live test of the GitHub queries and no list for collecting later
  findings: the owner removed both from the issue, because the repository
  has no continuous integration to run such a test and the list had nothing
  to build.
- No test checks the comment's wording, because no gate reads comments.

## Failure modes

The only failure is a comment that is still wrong or newly wrong, such as a
list of copied conditions that does not match the code. Nothing a session
does depends on it.

## Verification

- Reading `overdueAtLimitStep` beside the new comment shows that every
  condition the comment calls copied is checked by hand there, that the
  pushes and rounds limits come from `limitsPassedIn`, and that nothing else
  is checked.
- `git diff origin/main` touches only the comment lines in `step.ts`, apart
  from this spec and its plan.
- All four gates in the project's `CLAUDE.md` pass, which shows the change
  broke nothing, though no gate reads the comment itself.

## Decided by the counsel

- The comment above the review-request block in chooseStep (mods/builder/hooks/step.ts) says that overdueAtLimitStep in github.ts repeats by hand every condition checked above it. The pushes and rounds limits are now shared through limitsPassedIn, so only the other conditions are copied. How should the change fix the comment? The counsel chose: Reword the comment in step.ts only: say that overdueAtLimitStep reads the pushes and rounds limits through limitsPassedIn, as chooseStep does, and repeats by hand only the other conditions above (verdicts, the /code-review pass, mergeability, failed checks and runs, outside feedback or no request), so a change to those must change it too. 6 of 7 members voted for it.
