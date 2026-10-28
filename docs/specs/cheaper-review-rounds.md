# Review rounds after the first one cost less

Written 2026-10-28.

## The incident

After the change that caps an `/implement` session's context (see
`docs/specs/implement-session-context-cap.md`), the subagents became most of
what a session costs. In the run that tested the cap they were 81% of the
session's cost: 38.6 million weighted tokens over 6.5 hours. The review
rounds launch most of those agents. A round runs the four focused reviewers
(security, maintainability, performance and data) and a claim checker, and
then, when that half finds nothing to fix, the spec reviewer, the adversarial
reviewer and another claim checker. That is up to eight agents per round,
each starting from a large fixed prompt, and each reading the whole pull
request again.

A measurement of a heavy day found that rounds run after both verdicts had
already approved were about 18% of the whole day's usage. In one pull
request, small fixes committed after approval led to 7 focused rounds and 8
claim checks. `Max rounds` never stopped it, because it counts only rounds in
which a verdict requested changes. Today a head after approval goes through a
whole new round as soon as one changed line is not inert, and in a repository
of skills and mods almost no line is inert, because every line of a file that
Claude Code loads as instructions counts as code.

## Goal

A head after the first review costs only what its change since the last
review needs:

1. A head whose only change since a head both verdicts approved is the
   round's follow-up fix commit is checked by one reviewer and one claim
   checker, not by a full round.
2. On a later round, every reviewer reads the change since the last head
   the verdict reviewers read, not the whole pull request again.
3. On a later round, only the focused reviewers whose area the change could
   affect run again, by a rule from the changed file paths.

What does not change: a safety finding, or a finding that breaks working
behaviour, blocks exactly as it does today; a pull request that has never
had a verdict gets the full first review, all four focused reviewers on the
whole pull request and then both verdict reviewers; the verdicts that gate
the merge are on the exact commit that merges; and the counsel decides the
follow-ups it decides today, except the findings of the check after
approval, which it may only file or drop (see Behavior).

## Users and trigger

Every `/implement` session, from the second head of its pull request on.
The builder mod's package tool builds what the reviewers read and says which
reviewers to launch; the skill says what the session does with that.

## Behavior

### Words used below

- **The verdict head** is the newest commit of the pull request that has a
  verdict review posted by the session's login, read from the pull request's
  reviews, as the package's earlier rounds already are. A carried-over
  review counts.
- **The reviewed head** is the newest of the verdict head and every head that
  a fix commit's `Reviewed:` line names. Those are the heads where the
  focused reviewers last ran, because the first half writes `Reviewed:` on
  the commit that fixes its findings, and a first half that found nothing
  to fix is followed by a verdict review at the same head.
- **A first package** is the package of a pull request with no verdict head.
  **A later package** is any other.

Both heads must be ancestors of the current head, and the base branch must
not have been merged into the pull request since them; the package tool
checks both with git. When either check fails for a head, that head is
treated as missing, and the package falls back as the edge cases say.

### The package

A first package is what the tool writes today: `diff.patch` is the whole
pull request against the base, and every earlier review is repeated in full.
It names all four focused reviewers.

A later package differs in four ways:

- `diff.patch` is the change from the verdict head to the current head, with
  15 lines of context around each hunk.
- `full.patch` beside it is the whole pull request against the base, as
  `diff.patch` is in a first package.
- `package.md` names the verdict head the change starts from, and tells
  reviewers to read `diff.patch` first and `full.patch` or any source file
  only when a hunk needs it.
- The newest earlier review is repeated in full, and each older one as one
  line naming its head and its two verdicts. The `## Already decided` list
  and the `## Areas fixed so far` section stay whole, so the rule for repeats
  works as before.

`diff.patch` starts at the verdict head rather than the reviewed head because
both verdict reviewers read every line up to the verdict head, while a
focused reviewer that the rule below skipped may not have read a test or
documentation change since. One start point gives `diff.patch` one meaning
for every reviewer.

The reviewer agents' instructions describe both files, so that a reviewer on
a later round knows `diff.patch` is the change since the named head, and the
claim checker reads `full.patch` when it checks a finding's scope against the
whole pull request.

### Which focused reviewers run again

The package tool sorts every file changed between the reviewed head and the
current head, read with `git diff --name-status`, into one of three kinds:

- **a test file**, when a folder in its path is named `test` or `tests`, or
  its file name contains `.test.`, `.spec.` or `_test.`;
