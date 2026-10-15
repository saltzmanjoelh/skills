# A merge reaches the checkout that new sessions load

Issue: SAL-186. Written 2026-10-08.

## Goal

When `/implement` merges a pull request in the repository that the skills
and the pilot mod are linked from, the main checkout of that repository is
fast-forwarded to the merge before anything else happens, so a session
started a moment later loads the merged code.

## Users and trigger

Every later session on this Mac. Skills, agents and the pilot mod load
through symlinks under `~/.claude` (for example `~/.claude/skills/pilot`
points at `~/Projects/skills/mods/pilot`), so a session runs whatever the
main checkout holds when it starts, not what its own worktree holds. The
trigger seen on 2026-10-07: archived pull request 13 merged at 21:07, a
session started at 21:13:11, and the main checkout was fast-forwarded only
at 21:13:19, so that session ran the mod from before the counsel and had no
access to it.

## Behavior

The change is to the **Merged** step of `skills/implement/SKILL.md` only.
Its new first action, before moving the issue, filing follow-ups, running
`/cleanup` or reporting, is to update the linked checkout:

1. **Find the linked checkouts.** Resolve every symlink directly under
   `~/.claude/skills`, `~/.claude/agents` and `~/.claude/commands` to its
   real target. For each target, the main checkout is the parent of
   `git -C <target> rev-parse --path-format=absolute --git-common-dir`.
   Several links into one checkout give one checkout, which is looked at
   once. A link into a worktree (its target's `--show-toplevel` is not
   the main checkout) is never moved and never counted as updated, since
   sessions load the worktree and not the main checkout. It is not a
   failure either: the report names it, and the main checkout is still
   updated when a link leads into it. When every link of the merged repository lies in a
   worktree, the main checkout is not moved, since no session loads it.
2. **Match the merged repository.** For each distinct checkout, run
   `gh repo view --json nameWithOwner --jq .nameWithOwner` inside it. The
   checkout is linked to this merge when that equals the pull request's
   owner and name. Two clones of the merged repository are each updated on
   their own, each with its own outcome. When none matches and no link was broken and no lookup
   failed, the step changes nothing and says, in one sentence, which
   repository merged and which repositories the links point into. When none
   matches and a link was broken or a lookup failed, that is a failure,
   since it might have been the match. When one matched, a broken link or a
   failed lookup elsewhere is named in one sentence and does not stop the
   update.
