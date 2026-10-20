# The counsel decides each follow-up

Written 2026-10-14. It builds on `follow-ups-sorted.md`, which it changes
only where it says so, and on the counsel of seven members and the 4 of 7
rule in the section "The owner's advocate" of `pilot-counsel.md`.

## Goal

No follow-up from an `/implement` pull request is filed, or dropped, on the
judgement of the one session that wrote the code alone. The counsel decides,
for each follow-up the session did not fix as cheap, whether it is fixed in
the pull request, filed as an issue or dropped, and only a follow-up the
counsel decides to file reaches the issue tracker. The counsel decides all
of a round's follow-ups in one sitting of seven agents, not one sitting per
follow-up.

## Users and trigger

Every `/implement` session, in the second half of a review round where both
verdicts approve, and the person who later reads the issue tracker. The
trigger: since `follow-ups-sorted.md`, the session itself sorts follow-ups into
cheap, dropped and to file, so its own view of its own code still decides what
is worth keeping. Four runs once filed 27 issues, and the owner labelled about
twenty of them `not-worthy`; the owner's position is that there is no point
putting up issues that are not worth doing.

## Behavior

### Which follow-ups go to the counsel

In the second half of a round, the session still sorts every surviving
`FOLLOW-UP:` as `follow-ups-sorted.md` says, and still fixes the cheap ones
itself. Every follow-up it did not fix as cheap goes to the counsel, which
covers the ones it would have filed and the ones it would have dropped as
`nothing visible`. A speculative follow-up, one the claim checker answered
speculative or could not confirm, does not go to the counsel: the session
drops it and lists it as dropped, as today, because a vote to fix or file it
would act on a claim nobody verified.

### When the counsel sits

The counsel sits in the second half of a round where both verdicts approve,
after the session has sorted the follow-ups and before the round's review
is posted, so that the review records the decisions. In a round where a
verdict requests changes, the session sorts the follow-ups and lists the
ones the counsel has not decided under a new heading, `Undecided:`, in the
review's **Follow-ups** section, and the counsel does not sit; the next
approving round puts them to it.

An approving round puts to the counsel only the follow-ups it has not yet
decided. Which ones those are is read from the **Follow-ups** sections of
the earlier reviews on the pull request, and from the lists in any
cheap-fix commit that no review lists, never from the session's memory, so
a resumed session does not put a decided follow-up to the counsel again.
With nothing left to decide, the counsel does not sit.

### One question with every follow-up

The session calls `mcp__pilot__counsel` once for up to twenty follow-ups,
and once more for each further twenty, with a new input, `follow_ups`, a
list of the follow-ups, each in one or two sentences saying what it is and
what a person would see if it is never fixed. A call with `follow_ups` has
no `options`: the mod gives every follow-up the same three options, in this
order: fix it in this pull request, file it as an issue, drop it. A call
with both, or with an empty list, is refused, and so is a list longer than
twenty follow-ups, because each member's report holds one vote per
follow-up. A call with `follow_ups` and `pull_request` is refused too: the
session's **Follow-ups** section is the only record of these decisions, so
the mod owes nothing to the pull request's next review for them and adds no
"Decided by the counsel" paragraph, and their decisions are not written
into a spec either.

The brief lists the follow-ups, numbered, under the question and the
background, and asks each member to end its report with one pair of lines
per follow-up, in order:

```
VOTE 1: <fix|file|drop|none>
REASON 1: <one sentence>
```

A vote is read the way a vote is read today, except that it is one of the words
`fix`, `file`, `drop` or `none`, or the number of one of the three options. A
member whose report lacks a readable vote for any follow-up has no vote, and
the tally asks for it again once, as today. A member asked again that still
lacks a vote for some follow-up does not send the question to the person, which
is the one place a follow-ups question departs from the rule in the section
"Every member votes" of `pilot-counsel.md`: each follow-up is counted from the
votes that exist, so a follow-up with 4 votes for one option is decided
whatever the missing member would have said, and every other follow-up is
undecided and dropped, listed with its tally and the members without a vote. A
missing vote can only take a vote away, so it never changes a follow-up that
already has four. No member proposes options on such a question, so it never
reruns.

