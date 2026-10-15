# Plan: follow-ups are fixed, dropped or filed once

Spec: `docs/specs/follow-ups-sorted.md`. Issue: SAL-280, with SAL-199 and
SAL-210. Written 2026-10-14.

## Chosen approach

The simplest-thing plan won. It edits five existing files in place and adds
no new file. Review later added one subsection, as "How the build departed
from this plan" says:

- `skills/implement/SKILL.md` carries the rule. The second half of a review
  round gains a point that sorts the round's follow-ups and a point that
  decides at which head the review is posted. The **Merged** step files at
  most one issue. Steps 6, 7 and 8 and **Resuming** each gain a sentence.
- `mods/pilot/agents/spec-reviewer.md` and
  `mods/pilot/agents/adversarial-reviewer.md` gain the `If never fixed:`
  part under **Each finding**, and the sentence in **Rounds** that defines
  `FOLLOW-UP:` points to it.
- The root `CLAUDE.md` loses the sentence naming SAL-174 and SAL-175.
- `skills/storypr/SKILL.md` step 1 fetches the base and diffs with three
  dots.

It won because it meets the spec with the least text in a skill that is
already 565 lines long, every added rule being one more branch a model must
follow correctly, and because it keeps the limits as the pull request's
own safeguards rather than adjusting them.

## Grafts

1. **Only `//` and `#` whole-line comments are inert** (the judge's own
   addition, sharpening the robust plan's rule for `*`). Block comments and
   comments that instruct a tool are never inert, because a `/*` line above
   unchanged code and a `*/` line below it would switch that code off with
   no reviewer reading it. The spec was corrected to match before this plan
   was written.
2. **Whole-file changes are not inert, and a command shows them** (from the
   robust and extensible plans). `git diff --unified=0` shows no lines for
   a rename, a mode change or a binary, and shows an added or deleted file
   as ordinary lines, so the check also reads
   `git diff --summary --numstat`.
3. **The spec directory is read from the base branch** (from the robust
   plan), as the merge facts are, so a pull request cannot widen what is
   inert.
4. **The push limit as well as the round limit** (from the robust plan).
   The mod's `pushesAfter` counts every commit after the last
   changes-requested verdict, including those a later round approved, so a
   cheap-fix commit can trip **Over a limit** as surely as a carried-over
   review's extra round can.
5. **A fixed title for the follow-up issue,** `Follow-ups from
   <owner>/<name>#<n>`, found by searching the issue tracker for that exact
   title, and nothing filed when the search fails (from the robust and
   extensible plans). Without the title, the check against filing twice
   has nothing to match.
6. **The carried-over review opens with a fixed sentence** naming the full
   approved head (from the extensible plan), so steps 6 and 7 and
   **Resuming** can recognise it.
7. **`None.` for an empty list,** and each repeated item tagged with the
   review it came from (from the extensible plan).
8. **The instruction-file exclusion in generic words:** every line of a file
   that Claude Code loads as instructions (skills, agents, commands, plugins
   and mods) is not inert, comments included.
9. **A resumed session pushes a commit the worktree holds and the pull
   request lacks** before entering the list (from the robust plan), after
   the credential check. Without it, cheap fixes committed before a restart
   are lost when `/cleanup` deletes the worktree, and the package tool
   refuses a checkout ahead of the pull request's head.

## Rejected alternatives

- **The extensible plan's new `### Follow-ups` subsection with pointers.**
  It defines everything once, but it adds the most text after the robust
  plan, adds indirection, and the spec's verification asks for the second
  half itself to state the inert rule.
- **The extensible plan's exemption from the limits** (take one off the
  mod's round for each carried-over review). The limits are among the
  questions that go straight to the person because they guard the pull
  request, and the session's count would drift from the round the pane
  shows and the round `package.md` gives the reviewers.
- **The robust plan's deferred post** when GitHub has not shown the push
  yet, with a special case in step 6. It contradicts the spec's edge case,
  under which a refused carried-over review leads to a normal round, and a
  resumed session could not recognise the special case.
- **The robust plan's fallback of reading every older review's
  follow-ups** when the last review has no **Follow-ups** section. It could
  file the flood this change exists to stop.
- **The robust plan's rule that storypr stops when the fetch fails.**
  Harmless but more text than the issue asks for; a failed fetch prints its
  own error.
- **A table of languages and file endings.** Two markers in one sentence
  cover the languages the spec names.

## Steps

Each step is one commit.

1. **SAL-199.** In `CLAUDE.md`, replace the bullet that begins "Some files
   name a project today" with "A reviewer applies these rules to the text a
   pull request adds or changes."
2. **SAL-210.** In `skills/storypr/SKILL.md` step 1, say to fetch the base
   first and why, and use:
   ```bash
   git fetch origin <base branch>
   git log --oneline origin/<base branch>..HEAD
   git diff --stat origin/<base branch>...HEAD
   git diff origin/<base branch>...HEAD          # skim the meaningful hunks
   ```
   The `gh pr create --base <base branch>` line stays.
3. **The verdict reviewers.** In both agents, after the finding format
   line, add a paragraph: a `FOLLOW-UP:` finding ends with
   `If never fixed: <what a person would see>` or
   `If never fixed: nothing visible`; a person is whoever uses what the pull
   request ships (someone running a skill, a session following it, someone
   reading its output); name what they would see go wrong, such as a wrong
   result, a stall, a misleading message or lost work; wording, a test that
   could be stronger and code structure are `nothing visible`; a blocking
   finding has no such part. Give the full format line for a follow-up. In
   **Rounds**, the sentence that defines `FOLLOW-UP:` adds "and ends as
   **Each finding** says". The two agents' different wording about which
   rounds use `FOLLOW-UP:` stays. Frontmatter is untouched.
4. **`skills/implement/SKILL.md`.**
   - **Merged:** read the `To file:` list in the **Follow-ups** section of
     the last verdict review. `None.` files nothing. Otherwise search the
     issue tracker for the exact title `Follow-ups from <owner>/<name>#<n>`;
     when an issue has it, file nothing; otherwise file that one issue,
     linking the pull request, each item one sentence saying what a person
     would see. When the search fails, or there is no tracker, file nothing
     and say in the report that the list is in the last review.
   - **Step 6:** a head whose verdict review was carried over to it counts
     the focused reviewers as run.
   - **Step 7:** a review carried over to this head is its verdict review.
   - **Step 8:** the push also carries the cheap fixes the second half
     committed, and the next round reviews them.
   - **First half, point 3:** a speculative finding is dropped and listed as
     dropped in the round's review, never a code change.
   - **Second half:** keep points 1 and 2. New point 3 sorts every
     `FOLLOW-UP:` that survived the claim checker into cheap, dropped and to
     file, as the spec defines them, treats a missing `If never fixed:` as
     `nothing visible` unless the finding plainly describes a visible
     failure, commits the cheap fixes in one commit staged by path without
     pushing, and drops them instead when they would take the pull request
     past `Max rounds` or `Max pushes per round` and nothing else needs a
     push. New point 4 is today's point 3 (posting), with "and the
     follow-ups" replaced by the **Follow-ups** section (`Fixed:` with
     commits, `Dropped:` with why, `To file:` with what a person would see,
     `None.` when empty, earlier reviews' dropped and to-file items repeated
     with the review they came from), and the four cases of where to post:
     requests changes, at the reviewed head, pushing nothing; both approve
     and nothing committed, at the reviewed head; both approve and every
     changed line inert, push and post at the new head, opening with "Both
     verdicts are carried over from <full sha>, which both verdict reviewers
     read." and listing each commit and file since, and on a refusal start
     the list again from **Merged** so the head gets a normal round; both
     approve and any line not inert, post at the reviewed head, then push.
     Then the inert rule as the spec states it, with the commands
     `git diff --unified=0 <reviewed head> HEAD` and
     `git diff --summary --numstat <reviewed head> HEAD`. New point 5: after
     a push, go on as **When a turn ends** says; otherwise start the list
     again from **Merged**.
   - **When a turn ends:** "after its second half posts the review" becomes
     "after its second half posts the review without pushing".
   - **Updating the linked checkout, When it fails:** "the follow-ups"
     becomes "the follow-up issue".
   - **Resuming:** a carried-over review at the head counts both halves as
     run; before entering the list, push any commit the worktree holds that
     the pull request lacks, after the credential check.

