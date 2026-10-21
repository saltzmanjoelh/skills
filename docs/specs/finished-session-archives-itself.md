# A finished /implement sub session archives itself, and the parent archives one whose worktree is already gone

Written 2026-10-21. Seeded from an issue in the owner's tracker. The questions
the issue left open were put to the counsel.

## Goal

A sub session that a foreman parent started took its issue to a merged pull
request and ran `/cleanup`. It removed its worktree, its local branch and its
scratchpad, and turned Remote Control off, but it did not archive itself,
because it read the archive as needing the person's explicit agreement and the
task had come from the parent rather than from the person. Foreman then counted
it as stuck in cleanup and woke the parent. The wake skill's cleanup case reads
the branch only from the session's entry in `git worktree list`, which was gone,
so it sent the case to the person, who archived the session by hand.

The person had agreed in advance: asking for `/implement`, whose last step is
`/cleanup`, or starting a foreman parent that starts `/implement` sub sessions,
asks for the whole lifecycle, and the lifecycle ends in an archive. This change
says so in the skills, and lets the parent finish the job when a merged sub
session's worktree is already gone.

## Users and trigger

- A session running `/cleanup`, on its own or as the last step of `/implement`,
  whether the person started it directly or through a foreman parent the person
  started.
- A foreman parent woken with "<who> has been in cleanup for <n> minutes with
  <n> failed calls." for a sub session whose worktree entry is missing or marked
  `prunable`.

## Behavior

1. **The request is the agreement.** `skills/cleanup/SKILL.md` and
   `skills/implement/SKILL.md` say that the person's request to run them
   already counts as agreement to archive the session at the end, whether the
   person started the session directly or through a foreman parent that the
   person started. A session never waits for, or asks for, a second agreement
   before step 7 of `/cleanup`. The refusal checks of `/cleanup` still run
   first and still stop it; the agreement covers the archive, not a forced
   teardown.
2. **A refused archive is final.** When the app or the permission check refuses
   `set_remote_control` or `archive_session` in step 7, the session adds one
   sentence to the report it already wrote, naming the call that was refused and
   quoting the refusal, and stops. It never retries the call and never asks the
   person instead. When turning Remote Control off was refused, it does not call
   `archive_session`, because the app refuses to archive while Remote Control is
   on. A foreman parent's cleanup case archives the session later; a person who
   started the session directly reads the sentence and archives it themselves.
3. **The parent's cleanup case handles a worktree that is already gone.** The
   case still takes the session and its folder from `list_sessions` by the issue
   key or ticket at the start of its title. When no entry of
   `git worktree list --porcelain` has exactly that folder's path, or the entry
   that has it is marked `prunable`, the parent goes on as follows instead of
   telling the person. Each check that fails, and each git or gh command that
   fails, sends the case to the person in one line, naming the issue.
   1. Exactly one session matches, and `list_sessions` shows it is not running.
   2. The branch is the one `list_sessions` shows for that session. It holds
      only the characters the cleanup case allows.
   3. `gh pr view '<branch>' --json state,headRefOid` says the pull request
      merged.
   4. The merged commit is the branch's last commit:
      - when the local branch exists, its commits are reachable from the base
        branch, or `git rev-parse '<branch>'` equals `headRefOid`;
      - when the local branch is gone,
        `git ls-remote --exit-code origin 'refs/heads/<branch>'` either prints
        a tip equal to `headRefOid`, or exits with status 2 because the remote
        branch is gone too, in which case the merged pull request is enough.
        Any other exit status is a failed command.
   5. The gone case's search for the issue's pull requests, the same two
      `gh pr list` calls and the same rule for matching the key, finds no open
      pull request for the issue.
   6. The parent archives the session with `archive_session`.
   7. It then clears what git still holds for that folder, in this order:
      - a `prunable` entry for exactly that folder is removed with
        `git worktree remove '<path>'`, never with `--force`, which removes that
        one entry and no other;
      - a local branch that is still there, and that `git worktree list` shows
        no other entry holding, is deleted with `git branch -d '<branch>'`,
        never with `-D`.

      A refusal from git here is told to the person in one line; the archive
      already done stands.
4. **Every other case still goes to the person,** including an entry that is
   the main checkout, several matching sessions, a running session, a pull
   request that is not merged, an open pull request for the issue, and a tip
   that differs from `headRefOid`. The existing path for a worktree that still
   exists is unchanged.

## Edge cases

