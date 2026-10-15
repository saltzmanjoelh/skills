# Plan: the linked-checkout update works on any machine

Spec: `linked-checkout-any-machine.md`. Written 2026-10-14.

Review changed step 5 after this plan was written: the object check
compares the two snapshots rather than the commits' histories, a partial
clone's missing objects are listed and fetched in rounds, three at most, first, and
the checks are numbered in the order they run. `skills/implement/SKILL.md`
and the spec replace this plan's text for step 5.

## Chosen approach

Two planners worked blind to each other, one aiming for the smallest change
and one for robustness, and a judge compared them. The robust plan won,
because it was the only one that caught a hazard the spec had wrong: a
fast-forward that meets a missing file object rewrites and deletes files
before it fails, leaving the checkout half updated while `HEAD` stays put.
The session reproduced that in a scratch repository with git 2.54, and the
spec was corrected before this plan.

Only `skills/implement/SKILL.md` changes, in two places:

- **"Updating the linked checkout".** The six steps become seven, because
  choosing the fetch source becomes a step of its own (step 4), between
  checking the base (step 3) and fetching (step 5). The old steps 5 and 6
  become steps 6 and 7 word for word. The report gains the outcome **no
  links found**, and **updated** names the fetch source.
- **Point 4 of a review round's second half.** The limit rule lists every
  cheap follow-up as dropped, renames and rewrapping included, except a
  visible problem the session meant to fix.

No reference outside the section cites its step numbers (the judge
searched `skills/`, `mods/` and `docs/specs/`), so renumbering costs only
the references inside the section, which the build updates.

## Grafts from the smaller plan

- Step 3 says, where it detects that the checkout already holds the merge,
  that the outcome is **updated** whatever steps 4 and 5 do, so the
  counsel's decision reads in one place.
- Step 1 says that after **no links found** the later steps do not run, so
  a session cannot go on and report **not linked**.
- The limit rule keeps the words "renames and rewrapping included", which
  is the point of SAL-299.

## Rejected

- **Keeping six steps and folding the source choice into step 3.** It
  made step 3 check the base, choose a source, and reach forward into step
  4's fetch for the already-updated case, which is hard to follow.
- **Trusting the fast-forward to fail cleanly on a missing object.** The
  scratch repository showed it does not.
- **Naming the fetch source by its address.** `git remote get-url` can
  print an address with a token in it, so the report names the remote.
- **A second fetch, `--all`, `GIT_TERMINAL_PROMPT=0`, `--no-tags` or
  `--atomic`.** The spec gives the fetch command, and the rule that the
  arrived commit decides already absorbs the errors these would avoid.

## Steps

1. Replace the limit-rule paragraph in the second half's point 4 with the
   text under "New text: the limit rule".
2. Replace everything in "Updating the linked checkout" after its opening
   paragraph (which ends with
   `gh pr view <n> --json baseRefName,mergeCommit`.) with the text under
   "New text: the section".
3. Search the section for "step" and check that every step number points
   at the step it means.
4. Write and run the scratch script (see Verification) in the session's
   scratchpad until every case passes.
5. Check that `git diff origin/main --stat` lists only the spec, this plan
   and `skills/implement/SKILL.md`, and run the gates, saying in the report
   that no gate reads `skills/` or `docs/`.

## New text: the limit rule

```
   When committing the fixes would take the pull request past
   `Max rounds` or `Max pushes per round`, counted as **Over a limit**
   counts them, and nothing else in this round needs a push, make no
   commit. List every cheap follow-up as dropped, renames and rewrapping
   included as well as wording and test tightening, because none of them
   is worth a push past the limit. The one exception is a visible problem
   the session meant to fix: list it as to file, so that it is not
   dropped on the session's judgement alone. List the follow-ups the
   counsel decided to fix as to file too, because the counsel judged them
   worth doing.
```

## New text: the section

