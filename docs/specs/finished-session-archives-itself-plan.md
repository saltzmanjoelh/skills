# Plan: a finished session archives itself

Written 2026-10-21 for `docs/specs/finished-session-archives-itself.md`. Two
planners ran blind, one aiming for the smallest change and one for the most
robust; a judge scored them against the spec.

## Chosen approach

The smallest-change plan won. It edits text in three files, adds no file, keeps
no state, and says each rule in one place.

1. **`skills/cleanup/SKILL.md`, step 7.** Rewrite the step so that it says the
   person's request to run `/cleanup`, or `/implement` whose last step is
   `/cleanup`, already counts as agreement to archive, whether the person
   started the session directly or through a foreman parent they started; that
   the refusal checks still run first; and that a refused or missing
   `set_remote_control` or `archive_session` is final. The session adds one
   sentence to the report it already wrote, naming the call and quoting the
   refusal, and stops, without retrying and without asking. It skips
   `archive_session` when Remote Control could not be turned off. A foreman
   parent archives the session later; a person who started it directly archives
   it themselves.
2. **`skills/implement/SKILL.md`, the Merged step.** After "Otherwise run
   `/cleanup`, report, and stop.", add that the request for `/implement`,
   direct or through a foreman parent, already counts as agreement to the
   archive that ends `/cleanup`, and that step 7 of `/cleanup` says what to do
   when it is refused.
3. **`mods/foreman/skills/wake/SKILL.md`, the cleanup case.**
   - The bullet that takes the branch from `git worktree list --porcelain`
     keeps sending the main checkout and several matching sessions to the
     person, and sends a missing or `prunable` entry to a new subsection.
   - The existing numbered list's lead-in says it applies when the worktree
     still exists.
   - A new subsection, "### When the worktree is already gone", after the "For
     anything else" paragraph, carries Behavior point 3 of the spec as seven
     steps, and sends a ticket-only line to the person at the pull request
     search, because that search needs an issue key.

## Grafts from the robust plan

- **The folder must really be gone.** Step 1 also checks with
  `test -e '<path>'` that the folder no longer exists. A path that git spells
  differently, such as `/private/tmp` against `/tmp`, could otherwise make a live
  worktree look gone, and `archive_session` removes a session's worktree by
  default, which would skip the existing path's checks for edits and ignored
  files. The check only sends more cases to the person, which Behavior point 4
  allows.
- **An exact `ls-remote` match.** `git ls-remote` matches its pattern against
  the end of ref names, so only a line for exactly `refs/heads/<branch>` counts,
  and status 0 without such a line is a failed command.
- **The existing lead-in** is narrowed so it no longer reads as governing the
  new subsection.
- **A missing tool counts as a refusal** in `/cleanup` step 7, so a session
  outside the desktop app does not fall back to asking the person.
- **Removal order.** The prunable entry is removed before `git branch -d`,
  because `-d` refuses a branch that an entry still holds.

## Rejected alternatives

- **A separate "The request is the agreement" section in `/cleanup`.** It
  repeats step 7, so the rule would live in two places that can drift apart.
- **Restating in `/implement` that `/cleanup` never runs while the worktree
  holds commits the pull request lacks.** The Merged step already says so.
- **A second `list_sessions` read just before the archive.** Step 1 already
  checks that the session is not running, the window it narrows is small, and
  an archive can be undone with `unarchive_session`.
- **A guard that the branch is not the base branch.** Outside the spec; a
  session started from the base branch would not have a merged pull request
  from it.
- **Moving the ticket rule to "A line that names a ticket".** Keeping it at the
  pull request search puts the reason beside the step and needs no edit
  outside the cleanup case.

## Steps

1. Rewrite `/cleanup` step 7.
2. Add the sentences to `/implement`'s Merged step.
3. Change the wake skill's bullet and lead-in, and add the new subsection.
4. Run the four gates, and the naming search from
   `.claude/rules/no-project-names.md` on the staged changes.

## Test plan

No gate reads `skills/` or the wake skill's text, so the reviewers check them
by reading, mapped to the spec's Verification section:

- `/cleanup` step 7 and `/implement`'s Merged step each state the agreement for
  both kinds of start, and step 7 covers a refused or missing call.
- The new subsection follows Behavior point 3 step by step, and every case
  Behavior point 4 lists still reaches the person; the path for a worktree that
  still exists and the gone case are unchanged apart from the lead-in.
- The four gates pass, which shows the mods still load, type check, test and
  validate.
- A scratch repository under the scratchpad confirms the command statuses the
  text relies on: `git worktree remove` on a prunable entry removes that entry
  only, `git rev-parse --verify --quiet` exits 1 for a missing branch, and
  `git ls-remote --exit-code` exits 2 for a missing remote branch.
