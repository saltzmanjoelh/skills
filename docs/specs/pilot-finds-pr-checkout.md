# The pilot mod finds the pull request's checkout

Date: 2026-10-12

## Goal

The pilot mod records the session's folder once, in its `session.start`
hook in `mods/pilot/hooks/register.tsx`, and the watch tool stores that folder
as the watched run's `cwd`. The package tool compares `git rev-parse HEAD` in
that folder with the pull request's head, and refuses when they differ.

On 2026-10-12 a session running `/implement` started in the repository's main
checkout, which the owner's rules keep on the default branch, and did its work
in a worktree under `.claude/worktrees/`, which it reached with the shell
tool's `cd`. The package tool answered "The checkout is at a0588542 but the
pull request's head is 721cd19b; push or pull first.", because it was
comparing the main checkout rather than the worktree. The answer did not say
which folder it had looked in, and the session wrote the review package by
hand in the mod's format.

After this change, the package and review tools find the checkout of the
watched pull request by asking git which worktree has the pull request's head
branch checked out, wherever the session started and however it moved.

## Users and trigger

The session running `/implement` calls the package tool at every new head and
the review tool once per round. The trigger is any session whose starting
folder is not the checkout of the pull request's head branch, most often a
session that started in the main checkout and moved into a worktree.

## Behavior

- The live read of the pull request that the package and review tools already
  make (`livePullRequest`) also reads `headRefName`.
- Each time the package tool or the review tool runs, it runs
  `git worktree list --porcelain -z` from the watched run's stored folder, and
  uses the worktree whose `branch` line is `refs/heads/<headRefName>`. The `-z`
  makes git print every path as it is, never quoted, so a path with unusual
  characters is read correctly; a git too old for `-z` fails the command,
  which takes the fallback below. The list includes the main checkout, so a
  main checkout that has the branch out is found too.
- When no worktree has that branch, the tools use the stored folder, as they
  do today. When git cannot list the worktrees, because it exits with an
  error, throws or has its output cut off, they also use the stored folder.
- The package tool then runs every git command, and reads the project's
  documents, in the folder it found, and writes the package under that
  folder's git folder. The review tool stages the review body under the git
  folder of the folder it found. Both find the folder by the same rule from
  the same field, so they agree whenever the worktrees have not changed in
  between.
- Nothing new is stored. The watch tool, the polling and the label commands
  keep using the stored folder, because they pass `--repo` and work from any
  checkout of the repository.
- When the folder found is not at the pull request's head, the package tool
  still refuses. The answer keeps today's sentence, "The checkout is at <x>
  but the pull request's head is <y>; push or pull first.", and adds one
  sentence naming the folder it compared and how it chose it:
  - "It compared <path>, the worktree that has <branch> checked out."
  - "It compared <path>, the session's folder, because no worktree has
    <branch> checked out."
  - "It compared <path>, the session's folder, because git could not list
    the worktrees."

## Edge cases

- A worktree whose `HEAD` is detached has no `branch` line, so it never
  matches.
- A pull request from a fork whose head branch has the same name as a local
  branch matches that local worktree. The comparison with the head commit
  then refuses unless that worktree really is at the head, and the refusal
  names it.
- A worktree that git lists as prunable, because its folder is gone, can
  still match, since git keeps its branch reserved. The comparison then fails
  and the refusal names the missing folder.
- A run stored before this change holds the session's folder as `cwd`, which
  is exactly the folder the lookup starts from, so it needs no migration.
- A worktree created, moved or removed after the watch began is found, or no
  longer found, at the next call, because nothing is stored.

## Non-goals

- The counsel tool keeps using the session's starting folder. Its check that
  a brief's paths exist and stay inside the checkout, and the place it writes
  briefs, are left for a follow-up issue, which should also weigh
  `$.session.root()` and the mismatch between the folder that check uses and
  the folder the members read from.
- No input is added to the watch tool, and `$.session.root()` is not used.
- The `/implement` skill does not change.

## Failure modes

- A wrong folder never produces a package: the comparison with the head
  commit refuses first, and the refusal says which folder and why.
- If the worktrees change between the package tool and the review tool, the
  review tool may stage its body under a different git folder from the
  package. That is harmless, because the review tool writes its own file there
  and does not read the package.

## Verification

Tests in `mods/pilot/tests/register.test.ts`, each seen failing before the
change:

- A session that started in `/repo`, with `git worktree list --porcelain`
  listing `/repo` on `main` and `/wt` on the head branch, where only `/wt` is
  at the head: the package tool writes the package under `/wt`'s git folder,
  and runs `git rev-parse HEAD` in `/wt`. This reproduces the 2026-10-12
  refusal before the fix.
- The same session: the review tool stages `review.md` under `/wt`'s git
  folder.
- When the worktree with the head branch is behind the head, the refusal
  keeps today's sentence and names `/wt` as the worktree that has the branch.
- When no worktree has the branch, the refusal names the session's folder and
  says no worktree has the branch checked out.
- When `git worktree list` fails, throws or has its output cut off, the
  refusal names the session's folder, says git could not list the worktrees,
  and does not say that no worktree has the branch.
- The existing package and review tests still pass.

## Decided by the counsel

- How should the pilot mod find the local checkout of the watched pull request, which the package tool compares with the pull request's head and runs git in? The counsel chose Ask git: run `git worktree list --porcelain` from the session's folder and use the worktree (the main checkout included) whose branch is the pull request's head branch, falling back to the session's folder when none has it., 6 of 6.
- When should the pilot mod look up the worktree whose branch is the watched pull request's head branch? The counsel chose Each time the package tool or the review tool runs, from the live `gh pr view` they already make (adding `headRefName` to its fields); the watched run keeps storing the session's folder, and nothing new is stored., 6 of 6.
- Should this change also move the counsel tool off the session's starting folder, or leave the counsel tool as it is and limit the change to the package and review tools? The counsel chose Leave the counsel tool alone here, and file a follow-up issue for it., 5 of 6.
- When the package tool still refuses because the checkout it found is not at the pull request's head, what should its answer say? The counsel chose Name the folder it compared and how it chose it: either the worktree that has the head branch, or the session's folder because no worktree has that branch, followed by today's 'push or pull first' advice., 6 of 6.
- When `git worktree list --porcelain` itself fails (git exits non-zero, throws, or its output is cut off), what should the package and review tools do? The counsel chose Fall back to the session's folder, as when no worktree has the head branch, and say in any refusal that the worktree list could not be read., 4 of 6.