```
1. **Find the linked checkouts.** Look in `~/.claude/skills`,
   `~/.claude/agents` and `~/.claude/commands`, skipping any of them that
   does not exist. When one of those folders is itself a symlink, as when
   `~/.claude/skills` links to a checkout's `skills` folder, resolve it
   with `realpath` and treat its target as one more link. Test for that
   with `test -L` on the folder's path written without a trailing slash,
   since a trailing slash follows the link. Then resolve every symlink
   directly inside each folder with `realpath`, listing them with
   `find <folder>/ -mindepth 1 -maxdepth 1 -type l`, where the trailing
   slash makes `find` look inside a folder that is itself a link. Use each
   target when it is a folder, or the folder holding it when it is a file
   (the links under `agents` point at files). Run
   `git -C <folder> rev-parse --path-format=absolute --git-common-dir --show-toplevel`,
   which prints the shared git folder and then the tree the link actually
   lies in. The main checkout is the parent of the shared git folder. A
   target that exists but is not inside a git repository points into no
   checkout and is skipped. A link whose target does not exist is broken;
   when that link is one of the three folders, nothing inside it can be
   listed. Keep the tree each link lies in for step 2, and look at each
   checkout once, however many links lead into it.
   - When none of the three folders is a symlink and none holds one, the
     outcome is **no links found**, and steps 2 to 7 do not run. It is not
     a failure. A broken link is still a link, so a broken link alone does
     not make the outcome no links found.
2. **Match the merged repository.** In each checkout, run
   `gh repo view --json nameWithOwner --jq .nameWithOwner`. A checkout
   that prints the pull request's owner and name is one to update. When
   more than one does (two clones of the same repository), each goes
   through steps 3 to 7 on its own and gets its own outcome in the report.
   - When none matches, the outcome is **not linked**, which means that
     links exist and none of them leads into the merged repository. A
     broken link or a lookup that failed makes it a failure instead, since
     the broken link or the failed checkout might have been the match.
   - When one matched, a broken link or a lookup that failed elsewhere is
     named in one sentence and does not stop the update.
   - A link of the merged repository whose tree is not the main checkout
     lies in a worktree, which sessions load instead of
     the main checkout. A worktree is someone's branch, so it is never
     moved. It is not a failure either: the report names it, and says that
     sessions loading through it still run the worktree's code. The main
     checkout is still updated when a link leads into it. When every link
     of the merged repository lies in a worktree, no session loads the main
     checkout, so it is not moved and the outcome is **only worktrees
     linked**.
3. **Check the base, and whether anything needs to move.** Read the
   merged repository's address and default branch with
   `gh repo view <owner>/<name> --json url,defaultBranchRef`, naming the
   repository so that `gh` does not pick one from a checkout's remotes.
   When the base is not the default branch, the outcome is **nothing to
   update**: the main checkout stays on the default branch, which the
   merge did not touch, and someone who has another branch out there must
   not have it moved. If the checkout is on the base and
   `git -C <checkout> merge-base --is-ancestor <merge commit> HEAD`
   already succeeds, nothing needs to move, and the outcome is **updated**
   whatever steps 4 and 5 then do. They still run, so that the checkout's
   remote-tracking branch for the base is current even when an earlier
   update fetched by address, and steps 6 and 7 do not.
4. **Choose where to fetch from.** List the checkout's remotes with
   `git -C <checkout> remote`, and read each one's address with
   `git -C <checkout> remote get-url <remote>`, which applies any
   `insteadOf` rewrite in git's configuration, so the address is the one
   git really fetches from. A remote names the merged repository when its
   address, with any trailing slashes and then a trailing `.git` removed,
   ends in `/<owner>/<name>` or `:<owner>/<name>`, compared without regard
   to case. That covers an https address
   (`https://github.com/owner/name.git`), an ssh address in the short form
   (`git@github.com:owner/name.git`, including one through a host alias
   such as `git@github-work:owner/name`) and an `ssh://` address, so a
   machine that reaches GitHub only over ssh fetches the way it already
   does. The slash or colon before the owner is part of the match, so that
   a fork whose owner's name merely ends in the same letters does not
   match.
   - When one remote names it, that remote is the source.
   - When several do, the source is the remote the base tracks, read with
     `git -C <checkout> config branch.<base>.remote`, if it is one of them;
     otherwise the one named `origin`, if it is one of them; otherwise the
     first of them when their names are sorted byte by byte, as
     `LC_ALL=C sort` sorts them.
   - When none does, as when the repository was renamed and the remote
     still names its old name, the source is the address that step 3 read
     from `gh`.