### Each follow-up is decided on its own

`mcp__pilot__counsel_tally` takes, for each member, its votes and reasons
for every follow-up in order. Each follow-up is counted on its own: an
option chosen by at least 4 of the 7 decides it. A follow-up that no option
wins with 4 of 7 is dropped, and the review lists it under `Dropped:` with
its tally and the words "the counsel did not decide"; nothing is filed for
it and the person is not asked. The tally's answer gives, for every
follow-up, its decision, the count, and the counsel's one-line reason,
which is the reason of the first member, in the counsel's order, that voted
for the chosen option, and tells the session to write each one into the
round's **Follow-ups** section.

### What the session does with the decisions

- **Fix:** the session fixes it in the same commit as the cheap follow-ups,
  `Fix this round's cheap follow-ups`, and it goes in that commit's
  `Fixed:` list. The existing rule for what follows still holds: when every
  changed line is inert the verdicts carry over, and otherwise the new head
  goes through a normal round.
- **File:** it goes in the review's `To file:` list, with one sentence on
  what a person would see, and the **Merged** step files it in the one
  follow-up issue, as today.
- **Drop:** it goes in the review's `Dropped:` list with the counsel's
  one-line reason, and is filed nowhere.

When fixing would take the pull request past `Max rounds` or
`Max pushes per round`, and nothing else in the round needs a push, the
existing rule of `follow-ups-sorted.md` makes no commit, and a follow-up the
counsel decided to fix is filed instead, because the counsel judged it
worth doing. A cheap follow-up that is only wording or test tightening is
dropped, but a visible problem the session meant to fix is filed too, so
that it is not dropped on the session's judgement alone.

The review's **Follow-ups** section is the only record of the counsel's
decisions on follow-ups. For each follow-up the counsel decided, its item in
`Fixed:`, `To file:` or `Dropped:` says that the counsel decided it, the
count, and the counsel's one-line reason, and later reviews repeat it as
they repeat every earlier item, so the last review before the merge records
every decision and its reason.

### The Merged step

The **Merged** step does not change: it files at most one issue, from the
last verdict review's `To file:` list. That list now holds what the counsel
decided to file, together with the fix decisions and the visible problems
that the limit rule above moved there, what the person decided when the
counsel could not sit, and items carried over from reviews posted before
the counsel decided follow-ups. So nothing new reaches the issue tracker on
the session's judgement alone, except a visible problem the session meant
to fix in this pull request and could not.

## Edge cases

- **A pull request with no follow-ups left after the cheap fixes:** the
  counsel does not sit.
- **A follow-up split 3 drop, 3 file, 1 fix:** no option reached 4, so it
  is dropped and listed with the tally and "the counsel did not decide".
- **A member votes for three follow-ups and leaves the fourth out:** it has
  no vote, and is asked again once, like a member that gave no vote at all.
- **A fix the counsel chose raises new follow-ups in the next round:** the
  next approving round puts only those new ones to the counsel.
- **The counsel cannot sit** (the tool says so): the session asks the person
  once, with every follow-up in the question, because the project's rule is
  to ask the person when the counsel cannot settle a question.
- **A member asked again still has no vote for one follow-up:** that
  follow-up is decided only if an option has 4 of the votes that exist, and
  is otherwise dropped with its tally and the member named; the person is
  not asked. A member with no readable vote at all, after being asked
  again, is missing from every follow-up in the same way, so a reader of
  the review sees each dropped follow-up name it.
- **An earlier review on the pull request predates this change** and has no
  `Undecided:` list: its `To file:` and `Dropped:` items stand as they were
  decided, and are not put to the counsel again.
- **More than twenty follow-ups are left to decide in one round:** the
  tool refuses a list longer than twenty, so the session puts them to the
  counsel in several calls of at most twenty each, in the same round, and
  launches all seven members for each call.

## Non-goals

- The existing `not-worthy` backlog, which a separate issue decides.
- Any change to which findings block, to the rule for rounds, to the
  focused reviewers, or to the cheap fixes the session makes itself.
- Any change to how an ordinary counsel question, one with `options`, is
  briefed, read, tallied or rerun.

