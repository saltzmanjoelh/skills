# Builder labels show whose turn it is, with a label for the outside reviewer

Written 2026-11-05, from the owner's report that the labels on a pull request
do not show whether the outside reviewer is still reviewing.

## The incident behind it

The change that made the builder mod wait for an outside reviewer (see
`docs/specs/builder-waits-for-outside-reviewer.md`) gave the steps that
request the outside review and wait on it the `ready-to-merge` label, the
same label as a pull request that only waits on its checks or on the merge
itself. A person looking at a pull request could not tell from its label
whether the outside reviewer was still reviewing, or had finished and would
not review again, so that the pull request was truly ready to merge.

## Goal

Every state label answers one question that a person can check on the pull
request: whose turn it is. The outside reviewer's turn gets a label of its
own, `waiting-on-reviewer`, and `ready-to-merge` means that nobody holds the
merge.

## Users and trigger

- The owner and the outside reviewer, who read the label on the pull request
  page or in the list of pull requests to see who has to act next.
- The builder mod, which sets the label at every look from the step it
  chooses.

## Behavior

1. A new state label, `waiting-on-reviewer`, joins `in-review`,
   `waiting-on-author`, `ready-to-merge` and `stuck`. The five are mutually
   exclusive, as the four are today: the mod sets one and removes the others.
2. The step that requests the outside review and the step that waits on it
   give `waiting-on-reviewer`. These are the two steps where both verdicts
   approve at this head but an outside reviewer still holds the merge.
3. The step where an outside review has feedback to address keeps giving
   `waiting-on-author`, the same label as the session's own requested
   changes, and the same label the outside reviewer sets by hand.
4. `ready-to-merge` stays on the steps where both verdicts approve and no
   outside reviewer holds the merge: the step that waits on checks, the step
   for a head that is not a full commit sha, the merge step and the step for
   a pull request with no checks.
5. Every other step keeps the label it gives today.
6. The mod creates `waiting-on-reviewer` in the repository when it is
   missing, the first time it sets it, as it already does for every state
   label it sets. A repository that has never seen the label needs no setup.
7. While the pull request carries `waiting-on-reviewer`, the mod looks at it
   at the interval it uses while a review is requested from an outside
   reviewer (five minutes), including at the step that requests the review,
   before the request reaches GitHub. Today that step polls at the merge
   interval only because it carries `ready-to-merge`, and without this rule
   it would fall to the ten-minute interval for a pull request with nothing
   pending.
8. A pull request that carries `ready-to-merge` from before this change,
   while an outside reviewer holds the merge, is relabelled
   `waiting-on-reviewer` at the mod's next look, with no other action.
9. `skills/implement/SKILL.md`, in its sections on state labels and on outside
   reviewers, and `mods/builder/README.md` name the new label and say which
   steps give it. The README's section on how often the mod looks at the pull
   request says what item 7 says.

## Edge cases

- **The outside reviewer moves the label by hand.** When they set
  `waiting-on-author` while leaving feedback, the mod's step is the outside
  feedback step, which gives the same label, so nothing changes back. When
  they set any other state label by hand, the mod replaces it at its next
  look with the label its step gives, as it does today.
- **A solo project.** With no `Reviewer:` line and no review from anyone
  else, no step ever gives `waiting-on-reviewer`, the label is never created,
  and the labels behave as they do today.
- **The outside reviewer approves.** The step becomes one of those in
  Behavior item 4, so the label moves from `waiting-on-reviewer` to
  `ready-to-merge`.
- **Branch protection dismisses the outside reviewer's approval after a
  push.** The step goes back to requesting the review, so the label goes back
  to `waiting-on-reviewer`.
- **The session sets `stuck` itself.** The mod leaves that `stuck` alone
  until the label that follows from the step changes, as it does today, and
  `waiting-on-reviewer` counts as a state label for that rule.

## Non-goals

- No second new label for the step where the session addresses the outside
  reviewer's feedback; `waiting-on-author` covers it.
- No display of which outside review round the pull request is in, such as
  "round 2 of 2", in the pane or in the comment that requests the review. The
  mod still neither counts nor caps the outside reviewer's rounds.
- No change to how the mod chooses its step. It still decides from the
  reviews, review requests, checks, runs, commits and mergeability, never
  from the labels.
- No change to `needs-decision`, which is not a state label.
- No change to the foreman mod, which reads no state label.
- No colour or description is chosen for the new label beyond what
  `gh label create` gives by default.

## Failure modes

- **Creating the label fails**, for example because the session's login may
  not create labels in the repository. The label edit fails as any failed
  label edit does today: the mod does not record the label as set, and tries
  again at its next look. The step and the session's work go on unchanged.
- **The label edit fails after the label exists.** Same as above.

## Decided by the person

- The new label is named `waiting-on-reviewer`.
- The mod creates any state label the repository lacks.
- The flow of labels is the one in the issue: `in-review` while the session
  reviews, `waiting-on-author` while the session fixes, `waiting-on-reviewer`
  while the outside reviewer holds the merge, `ready-to-merge` when nobody
  does, and `stuck` past a limit or when closed.

## Decided by the counsel

- When an outside reviewer leaves feedback and the session is addressing it, should the pull request carry the same `waiting-on-author` label as when the session's own reviewers request changes, or a label of its own? The counsel chose: Keep one label: waiting-on-author covers both the session's own findings and the outside reviewer's feedback. 7 of 7 members voted for it.
- Should this change also show which outside review round the pull request is in, such as "round 2 of 2", in the builder pane or in the comment that requests the review, or is that left out of this change? The counsel chose: Leave the round display out of this change and list it under Non-goals. 7 of 7 members voted for it.

## Verification

- A test of the label mapping shows that the step that requests the outside
  review and the step that waits on it give `waiting-on-reviewer`, that the
  outside feedback step gives `waiting-on-author`, and that the four steps in
  Behavior item 4 give `ready-to-merge`.
- A test shows that `waiting-on-reviewer` is one of the state labels, so that
  setting it removes the other four and setting any of the others removes it.
- A test of the poll interval shows that a pull request carrying
  `waiting-on-reviewer`, with no review yet requested, polls at the reviewer
  interval, and that one carrying `ready-to-merge` still polls at the merge
  interval.
- A test of the label edit shows that when adding `waiting-on-reviewer` fails
  because the label is missing, the mod creates it with `gh label create`
  and adds it again.
- A test shows that a pull request carrying `ready-to-merge` while an outside
  reviewer's review is requested is relabelled `waiting-on-reviewer` at the
  next look.
- Reading `skills/implement/SKILL.md` and `mods/builder/README.md` shows the
  new label and the steps that give it. No gate reads them, so their
  reviewers check them.
