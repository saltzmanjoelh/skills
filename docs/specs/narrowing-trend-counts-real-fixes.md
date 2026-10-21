# The narrowing trend counts only real fixes

Written 2026-10-21. It changes rule three of
`review-rounds-stay-in-scope.md`, the narrowing-trend rule of `/implement`'s
review rounds, in three places: how a fix commit's `Reviewed:` value is
matched, which fixes count toward a streak, and what a stop means when safety
findings are in play. Everything that spec says and this one does not change
stays as it is.

## Goal

A streak of 3 stops the rounds and costs a seven-member counsel sitting, so it
should fire only on what it was built for: a run of fixes that keep changing
what the code does in one area. It should not fire on a trickle of added tests
and reworded comments, it should not be lengthened, shortened or split by a
`Reviewed:` value that cannot name one commit, and a session should never have
to decide on its own judgement whether a stop applies.

## Users and trigger

Every `/implement` session in the review stage, and the person who pays for
its rounds. The trigger was the pull request that added the three rules that
keep review rounds inside the spec. In its own rounds, a run of small
maintainability fixes in one file (added tests, reworded comments) reached a
streak of 3 by hand when nothing was narrowing, and the session skipped a stop
on its own judgement because the findings behind it were safety findings,
which stay blocking whatever the counsel answers. Its reviews also noted that
the package matches a `Reviewed:` value by prefix with no minimum length and
takes the first commit that matches.

## Behavior

### Matching a `Reviewed:` value

The package tool groups a fix commit under the branch commit its `Reviewed:`
value names only when the value, read as today (its first word, without
trailing punctuation, ignoring case), has at least 7 hex characters and
exactly one branch commit's full sha starts with it. Any other value (shorter
than 7 characters, not hex, matching no branch commit, or matching more than
one) keys a group of its own named by the value, as an unmatched value does
today, so two commits that give the same unmatchable value still share a
group. The package's `## Areas fixed so far` section lists each commit whose
`Reviewed:` value could not be matched to one commit, by its short sha and the
value, cleaned to print, so the session can see why a streak looks the way it
does.

### Which fixes count

A commit that fixes review findings names the area of each fixed finding on
one of two lines, `<file>: <function or mechanism>` as today:

- `Area:` for a fix that changes what the code does. A change to an
  instruction file that Claude Code loads, such as a skill, an agent, a
  command or a mod, changes what a session does, so it is a behaviour fix
  even though the file is Markdown.
- `Tidied:` for a fix that only adds or changes tests, comments,
  documentation, names or wording, and changes nothing about what the code
  does.

A commit with fixes of both kinds carries both kinds of line. `Area:` lines
count toward streaks exactly as today. `Tidied:` lines neither lengthen nor
break a streak: a commit whose fixes are all tidied forms no group, as a
commit without an `Area:` line does today. The package lists every `Tidied:`
line with its commit's short sha beside the areas, and a commit with a
`Reviewed:` line and only `Tidied:` lines is not listed among the commits that
fixed findings without naming an area. Cheap follow-ups are unchanged: their
commit carries neither line.

### Checking the label

Every reviewer agent reads the `Tidied:` lines in the package's
`## Areas fixed so far` section. A `Tidied:` line on a fix that changed what
the code does, including a change to an instruction file, is a finding the
reviewer raises like any other, with the scope `in the spec`, since this
spec asks for the label to be right.

When the claim checker confirms such a finding, the session corrects the
record with a line `Retag: <sha>: <area>` in its next commit, whichever round
it is: the commit for that round's fixes, the cheap follow-ups commit, or an
empty commit of its own when nothing else needs committing. The correction is
a change to one commit message line, so it is fixed like a cheap follow-up,
and the rule for rounds, which from round 3 lets only `REGRESSION:`,
`SAFETY:` and `UNFIXED:` findings block, is not changed. The `<sha>` follows
the same rule as `Reviewed:`: at least 7 hex characters, matching exactly one
branch commit. The package then reads that commit's `Tidied:` line for that
area as an `Area:` line, at that commit's own place on the branch, so the
group order and any `Trend:` answer between the two commits come out as if
the line had been right from the start. A `Retag:` line that cannot be
applied, because its sha does not match exactly one branch commit or that
commit has no `Tidied:` line for that area, changes nothing and is listed in
the package as unreadable, as an unreadable `Trend:` line is today.

