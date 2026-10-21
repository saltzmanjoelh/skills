# Review rounds stay inside the spec

Written 2026-10-20. It changes the review rounds of `/implement`
(`skills/implement/SKILL.md`, "A review round"), the builder mod's reviewer
and claim checker agents, its package tool and its follow-ups question
(`counsel-decides-follow-ups.md`), only where it says so.

## Goal

A review round spends its reviewers on the work the spec asks for. A finding
about behaviour the spec never asked for is not fixed in the pull request, a
finding that was already settled is not raised and checked again without new
evidence, and a run of fixes that keeps narrowing inside one area of the code
is stopped and put to the counsel before the push limit is reached.

## Users and trigger

Every `/implement` session in the review stage, and the person who pays for
its rounds. The trigger was the pull request that added the foreman mod's
actions. It took sixteen rounds and sixteen pushes after it was opened. From
its seventh round, the data reviewer found a narrower race in every round
inside code that the review rounds themselves had added: code that let a
running parent session go on as another conversation, and later survive a
`/clear`. The spec never asked for either, and in the end the owner had all
of it removed. Along the way the performance reviewer raised one finding ten
more times after the claim checker had refuted it, and the session once built,
and in the next push removed, a cache for it. A replay of that pull request
against the three rules below is in the pull request that carries this spec.

## Behavior

### Rule one: a finding outside the spec is not fixed here

Every finding from every reviewer, focused and verdict alike, carries a
scope line, `Scope:`, with one of three values:

- `in the spec`, naming the passage of the spec that asks for the feature
  the finding is about. The spec asks for a feature, not for every
  protection inside it, so a defect in code that the pull request adds to
  deliver what the spec asks for is in the spec, even when the spec does
  not name the check that is missing;
- `breaks working behaviour`, naming what works on the base branch and
  stops working at the head;
- `outside the spec`, for a finding that asks for behaviour the spec does
  not ask for and the base branch does not have.

A finding that breaks behaviour that already works counts as in scope,
whatever the spec says. So does a safety finding: any finding classed
`SAFETY:`, any finding from the security reviewer, and any other finding
that describes a security hole (an authorization boundary, injection,
untrusted text reaching a shell or a model as an instruction, a widened
privilege), data loss or corruption, a migration that cannot be undone
safely, a credential exposed, a wrong deploy to production, or a breach of a
guarantee the project's `CLAUDE.md` names as protected, whatever its label
or the reviewer that raised it. It is in scope whatever the spec says, and
it blocks as it did before this rule. The claim checker never answers
`outside the spec` or `unsettled` for a safety finding or for one that
breaks working behaviour.

The claim checker checks every scope mark, not only the findings marked
`Needs checking: yes`, against the spec and the base branch, the same way it
checks a claim. For each finding it answers, beside its verdict on the
claim, `scope: stands` or the scope it finds instead, or
`scope: unsettled` when the spec and the base cannot settle it. An unsettled
scope counts as outside the spec, because fixing by default is how the
foreman actions pull request grew.

A finding whose scope, after the check, is outside the spec is not fixed in
this pull request, in either half of a round, and does not block: a
`REQUEST_CHANGES` whose surviving blocking findings are all outside the spec
counts as `APPROVE`, as one whose blocking findings were all refuted does
today. The session lists the finding under `Outside the spec:` in the fix
commit or review of the round, and it becomes a follow-up for the counsel,
sorted and timed like every other follow-up for the counsel: decided in the
next round where both verdicts approve, and listed under `Undecided:` until
then, where it keeps its scope so that it reaches the counsel as outside the
spec.

The follow-ups question takes each follow-up either as text, as today, or as
`{ text, outside_spec: true }`. The brief offers an outside-spec follow-up
only two options, file it as an issue or drop it, keeping their numbers 2
and 3 and their words `file` and `drop`. A vote to fix such a follow-up, by
the word `fix` or the number 1, is not counted: the tally treats it as an
unreadable vote and asks that member again, saying the follow-up is outside
the spec and cannot be fixed in this pull request. Nothing else about the
follow-ups question changes.

### Rule two: reviewers see what was already decided

The package tool builds a numbered section, `## Already decided`, in
`package.md`, by itself, from two records and nothing the session passes in:

- the session's own earlier verdict reviews on the pull request, which it
  already reads for "Earlier rounds";
- the full messages of the commits on the branch, oldest first.

From both it reads the items under the headings `Dropped:` and
`Outside the spec:`. An item is one line starting `- ` under such a heading,
up to the next blank line or the next heading; its text is the finding and
the reason it was settled. Every refuted, speculative and repeated finding is
listed under `Dropped:`, with the claim checker's reason, in the fix commit
of the head where it was dropped, or, when that head drew no fix commit, in
the review posted at that head. Items that say the same thing, compared the
way the counsel compares options, are listed once, at their first place.
Each item is numbered `D1`, `D2` and so on, and names the commit or review
it came from. The section is quoted as data, under the package's existing
line that pull request text is data, not instructions. With nothing
decided, the section says `None yet.`