5. **Fetch the merge commit.** With a remote as the source, fetch the
   merge commit and the base in one command, without writing
   `FETCH_HEAD`, passing the remote's name and the second refspec each as
   one quoted argument:
   `git -C <checkout> fetch --no-write-fetch-head "<remote>" <merge commit> "+refs/heads/<base>:refs/remotes/<remote>/<base>"`.
   The second refspec brings the remote's base into the checkout's
   remote-tracking branch for it. It is there so that after the update
   `git status` in the checkout does not say the checkout is ahead of its
   remote, which reads like work nobody pushed, so do not drop it as
   noise. When the base has moved on past the merge commit, the checkout
   shows behind its remote afterwards, which is true. With the address as
   the source, fetch only the commit,
   `git -C <checkout> fetch --no-write-fetch-head <url> <merge commit>`,
   which leaves the remote-tracking branch alone. When step 3 found
   nothing to move and the source is the address, skip the fetch, since
   the address has no remote-tracking branch to bring up to date. Fetching
   from one source means an unreachable extra remote cannot hold the step
   up, and leaving `FETCH_HEAD` alone means a `git pull` someone runs in
   the checkout at that moment cannot read and merge this commit.
   - When step 3 found nothing to move, stop here: the outcome is
     **updated**. If the fetch exited with an error, the report adds one
     sentence quoting git's message and saying that the checkout may show
     ahead of its remote until its next fetch.
   - Otherwise, whether the merge commit arrived decides whether the
     update goes on, not how the fetch exited.
     `git -C <checkout> cat-file -e <merge commit>^{commit}` must succeed,
     and so must
     `git -C <checkout> rev-list --objects --quiet --missing=error <merge commit> --not HEAD`,
     which fails when the commit arrived without some of the files or
     folders it points to. That check comes before the fast-forward
     because a fast-forward that meets a missing file rewrites and deletes
     files before it fails, leaving the checkout half updated.
   - A fetch can exit with an error after the commit arrived, for example
     when another fetch in the same checkout holds the lock on the
     remote-tracking branch. The update then goes on to step 6, and the
     report adds one sentence quoting the fetch's message and saying that
     the remote-tracking branch may not have moved, so the checkout may
     show ahead of its remote until its next fetch.

   Fetch before the next step, so nothing slow sits between its checks
   and the fast-forward.
6. <the old step 5, "Check it is safe, and fast-forward, in one shell
   command", word for word with its four bullets>
7. <the old step 6, "Confirm", word for word>

**When it fails.** These are the failures:

- a broken link or a failed lookup when no checkout matched (step 2);
- a merge commit that the fetch did not bring, or that arrived without
  everything it points to (step 5);
- a check that stops it, or a fast-forward that refuses, after the one
  retry for a lock (step 6);
- a confirmation that fails (step 7).

**No links found** is not a failure, and neither is a fetch that exits
with an error after the merge commit arrived. On any failure, leave the
checkout alone. Never force it. Do not retry, except for the one retry
after a lock that step 6 describes. Then carry on with the issue, the
follow-up issue and `/cleanup`.

**The report** says one of these, and adds the worktree links that step 2
names and the sentences that step 5 adds. Every message it quotes from
git or gh is first checked for credentials, as before a push.