### A stop when safety findings are in play

A streak of 3 always stops the rounds, whatever the findings behind it were,
including safety findings and findings that break working behaviour. The
session never skips a stop on its own judgement. The package's stop line, and
the question the session puts to the counsel, both say that a later safety
finding in the area, or a later finding that breaks working behaviour, stays
in scope and blocking whatever the answer, so the answer governs only the
area's other later findings. Cut it out still removes the code in the area
that the pull request added, and a hole in that code goes with it.

### The skill, the agents and the README

`skills/implement/SKILL.md` describes, in "The fix lines" and "A streak of 3",
the two kinds of line and when each is used, the `Retag:` correction, and that
the stop always happens with the answer governing only the area's other later
findings. Each of the six reviewer agents says that a mislabelled `Tidied:`
line is a finding. The claim checker agent says that such a finding is in the
spec whatever the pull request's own spec says, because the rule that asks
for the label to be right is the review rounds' own rule and the pull
request's spec will not mention it. The builder README's description of the package tool
mentions `Tidied:` and `Retag:` lines. Rule three of
`review-rounds-stay-in-scope.md` is edited where it becomes wrong, and points
to this spec.

## Edge cases

- **A `Reviewed:` value of exactly 7 characters that matches one commit.** It
  groups under that commit. The same value later matching two commits, as the
  branch grows, keys a group of its own from then on; the package lists it.
- **A value of 40 characters, a full sha.** It matches at most one commit, as
  today.
- **A commit with an `Area:` line and a `Tidied:` line for the same area.**
  The `Area:` line counts; the `Tidied:` line is listed.
- **A `Retag:` for a commit that is later than the `Retag:` line itself, or
  is the same commit.** It is applied all the same, because the package reads
  every `Retag:` line before it counts streaks.
- **Two `Retag:` lines for the same commit and area.** The second changes
  nothing.
- **A `Retag:` for a commit after which a `Trend: keep going` line was
  given.** The retagged area is counted at the earlier commit's place, so the
  `keep going` answer resets it as it would have reset a right label.
- **A `Retag:` naming a commit in an area that a `Trend:` line has closed.**
  The area stays closed; the retag cannot reopen it.
- **Older commits on an open pull request whose tidy fixes carry `Area:`
  lines.** They keep counting, as they do today.

## Non-goals

- No reverse correction: no line turns an `Area:` line into a `Tidied:` one,
  because that would let a session shorten its own streak. A wrongly counted
  fix can only stop the rounds early, which costs one question.
- No check or warning in the mod that reads a fix commit's diff to judge its
  labels; the reviewers judge them.
- No matching of one area worded differently; the streak still breaks, as
  rule three's edge case says.
- No change to the streak numbers (shown from 2, stopping at 3), to
  `Max rounds` or to `Max pushes per round`.
- No special handling of older commits whose tidy fixes carry `Area:` lines;
  they keep counting as they do today.
- No change to the rule for rounds from round 3, or to the other places that
  print a short sha, which print it and match nothing.

## Failure modes

- **A session labels a behaviour fix as tidied.** The reviewers see the line
  and raise it, and the `Retag:` line puts the fix back into the streak at its
  own place. A mislabel no reviewer notices hides one group of a streak, which
  the push limit still bounds.
- **A malformed `Retag:` line.** It is listed as unreadable and changes
  nothing; the package never fails because of a message.
- **An unmatched `Reviewed:` value.** The commit keys its own group, which
  can lengthen or split a streak, and the package says which commit and value
  caused it.

## Verification