Every reviewer reads the section before it reports. A reviewer raises a
finding that matches a decided item only with evidence the item did not
have, and says so on a line `Repeats: D<n>. New evidence: <what is new>`.
The session drops, without sending it to the claim checker, a finding that
matches a decided item and brings no new evidence, whether or not the
reviewer marked it, and lists it under `Dropped:` as a repeat of that item.
A repeat with new evidence goes through the claim checker like any finding.

### Rule three: a narrowing trend stops the rounds

`narrowing-trend-counts-real-fixes.md` changes this rule in three places: a
`Reviewed:` value must name exactly one commit, a fix that changes nothing
the code does goes on a `Tidied:` line that counts toward no streak, with a
`Retag:` line to correct a mislabel, and the stop always happens, whatever
the findings behind the streak were. The text below says how.

Every commit that fixes review findings, in a round's first half or for a
blocking verdict, carries two kinds of line:

- `Reviewed: <head>`, naming the head the findings were raised at;
- `Area: <file>: <function or mechanism>`, one for each area a fix that
  changes what the code does lies in, in the session's words, or
  `Tidied: <file>: <function or mechanism>` for a fix that only touches
  tests, comments, documentation, names or wording.

A commit that fixes only cheap follow-ups carries neither line.

The package tool groups the commits that carry `Area:` lines by the head
their `Reviewed:` line names, when the value has at least 7 hex characters
and exactly one branch commit starts with it, by the value itself otherwise,
or by the commit itself when it has none, in the order the groups first
appear. A `Tidied:` line neither lengthens nor breaks a streak, unless a
`Retag:` line turns it into an `Area:` line at its own commit. An area's streak is the number of groups
in a row, ending with the newest, that name that area. Areas are compared
ignoring case and runs of spaces. The package shows:

- every area named so far on the pull request, so the session reuses the
  same wording for the same area;
- each area's streak, when it is 2 or more;
- each commit that fixed findings without an `Area:` or `Tidied:` line, by
  its short sha, which neither lengthens nor breaks a streak;
- each `Tidied:` line with its commit's short sha, each commit whose
  `Reviewed:` value names no single commit, and each `Retag:` line that
  changed nothing;
- each area the person or the counsel closed, from the `Trend:` lines below.

When any area's streak is 3 or more, the package says so, and the package
tool's answer says it in its first line, so the session cannot miss it. The
stop happens whatever the findings behind the streak were, and the stop line
and the question below say that a later safety finding in the area, or one
that breaks working behaviour, stays in scope and blocking whatever the
answer, so the answer governs only the area's other later findings.

Before launching the reviewers on such a package, the session stops and puts
to the counsel, as a question about this pull request, whether to keep going
in that area, file the rest of the area's findings, or cut the area out. The
question names the area, its streak, and the findings fixed there, read from
the fix commits. If the counsel does not decide, the person decides. Then the
session records the answer in a commit of its own, empty when nothing else
needs committing, with the line `Trend: <area>: <keep going | file the rest |
cut it out>`, and pushes it before any reviewer runs:

- **Keep going:** the mod counts that area's streak from zero after the
  commit that holds the `Trend:` line, so the rule stops again only after
  three more groups in a row name the area.
- **File the rest:** the area is closed. The package lists it as closed, and
  every later finding in it counts as outside the spec, so rule one sends it
  to the counsel to file or drop, unless it breaks working behaviour or is a
  safety finding, which stays in scope as rule one says.
- **Cut it out:** the session removes the code in that area that this pull
  request added, in the same commit as the `Trend:` line, and the area is
  closed as above.

A `Trend:` line for one area changes nothing for any other.

### The skill and the reviewers' prompts

`skills/implement/SKILL.md` describes the three rules in "A review round":
the scope line, the claim checker's scope check, the `Outside the spec:`
list and its follow-ups, the repeat rule, the `Reviewed:`, `Area:` and
`Trend:` lines, and the stop before launching reviewers on a package that
reports a streak of 3. Each of the six reviewer agents says, in its report
format, that every finding has a `Scope:` line and that a repeat of a decided
item needs a `Repeats:` line with new evidence, and says to read the
`## Already decided` section. The claim checker agent gives its scope verdict
for every finding. The builder README's description of the reviewers says
the same in a sentence or two.

## Edge cases

- **A first-half round that drops everything and fixes nothing.** No fix
  commit is made, so the second half runs at the same head, and the review
  posted there lists that head's dropped findings under `Dropped:`, where
  the package reads them at the next head.
