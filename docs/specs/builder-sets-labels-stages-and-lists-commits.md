# Builder sets the state label, reports the late stages and lists missing commits

Written 2026-11-02, from the tracker issue that asks the builder mod to take
over the mechanical `/implement` jobs that the change in
`docs/specs/builder-chooses-the-step.md` left with the session: the state
labels, the progress-bar stage reports, the list of commits the worktree holds
that the pull request lacks, and the update of the linked main checkout after
a merge. The same issue also records one wrong sentence in that earlier spec.
This change delivers the first three jobs and the spec fix. The checkout
update is filed as its own issue (see Non-goals).

## Goal

While a pull request is open, the session still does three jobs whose answer
the mod already knows or can find with one command:

- It sets the pull request's state label (`in-review`, `waiting-on-author`,
  `ready-to-merge` or `stuck`) by hand, following sentences in the step texts
  and the skill's "State labels" section, although the label follows from the
  step the mod chose.
- It reports the `pr`, `review` and `merge` stages to the progress bar with
  `mcp__builder__progress`, although the mod sees the watch start, the review
  packages and the merge command itself.
- Before merging and after a merge, it lists the commits that the worktree
  holds and the pull request lacks with its own git commands, following the
  skill's "Commits the pull request lacks" section.

After this change, the mod does all three, each step text states the result
the session needs, and the skill and the step texts drop the instructions the
mod now carries out.

## Users and trigger

A session running `/implement` with the builder mod watching its pull request.
The label is set on every look that chooses a step. The stage reports happen
when the watch tool starts watching, when the package tool is called, and
when a Bash call runs the merge command. The commit list is made on the look
that chooses a merge step or the Merged step.

## Behavior

### State label

- The mod derives a label from the step it chooses:
  - "Review this head" gives `in-review`.
  - The failed, conflicting and changes-requested steps give
    `waiting-on-author`.
  - The four outcomes where both verdicts approve (the waiting step, the
    head-unchecked step, merge, and ask whether to merge without checks) give
    `ready-to-merge`.
  - "Over a limit" and "Closed" give `stuck`.
  - "Merged" and "An open question" give no label, and the mod changes
    nothing. "The runs could not be read" gives no label either: it is not one
    of the four approving outcomes, because it exists only when the runs read
    failed, so a `ready-to-merge` there would rest on a failed read.
- The mod keeps a record of the last label it set on each pull request, in a
  store keyed by repository and number, persisted like the questions store, so
  that it survives a restart.
- When the derived label differs from the recorded one, the mod writes it:
  one `gh pr edit` that adds the new label and removes the other three state
  labels, creating a missing label first, through the same label queue the
  question labels use. The record is saved only after the edit succeeds.
- When there is no record and the pull request already carries `stuck`, the
  mod records the derived label without writing it, so that a reload never
  removes a `stuck` the session set by judgement.
- The session still sets `stuck` by hand in the judgement cases: a failure
  outside the code, the person saying no to merging without checks, and a
  head that stays unchecked. The mod leaves that label alone until the label
  it derives from the chosen step changes.
- The step texts and the skill no longer tell the session to set
  `in-review`, `waiting-on-author` or `ready-to-merge`, or the `stuck` that
  the mod derives for "Over a limit" and "Closed". Step 7 of the skill no
  longer tells the session to set `in-review` after opening the pull request.

### Stage reports

- The mod reports `pr` when the watch tool starts watching a pull request.
- The mod reports `review`, with the round as its note, on every package
  tool call for the watched pull request. The first call carries `round 1`
  too, because an empty note would wipe the `round 1` the session's resume
  report shows.
