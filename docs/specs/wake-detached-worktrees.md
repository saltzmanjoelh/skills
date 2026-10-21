# Wake skill: a detached worktree blocks only for the issue's branch

Date: 2026-10-21. This is the follow-up filed from the review of the change
that made the gone case find the right branch (see
`docs/specs/wake-gone-case-branches.md`).

## Goal

The gone case in `mods/foreman/skills/wake/SKILL.md` decides what to do with a
sub session whose status file stopped updating and whose desktop session is
not running. Today, while any worktree in the repository other than the dead
session's own says `detached`, the parent neither reports the issue finished
nor starts a fresh `/implement` session, and the person gets a one-line
question instead. That happens even when the detached worktree belongs to an
unrelated issue, for example one stopped in the middle of a rebase. This
change reads which branch git still holds for such a worktree, and lets that
worktree affect the decision only through that branch, so an unrelated
detached worktree no longer costs the person a question.

## Users and trigger

The parent session's model reads the gone case when foreman wakes it with
"<who> has not updated its status file for <n> minutes and its session is not
running, so restart it or release the issue." The person reads it to know
what the parent will do on their behalf.

## Behavior

The **other worktrees** keep their meaning from step 3 of the gone case:
every entry in `git worktree list --porcelain` except the worktree step 3
accepted. Only the other worktrees whose entry says `detached` are read as
below. Every other step keeps its current wording unless this list changes it.

1. **The held branch.** For each detached other worktree, the parent reads the
   records git keeps for a worktree stopped in a rebase or a bisect, in this
   order, each settling to a branch name or to no branch:
   1. The worktree's folder holds only the characters the cleanup case allows,
      because the parent puts it in a command.
   2. For each of `rebase-merge/head-name`, `rebase-apply/head-name` and
      `BISECT_START`, the parent finds the record's path with
      `git -C '<folder>' rev-parse --path-format=absolute --git-path '<record>'`
      and reads the file's first line when the file exists. A record that does
      not exist names no branch.
   3. In the two rebase records, the line is either `refs/heads/<name>`, which
      names `<name>`, or exactly `detached HEAD`, which git writes for a rebase
      that began on a detached head and which names no branch. In
      `BISECT_START`, the whole line is the name.
   4. The name holds only the characters the cleanup case allows. Then
      `git -C '<folder>' rev-parse --verify --quiet 'refs/heads/<name>'` decides:
      exit status 0 means the worktree holds that branch, and exit status 1
      means there is no such branch, as when `BISECT_START` holds the commit id
      of a bisect that began on a detached head, so the record names no branch.

   A detached worktree whose records name no branch holds no branch, the same
   as a plain `git worktree add --detach`, and affects nothing in the gone
   case.
2. **A worktree that cannot be settled.** A detached other worktree cannot be
   settled when its folder fails the character check, the path command fails,
   a record exists but cannot be read, a rebase record's line has neither
   form above, `BISECT_START` is empty, a name fails the character check, or
   the branch lookup exits with any status other than 0 or 1. Such a worktree
   keeps today's block: the parent never reports the issue finished and never
   starts a fresh session while one exists, and tells the person in one line
   that names the issue and the folder. The message never repeats the text of
   a record.
3. **A held branch counts as checked out.** In step 4 of the gone case, a kept
   branch that a detached other worktree holds counts as checked out by that
   worktree. So it is remaining, step 6 counts it among the branches, and the
   none choice's check for a branch checked out in another worktree applies to
   it. A held branch that does not hold the key is not a kept branch and
   changes nothing.
4. **Step 7.** The merged choice reports the issue finished only when, among
   its existing conditions, no other worktree is one that cannot be settled;
   otherwise its question names that worktree's folder. The none choice's
   first check tells the person and starts nothing only when an other
   worktree cannot be settled. The open pull request choice is unchanged.
5. **The earlier spec.** `docs/specs/wake-gone-case-branches.md` points to this
   spec where it describes the detached block, so a reader of either finds the
   current rule.

## Edge cases

- A worktree stopped in a rebase of `claude/xyz-9-other` while the issue is
  `ABC-123`: it holds a branch without the key, so the issue is reported
  finished, or a fresh session starts, as if that worktree were not there.
- A worktree stopped in a rebase of `claude/abc-123-fix` beside a merged pull
  request whose head was that branch at an older tip: the held branch is
  remaining, so the merged choice asks the person, naming that branch.