- **documentation**, when it is a Markdown file under the spec directory (read
  from the base branch's `CLAUDE.md` as the merge facts are, `docs/specs/` by
  default), under `docs/`, or is `README.md` at the repository's root;
- **anything else**, which includes every file that Claude Code loads as
  instructions, and every file the tool cannot sort for certain.

A renamed file is sorted by both its old and its new path, and counts as
anything else unless both sort the same way. If any file is anything else,
all four focused reviewers run. If only tests and documentation changed, only
the maintainability reviewer runs. A first package, or a later package whose
reviewed head is missing, names all four.

The package tool's answer names the focused reviewers to launch, and the
builder pane plans only those. Once all of the named ones have finished, the
pane plans the verdict reviewers, as it does today once all four have.

### The check after approval

A head is **up for the check** when the verdict head's review approves with
both verdicts, the verdict head is the reviewed head, and every commit after
the verdict head is the one commit the second half's point 4 makes, whose
first line is `Fix this round's cheap follow-ups`. The package tool decides
this from the commits and says so in its answer and in `package.md`. At such
a head the answer names only the adversarial reviewer, and the pane plans
only it.

The skill then works as follows for a head up for the check:

1. The session launches the adversarial reviewer alone on the later package,
   telling it that this is the check after approval.
2. It drops repeats and gives every finding left to one claim checker, as
   the first half does.
3. If a finding survives that is a safety finding or breaks working
   behaviour, the head goes through a normal round, as any later head does.
4. Otherwise the session posts a review at the new head that carries both
   verdicts over from the verdict head. It opens with "Both verdicts are
   carried over from <full sha>, which both verdict reviewers read; the
   adversarial reviewer read the change since then and found nothing that
   blocks.", lists the commit and files since that head, and repeats the
   **Follow-ups** section of the review before it.
5. Every other surviving finding goes to the counsel as a follow-up outside
   the spec, `{ text, outside_spec: true }`, so the counsel may only file it
   or drop it. Nothing the check raises is fixed in this pull request, so
   the carried-over head is final and the merge goes ahead from there.

When every line the point 4 commit changed is inert, the session carries the
verdicts over without the check, as today.

### The issue at merge

The real run that measures this change can only happen after merge, so on
this issue's own merge the session does not move the issue to done. It
comments on the issue that the measurement is owed, and the person closes
the issue once a later `/implement` run has been measured. This applies to
this issue only; the skill's Merged step does not change.

## Edge cases

- **The base was merged in after the verdict head.** A plain diff between the
  two heads would show the base's own changes as the pull request's. The
  package falls back to a first package, says why in `package.md`, and names
  all four focused reviewers. A head that only merged the base in still
  counts the focused reviewers as run, as today, so this costs a full round
  only when real work follows a merge of the base.
- **A force-push left the verdict head off the branch.** The verdict head is
  not an ancestor of the current head, so the package falls back to a first
  package and says why.
- **The reviewed head is missing but the verdict head is not**, for example
  when a `Reviewed:` value names no commit on the branch. The package is a
  later package, but it names all four focused reviewers.
- **A cheap-fix commit also carries blocking fixes**, which happens when a
  verdict requested changes and step 8 pushed them together. The verdict head
  did not approve, so the head is not up for the check and goes through a
  normal later round.
- **More than one commit after the approved head.** The head is not up for
  the check, and goes through a normal later round.
- **A file deleted, or a mode change.** It is sorted by its path like any
  other file; a mode change on a file that is not a test or documentation is
  anything else.

## Non-goals

- Changing how rounds are counted, `Max rounds` or `Max pushes per round`.
- Changing the first review of a pull request, or which agents sit on the
  counsel.
- Separating the base's changes from the pull request's own after a merge of
  the base; the package falls back to a full review instead.
- A finer rule that skips the security, performance or data reviewer for a
  change to instruction files only. Those files are the code in a repository
  like this one.
- A per-reviewer start point for `diff.patch`.
- Changing what the inert-line rule counts as inert.
- The real `/implement` run that measures this change, which is owed after
  merge (see "The issue at merge").

## Failure modes

- If git cannot produce the change since the verdict head, or the list of
  changed files, the package tool refuses the package, as it refuses a
  failed diff against the base today. It never writes a later package with a
  partial diff.
- If the tool cannot sort a file, the file counts as anything else, so a
  mistake costs a reviewer run, never a skipped reviewer.
