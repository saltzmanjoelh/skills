# Builder updates the linked checkout after a merge

Written 2026-11-03, from the tracker issue that the counsel split out of an
earlier change (see `docs/specs/builder-sets-labels-stages-and-lists-commits.md`,
whose Non-goals left this job out on purpose).

## Goal

After a pull request merges, the session still updates the main checkout that
the links in Claude Code's configuration folder lead into by hand, following the roughly 260-line section
"Updating the linked checkout" of `skills/implement/SKILL.md`. The builder mod
already knows the repository, the base branch, the merge commit and the
merged state, so it runs that procedure itself and hands the session only the
outcome. It never moves a checkout that is on another branch or has changes
to tracked files.

## Users and trigger

A session running `/implement` whose watched pull request merges, and every
session started after it, which loads whatever the main checkout holds. The
trigger is the first look (a poll, or a call to `mcp__builder__watch`) that
chooses the **Merged** step for a pull request with a merge commit.

## Behavior

### When it runs

- On the first look that chooses the Merged step, before the step is handed
  over, the mod runs the update once for that pull request's merge commit
  and base branch, read by the same `gh pr view` that reports the pull
  request merged, with `mergeCommit` added to the fields it asks for.
- Before it runs any git command, the mod records, in a store keyed by
  repository and number and persisted like its other stores, that the update
  for that merge commit has started. A second look that finds that record,
  whether it runs at the same moment or later, runs no git and uses what the
  record holds. When the update ends, the record holds its outcome.
- A record that says the update started and holds no outcome, because the
  mod was stopped in the middle, is reported as left alone, with the reason
  that the update started and did not finish. The mod never retries an
  update, except the one retry after a lock described below.
- The Merged step's text states the outcome (see "What the step says"), and
  so does every later rendering of the Merged step from the stored record.

### The procedure

The mod carries out the whole procedure that `skills/implement/SKILL.md`
holds today, with the same commands and the same rules, as
`docs/specs/merged-updates-linked-checkout.md` and
`docs/specs/linked-checkout-any-machine.md` describe it:

1. **Find the links** in the `skills`, `agents` and `commands` folders of
   Claude Code's configuration folder, which is `CLAUDE_CONFIG_DIR` when it is set
   and otherwise `.claude` under `HOME`, or else under `USERPROFILE`, read
   from the environment, including a
   folder that is itself a link and every link directly inside each folder,
   and find the main checkout and the tree each link lies in. No folder that
   is a link and no link inside one gives **no links found**.
2. **Match the merged repository** with `gh repo view --json nameWithOwner`
   in each checkout, looking at each checkout once. A link into a worktree is
   never moved. When every link of the merged repository lies in a worktree,
   the outcome is **only worktrees linked**. When none matches, the outcome is
   **not linked**, unless a link was broken or a lookup failed, which makes it
   left alone.
3. **Check the base** with `gh repo view <owner>/<name> --json url,defaultBranchRef`.
   A base that is not the default branch gives **nothing to update**. A
   checkout on the base that already holds the merge commit is **updated**;
   the fetch below still runs from a matched remote to refresh the
   remote-tracking branch, and its error is one sentence, not a failure.
4. **Choose the source**: the remote whose address names the repository
   (matched on `/<owner>/<name>` or `:<owner>/<name>` at the end, without
   regard to case, after trailing slashes and `.git` are removed); among
   several, the one the base tracks, then `origin`, then the first in byte
   order; with none, the https address from `gh`.
5. **Fetch** the merge commit, and from a remote also the base into its
   remote-tracking branch, with `--no-write-fetch-head`. The merge commit
   must be present afterwards (`cat-file -e`), whatever the fetch's exit.
   The objects the merge needs that are missing are listed with
   `rev-list --objects --quiet --missing=print <merge tree> --not <head tree>`
   and fetched in one request through `--stdin`, with
   `partialclonefilter=blob:none` set for that command only and no
   `--filter`, up to three rounds; unless the listing was empty and
   succeeded, the object check with `--missing=error` must then succeed.
6. **Check it is safe and fast-forward**: the checkout is on the base,
   `git status --porcelain --untracked-files=no` prints nothing, and
   `git merge --ff-only --no-overwrite-ignore <merge commit>` runs. Untracked
   and ignored files do not stop it. When the fast-forward fails because
   `index.lock` exists, this step runs once more, checks included.
7. **Confirm**: the checkout is still on the base, and
   `merge-base --is-ancestor <merge commit> HEAD` succeeds.

Each checkout that matched goes through steps 3 to 7 on its own and has its
own outcome. Every git and gh command runs through `$.process.run` as an
argument vector, never through a shell, with a time limit; a command that
fails, throws or runs past its limit counts as failed at that point.

### What the step says

The Merged step's text no longer tells the session to update the checkout. It
states each checkout's outcome, which is one of:

- **Updated**: the checkout's path, the merge commit, `HEAD` after the update,
  and the source by remote name, or that no remote named the repository and
  the https address was used or nothing was fetched.
- **Not linked**: which repository merged and which repositories the links
  point into.
- **No links found**: the three folders, and that skills or a mod loaded some
  other way were not updated.
- **Only worktrees linked**: the worktrees, and that the main checkout was not
  moved.
- **Nothing to update**: the branch the merge went into.
- **Left alone**: the checkout's path, or the broken link; what stopped it;
  and that new sessions run the old code until someone updates it.

It adds the sentences the procedure adds: worktree links of the merged
repository, a broken link or failed lookup elsewhere, a fetch error with the
merge commit present, and a branch found checked out at the confirmation.
A message quoted from git or gh is cut to a few hundred characters, and any
part shaped like a token, a key or an address with credentials in it is
replaced before it is stored or shown. A remote's address is never shown.

