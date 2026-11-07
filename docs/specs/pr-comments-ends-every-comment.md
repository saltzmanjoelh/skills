# Every review comment ends, and no requested review waits forever

Written 2026-11-06, from an issue in the owner's tracker about a pull request
that stalled between an author system and a reviewer system.

## The incident behind it

One system pushed commits to a pull request, and another system reviewed
them. The author rejected every comment, and the pull request stalled.

A loop like this can stall in two ways:

- **The reviewer raises rejected comments again.** A reviewer that reviews
  each round from scratch never sees the author's replies, so it repeats
  findings the author has already answered.
- **The reviewer goes silent.** This is what happened. The author pushed back
  with replies, pushed no commits, and asked for the review again. The
  reviewer saw no new commits and never answered. The builder mod waited
  forever on a review that was never going to come.

The reviewer in that case has since been fixed on its own side, but the
builder mod still has to cope with any reviewer, person or bot, that never
answers. Three gaps let the stall happen:

1. A rejection rested only on reading the code. The reply cited a code path
   but no commit, so the reviewer had nothing it could run, and it raised the
   comment again.
2. Nothing settled a dispute or closed the thread. A thread the author pushed
   back on stayed open until the reviewer closed it, and a disputed comment
   from an outside reviewer never went to the counsel.
3. The mod waited on a requested review with no time limit. While a review was
   requested, it looked every five minutes, and nothing ended the wait.

## Goal

Every review comment on a pull request ends in exactly one of four ways, and
the session can say which for each thread:

- **fixed**, with a test that failed before the fix, and the fix's hash in the
  reply;
- **disproved**, with a passing test that shows the claimed failure does not
  happen, and that test's hash in the reply;
- **decided** by the counsel or by the person, with the ruling in the thread
  and the thread resolved;
- **handed to the person**, such as an outside reviewer's review that needs
  overriding, or a question that got no answer.

No pull request waits forever on a comment that the author rejected, or on a
requested review that never arrives.

## Users and trigger

- A session working through review comments with `/pr-comments`, either on its
  own or from the outside-feedback step of `/implement`.
- The builder mod, while an outside reviewer's review is requested.
- An automated outside reviewer, which signals that it picked a request up by
  putting the label `reviewer-working` on the pull request.

## Behavior

### 1. A rejection is proved with a test

When the session judges a comment invalid, it runs `builder:bug-reproducer` on
the reviewer's claim, asking for a test that would fail if the claim were
true. When the builder mod is not loaded, a `general-purpose` agent gets the
same instruction.

- If the test passes, the session commits it, pushes, and replies in the thread
  with the commit's hash, the test's name and why the claim does not hold. The
  thread ends as **disproved**. The test stays in the suite as a guard; it is
  never removed after the reply.
- If the test fails, the claim is confirmed after all. The session says so
  plainly in the thread and goes on as for any confirmed comment, using that
  test as the failing test. The thread ends as **fixed**.
- A comment that no test can express, such as naming or wording, still gets a
  reasoned reply, which says that no test can express it.

A disproved thread stays unresolved, as a pushed-back thread is today: the
reviewer closes it when they agree, or the tie-breaker below settles it.

### 2. A repeated rejection goes to the counsel

A reviewer raises a rejected comment again when, after the session's rejection
reply, the same reviewer makes the same claim again, in the same thread or a
new one, without evidence that the rejection did not already answer. When that
happens:

1. The session puts the dispute to the counsel with `mcp__builder__counsel`,
   with the claim, the rejection, the disproving test if there is one, and two
   options: the reviewer is right and the comment is fixed, or the rejection
   stands. On a watched, open pull request it passes `pull_request`.
2. If the counsel does not decide, or cannot sit, or the builder mod is not
   loaded, the person decides.
3. The session replies in the thread with the ruling. The reply's first line is
   `Ruling: <who decided, and what>`, such as
   `Ruling: the counsel decided, 5 of 7, that the rejection stands.`, followed
   by the reason in plain sentences.
4. If the ruling is that the reviewer is right, the session fixes the comment
   with a failing test first, as for any confirmed comment, and the thread ends
   as **fixed**. Otherwise the thread ends as **decided**.
5. Either way, the session resolves the thread after the reply.

A repeat that brings new evidence is not a repeat: the session judges it again
from step 1 of this section.

### 3. A ruling reaches `## Already decided`

When the builder mod builds a review package, it reads the pull request's
review threads and lists, in `## Already decided`, every comment whose author
is the session's own login and whose first line begins with `Ruling:`. Each
item names the file and line of its thread and gives the ruling's text, capped
as the other items are. It sits beside the items read from the commit messages
and the session's verdict reviews, and is numbered with them.

