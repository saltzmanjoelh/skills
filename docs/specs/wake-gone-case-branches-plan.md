# Plan: the wake skill's gone case finds the right branch

Date: 2026-10-21. Spec: `docs/specs/wake-gone-case-branches.md`.

## Chosen approach

The most-robust plan won. It rewrites only the gone case of
`mods/foreman/skills/wake/SKILL.md`, rewraps cleanup step 1 without changing
its words, and rewords the comment above the pin test in
`mods/foreman/tests/wake.test.ts`. Nothing under `mods/foreman/hooks` changes.

The gone case opens with the key rule, the single-quote rule and the rule that
a failed git or gh command goes to the person, so that every later step
inherits them. Its steps are:

1. **List pull requests.** The all-state list, cut to the newest 100, with
   `headRefOid` added to its fields, then the same command with
   `--state open` and `--limit 1000`. When the open list returns 1000, it may
   have been cut, so the parent tells the person and stops.
2. **Keep the issue's pull requests**, once each by number, not from a fork,
   with the key in the title or head branch.
3. **Read the dead session's worktree**, as five ordered checks: the folder
   holds only allowed characters and is exactly the path of an entry in
   `git worktree list --porcelain` that is not marked prunable; that entry is
   not the first, which is the main checkout; it names a branch on its
   `branch refs/heads/<name>` line, and the name holds only allowed
   characters, while an entry that says `detached` goes to the person; the
   branch holds the key; no running session uses the folder. Step 3 also
   defines the **other worktrees**, every entry but the accepted one.
4. **Find the local branches** with
   `git branch --list --format='%(refname:short)'`, filtered by the key rule
   in the parent rather than by a git pattern, and define **remaining**. A
   branch that one of the other worktrees has checked out, or the accepted
   worktree's branch when that worktree has uncommitted changes, is always
   remaining.
5. **Read the issue's state.** A tracker that cannot be read is unknown, and
   is not a failed git or gh command.
6. **Count the branches**: distinct names among the open pull requests' head
   branches and the remaining branches.
7. **Decide**, in the spec's order. A merged pull request counts as finished
   only when no branch remains, no newer pull request was closed without
   merging, and none of the other worktrees is detached. The "none" bullet
   asks the person when one of the other worktrees is detached or has the
   one remaining branch checked out; otherwise it names that branch, and the
   worktree folder when step 3 accepted the worktree that holds it.

These steps include what the review rounds added; the spec is the full
description.

## Grafts

- From the simplest plan: the open list is written as "the same command with
  `--state open`", so the two lists cannot drift apart in their fields.
- From the judge: "and stop" after every one-line message that ends the case
  early, so that the parent never goes on to decide; the prunable check, so
  that a brief never names a deleted folder; step 7 reads the worktree listing
  from step 3, which runs even when step 3's first check fails.

## Rejected alternatives

- The simplest plan's `--limit 100` on the open list with no guard: it fails
  silently for someone with more than 100 open pull requests, which is the
  case the second list exists for.
- Relying on "Starting a session" alone for a branch that another worktree
  holds: that check matches running sessions by title and branch, so a
  worktree that no running session uses, such as a dead session's, slips
  past, and git refuses to check out a branch a second time.
- Naming a command and a project fact for "the base branch": the cleanup case
  uses the phrase the same way, so defining it belongs to both cases and to a
  change of its own. A stale local base only causes an extra question.
- Sending a command that writes to standard error to the person, as the
  cleanup case does: the gone case only reads, and gh prints update notices
  there, so every case would go to the person.

## Steps

1. Rewrite the gone case section of `SKILL.md` as above.
2. Rewrap cleanup step 1, checking with `git diff --word-diff` that no word
   changed.
3. Replace the comment above the "every wake sentence is pinned" test with one
   that names `skills/wake/SKILL.md`, says which sentences are headings there
   and which forms the text under the cleanup heading quotes, and says no
   test can read the skill.
4. Run the four gates.

## Test plan

- The four gates pass for both mods. None reads the skill, and the test file
  changes only in a comment, so a green run says only that the mods still
  load, type-check, test and validate.
- `git diff --word-diff` shows the cleanup hunk with no word added or removed.
- The pull request walks `ABC-123` through: a dead session on
  `claude/abc-123-fix-search` with an open pull request on that branch; a
  squash merge leaving the branch at `headRefOid`; a reused branch name; an
  older merged or closed pull request beside a newer open one; a branch held
  by a running session, with and without a merged pull request; a remote-only
  branch; an open pull request older than the newest 100; `abc-1234`; a branch
  name with a space; a failed gh call; an unreadable tracker state with a
  merged pull request and no remaining branch.
- The issue-key search on the staged diff finds only `ABC-123`.