- Builder's tests, run by `claude plugin test .` from `mods/builder`, cover:
  - a `Reviewed:` value of 7 hex characters matching one commit grouping under
    it; a value of 6 characters, and a value matching two commits, each keying
    a group of their own and listed in the package; and two commits with the
    same ambiguous value sharing a group;
  - a `Tidied:` line neither lengthening nor breaking a streak, listed in the
    package, and a `Tidied:`-only commit with a `Reviewed:` line not listed
    among the commits without an area;
  - a `Retag:` line counting the area at the retagged commit's own place, so
    that a streak of 2 becomes 3 and stops, and so that a `Trend: keep going`
    line between the two commits still resets it; and an unappliable `Retag:`
    listed as unreadable;
  - the stop line saying that later safety findings and findings that break
    working behaviour stay blocking whatever the answer.
- The gates in this repository's `CLAUDE.md` pass for both mods.
- Reading `skills/implement/SKILL.md`, the six reviewer agent files, the
  builder README and rule three of `review-rounds-stay-in-scope.md` shows each
  rule as described above. No gate reads them, so their reviewers check them.

## Decided by the counsel

- When a fix commit's `Reviewed:` value is too short to name one commit safely, or matches more than one commit on the branch, how should the package tool group that commit for the narrowing-trend streak? The counsel chose: Accept a value only when it has at least 7 hex characters and exactly one branch commit's sha starts with it, and group by that commit; any other value keys a group of its own named by the value, as an unmatched value does today, and the package lists the commit under a note that its Reviewed: value could not be matched to one commit. 7 of 7 members voted for it.
- Which fixes of review findings should count toward an area's narrowing-trend streak, and who decides that for each fix? The counsel chose: The session decides by a written rule: a fix that changes what the code does gets an `Area:` line as today; a fix that only adds or changes tests, comments, documentation, names or wording gets a `Tidied: <file>: <function or mechanism>` line instead, which the package lists beside the areas and which neither lengthens nor breaks a streak. 7 of 7 members voted for it.
- When an area's streak of 3 was reached because of fixes to safety findings, should the narrowing-trend stop still happen, and what does the counsel's answer then govern? The counsel chose: The stop always happens, whatever the fixes were for. The mod's stop line and the session's question both say that a later safety finding, or one that breaks working behaviour, in the area stays in scope and blocking whatever the answer, so the answer governs only the area's other later findings; cut it out still removes the area's code, and the hole goes with it. 7 of 7 members voted for it.
- Who checks that a fix written on a `Tidied:` line really changed nothing about what the code does, so that a session cannot hide a narrowing trend by labelling its fixes as tidying? The counsel chose: Every reviewer agent's prompt says that a `Tidied:` line on a fix that changed what the code does, including an instruction file such as a skill or agent, is a finding to raise, in scope, like any other; the package's `## Areas fixed so far` section already shows them each `Tidied:` line with its commit. 5 of 7 members voted for it.
- When a reviewer's finding that a `Tidied:` line was really a behaviour fix is confirmed, how does the session correct the streak record, given that a pushed commit message cannot be edited without a force push? The counsel chose: A later commit carries a line `Retag: <sha of the mislabelled commit>: <area>`, with the same 7-character and exactly-one-commit rule as `Reviewed:`; the package then reads that commit's `Tidied:` line for the area as an `Area:` line at that commit's own place, so the streak comes out as if it had been labelled right. The session always fixes a confirmed mislabel in this pull request, in any round, in its next commit, which may be the cheap follow-ups commit or an empty one. 6 of 7 members voted for it.
- What does this change deliberately leave out? The counsel chose: Leave out all of these: the reverse correction from `Area:` to `Tidied:`, any check or warning in the mod that reads a fix commit's diff, matching an area worded differently, any change to the streak numbers, the round limit or the push limit, and any special handling of older commits whose tidy fixes carry `Area:` lines, which keep counting as they do today. 7 of 7 members voted for it.