- The mod reports `merge` when a Bash call matching the merge command
  (`gh pr merge`, or the project's merge command) is about to run. It uses a
  matcher for merge commands only, not the push-or-merge matcher, and reports
  before the command runs.
- Each report applies only when a progress record exists that the session
  started for this work, meaning the watch began at or after the record's
  start. It keeps the session's title, and it never reports a stage before
  the furthest stage reached, so a later watch does not show `pr` again while
  the session reports `build` to fix review findings.
- The session still reports grounding, issue, spec, plan, build and verify
  itself, because the mod cannot see them. The skill's "Reporting the stage"
  section and the merge step text drop the reports the mod now makes.

### Commits the pull request lacks

- On the look that chooses merge, ask whether to merge without checks, or
  Merged, the mod finds the worktree that holds the pull request's head
  branch, fetches the pull request's head, and lists with git the commits the
  worktree holds that the head lacks.
- The step text states the result as one of: none, the list of short commit
  hashes, or could not be listed. With a list, the mod also runs
  `git merge-base --is-ancestor <head> HEAD` and states whether the head is
  an ancestor of the worktree's `HEAD`; a failed check gives "could not be
  listed".
- The session acts on that result and runs no listing of its own. When
  commits exist on a merge step, it does not merge: it pushes them when the
  head is an ancestor, and otherwise sets `stuck` and asks the person, as the
  skill says today. On the Merged step it pushes nothing, names the commits
  in its report and does not run `/cleanup`. "Could not be listed" counts as
  commits existing: the session does not merge, sets `stuck`, asks the person
  and never runs `/cleanup`.
- The listing finishes before the step text is rendered, on the same look
  that chooses the step.
- The skill's "Commits the pull request lacks" section shrinks to what the
  session does with the result.

### Spec fix

`docs/specs/builder-chooses-the-step.md` says that a workflow run's jobs are
read at most once for each run id and attempt. The code reads them again at
the next look when a read failed, which is useful. The sentence is changed to
say that.

## Edge cases

- The mod restarts while the pull request carries `stuck` that the session
  set: the record is missing, so the mod records the derived label and writes
  nothing.
- The label edit fails: the record stays as it was, and the next look tries
  again.
- A state label is missing from the repository: the mod creates it and
  retries, as it does for question labels.
- The pull request number is not numeric, or the head branch's name is odd:
  the number is checked to be numeric, and the branch name is passed as an
  argument, never through a shell.
- No worktree holds the head branch any more, or git fails or times out: the
  result is "could not be listed".
- The merge command fails after the mod reported `merge`: the bar stays at
  `merge`. That is acceptable, because the session reports again on its next
  attempt and the bar never claims the merge happened.
- The session never started a progress bar, or the bar belongs to earlier
  work: the mod reports nothing.

## Non-goals

- Updating the linked main checkout after a merge. Its procedure is long and
  has its own risks, so it is filed as its own issue. The issue's comment asks
  that it never move a checkout that is on another branch or has uncommitted
  edits, and that request goes with it.
- Stage reports before the pull request opens (grounding to verify). The mod
  cannot see those stages.
- The session's judgement `stuck` labels. They need the session's judgement,
  so they stay with the session.
- Listing commits on the Closed step. That step never pushes or runs
  `/cleanup`, so a listing there would add a read and untested branching for
  nothing.

## Failure modes

- Every git and gh call runs with the mod's usual 20-second timeout, returns
  nothing on failure and never throws.
- A failed label write leaves the old label and retries at the next look.
- A failed commit listing becomes "could not be listed", which stops the
  merge and the cleanup.
- A failed or skipped stage report leaves the bar where it was.

## Verification

- Tests show the label derived for every step kind, including no label for
  Merged and An open question.
- Tests show the mod writes the label only when it differs from the record,
  saves the record only after a successful edit, and records without writing
  when the record is missing and the pull request carries `stuck` (the reload
  case).
- Tests show the `pr`, `review` and `merge` reports from the watch tool, the
  package tool and a Bash merge command, that a push does not report `merge`,
  that the title is kept and the stage never moves back, and that no report
  is made without a progress record for this work.
- Tests show the merge steps and the Merged step carry "none", a list of
  short hashes, or "could not be listed", that the Closed step carries no
  listing, and that a failed git call gives "could not be listed".
- The step texts and the skill no longer tell the session to set the derived
  labels, to report the `pr`, `review` and `merge` stages, or to run its own
  listing.
- The gates in the project's `CLAUDE.md` pass for both mods.

## Decided by the counsel

- How much of the issue should this one pull request deliver: all four jobs the mod takes over (state labels, progress-bar stage reports, the list of commits the worktree holds that the pull request lacks, and the update of the linked main checkout after a merge), or a part of them, with the rest filed as a new issue? The counsel chose: Deliver the labels, the stage reports and the commit list here, and file the linked-checkout update as its own issue, because its procedure is long (about 260 lines of the skill) and has its own risks. 6 of 7 members voted for it.
- How should the mod set the pull request's state label, given that some `stuck` labels depend on the session's judgement (a failure outside the code, the person saying no to merging without checks, a head that stays unchecked)? The counsel chose: The mod derives the label from the step it chooses and sets it whenever the derived label differs from the last one the mod itself set on this pull request: Review this head gives in-review; the failed, conflicting and changes-requested steps give waiting-on-author; the four outcomes where both verdicts approve give ready-to-merge; Over a limit and Closed give stuck; Merged and An open question change nothing. The session still sets `stuck` by hand only in the judgement cases, and the mod leaves that label alone until the chosen step's label changes. 7 of 7 members voted for it.
- When should the mod list the commits that the worktree holds and the pull request lacks, and where should the session see the result? The counsel chose: At the look that chooses one of the merge steps (merge, or ask whether to merge without checks) or the Merged step: the mod finds the head branch's worktree, fetches the pull request's head, lists the commits with git, and the step text states the result as none, the list of short commit hashes, or could not be listed. The session acts on that and runs no listing of its own. 7 of 7 members voted for it.
- At which moments should the mod report a stage to the progress bar by itself, now that the session no longer has to report the stages after the pull request opens? The counsel chose: On three events the mod sees directly: `pr` when the watch tool starts watching the pull request; `review` when the package tool is first called for it, with the round as the note on later package calls; `merge` when a Bash call matching the merge command (gh pr merge or the project's merge command) is about to run. Each report needs a bar already started by the session for this work, never moves the bar back, and keeps the session's title. The session still reports grounding to verify itself, which the mod cannot see. 7 of 7 members voted for it.
- What should this pull request leave out, and should it also fix the issue's other item, the sentence in docs/specs/builder-chooses-the-step.md that says a workflow run's jobs are read at most once for each run id and attempt, when the code retries a failed jobs read at every look? The counsel chose: Leave out the same three, and also the Closed step's listing of commits the pull request lacks, keeping the listing strictly to the merge steps and Merged as decided; fix the spec sentence here. 7 of 7 members voted for it.
