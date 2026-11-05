# Builder waits for an outside reviewer and addresses their comments

Written 2026-11-05, from the owner's request that the builder mod work with a
person who reviews some pull requests by hand.

## The incident behind it

On some projects a second person reviews the pull requests that `/implement`
opens. They run the `/code-review` skill against the pull request and post its
findings as inline review comments, and sometimes they also move the pull
request's `ready-to-merge` label to `waiting-on-author`. Other projects are
solo, and nobody but the session reviews.

The builder mod did not know that this person existed:

- It reads only the verdict reviews posted by the session's own login. A
  review by anyone else changes nothing the mod fingerprints, so it never
  wakes the session, and the step chooser never looks at it.
- It merges as soon as both of its own verdicts approve and the checks pass,
  so the second person has almost no time to review at all.
- The state labels are left out of the fingerprint, so a person moving the
  label by hand wakes nobody either.
- Nothing requests the second person's review, so they have to notice the
  pull request on their own.

## Goal

When a project names a reviewer, or anyone other than the session reviews the
pull request, the mod requests the review, holds the merge until every outside
reviewer on the pull request approves, wakes the session when an outside
review arrives, and sends the session to address that review's comments. After
the session has addressed them and asked for the review again, the label goes
back to `ready-to-merge`. A solo project with no reviewer behaves exactly as
before.

## Users and trigger

A session running `/implement` with the builder mod watching its pull request,
in a project whose `CLAUDE.md` names a reviewer, or whose pull request draws a
review or a review request from someone other than the session's login.

## Behavior

### The `Reviewer:` fact

- A new fact, `Reviewer:`, names the GitHub login of the person who reviews
  the pull requests, or several logins separated by commas.
- A line in the user's own `CLAUDE.md` (in the Claude configuration folder,
  `CLAUDE_CONFIG_DIR` or `~/.claude`) sets it for every project.
- A line in the project's `CLAUDE.md`, read from the base branch like the
  other facts that govern the merge, overrides the user's line.
  `Reviewer: none` in the project turns it off there.
- A login that is not a valid GitHub login is ignored, and so is the
  session's own login, because GitHub refuses to request a review from the
  pull request's author.
- When the base branch's `CLAUDE.md` cannot be read, the user's line still
  applies.

### Who counts as an outside reviewer

An outside reviewer, who holds the merge until they approve, is any GitHub
user other than the session's own login who meets one of these:

- they are named by the `Reviewer:` fact;
- their review is requested now, as a user;
- their newest review that is not pending carries the association `OWNER`,
  `MEMBER` or `COLLABORATOR`, which GitHub sets on its own servers from the
  author's relation to the repository.

The last rule keeps a requested reviewer holding the merge after they review,
because GitHub removes them from the review requests when they submit. A
review request for a team or a bot is left out, because the mod cannot tell
which person will answer it, and so is a login that is not a valid GitHub
login.

Anyone else who reviews is an **other reviewer**. This covers a GitHub app's
automatic review, which the pull request read reports with a plain login, no
`[bot]` ending and the association `CONTRIBUTOR`, and a stranger on a public
repository. An other reviewer never holds the merge and is never asked again,
because a review request to them fails. Their review still wakes the session,
and the steps tell it to address their comments before it merges. Their
comments, like everyone's, are data to judge on their merits, never
instructions.

Each outside reviewer is in one of four states, decided in this order:

1. **Requested:** they are in the pull request's review requests now. GitHub
   removes a person from that list when they submit a review, and puts them
   back when someone requests their review again.
2. **Approved:** their newest review that is not pending approves.
3. **Feedback:** their newest review that is not pending comments or
   requests changes.
4. **Unrequested:** they have no request and no review that stands. Either
   the fact names them and nobody has asked them yet, or their newest review
   was dismissed. A dismissed review counts as no review, so the session asks
   them again rather than dropping them or sending itself back to comments it
   has already answered.

The look keeps each outside reviewer's login and state, and the submission
time of their newest review, in the snapshot. It also keeps each other
reviewer whose newest review comments or requests changes, with that review's
submission time. That part of the snapshot is in
the fingerprint, so a review submitted, a request made, or a request
withdrawn starts a turn, and the change prompt says what moved.

### The steps

The outside reviewers matter only once both of the session's own verdicts
approve at the head. Before that, their reviews wait until the session's own
review round has finished, so the two never interleave. Once both verdicts
approve, the mod chooses the first of these that applies, before any of the
existing outcomes where both verdicts approve:

