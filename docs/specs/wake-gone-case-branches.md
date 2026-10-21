# Wake skill: the gone case finds the right branch

Date: 2026-10-21. These are the follow-ups from the review of the change that
added the `foreman:wake` skill (see `docs/specs/foreman-skill.md`), which were
filed rather than fixed when that change merged.

## Goal

The gone case in `mods/foreman/skills/wake/SKILL.md` decides what to do with
a sub session whose status file stopped updating and whose desktop session is
not running: resume its pull request, start a fresh `/implement`, report the
issue finished, or ask the person. Its rules for finding the issue's branch
and pull request had five gaps, and each could make the parent start a second
session beside an open pull request, send an ordinary case to the person, or
call an issue finished while unmerged work sits on a branch nobody owns. This
change closes those gaps, rewraps one line in the cleanup case, and records
why the heading test the review asked for is not possible.

## Users and trigger

The parent session's model reads the gone case when foreman wakes it with
"<who> has not updated its status file for <n> minutes and its session is not
running, so restart it or release the issue." The person reads it to know
what the parent will do on their behalf.

## Behavior

1. **The key rule.** A title or branch name holds an issue key when it
   contains the key, ignoring letter case, with no letter or digit directly
   before or after it. The skill gives `claude/abc-123-fix-search` as a name
   that holds `ABC-123`, and `abc-1234` as one that does not. Every place in
   the gone case that matches a key uses this rule.
2. **Listing pull requests.** The parent runs two lists of the person's pull
   requests, each with the same fields: the existing list of every state,
   which is cut to the newest 100, and a separate list of open pull requests
   only, so that a long-running open pull request older than the newest 100
   is still found. It keeps the pull requests from either list, once each,
   that are not from a fork and whose title or head branch holds the key.
3. **The dead session's worktree.** The parent reads the record's working
   folder as ordered checks, stopping at the first that fails and then
   ignoring the folder:
   1. it holds only the characters the cleanup case allows, because the
      parent may name it in a command or a brief, and it is the path of an
      entry in `git worktree list --porcelain` that is not marked `prunable`,
      so that a brief never names a folder that is gone;
   2. that entry is not the repository's main checkout;
   3. the entry's branch, taken from that entry, holds only the characters
      the cleanup case allows; an entry that says `detached`, as during a
      stopped rebase, goes to the person instead of being ignored, because
      git still holds its branch;
   4. that branch holds the key;
   5. no running session in `list_sessions` uses that folder.
4. **Local branches.** The parent lists every local branch name with
   `git branch --list --format='%(refname:short)'` and keeps those that hold
   the key, filtering the names itself rather than passing the key to git as
   a pattern, because a pattern there ignores the key rule and letter case. A
   kept branch is **remaining** unless its commits are reachable from the base
   branch, or it is the head branch of a merged or closed pull request from
   the list and its tip equals that pull request's `headRefOid`, because that
   pull request already accounts for it. Whatever those say, a kept branch is
   also remaining when a worktree other than the one step 3 accepted has it
   checked out, or when it is the accepted worktree's branch and that
   worktree has uncommitted changes, so that work with no commits of its own
   keeps an owner. A kept branch with a character the cleanup case does not
   allow goes to the person, because the parent would have to put it in a
   command.
5. **Counting.** "More than one branch" counts distinct branch names among
   the open pull requests' head branches and the remaining branches, so a
   worktree's branch and an open pull request on that same branch count once.
6. **Deciding**, taking the first that holds:
   - more than one open pull request, or more than one branch: tell the
     person in one line;
   - the issue was closed or moved to done: ask the person in one line;
   - an open pull request: start `/implement --resume #N` with it;
   - a merged pull request: tell the person the issue is finished, starting
     nothing, only when no branch remains, no pull request closed without
     merging is newer than the newest merged one, and the tracker does not
     show the issue open, which includes a state that could not be read;
     otherwise ask the person in one line, naming what stopped it, because a
     newer attempt that was closed may hold work nobody owns;
   - a pull request closed without merging: ask the person in one line;
   - none: start `/implement <issue>`, and when one branch remains, the brief
     names it, and names the worktree folder from step 3 when that holds it.
     When a worktree other than the one step 3 accepted has that branch
     checked out, ask the person instead, because another session may be
     working on it and git refuses to check out one branch twice.
7. **The cleanup case.** The over-long line in its merged check is rewrapped,
   with no change to its words.
8. **The heading test.** No test is added (see "Decided by the counsel"). The
   comment above the test that pins every wake sentence in
   `mods/foreman/tests/wake.test.ts` names `skills/wake/SKILL.md`, so that a
   person fixing a failing pin test is sent to the skill's headings.

## Edge cases

- A squash merge leaves the merged branch behind locally at the merged tip:
  it is not remaining, so the issue still counts as finished.
- A branch name reused for new work after its pull request merged has a tip
  that differs from `headRefOid`: it is remaining, so the person is asked.
- An older merged or closed pull request and a newer open one on another
  branch: the older branch is not remaining while its tip equals
  `headRefOid`, so the parent resumes the open one.
- A running session holds a branch for the key: the branch counts, which
  sends the case to the person, because the issue is not finished.
- A session died before its first commit, so its branch sits at the base
  branch's tip with uncommitted edits in its worktree: the branch is
  remaining, so a fresh session's brief names it and its folder.
- A worktree folder whose path holds a character the cleanup case does not
  allow is ignored, so it is never named in a command or a brief.
- A branch that exists only on the remote with no pull request is not seen.
  Pushed work almost always has a pull request, which the lists find.

## Non-goals

- No change to `mods/foreman/hooks`, the wake sentences, or foreman's timers.
- No change to the other wake cases, apart from the one rewrapped line.
- No new gate, and no change to `/implement` or `/cleanup`.

## Failure modes

- Every case the parent cannot settle safely, including a git or gh command
  that fails, ends in a one-line message to the person naming the issue.
- A wrong "finished" leaves work without an owner while a needless question
  costs one line, so each doubtful case asks.

## Verification

The four gates load, type-check, test and validate both mods; none of them
reads the skill's text, so the text is checked by its reviewers and by a
walk-through in the pull request. The walk-through takes `ABC-123` through
each edge case above, and through a dead session whose branch is
`claude/abc-123-fix-search` with an open pull request on that branch, and
says what the skill tells the parent to do. The search in
`.claude/rules/no-project-names.md` on the staged diff finds only
placeholders.

## Decided by the counsel

- The issue's seventh follow-up asks for a test that builds each foreman wake sentence from REASON_WORDS and checks that the foreman:wake skill has a matching heading, "if claude plugin test allows reading a file from the mod's folder". It does not. What should this change do about the heading drift that the test was meant to catch? The counsel chose: Add no test; record in the spec and the pull request that the plugin test runner cannot read files, so the follow-up is closed as not possible, and keep the existing comment above REASON_WORDS as the only guard. 4 of 7 members voted for it.
- In the foreman:wake skill's gone case, a merged pull request should count as "the issue is finished" only when no other branch for the issue key remains and the tracker does not show the issue open. Where should the parent look for such a remaining branch? The counsel chose: Those, plus every local branch whose name holds the key, from `git branch --list`, whether or not a worktree holds it. 7 of 7 members voted for it.

The plugin test runner was measured on 2026-10-21: in a test, the engine has
no `$.fs`, importing `SKILL.md` as text is refused because only code files may
be imported, and `Bun`, `require`, `process` and `fetch` are all undefined.