- A worktree stopped in a rebase of `claude/abc-123-second` beside an open pull
  request on `claude/abc-123-fix`: two branches count, so the parent tells the
  person instead of resuming the pull request. Today it resumes the pull
  request.
- A worktree stopped in a rebase of the open pull request's own branch: the
  branch counts once, so the parent resumes the pull request, as today.
- A bisect at a midpoint that started on `claude/abc-123-fix`: `BISECT_START`
  names it, so it is held, the same as a rebase.
- A bisect or a rebase that started on a detached head: it names no branch.
- A plain detached worktree: it holds no branch.
- A worktree in a rebase and a bisect at once: every branch either record
  names is held.
- The dead session's own worktree saying `detached`: step 3.3 still sends the
  whole case to the person, unchanged.

## Non-goals

- Step 3.3, for the dead session's own detached worktree, is unchanged (see
  "Decided by the counsel").
- The "When the worktree is already gone" section and the cleanup case are
  unchanged.
- Other states that leave a worktree detached without a rebase or bisect
  record, such as `git am`, are not read: they hold no branch for git either.
- No change to `mods/foreman/hooks`, the wake sentences, foreman's timers, or
  any gate. No test is added, because the plugin test runner cannot read the
  skill's text (measured for the earlier spec).

## Failure modes

- Anything the parent cannot settle about a detached worktree keeps today's
  block and costs one line to the person, because a wrong "finished" leaves
  work without an owner while a needless question costs one line.
- A git command that fails elsewhere in the gone case still stops the case
  with a one-line message, as before. A branch lookup that answers no through
  exit status 1 has not failed.
- A name read from a record is never put in a command before it passes the
  character check, and is always single-quoted.

## Verification

The four gates load, type-check, test and validate both mods; none of them
reads the skill's text, so the text is checked by its reviewers and by a
walk-through in the pull request. The walk-through takes `ABC-123` through
every edge case above against git states made in a scratch repository with
git 2.54: a stopped rebase of a branch with the key and of one without it, a
rebase begun on a detached head (`detached HEAD`), a bisect at a midpoint
begun on a branch and one begun on a detached head (a commit id), and a plain
detached worktree. For each, the pull request shows the record's content, the
branch lookup's exit status, and what the skill tells the parent to do. The
search in `.claude/rules/no-project-names.md` on the staged diff finds only
placeholders.

Measured on 2026-10-21 with git 2.54: a linked worktree's records are under
`.git/worktrees/<name>/`, while `--git-path` without `--path-format=absolute`
prints a path relative to the folder for the main checkout; `git branch -d`
and `git checkout` refuse a branch that a detached rebase or bisect holds.

## Decided by the counsel

- When a worktree other than the dead session's own says `detached` in `git worktree list --porcelain`, which records should the gone case read to learn which branch git still holds for that worktree? The counsel chose: The stopped rebase's two records and also `BISECT_START`, which holds the branch a bisect started from while the bisect keeps the worktree detached at a midpoint. 7 of 7 members voted for it.
- When one of the other worktrees says `detached` and the parent cannot settle which branch it holds, what should the gone case do? This covers three situations: `git -C <folder> rev-parse --git-path` fails; one of the three records exists but cannot be read; or a record names a branch with characters the cleanup case does not allow. The counsel chose: Keep today's block for that worktree: never report the issue finished or start a fresh session, and tell the person in one line, naming the folder. 7 of 7 members voted for it.
- Should this change also narrow step 3.3 of the gone case, where the dead session's own worktree says `detached`, or leave that step as it is? The counsel chose: Leave step 3.3 unchanged, so a detached own worktree still goes to the person; narrow only the other worktrees, as the issue asks. 7 of 7 members voted for it.
- When one of the other worktrees is detached and the branch it holds (read from the three records) holds the issue key, how should the gone case treat it? The counsel chose: Treat the held branch as checked out by that worktree, so step 4 counts it as remaining and step 6 counts it among the branches, and drop the separate detached block for worktrees whose held branch is settled. The existing rules for remaining branches and branch counts then decide. 7 of 7 members voted for it.
- When a detached other worktree's `BISECT_START` holds a commit id instead of a branch name, because the bisect began from a detached head, how should the gone case treat that worktree? The counsel chose: As holding no branch, the same as a plain detached checkout, so it blocks nothing; the parent tells a commit id from a branch name by checking that `git -C <folder> rev-parse --verify --quiet 'refs/heads/<name>'` finds a branch of that name. 7 of 7 members voted for it.