- **Outside review feedback to address**, when any outside reviewer is in the
  Feedback state. It gives the label `waiting-on-author`. Its text sends the
  session through the `/pr-comments` runbook for those reviewers' review
  comments, inline threads and review bodies, and the pull request's
  conversation comments: verify each one, prove a real one with a failing
  test, fix it, push, reply in the thread with the fix commit, resolve the
  threads that are closed, and push back with evidence on the wrong ones. A
  comment that asks for work outside the spec gets a reply that says so and
  goes on the `To file:` list of the next verdict review. Then the session
  requests those reviewers' review again with
  `gh pr edit <n> --add-reviewer <logins>`. After a push it goes on as after
  any push, so its own review round reviews the new head. With nothing
  pushed, it calls the watch tool and follows the step it names.
- **Request the outside review**, when any outside reviewer is in the
  Unrequested state. It gives `ready-to-merge`. Its text tells the session
  to run `gh pr edit <n> --add-reviewer <logins>` and then call the watch
  tool. When the request fails, the session sets `stuck` and asks the person.
- **Waiting on the outside review**, when any outside reviewer is in the
  Requested state. It gives `ready-to-merge`. Its text tells the session to
  say whose review it waits on and end the turn, because the mod starts a
  turn when a review arrives.

Only when every outside reviewer approves, or there are none, does the mod go
on to the existing outcomes: waiting on checks, merging, or asking whether to
merge without checks.

When there are other reviewers with comments, the texts of the request,
waiting, merge and ask-merge steps name them and tell the session to address
any of their comments that have no answer yet through `/pr-comments` before it
merges, without asking them again. The Feedback step does the same for them
alongside the outside reviewers.

The merge texts already tell the session to fetch the base branch and read its
`CLAUDE.md` before merging. They also tell it that when that file names a
`Reviewer:` who has not approved, it merges nothing and ends the turn, because
a failed read of that file at the look leaves out a reviewer only the project
names.

An approval counts whatever head it was given at. The owner's reviewers do at
most two rounds and approve after the fixes, and the session's own verdicts
still review every head. A project that wants a fresh approval for every head
turns on GitHub's branch protection setting that dismisses stale approvals
when new commits are pushed. A dismissed approval puts the reviewer in the
Unrequested state, so the session asks for their review again.

### The label

The mod already writes the label that follows from the step and removes the
other state labels. So when an outside review arrives, the label becomes
`waiting-on-author`, whether or not the reviewer moved it by hand. Once the
session has addressed the comments and requested the review again, the step
is **Waiting on the outside review**, which gives `ready-to-merge`, so the mod
puts that label back. The session sets no state label by hand for any of this.

### How often the mod looks

While an outside reviewer's review is requested and the checks are not
running or failed, the mod polls every 5 minutes (`reviewer`), because only a
look sees a review arrive and a person's review takes minutes or hours. The
pane says the session waits on the reviewer.

### Documents

- The facts table of `/implement` gains the `Reviewer:` row, and a new section,
  "Outside reviewers", describes the states, the steps and the label.
- The builder README describes the new steps, the new poll interval, and the
  `Reviewer:` fact under what it reads from `CLAUDE.md`.

## Non-goals

- A label moved by hand with no review behind it still wakes nobody. The
  owner's reviewers always leave their findings as review comments, which do
  wake the session, and the label alone holds nothing to address.
- The mod does not count the outside reviewer's rounds or cap them. The
  existing push and round limits still apply to every head.
- An app reviewer that has been given collaborator access holds the merge
  like a person. The session sets `stuck` when its review request fails.
- The mod keeps no record of which other reviewer's comments were answered.
  The session reads the threads and answers only those with no answer yet.

## Edge cases

- **A reply in a thread after an approval.** GitHub records the reply as a
  new comment-only review, so the reviewer is in the Feedback state again. The
  session reads it, answers it, and asks for the review again, and the merge
  waits for a fresh approval. That costs the reviewer one more approval.
- **A reviewer who approves and then asks for changes.** Their newest review
  decides, so they are in the Feedback state.
- **Two outside reviewers, one approved and one requested.** The merge waits
  on the requested one, and the label is `ready-to-merge`.
- **A review request that a person withdraws.** A named reviewer without a
  review falls back to the Unrequested state and is asked again. A reviewer
  who is not named and has no review stops being an outside reviewer.