- A `Ruling:` comment written by any other login is never listed.
- When the threads cannot be read, the section says so in a line of its own,
  so the failed read never looks like an empty list.

### 4. A ruling against a reviewer who holds the merge

When a ruling goes against an outside reviewer who holds the merge, the session
never overrides, dismisses or works around that reviewer's review itself. It
records the ruling and resolves the thread as above, asks for that reviewer's
review again as the outside-feedback step already does, and asks the person in
one question whether to keep waiting on the reviewer or to override or dismiss
the review themselves on GitHub. The thread is then **handed to the person**
until either the reviewer approves or the person acts. The merge still waits
for every outside reviewer's approval, as it does today.

### 5. A question with no answer goes to the person

When the session asks a reviewer a question in a thread, because it cannot tell
what a comment asks or needs the evidence behind a repeated claim, the question
has no clock of its own:

- For an outside reviewer, the question goes to the person when that reviewer's
  next review arrives with no reply in the thread, or when the limits in
  section 6 set `stuck`.
- For an other reviewer, who is never asked again, any of the session's
  questions still waiting for an answer go to the person at the merge step,
  before merging. The merge step's text names this check, and the session does
  not merge while such a question is open unless the person says to.

### 6. A requested review has a time limit

While an outside reviewer is in the Requested state, the mod counts from the
newest time that reviewer's review was requested, as GitHub records it. At the
first look after a limit passes, the mod names a step that gives the state
label `stuck`:

- **Ten minutes to pick up.** The reviewer is still requested ten minutes after
  the request, and the pull request does not carry `reviewer-working`.
- **Two hours to arrive.** The reviewer is still requested two hours after the
  request, whether or not the label is on.

The same limits apply to every outside reviewer, person or bot. The step's
text names the reviewer and the limit that passed, and tells the session to ask
the person whether to ask for the review again or to leave it to them on
GitHub. Asking again means removing the request and adding it back, which
GitHub records as a new request, so both limits count afresh from it.

### 7. The `reviewer-working` label

`reviewer-working` is not a state label. It sits beside the state labels, as
`needs-decision` does, and never replaces `waiting-on-reviewer`.

- The reviewer puts it on when it picks a request up. The mod reads it at every
  look.
- The mod never removes it while the label that follows from the step is
  `waiting-on-reviewer`.
- When the mod sets any other state label, it also takes `reviewer-working`
  off, so a reviewer that forgets cannot leave it behind.
- When the session asks for an outside review, the mod creates the label if the
  repository lacks it, as it does for the state labels, so the reviewer can put
  it on.
- Like the other workflow labels, it is not itself part of the pull request's
  fingerprint, so putting it on or taking it off starts no turn, with one
  exception: once ten minutes have passed since the request, while the mod can
  name the ten-minute step, the label moves a reviewer into or out of that
  step, and that change starts a turn. Crossing a time limit while the mod
  names another step, such as the `/code-review` pass, starts no turn; the
  look at which a limit step first applies does.

### 8. The session reports each thread's ending

At the end of `/pr-comments`, the session lists every thread with its ending:
fixed, disproved, decided or handed to the person, and for a thread still open
on purpose, what it waits on.

## Edge cases

- **Two outside reviewers are requested and the label is on.** The mod cannot
  tell who put the label on, so the label counts as picked up for every
  requested reviewer, and the two-hour limit still applies to each.
- **The label goes on and comes off again with no review.** The ten-minute
  limit counts from the request, so once ten minutes have passed with the label
  off, the next look names the stuck step.
- **The reviewer posts a review just before a limit passes.** The reviewer
  leaves the Requested state, so no limit applies.
- **A person reviews by hand and does not use the label.** They get the same
  ten minutes, and the session asks the owner, who can say to keep waiting.
- **A ruling's text is long or holds Markdown.** It is capped and listed as
  data, like every other item in `## Already decided`.
- **The bug reproducer cannot write a test for a claim that a test could
  check.** The session says so in the reply and puts the dispute to the
  counsel at once if the reviewer raises it again.

## Non-goals

- A project setting that marks a reviewer account as one that never holds the
  merge.
- The session overriding or dismissing an outside review itself; it only asks
  the person.
- Any change to the foreman mod.
- Any change to how the session's own builder reviewers handle repeats, which
  the package already covers.
- A clock of its own for an unanswered question in a thread.
- A longer limit for people than for bots.
- Telling a person's account from a bot's account.

## Failure modes