The skill's section "Updating the linked checkout" shrinks to a short
section: the mod updates the linked checkout when it sees the merge, the
outcomes it can state, and what the session does with each, which is to
report it, quoting what the step quotes, and carry on with the issue, the
follow-up issue and `/cleanup`. The section keeps its heading, which the step
text points at.

## Edge cases

- Two looks start at the same moment: the record of the start is written
  before either runs git, with no await between reading the record and
  writing it, so only one runs the update. This holds only within one
  process: the store has no compare-and-set, so two sessions that both see
  the merge before either writes the record can both run the update, and one
  may report the checkout left alone after a lock, or the update as started
  and not finished, while the other updated it. Nothing is forced or lost.
- The mod is stopped or restarted in the middle of the update: the record
  holds no outcome, and the step reports the checkout as left alone because
  the update started and did not finish.
- A pull request that GitHub reports merged with no merge commit yet: the mod
  runs nothing and records nothing on that look, and the step says the merge
  commit could not be read yet; a later look runs the update once the commit
  can be read.
- The merged repository is not linked from Claude Code's configuration folder: not linked, and
  nothing is moved.
- A session that started before this change merges with the old mod: the old
  skill it loaded still holds the full procedure, so it updates by hand.

## Non-goals

- Showing the outcome in the builder pane or in the status file the foreman
  reads, and any change to the foreman mod or `/cleanup`.
- Telling a session that is already running that its mod is out of date.
- Retrying a failed update, other than the one retry after a lock.
- Detecting skills or mods loaded through settings, `--plugin-dir` or a copy.
- Updating checkouts of repositories that no link in Claude Code's configuration folder
  points into.
- Changing what the procedure does: its commands, its checks and its outcomes
  stay as the two earlier specs describe them.

## Failure modes

On any failure (a broken link or failed lookup when nothing matched, a merge
commit the fetch did not bring or that arrived without what it points to, a
check that stops the fast-forward, a fast-forward that refuses after the one
retry for a lock, a confirmation that fails, an update that started and did
not finish, or a command past its time limit), the mod leaves the checkout
alone, never forces it, and records the outcome as left alone with the
reason. The session reports it and carries on. A failure is never reported
as not linked, and the mod's own errors never stop it from rendering the
Merged step.

## Verification

- Tests in `mods/builder/tests`, with `process.run` faked, show each outcome
  above reaching the Merged step's text: updated from a matched ssh remote,
  updated from the https address, already updated with the refresh fetch,
  not linked, no links found, only worktrees linked, nothing to update, and
  left alone for a checkout on another branch, for tracked changes, for a
  missing merge commit, for a failed object check, for a fast-forward that
  refuses, and for a lock that clears on the retry and one that does not.
- Tests show that a second look, at the same moment or later, runs no git for
  a merge commit already recorded, that a record with no outcome is reported
  as left alone, and that the step text no longer tells the session to run
  the update.
- Tests show that a quoted message holding a token-shaped string is stored
  and shown without it.
- A scratch script in the session's scratchpad runs the mod's update function
  with a `$` whose `process.run` runs real commands, against throwaway
  repositories (a bare origin, a main checkout, a partial clone, and links
  standing in for `~/.claude` under a scratch `HOME`), and shows the cases of
  `docs/specs/linked-checkout-any-machine.md` behaving as specified.
- `skills/implement/SKILL.md` no longer holds the procedure, and its short
  section names every outcome the step can state.
- The four gates in the project's `CLAUDE.md` pass.

## Decided by the counsel

- How much of the "Updating the linked checkout" procedure in skills/implement/SKILL.md should the builder mod carry out itself after a merge? The counsel chose: All of it, as the skill has it now: finding links in the three ~/.claude folders, matching the merged repository, the default-branch check, choosing the remote, the fetch with its batched partial-clone download, the safety check and fast-forward with its one retry after a lock, the confirmation, and every outcome the report names. 7 of 7 members voted for it.
- When should the builder mod run the update of the linked checkout, and what happens when it fails? The counsel chose: On the look that first chooses the Merged step, before the step is handed over: run it once for that merge commit, store the outcome with the pull request, and state the outcome in the Merged step's text. A failure is reported as left alone and is never retried by the mod. 7 of 7 members voted for it.
- Once the builder mod runs the update of the linked checkout itself, what should happen to the roughly 260-line "Updating the linked checkout" section of skills/implement/SKILL.md? The counsel chose: Replace it with a short section that says the mod updates the linked checkout when it sees the merge, names each outcome the Merged step's text can state, and says what the session does with each (report it, quote it, carry on); the full procedure lives only in the mod's code and its spec. 7 of 7 members voted for it.
- The issue says the update must never move a checkout that "has uncommitted edits". Which state of the main checkout should stop the mod's fast-forward? The counsel chose: Keep today's rule: only changes to tracked files (staged or not) stop it, read with git status --porcelain --untracked-files=no; untracked and ignored files do not stop it, because merge --ff-only --no-overwrite-ignore leaves them alone and refuses rather than overwrite one. 7 of 7 members voted for it.
- Where besides the Merged step's text should the outcome of the mod's update of the linked checkout appear, and what is left out of this change? The counsel chose: Only the Merged step's text (and the stored outcome behind it); the builder pane, the status file the foreman reads, the foreman mod and /cleanup are not changed, and telling an already-running session that its mod is out of date stays out of scope. 7 of 7 members voted for it.
