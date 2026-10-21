# Plan: a detached worktree blocks only for the issue's branch

Date: 2026-10-21. Spec: `docs/specs/wake-detached-worktrees.md`.

## Chosen approach

The most extensible of three plans won, scored by a judge against the spec,
with grafts from the other two. All of the change is Markdown.

The rule for reading a detached worktree goes in one new subsection of the
gone case in `mods/foreman/skills/wake/SKILL.md`, headed
`### The branch a detached other worktree holds`, placed after the line
"Starting goes through "Starting a session"." and before the next `##`
heading. The cleanup case already uses a `###` subsection, so the layout
matches the file. Steps 3, 4 and 7 refer to the subsection by its name, and
the subsection defines "cannot be settled" once, so every step uses the same
words for it.

## Grafts

- **The exception sits beside the rule it overrides** (from the winner, kept).
  The gone case's opening paragraph says a failed git command stops the case.
  One sentence there says that reading a detached other worktree is the
  exception, and that the subsection says what a failure there means.
- **Strict scope** (from the simplest plan). The subsection speaks of "a
  detached other worktree" every time, so nothing in it reads as applying to
  the dead session's own worktree, which step 3.3 still sends to the person.
- **A prunable detached entry cannot be settled** (from the most robust
  plan). A worktree nested inside the main checkout whose `.git` file is gone
  is listed as `prunable`, and `git -C` into its folder walks up and reads the
  main checkout's records instead of its own, while git still holds its
  branch. Measured on git 2.54. Reading it would report "no branch" for a
  branch git holds, which can produce a wrong "finished". The spec's Behavior
  point 2 and its Edge cases are amended in the same pull request.
- **One way to read a record** (from the judge). The parent reads the record
  file with its file-reading tool and never through the shell, because the
  record's path lies under the repository's git folder, whose characters no
  check covers. A file that does not exist names no branch; a file that
  exists but cannot be read means the worktree cannot be settled.
- **The race is accepted and stated** (from the simplest plan). A rebase that
  ends between the worktree listing and the record read makes the worktree
  read as holding no branch while it has the branch checked out. The window
  needs someone acting at that moment, and at worst git refuses the fresh
  session's checkout loudly.
- **The no-repeat rule is stated in the skill**: the message about a worktree
  that cannot be settled names the issue and the folder and never repeats the
  text of a record.

## Rejected alternatives

- **The rule inline in step 3** (the simplest plan). It gives step 3 a second
  numbered list, so "step 3.3", which the counsel's decision and both specs
  use for the dead session's own worktree, would no longer point at one
  thing.
- **A final `git symbolic-ref --quiet HEAD` check** (the most robust plan). It
  does not close the race, because a rebase can end after it too, and it adds
  a timing-dependent question for a worktree that has just reattached.
- **A character check on the printed record path** (the most robust plan).
  Reading the file without the shell avoids the problem without a new reason
  for a worktree to be unsettled.
- **A rule for an empty name after `refs/heads/`** (the most robust plan). The
  branch lookup already exits with status 1 for an empty name.
- **Wording the subsection for any detached worktree** (the most extensible
  plan). It prepares for narrowing step 3.3, which the counsel turned down.

## Steps

1. In the gone case's opening paragraph, after the sentence about a failed git
   or gh command, add the exception for reading a detached other worktree.
2. Replace step 3's closing sentence about a detached other worktree with one
   that sends each detached other worktree to the new subsection. Step 3.3 is
   unchanged.
3. In step 4, say that a branch a detached other worktree holds counts as
   checked out by that worktree, so the existing "also remaining" bullet
   applies to it.
4. In step 7, the merged choice requires that no other worktree is one that
   cannot be settled, and its question names that worktree's folder. The none
   choice's first check tells the person, naming the issue and the folder,
   only for a worktree that cannot be settled, and its third check covers a
   branch that another worktree holds as well as one it has checked out.
5. Add the subsection: the folder and `prunable` checks, the three records in
   a list with how each line names a branch, the branch lookup and its exit
   statuses, the definition of "cannot be settled", the race, and the
   no-repeat rule.
6. Add pointers in `docs/specs/wake-gone-case-branches.md` after its paragraph
   on detached worktrees and in its merged choice.
7. Amend `docs/specs/wake-detached-worktrees.md` for the prunable entry and
   for reading a record with the file-reading tool.
8. Reread every changed line for project names and run the search in
   `.claude/rules/no-project-names.md`.

## Test plan

The four gates run and are reported as not reading the skill's text. The
pull request's walk-through takes `ABC-123` through states built with git
2.54 in a scratch repository outside the checkout, showing for each the
worktree's porcelain entry, each record's first line, the branch lookup's
exit status, and what the edited skill tells the parent to do:

- a stopped rebase of a branch with the key, beside a merged pull request at
  an older tip, beside an open pull request on another key branch, and beside
  an open pull request on the same branch;
- a stopped `--apply` rebase of a branch without the key;
- a rebase begun on a detached head (`detached HEAD`);
- a bisect at a midpoint begun on a key branch, and one begun on a detached
  head (a commit id, lookup status 1);
- a plain detached worktree;
- the main checkout stopped in a rebase, read as an other worktree;
- the conditions that cannot be settled: an unreadable record, an empty
  `BISECT_START`, a folder with a space, and a prunable nested worktree;
- the dead session's own worktree saying `detached`, which step 3.3 still
  sends to the person.

Pull request lists are invented for the walk-through, because `gh` cannot be
faked in a scratch repository, and the pull request says so. Its risk notes
name what the change leaves as it was: the open pull request choice still
ignores a worktree that cannot be settled, and `rebase-merge/update-refs` is
not read.