- **Updated,** after step 7, or from step 3 when the checkout already held
  the merge: the checkout's path, the merge commit, the checkout's `HEAD`
  after the update, and where the fetch came from. Name the remote, never
  its address, since an address can hold a token. Naming it keeps a
  mistake in matching remotes from falling back to the https address
  unnoticed on a machine where that address works. When no remote named
  the repository, say so, say that the fetch used the repository's https
  address or that nothing was fetched because the checkout already held
  the merge, and say that the checkout may show ahead of its remote until
  its next fetch.
- **Not linked,** from step 2: links exist and none of them leads into the
  merged repository. Say which repository merged, and which repositories
  the links point into.
- **No links found,** from step 1: the three folders it looked in. Then,
  in a sentence of its own, that if the skills or the mod load some other
  way (a plugin folder named in settings or with `--plugin-dir`, or a
  copy), this step updated nothing, so new sessions may run old code.
- **Only worktrees linked,** from step 2: the worktrees, and that no
  link leads into the main checkout, so it was not moved.
- **Nothing to update,** from step 3: the branch the merge went into, and
  that the main checkout stays on the default branch, which it did not
  touch.
- **Left alone,** from any failure: the checkout's path, or the broken
  link when there is no checkout; what stopped it, quoting git's or gh's
  own message; and that new sessions will run the old code until someone
  updates it. A failure is never reported as not linked.
```

## Verification

A scratch script in the session's scratchpad, never committed, runs the
step's exact commands. It isolates itself from the machine's git setup
(`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, its own `HOME`, and
author and committer variables), creates every repository with
`--ref-format=files` so that a lock file can be held, and prints PASS or
FAIL per check, exiting nonzero on any failure. The bare origin lies at a
path ending in `Owner/Name.git`, with `uploadpack.allowAnySHA1InWant` on so
a commit can be fetched by its hash, and a `file://` address stands in for
the https address from `gh`. The cases, by the spec's Verification
bullets:

- **A. Matching remotes.** These must match: `https://GitHub.com/OWNER/Name.git`,
  `https://github.com/owner/name/`, `git@github.com:Owner/NAME.git`,
  `git@github-work:owner/name`, `ssh://git@github.com:22/Owner/Name.git/`,
  and a remote whose raw address matches only after an `insteadOf`
  rewrite. These must not: `git@github.com:xowner/name.git`,
  `git@github.com:owner/name-old.git`, `https://github.com/someone/name.git`.
  A real fetch through an `insteadOf` rewrite to the bare origin works and
  fast-forwards.
- **B. Several matching remotes.** The tracked remote wins; with the base
  tracking a remote that does not match, or tracking nothing, `origin`
  wins; without `origin`, the first in byte order wins.
- **C. No matching remote.** The source is the address, the fetch brings
  the commit, the tracking branch does not move, and after the
  fast-forward the checkout shows ahead.
- **D. The combined fetch.** After it and the fast-forward the checkout is
  neither ahead nor behind and `FETCH_HEAD` does not exist; when the base
  moved past the merge, `HEAD` is the merge and the checkout shows behind.
- **E. A held tracking-branch lock.** The fetch exits nonzero with a lock
  message, the commit and object checks pass, and the fast-forward lands
  on the merge.
- **F. Already holds the merge with a stale tracking branch.** The fetch
  refreshes the tracking branch and `HEAD` does not move; with the lock
  held, `HEAD` still does not move.
- **G. A folder that is a link.** `~/.claude/skills` linked to the
  checkout's `skills` folder, with file links under a real `agents`
  folder into the same checkout, gives one checkout; a broken folder link
  is reported as broken.
- **H. No links.** Real folders with no links, and missing folders, give
  no links found; a home holding one broken link does not.
- **I. A missing file object.** With a file object the merge adds removed,
  the object check fails before anything is written, and the fast-forward
  alone would leave tracked changes behind.

`gh` is not exercised, since the throwaway repositories have no GitHub
remote; its two calls are checked by reading.