- If the check after approval is refused or the turn ends before its review
  is posted, the head is reviewed again on the next turn; the record of the
  approved head stays in its review.

## Verification

Tests in `mods/builder`, run by `claude plugin test .`:

- A first package is unchanged: `diff.patch` is the whole pull request, no
  `full.patch` is written, every earlier review is in full, and the answer
  names all four focused reviewers.
- A later package writes `diff.patch` from the verdict head with 15 lines of
  context, `full.patch` against the base, names the start head, repeats the
  newest review in full and the older ones as one line each, and keeps the
  whole `## Already decided` list.
- The sorting rule: a test file, a documentation file under the spec
  directory, under `docs/` and `README.md`, a skill or agent file, a renamed
  file across kinds, and a file it cannot sort, each give the right kind,
  and the reviewers named follow from the kinds.
- A merge of the base since the verdict head, and a verdict head that is not
  an ancestor, each fall back to a first package with the reason in
  `package.md`.
- A head is up for the check exactly when the verdict head approves with
  both verdicts, is the reviewed head, and the only commit since is the
  cheap-fix commit; the answer then names only the adversarial reviewer.
- The pane plans only the named focused reviewers, then the verdict
  reviewers once those have finished, and only the adversarial reviewer at a
  head up for the check.

The gates in the project's `CLAUDE.md` run on the change. No gate reads
`skills/` or the agent files' wording, so the skill's new rules are checked
only by the reviewers.

## Not verified by the gates

One real `/implement` run on an issue in this repository with the change
loaded, reporting how many review rounds ran, how many reviewer agents and
claim checkers were launched before and after the first approval, and the
subagent share of the session's cost, compared with the context-cap run.
Sessions load the skill and the mod through links into the main checkout, so
this run can only happen after merge.

## Decided by the counsel

- After both verdict reviewers approve a head and the session then commits fixes that change real code (not only inert lines), what should check the new head instead of today's full round of six reviewers and two claim checkers? The counsel chose: One reviewer, the adversarial reviewer, reads only the change since the approved head, and one claim checker checks whatever it raises. If nothing survives that is a safety finding or breaks working behaviour, the review at the new head carries both verdicts over from the approved head and names the new head; if something does survive, the new head goes through a normal full round. 4 of 7 members voted for it.
- On a head after the first review, which focused reviewers (security, maintainability, performance, data) should rerun, decided mechanically from the files changed since the last head they reviewed? The counsel chose: Sort each changed file into one of three kinds: a test file (under a test or tests folder, or named with .test. or .spec. or _test.), documentation (Markdown that no tool loads as instructions: the spec directory, docs/, README.md), or anything else. If any file is anything else, all four rerun. If only tests and documentation changed, only the maintainability reviewer reruns. A file that cannot be sorted for certain counts as anything else. 7 of 7 members voted for it.
- On a second or later round, what should the review package give the reviewers to read by default, and does that differ between the focused reviewers and the two verdict reviewers? The counsel chose: Every reviewer on a later round gets the change since the last head it reviewed as diff.patch, with wider context around each hunk (for example 15 lines), and the whole pull request's diff against the base as full.patch beside it. package.md says which head the change starts from, puts the newest earlier review in full and the older ones as a one-line summary each, and keeps the Already decided list whole. Reviewers are told to read diff.patch first and full.patch or any source only when a hunk needs it. 5 of 7 members voted for it.
- When the one-reviewer check after approval (the adversarial reviewer reading only the change since the approved head) raises findings that are neither safety findings nor findings that break working behaviour, what happens to them? The counsel chose: They go to the counsel with only file it or drop it on offer, the way findings outside the spec are put today, so nothing raised by the check is fixed in this pull request, the carried-over head is final, and the loop of fix, check, fix ends after one check. 4 of 7 members voted for it.
- The issue's verification asks for one real /implement run on an issue in this repository with the change loaded, reporting rounds, reviewer and claim-checker launches before and after the first approval, and the subagent share of cost against the context-cap run. Sessions load the skills and the builder mod through links into the repository's main checkout, so the change is only loaded for a real run after this pull request merges. How should this spec treat that measurement? The counsel chose: Out of scope for this pull request: the spec's Verification covers the builder tests and gates, and lists the real run as a measurement owed after merge. At merge the session leaves this issue's state alone (it does not move it to done) and comments on it that the measurement is owed, so the person closes the issue once a later /implement run has been measured. 5 of 7 members voted for it.