3. **Fetch the merge commit.** The pull request's base must be the merged
   repository's default branch, read with
   `gh repo view <owner>/<name> --json url,defaultBranchRef` only once a
   checkout has matched; a merge into another branch moves nothing and is
   reported in one sentence as nothing to update (not a failure), since
   the main checkout's default branch was not touched and someone who has
   that other branch out must not have it moved. When the checkout is on the
   base and already contains the merge commit, nothing moves and it is
   reported as updated. Otherwise the step fetches only that commit from
   the repository's own address, `git -C <checkout> fetch --no-write-fetch-head
   <url> <merge commit>`, so an unreachable extra remote cannot hold it up
   and a `git pull` running in the checkout does not read this commit from
   `FETCH_HEAD`, and
   `git cat-file -e <merge commit>^{commit}` must succeed afterwards. The
   fetch comes before the safety check, so nothing slow sits between the
   check and the fast-forward.
4. **Check it is safe, and fast-forward, in one shell command.** The
   checkout must be on its default branch (the pull request's base) and
   `git status --porcelain --untracked-files=no` must print nothing; then
   `git -C <checkout> merge --ff-only --no-overwrite-ignore <merge
   commit>`. Untracked and ignored files do not stop it: a fast-forward
   leaves them alone, and refuses when it would overwrite one (git would
   otherwise replace an ignored file, which review found). This is looser
   than `/cleanup`'s rule on purpose, because `/cleanup` deletes a
   worktree and this fast-forward destroys nothing. A checkout that is on another branch,
   or has changes to tracked files, is left alone, because the owner's
   ruling is that a checkout someone has a branch out in is never moved.
   The issue named `pull --ff-only`, but a bare pull moves the branch to
   whatever it tracks, which can be a fork or another branch (found in
   review and reproduced), so the fast-forward names the merge commit.
   Never a new merge commit, a rebase, a reset or a forced checkout.
5. **Confirm.** The checkout is still on the base, which catches a branch
   checked out in the instant around the fast-forward (the report then
   names that branch and points at `git reflog -2 <branch>`, which shows
   whether the fast-forward moved it and from where; it offers no commit
   to reset to, since the branch may not have moved), and
   `git -C <checkout> merge-base --is-ancestor <merge commit> HEAD`
   succeeds, where the merge commit is the pull request's `mergeCommit`
   from `gh pr view <n> --json mergeCommit`. The report gives the
   checkout's path, the merge commit, and the checkout's `HEAD` after the
   update.

## Edge cases

- The merged repository is not linked from `~/.claude` (a project
  repository, a tool's own repository): nothing is moved, and the
  one sentence in step 2 says so.
- A checkout already on the base that contains the merge commit (someone
  pulled first): nothing is fetched or moved, and it is reported as
  updated.
- The default branch has local commits and origin moved: `merge --ff-only`
  refuses because the branches diverged, and that refusal is reported.
- Two sessions finish merges at once: each is a fast-forward to the merge
  commit it names, so the second is a no-op or a further fast-forward. If
  the two collide on git's `index.lock`, the loser fails without moving
  anything and runs its checks and fast-forward once more (found in
  review); a second failure is reported.

## Non-goals

- Telling a session that is already running that its mod is out of date.
  That is a separate issue, waiting on SAL-160.
- Other repositories' checkouts, which their own gates
  govern. No `~/.claude` link points into them today. If one ever did, the
  step would treat that checkout like any other linked checkout, under the
  same guards; there is no per-project switch to turn the update off.
- Changing `/cleanup` (SAL-175 owns it) or `mods/pilot` (SAL-160 is
  changing it).
- A new notification channel.

## Failure modes

Whenever the step cannot bring the linked checkout up to the merge (a broken
link or a failed `gh` lookup when nothing matched, a checkout on another
branch or with tracked changes, a merge commit the fetch did not bring, a
fast-forward that refuses, or a confirmation that fails), it leaves the
checkout alone and does not retry or force. The report names the checkout,
or the broken link when there is no checkout, quotes git's or gh's own
message (after the same check for credentials that a push gets), and says
that new sessions will run the old code until someone updates it. Then the
step carries on as before: it moves the issue to done, files the follow-ups,
runs `/cleanup`, and stops. A failure here is never treated as "not linked".

## Verification

- The Merged step in `skills/implement/SKILL.md` lists the update as its
  first action, with the steps above (the skill splits the fetch step in
  two), and the report wording for each outcome: updated and confirmed, not linked, only worktrees linked,
  nothing to update (a merge into another branch), and left alone with the
  reason.
- A scratch script in the session's scratchpad runs the step's exact
  commands against throwaway repositories (a bare origin, a main checkout,
  and a symlink into it standing in for `~/.claude`), and shows each case
  behaving as specified: on the default branch and clean, so it
  fast-forwards and the ancestor check passes; with an untracked file, so it
  still fast-forwards; with an untracked or ignored file in the way, so it
  refuses and the file is kept; with a merge into a non-default base, so it
  is left alone; with an unreachable extra remote, so it still
  fast-forwards; with a tracked change, so it is left alone; on
  another branch, so it is left alone; with diverged local commits, so the
  fast-forward refuses; and with the branch tracking a fork, so it still
  lands on the merge commit and not on the fork. `gh repo view` is not exercised there, since the throwaway
  repositories have no GitHub remote; its output on the real skills
  checkout is checked by hand instead.
- `git diff origin/main --stat` lists only this spec, its plan and
  `skills/implement/SKILL.md`.

## Decided by the counsel

- When /implement merges a pull request in a repository other than the one the skills and mod are linked from (for example a tool's own repository, or a project repository), what should the Merged step do about checkouts? The counsel chose Fast-forward a main checkout only when the merged pull request's repository is the one a ~/.claude link points into; for any other repository, do nothing and say in one sentence that no linked checkout needed updating., 6 of 6.
- How should the Merged step decide that a checkout a ~/.claude link points into belongs to the repository whose pull request just merged? The counsel chose Resolve each symlink under ~/.claude (skills, agents, commands) to its target, find that target's main checkout with `git rev-parse --path-format=absolute --git-common-dir`, and match it when `gh repo view --json nameWithOwner` run in that checkout equals the pull request's owner/name., 6 of 6.
- What counts as "local changes" that stop the Merged step from fast-forwarding the linked main checkout? The counsel chose Only changes to tracked files (`git status --porcelain --untracked-files=no`); untracked files do not stop it, and if one would be overwritten, `git pull --ff-only` refuses on its own and the step reports that., 6 of 6.
- Should a project be able to turn off the Merged step's fast-forward of its linked main checkout? The counsel chose No switch: the decided guards (the merged repository must be the one a ~/.claude link points into, the checkout must be on its default branch with no tracked changes, and the update is `pull --ff-only` only) are the whole rule., 5 of 6.

## Decided by the person

- When the step cannot bring the linked checkout up to the merge, it
  reports why and carries on (the counsel split 3, 2 and 1; the owner chose
  this on 2026-10-08).
