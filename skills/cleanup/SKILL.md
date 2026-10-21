---
name: cleanup
description: Tear down everything a finished worktree session owns (any local services or devices the project allocated to it, its scratchpad, its worktree, its local branch), and then archive the session. Use when the user says "cleanup", "clean up this worktree", "I'm done with this session", or after a branch has merged and the tree is no longer needed.
---

# Cleanup

Retire a finished worktree session and everything allocated to it. Cost class:
single agent, no subagents. Every step is irreversible, so the whole design is
about refusing to run when something would be lost.

## Project facts

Read these facts from the project's `CLAUDE.md`. Each is either one
`Label: value` line anywhere in the file or a section under its own heading.
When a fact is missing, or there is no `CLAUDE.md`, use its default.

| Fact | Default |
|---|---|
| `Base branch:` | `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` |

## The one rule

**Only ever touch what the CURRENT worktree owns.** One machine
routinely carries several worktrees at once, each with its own local services,
its own simulator or devices and its own ports, and they are distinguished
only by the worktree's directory name. Deleting a neighbour's services or devices destroys a
session somebody is still using. Every command below names the current worktree
explicitly; none of them may take a wildcard, a "stop all", or a device picked
by hand.

## Refuse rather than destroy

Run these checks first and **stop, reporting what you found**, if any fail. Do
not offer to force past them on your own initiative. Say what is unmerged and
let the user decide.

1. **This must be a worktree, not the main checkout.** `git rev-parse
   --git-common-dir` differs from `--git-dir` inside a worktree. If they are
   the same you are in the primary checkout: refuse outright. This is the check
   that stops the skill deleting somebody's actual repository.
2. **The tree must be clean.** `git status --porcelain` empty. Untracked files
   count, because a scratch file somebody meant to keep looks exactly like
   litter.
3. **Every local commit must be somewhere else.** For each branch about to be
   deleted, confirm its commits are reachable from `origin/<base branch>`,
   or that its pull request is merged. **A squash merge does not make the branch
   an ancestor of anything**, so `git branch -d` refuses on branches whose work
   is safely landed. Ask `gh pr view <branch> --json state` instead of trusting
   the ancestry check, and only then use `-D`.
4. **Nothing else may be checked out on the branch.** `git worktree list` shows
   which branch each tree holds.

## Procedure

Work outward from the most specific resource to the least, so that if a step
fails the remaining ones still describe a coherent state.

1. **Find the project's own teardown steps.** Read the project's `CLAUDE.md`
   and `docs/` for how a worktree's local resources are created and destroyed
   (a local database stack, a port allocation file, a per-worktree simulator,
   containers, dev servers). Use the project's own wrapper script rather than
   the bare underlying tool, because the wrapper is what supplies this
   worktree's identity. If the project documents nothing, say so and skip to
   step 4 rather than guessing.
2. **Stop and destroy this worktree's local services, then release its
   ports.** Delete only this worktree's entry from any shared allocation file,
   rewrite it, and re-read it to confirm the other entries survived byte for
   byte. Leaving the entry behind leaks a port block forever; deleting the
   wrong one hands two trees the same ports. Verify afterwards that the
   neighbours' containers are still up.
3. **Delete this worktree's own device or simulator**, if the project gives
   each worktree one. Look it up by its exact full name and delete it by
   unique id, never by a name match, and never touch a shared or hand-made
   device or one named after another worktree. If none exists, say so and move
   on: a session that never ran the app never created one.
4. **Remove the worktree**, from the primary checkout via `git -C <main-repo>
   worktree remove <path>`, then `git worktree prune`.
5. **Delete the local branches this session created.** Include any branch the
   session started on and then abandoned. Those are invisible in the worktree
   list and are the ones that accumulate. Leave the REMOTE branch alone unless
   the user asks: it is the pull request's history.
6. **Delete the scratchpad**: the `scratchpad` directory under the session's
   temp path, and **only** that directory. Absolute path, and confirm it sits
   under the temp root before removing anything.

   **Do not delete the session temp directory itself.** Its sibling `tasks`
   directory is where the harness writes the stdout of every Bash call,
   including the very call doing the deleting. Removing the parent makes that
   command's own output file vanish before it can be read: the command succeeds,
   and the result comes back as `output file could not be read (ENOENT)`, which
   reads exactly like a crash. Measured on 2026-08-23: the teardown had
   completed in full and looked like a failure. The harness recreates the
   directory for the next tool call anyway, so deleting it buys nothing.
7. **Archive the session**, last, with `archive_session` and `session_id:
   "self"`. The person's request to run `/cleanup`, or to run `/implement`,
   whose last step is `/cleanup`, already counts as their agreement to archive
   the session. This holds whether the person started this session directly
   or through a foreman parent session that they started, because either way
   they asked for the whole life of the session, and that life ends in an
   archive. So never wait for, or ask for, a second agreement here. The
   agreement covers the archive only: the checks in "Refuse rather than
   destroy" still run first, and a check that fails still stops the skill.
   Archiving ends the conversation, so **write the full report before calling
   it**, because there is no turn afterwards in which to explain what
   happened.
   Turn Remote Control off first, with `set_remote_control` for `"self"`: the
   app refuses to archive a session while Remote Control is on, and calls it
   only "live work".
   When the app or the permission check refuses either call, or the tool is
   not there at all, as in a session outside the desktop app, that is final.
   Add one sentence to the report already written, naming the call and
   quoting the refusal, and stop. Never retry the call, and never ask the
   person instead. When turning Remote Control off failed, do not call
   `archive_session`, because the app would refuse it too. The session is then
   left with its work merged and torn down but not archived. When a foreman
   parent started it, the parent archives it once foreman reports the session
   as stuck in cleanup; a person who started it directly reads the sentence
   and archives it themselves.

## Ordering traps

- **The working directory disappears underneath you.** Step 4 deletes the
  directory the shell is sitting in. Use absolute paths and `git -C` for
  everything from step 4 onward. A later Bash call may report
  `Working directory ... was deleted; shell cwd recovered` and need re-issuing,
  so put the verification in a separate command rather than trusting the one
  that did the deleting.
- **A branch cannot be deleted while a worktree holds it**, so step 5 has to
  follow step 4 rather than precede it.
- **`archive_session` may remove the worktree itself.** It cleans up the
  session's worktree by default, so step 4 may already have been done for you.
  Removing it explicitly first keeps the outcome the same either way.
- **Report before archiving.** The conversation ends on the tool result.

## Report

State what was destroyed and what was deliberately left: the remote branch, the
merged pull request, any neighbouring services or devices still running, and
anything a check refused to touch.