## Failure modes

- A follow-up the counsel drops by mistake is still listed in the review
  with its tally and reason, so a person reading the pull request can file
  it by hand.
- A session that forgets to put an approving round's follow-ups to the
  counsel leaves them under `Undecided:`, which the next review repeats, and
  a reviewer reading the last review sees them still undecided.
- A follow-up the session calls cheap when it is not costs at most one extra
  round, as in `follow-ups-sorted.md`.

## Verification

Mod tests, each failing if its change is removed:

- A brief with three follow-ups lists them, numbered, gives each the three
  options, and asks for one vote and one reason per follow-up; it holds no
  lean.
- A counsel call with both `options` and `follow_ups`, with an empty list,
  or with more than twenty follow-ups is refused and writes no brief.
- A tally of seven members over three follow-ups decides each one on its
  own: one at 4 of 7 for file, one at 5 of 7 for drop, and one split 3, 3
  and 1 that is dropped as undecided.
- The answer gives each follow-up's decision, count and the reason of the
  first member in the counsel's order that voted for the chosen option.
- A member whose report lacks a vote for one follow-up is asked again. When
  it still lacks that vote, a follow-up with 4 votes for one option is
  still decided, the follow-up without 4 is dropped as undecided with the
  member named, and the answer does not ask the person.
- A follow-ups question never reruns, and a `NEW OPTION` on it is ignored.
- A follow-ups call with `pull_request` is refused and writes no brief, and
  a decided follow-ups question owes nothing to any pull request's review.
- The pane lists a follow-ups question with each follow-up's tally and
  decision.

No gate reads `skills/` or `docs/`, so the reviewers check
`skills/implement/SKILL.md`, `docs/specs/pilot-counsel.md` and the pilot
README by reading: the second half puts the follow-ups to the counsel in an
approving round, lists `Undecided:` in a round that requests changes, and
the **Merged** step files only what the counsel decided to file.

## Decided by the counsel

- Which of a pull request's unfixed follow-ups does the /implement session put to the counsel for a fix, file or drop vote? The counsel chose Every follow-up the session did not fix as cheap, except speculative ones: a follow-up the claim checker answered speculative, or could not confirm, stays dropped by the session without a vote, and is listed as dropped as today., 6 of 7.
- At what point in an /implement pull request does the session put the follow-ups to the counsel, and what happens to follow-ups that later rounds raise after the counsel has sat? The counsel chose In the second half of a round where both verdicts approve, before that round's review is posted, so the review records the decisions. A follow-up decided 'fix' is fixed in the same commit as the cheap ones, and when the fix is not inert the new head gets a normal round; a later approving round puts to the counsel only follow-ups it has not decided yet, so a second question happens only when fixing raised new ones., 7 of 7.
- When the counsel votes on a pull request's follow-ups and one follow-up gets no option chosen by at least 4 of the 7 members, what happens to that follow-up? The counsel chose Drop it: list it under Dropped in the review with the tally and the words 'the counsel did not decide', and file nothing., 6 of 7.
- Where does the pull request's review record the counsel's decision on each follow-up and the counsel's one-line reason? The counsel chose Only the session's Follow-ups section: the follow-ups question is recorded nowhere by the mod, and the session writes each follow-up into Fixed, To file or Dropped with the counsel's decision, count and reason, which the tally's answer gives it., 5 of 7.
- On a follow-ups question, when a member that was asked again still has no readable vote for some follow-up, what happens? The counsel chose Count each follow-up from the votes that exist: a follow-up whose option already has 4 votes is decided whatever the missing member would say, and every other follow-up is dropped as undecided, listed with its tally and the members without a vote; the person is not asked., 6 of 7.

## Decided by the person

- The counsel's answer on a member still without a vote, above, departs from
  the rule in the section "Every member votes" of `pilot-counsel.md` that such
  a member sends the question to the person, and that rule is one the owner
  decided directly. The owner's advocate dissented on that ground, so the owner
  was asked, and chose to count from the votes that exist for follow-ups
  questions. The rule in "Every member votes" still holds for every other
  counsel question.