- **A squash merge.** The local branch is not reachable from the base, so the
  `headRefOid` comparison decides; `git branch -d` may then refuse it, which is
  told to the person after the archive.
- **A reused branch name.** New commits pushed after the merge leave a tip,
  local or remote, that differs from `headRefOid`, and the case goes to the
  person.
- **GitHub deleted the remote branch on merge.** `git ls-remote --exit-code`
  exits with status 2, which is the expected answer, not a failure.
- **A failed `ls-remote`,** such as a network or authentication error, exits
  with another status and goes to the person; it is never read as a missing
  branch.
- **Other prunable entries.** They belong to other sessions and stay;
  `git worktree prune`, which clears every prunable entry in the repository, is
  never run.

## Non-goals

- No change to the foreman mod's code, its wake sentences or its timers. A
  session in cleanup whose record does not say its pull request merged may also
  receive the gone wake; this change leaves that overlap as it is.
- The mod does not archive sessions itself.
- No change to the gone case, or to the cleanup case for a worktree that still
  exists.
- No retry of a refused archive, and no question to the person about one.
- A local branch that `git branch -d` refuses after a squash merge is not
  deleted with `-D`.

## Failure modes

- A refused archive in `/cleanup` leaves a session with its work merged and torn
  down but not archived, and its report says why. Foreman's cleanup wake brings
  the parent, which archives it under Behavior point 3.
- Any check in Behavior point 3 that cannot be settled sends one line to the
  person and archives nothing.

## Verification

No gate reads `skills/` or the wake skill's text, so the reviewers check these
by reading:

- `skills/cleanup/SKILL.md` and `skills/implement/SKILL.md` each say that the
  request to run them is the agreement to archive, for a session started
  directly or through a foreman parent, and `/cleanup` step 7 says what to do
  when a call is refused.
- The wake skill's cleanup case covers a missing or `prunable` worktree entry
  with the checks, the archive and the clean-up of Behavior point 3, and keeps
  every other case with the person.
- The four gates in the project's `CLAUDE.md` pass, which shows the mods still
  load, type check, test and validate.
- Measured on 2026-10-21 with git 2.54: `git worktree remove '<path>'` on an
  entry whose folder was deleted exits with status 0 and removes that entry
  only, leaving a second prunable entry in place.

## Decided by the counsel

- When the foreman parent is woken because a sub session has been in cleanup too long, and the sub session's worktree entry is already gone from `git worktree list`, where should the parent find the branch and pull request it checks for a merge before archiving the session? The counsel chose: Take the branch from list_sessions and also require the gone case's key search to find no open pull request for the issue; any disagreement goes to the person. 5 of 7 members voted for it.
- In the wake skill's cleanup case, once the sub session's worktree entry is gone, its local branch is usually gone too, because /cleanup deletes it. What should replace the check that the pull request's headRefOid equals `git rev-parse '<branch>'` before the parent archives the session? The counsel chose: When the local branch is gone, compare headRefOid with the remote branch's tip from `git ls-remote origin 'refs/heads/<branch>'` when it exists; when the remote branch is gone too, the merged pull request plus the no-open-pull-request search is enough. 5 of 7 members voted for it.
- When the parent archives a merged sub session whose worktree folder is already gone, what should it do about git state left behind: a worktree entry that git still lists but marks `prunable` (its folder is gone), and a local branch that /cleanup did not delete? The counsel chose: Archive, then clean up as the existing steps do: `git worktree prune` for a prunable entry of that folder, and `git branch -d` for a merged local branch nothing else holds. 5 of 7 members voted for it.
- With /cleanup and /implement saying that the person's request already counts as agreement to archive, what should a session do when its own `archive_session` call (or the `set_remote_control` call that must turn Remote Control off first) is refused, for example by a permission check? The counsel chose: Treat the refusal as final: add one sentence to the report already written saying that the archive was refused and quoting the refusal, and stop; a foreman parent's cleanup case archives it later. 7 of 7 members voted for it.
- Should this change stay within the skills' text, or also change the foreman mod's code that decides when a session is stuck in cleanup or gone? The counsel chose: Text only: the mod's code stays as it is, and any overlap between the cleanup and gone wakes is left as a non-goal. 7 of 7 members voted for it.

The third decision names `git worktree prune`; several members pointed out that
it clears every prunable entry in the repository, so Behavior point 3 removes
the one entry for that folder with `git worktree remove '<path>'`, which the
measurement in Verification shows does the same for that folder alone.