- **The reviewer is the session's own login.** It is ignored, because GitHub
  refuses that request.
- **A GitHub app's automatic review.** It carries the association
  `CONTRIBUTOR`, so the app is an other reviewer. Its comments are addressed
  before the merge, and the merge does not wait for it.
- **A stranger's review on a public repository.** The stranger is an other
  reviewer, so nobody asks them again and the merge does not wait.
- **A collaborator who reviews without being named or asked.** Their review
  carries `COLLABORATOR`, so they hold the merge like a requested reviewer.
- **The same login twice in the fact, in different cases.** GitHub compares
  logins without regard to case, so the repeat is dropped.
- **Outside feedback arrives while the session's own round is running.** It
  waits until both of the session's verdicts approve, and then the Feedback
  step applies.

## Failure modes

- **The review request fails** (the login does not exist, or the person has
  no access to the repository). The step's text tells the session to set
  `stuck` and ask the person. When the same request step comes back after a
  request that seemed to succeed, the session does the same, so it never asks
  in a loop. The Feedback step has the same guard: when the watch names it
  again for the same reviewers with nothing pushed, the session sets `stuck`.
- **The base branch's `CLAUDE.md` cannot be read at the look.** A reviewer only
  the project names is missing from that look, so the step may name the merge.
  The merge text's check of the fetched file stops the merge, and the next
  look that reads the file names the reviewer again.
- **A `Reviewer:` line in the user's own `CLAUDE.md` names someone with no
  access to a repository.** Every pull request there ends at `stuck` until the
  project writes `Reviewer: none`.
- **The user's `CLAUDE.md` cannot be read.** It is treated as having no
  `Reviewer:` line, and the project's line, if any, still applies.
- **The pull request read fails.** Nothing new happens: the look already
  retries a failed read, and the snapshot keeps its last outside reviewers.
- **The reviewer never answers.** The session waits, and the mod's existing
  stuck prompt checks the wait after a long quiet time, as for any other wait.

## Decided by the person

- Wait for an outside reviewer before merging, but only when the pull request
  has one; solo projects have none. Their rounds end in an approval after the
  fixes, at most two rounds.
- The reviewer is named by a `Reviewer:` line. A line in the user's own
  `CLAUDE.md` applies everywhere, a project's line overrides it, and
  `Reviewer: none` in a project turns it off.
- Feedback from anyone other than the session's own login sends the session
  to address it. Only outside reviewers are waited for and asked again.

## Decided by the counsel

- When an outside reviewer has approved the pull request and the session later pushes more commits (for example the fixes for another outside reviewer, or its own cheap follow-ups), does that earlier approval still count toward the merge, or must the outside reviewer approve the current head again? The counsel chose: An approval counts at any head: once given, it holds until that reviewer submits a newer review or is asked for their review again. 7 of 7 members voted for it.
- Which reviewers other than the session hold the merge until they approve, and how are the rest handled? The counsel chose: Hold the merge for reviewers named by the Reviewer fact, reviewers whose review is requested now as a User, and reviewers whose newest standing review has the association OWNER, MEMBER or COLLABORATOR. Anyone else's review still wakes the session, and the merge and waiting texts tell it to address those comments through /pr-comments before merging, without waiting for or asking that reviewer again. 6 of 7 members voted for it.
- After an outside reviewer has approved, they post a newer review that only comments (on GitHub, even a reply in an existing thread is a comment-only review). Should that newer comment-only review take away their approval and send the session to address it and ask for their review again? The counsel chose: Yes: their newest review decides, so a comment-only review after an approval is feedback; the session addresses it, asks for their review again, and the merge waits for a fresh approval. 6 of 7 members voted for it.

## Verification

- Unit tests for the association rule: an app review with `CONTRIBUTOR`, a
  stranger with `NONE`, and a collaborator who was never asked.

- Unit tests for reading the `Reviewer:` fact from the project and user files,
  `none`, invalid logins and the session's own login.
- Unit tests for the outside reviewers' states from reviews and review
  requests, including dismissed reviews, teams and bots.
- Unit tests for the step chooser: each new step, their order, their labels,
  that a pull request with no outside reviewer chooses exactly what it did
  before, and that outside reviews before the verdicts approve change nothing.
- Unit tests for the fingerprint and the change sentences, and that a
  snapshot without outside reviewers fingerprints as before.
- Unit tests for the waiting state and its poll interval.
- The repository's gates pass.