## How the build departed from this plan

The focused reviewers found ordering and recovery problems that the plan
did not foresee, and the skill now differs from step 4 in three ways.

- The second half has seven points rather than five. Points 1 and 2, which
  launch the verdict reviewers and send their findings to the claim
  checker, are unchanged; points 3 to 7 settle the verdicts, sort the
  follow-ups and commit the cheap fixes, choose what follows the review,
  post the review, and go on. Settling the verdicts first means the
  sort and the choice of head use the verdicts that are actually posted.
- The round's review is always posted at the reviewed head first, and a
  review carried over to the new head is a short addition after the push,
  so a refused or unposted carried-over review loses no record.
- A new subsection, **Commits the pull request lacks**, says once how to
  find, push or keep commits the worktree holds and the pull request does
  not. The **Merged** step, the merge step and **Resuming** point to it,
  which replaced three differently worded copies.

## Test plan

No gate reads `skills/`, `docs/` or `CLAUDE.md`; the reviewers check those
by reading, and the report says so.

- The four pilot gates run in order, because the agent files live in the
  mod: they show the agent edits left the frontmatter valid and no test
  reads the agents' text.
- ``grep -rn "for each \`FOLLOW-UP:\`" skills mods`` prints nothing.
- `grep -n "If never fixed" mods/pilot/agents/*.md` finds exactly the two
  verdict reviewers.
- `grep -n "SAL-17" CLAUDE.md` prints nothing.
- `grep -n "fetch origin\|\.\.\.HEAD" skills/storypr/SKILL.md` shows the
  fetch and both three-dot diffs.
- `grep -rnE "SAL-[0-9]" skills mods/pilot/agents` finds nothing in added
  text.
- A dry run of the inert commands in a scratch repository: a commit that
  changes one spec line and one `//` comment shows only those lines; adding
  a `/*` line, a code line, a mode change or a binary file each shows
  something the rule calls not inert. The result goes in the pull request's
  description as a measurement.