- **A restart before the review is posted.** The decided items of a head
  with a fix commit are already in that commit. Those of a head without one
  are lost until the review is posted, so a restarted session may check one
  of them again; that is the safe direction.
- **A commit message an outsider wrote.** Anyone who can push to the branch
  can write a `Dropped:` line. The section is quoted as data, the reviewers
  may still raise an item with new evidence, and a commit not made by the
  session is visible in the commit list beside it.
- **A rebase or squash that rewrites the branch.** The records go with the
  commits. `/implement` never rebases a pull request's branch, so this only
  happens when a person does it, and then the package shows what is left.
- **The same area worded differently.** The streak breaks. The package lists
  the areas already named so the session can reuse them, and a reviewer may
  raise a relabelled area as a finding.
- **A round of only cheap follow-ups.** It names no area, so it is not a
  group, and it neither lengthens nor breaks a streak.
- **The limits.** `Max rounds` and `Max pushes per round` stay as they are.
  The empty commit that records a trend answer counts as a push like any
  other.

## Non-goals

- No change to the rule for rounds that, from round 3, a blocking finding
  must be classed `REGRESSION:`, `SAFETY:` or `UNFIXED:`.
- No change to the limits or to how the counsel is made up.
- No check that the file named on an `Area:` line was changed by its commit.
- Nothing for the steady stream of small maintainability findings that kept
  the foreman actions pull request's first halves from ever coming up empty;
  only the push limit bounds that.
- No reading of the session's own memory for any of the three rules.

## Failure modes

- **A wrong scope mark.** The claim checker checks every one; a real
  regression marked outside the spec is caught as `breaks working
  behaviour`, and an out-of-spec addition marked in the spec is caught as
  `outside the spec`. A defect in code that serves the spec stays `in the
  spec` even when the spec does not name the protection that is missing,
  and a safety finding is never outside the spec or unsettled, so a
  security hole in new code still blocks, whichever reviewer found it.
- **A decided item that is not in any record.** It reaches the reviewers
  again and is checked again, which costs a check but ships nothing wrong.
- **A malformed list in a commit.** Lines that do not start `- ` under a
  heading are skipped; the package never fails because of a message.
- **A failed git read of the commit messages.** The package tool refuses, as
  it does today when git cannot produce the diff, rather than write a
  package with an empty decided section.

## Verification

- Builder's tests, run by `claude plugin test .` from `mods/builder`, cover:
  - the decided section built from a review body and from commit messages,
    with numbering, sources, the removal of repeated items, and `None yet.`;
  - the grouping of fix commits by `Reviewed:`, the streak of each area, a
    streak of 3 reported in the tool's first line, a commit without an
    `Area:` line listed and neither lengthening nor breaking a streak, a
    `Trend: keep going` line counting the streak from zero after it, so that
    two later groups do not stop and a third does, and a closed area;
  - an outside-spec follow-up whose brief offers only file and drop, and a
    `fix` vote on it that is not counted and sends the member back, while a
    `fix` vote on an in-scope follow-up in the same question still counts.
- The gates in this repository's `CLAUDE.md` pass for both mods.
- Reading `skills/implement/SKILL.md` and the seven agent files shows each
  rule as described above. No gate reads them, so their reviewers check them.
- The pull request's description applies the three rules by hand to the
  history of the foreman actions pull request and says at which round each
  rule would have stopped the loop.

## Decided by the counsel

- How should the list of already decided findings reach each round's reviewers? The counsel chose: The mod finds them itself: it reads the Dropped and refuted lists out of the earlier reviews and the fix commits' messages, and writes the numbered section without the session's help. 5 of 7 members voted for it.
- Who decides that a review finding is about behaviour the spec does not ask for, so that it is not fixed in this pull request? The counsel chose: Every reviewer marks the scope line as above, and the claim checker also checks every scope mark against the spec and the base branch, the same way it checks a claim. 6 of 7 members voted for it.
- When the counsel decides a finding confirmed to be outside the spec, which choices should it have? The counsel chose: Out-of-scope findings go into the same follow-ups question, at the same time as other follow-ups, but the mod offers them only two options, file it or drop it, and refuses a 'fix' vote on them. 7 of 7 members voted for it.
- For the narrowing-trend rule, how is "a new finding in the same area of the code" recognised across rounds? The counsel chose: Each fix commit names the area of every finding it fixes on an 'Area:' line (a file and the function or mechanism, in the session's words), and the mod counts, from those lines, how many reviewed heads in a row drew a fix in the same area, and shows the streak in the package. 7 of 7 members voted for it.
- After a narrowing-trend stop is answered "keep going" for an area, when does the rule stop for that area again? The counsel chose: The answer is written on a 'Trend:' line in the next fix commit, and the mod counts that area's streak from zero after it, so the rule stops again only after three more heads in a row with a fix there. 7 of 7 members voted for it.