- **The threads cannot be read when a package is built.** The package says so,
  and the session's reviewers may raise a ruled point again; the session drops
  it as a repeat by reading the thread itself.
- **The request time cannot be read.** The mod keeps the request time that an
  earlier look read for that reviewer at the same head, and applies the limits
  from it, so a pull request already past a limit stays `stuck` and no turn
  starts for a passing failure. A reviewer whose request time no look has read
  gets no limit at that look, so the mod never sets `stuck` on a time it never
  read. The next look reads again, and a read that succeeds replaces the kept
  time.
- **Creating `reviewer-working` fails.** The mod tries again at its next look,
  as for a state label; a reviewer that cannot put the label on runs into the
  ten-minute limit and the session asks the person.
- **Removing `reviewer-working` fails.** The mod tries again at its next look.

## Decided by the person

- A person who reviews by hand gets the same ten-minute pick-up limit as a bot;
  a question from the session after ten minutes is acceptable.

## Decided by the counsel

- How long may an outside reviewer take before the mod sets stuck and the session asks the person, given that the mod cannot reliably tell a person's account from an automated reviewer's account? The counsel chose: Ten minutes to pick up for every outside reviewer, and also a long limit, two hours from the request, on the review arriving at all, so a reviewer that puts reviewer-working on and then crashes cannot hold the pull request forever. 4 of 7 members voted for it.
- When the counsel or the person rules on a disputed comment from an outside or other reviewer, where is the ruling recorded so that the package's `## Already decided` section lists it, and the same point cannot come back from the session's own reviewers or the outside reviewer without new evidence? The counsel chose: In the thread itself: the session's reply that records a ruling starts with a fixed line such as `Ruling: <the ruling>`, and the mod reads the pull request's review threads when it builds a package and lists each such reply in `## Already decided` beside the commit and review lists. Needs mod code and a GraphQL read of the threads, but costs no push and is listed at once. 5 of 7 members voted for it.
- When the session asks a reviewer a question in a review thread (a comment it cannot classify, or a request for the evidence behind a repeated claim) and the reviewer does not answer, when does that question go to the person? The counsel chose: No clock of its own. For an outside reviewer, the question goes to the person when that reviewer's next review arrives with no reply in the thread, or when the requested-review limits (ten minutes to pick up, two hours to arrive) set stuck. For an other reviewer, who is never asked again, it goes to the person at the merge step, before merging. Only skill text changes. 6 of 7 members voted for it.
- What does this change leave out, and does it ship all four parts of the issue in one pull request? The counsel chose: All four parts in one pull request (disproving tests, the tie-breaker, closing decided threads with Ruling: replies read into Already decided, and the requested-review limits with the reviewer-working label). Left out: a project setting that marks a reviewer as one that never holds the merge; the session overriding or dismissing an outside review itself (it only asks the person); any change to the foreman mod; any change to how the session's own builder reviewers handle repeats, which already works. 5 of 7 members voted for it.
- When the mod cannot read a requested review's request time at one look, while the pull request already carries `stuck` because a time limit passed, what should that look do? The counsel chose: Amend the failure mode so a failed read keeps the request time stored from an earlier look and applies the limits from it; only a time never read applies no limit. 5 of 7 members voted for it.

## Verification

- Unit tests for reading `Ruling:` comments into `## Already decided`: a ruling
  by the session's login is listed with its file and line, one by another login
  is not, a comment whose first line does not begin with `Ruling:` is not, the
  numbering runs on from the commit and review items, and a failed thread read
  gives its own line rather than `None yet.`.
- Unit tests for the step chooser with a requested outside reviewer and a fixed
  clock: before ten minutes, the waiting step; after ten minutes without the
  label, the pick-up step; after ten minutes with the label, the waiting step;
  after two hours with the label, the arrival step; a new request after an
  earlier one counts from the new one; a request time that no look has read
  gives the waiting step; a failed read after a limit passed keeps the time an
  earlier look read, so the pull request stays `stuck`. Both new steps give
  `stuck`.
- Unit tests for `reviewer-working`: it is a workflow label and not a state
  label, it leaves the fingerprint unchanged before the ten-minute limit,
  after that limit it moves a reviewer into or out of the ten-minute step, and
  a limit crossed while another step applies leaves the fingerprint
  unchanged, setting `waiting-on-reviewer`
  keeps it, and setting any other state label removes it.
- A unit test that the request step creates `reviewer-working` when the
  repository lacks it.
- The repository's gates pass. No gate reads `skills/`, so the changes to
  `skills/pr-comments/SKILL.md` and `skills/implement/SKILL.md` are checked only
  by the reviewers.
