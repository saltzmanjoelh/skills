# The linked-checkout update works on any machine and leaves the checkout in step with its remote

Written 2026-10-14.

## Goal

After `/implement` merges a pull request, its **Merged** step fast-forwards
the main checkout that `~/.claude` links into (see
`merged-updates-linked-checkout.md`). Three gaps in that step give a person a
wrong result or a misleading report, and this change closes them:

- On a machine that reaches GitHub only over ssh, the fetch by https address
  fails for a private repository, so every merge reports the checkout as left
  alone and new sessions keep running old code.
- When `~/.claude/skills` is itself a link into a checkout, or nothing under
  `~/.claude` is a link at all, the step reports "not linked" as if that were
  the normal answer, while new sessions keep running old code.
- After an update, `origin/<base>` still names the old commit, so
  `git status` in the main checkout says it is ahead of origin, which looks
  like unpushed work.

Where this spec and `merged-updates-linked-checkout.md` disagree, this one
is later and wins: the fetch source, the tracking branch, the fetch in the
already-updated case, and the outcomes the report can give.

The same pull request also says, in the second half of a review round,
where a cheap rename or rewrap goes when a round is over its push limit.

## Users and trigger

Every session that runs `/implement` to a merge, on any machine, and every
session started after it, which loads whatever the main checkout holds. The
person reads the merge report to learn whether new sessions will run the
merged code.

## Behavior

The change is to `skills/implement/SKILL.md`: the section "Updating the
linked checkout", and point 4 of a review round's second half.

### Finding the links

1. Finding the links also resolves each of `~/.claude/skills`,
   `~/.claude/agents` and
   `~/.claude/commands` itself when that folder is a symlink, and treats its
   target as one more link: a target inside a git repository leads into a
   checkout, a target outside any repository leads nowhere, and a missing
   target is a broken link. It still resolves every symlink directly inside
   each folder, following the folder's own link to reach them.
2. When none of the three folders is a symlink and none holds one, the
   outcome is **no links found**. It is not a failure. The report names the
   three folders it looked in and says, in its own sentence, that if the
   skills or the mod load some other way (a plugin folder named in settings
   or with `--plugin-dir`, or a copy) this step updated nothing, so new
   sessions may run old code. "Not linked" now means only that links exist
   and none of them leads into the merged repository.

### Fetching

3. Once a checkout matches and the base is the default branch, the step picks
   the fetch source. It reads each of the checkout's remotes with
   `git -C <checkout> remote get-url <remote>`, which applies `insteadOf`
   rewrites, and a remote names the merged repository when its address,
   with any trailing slashes and then a trailing `.git` removed, ends in
   `/<owner>/<name>` or `:<owner>/<name>`, compared without regard to case.
   The slash or colon before the owner keeps a fork whose owner's name
   merely ends in the same letters, such as `xowner/name`, from matching.
   The address may be https
   (`https://github.com/owner/name.git`), scp-style ssh
   (`git@github.com:owner/name.git`, including a host alias such as
   `git@github-work:owner/name`), or `ssh://`. When several remotes name it,
   the source is the remote the base branch tracks
   (`git -C <checkout> config branch.<base>.remote`) if that is one of them,
   otherwise the one named `origin` if that is one of them, otherwise the
   first in name order. When no remote names it (a renamed repository whose
   remote still names the old name), the source is today's https address
   from `gh repo view <owner>/<name> --json url`.
4. With a remote as the source, the step fetches the merge commit and the base
   into its remote-tracking branch in one command:
   `git -C <checkout> fetch --no-write-fetch-head <remote> <merge commit> +refs/heads/<base>:refs/remotes/<remote>/<base>`.
   The remote's name and the base are each passed as one quoted argument.
   The skill says why the second refspec is there (so `git status` does not
   say the checkout is ahead of its remote after the update), so that a later
   edit does not drop it as noise. With the https address as the source,
   the fetch is today's `git -C <checkout> fetch --no-write-fetch-head <url> <merge commit>`,
   the tracking branch is left alone, and the report says that the checkout
   may show ahead of its remote until its next fetch.
5. Whether the merge commit and everything it points to arrived decides
   whether the update goes on, not how the fetch exited. The step checks
   it in this order, and every failure is the failure "a merge commit the
   fetch did not bring", which leaves the checkout alone.
   - `git -C <checkout> cat-file -e <merge commit>^{commit}` must succeed.
     When the fetch exited with an error but the commit is there, the
     update goes on, and the report adds one sentence quoting the fetch's
     message and saying the tracking branch may not have moved, so the
     checkout may show ahead of its remote until its next fetch.
   - The merge commit's snapshot and the checkout's are read from the
     commits with `git log -1 --format=%T`. Comparing snapshots rather
     than histories catches a file the merge takes back to a version an
     older commit had. Comparing histories with `<merge commit> --not
     HEAD` misses such a file, which review showed in a scratch
     repository, and `<merge commit>^{tree}` cannot be resolved in a
     clone that left its folders on the server.
   - The objects the merge needs that are missing are listed with
     `rev-list --objects --missing=print <merge tree> --not <head tree>`.
     An empty listing that succeeds means nothing is missing, which is
     always the case in a full clone, and the object check below is
     skipped. Otherwise the listed objects are fetched in one request from
     the same source, because the object check would download each one in
     a fetch of its own (300 fetches and 12 seconds for 300 files in
     review). That fetch passes no `--filter`, because an explicit filter
     makes git record the source as a partial-clone source in the shared
     checkout's settings. It sets `partialclonefilter` to `blob:none`
     for that one command, under the remote's name or the address, and repeats
     the listing and the fetch until the listing is empty, three rounds at
     most: a missing folder then arrives with its folders but without
     their files, and the next round fetches only the files the merge
     needs. Without that, a clone that left its folders on the server
     downloaded the whole snapshot, 531 objects for a merge of 3 files in
     review, against 34 over 2 rounds with it.
   - Unless the listing was empty and succeeded, the object check
     `rev-list --objects --missing=error <merge tree> --not <head tree>`
     must succeed, whether or not the listing or the batched fetch
     succeeded. It runs before the fast-forward because a fast-forward
     that meets a missing file writes part of the working tree before it
     fails: in a scratch repository with git 2.54 it rewrote two files and
     deleted a third while `HEAD` stayed put, leaving sessions loading a
     tree that matches no commit, and in a partial clone a download that
     fails during the fast-forward deleted a file the same way.
6. The report for **updated** says which source the fetch used: the remote
   by name, or the https address because no remote named the repository.
   Without that, a mistake in matching remotes would fall back to https
   silently and go unnoticed on a machine where https works.

### Already up to date

7. When the checkout is already on the base and already contains the merge
   commit (someone pulled first, or another session's update got there),
   nothing moves, as today, but the same fetch from the matched remote still
   runs, so that `origin/<base>` is current even when an earlier update
   fetched by address. The outcome is **updated** whatever that fetch does;
   a fetch error is one sentence in the report quoting git's message and
   saying the checkout may show ahead of its remote until its next fetch.
   When no remote names the repository, this fetch is skipped, since the
   https address has no tracking branch to refresh.

### The limit rule

8. In point 4 of a review round's second half, the rule for a round that
   would go past `Max rounds` or `Max pushes per round` lists every cheap
   follow-up as dropped, renames and rewrapping included, except a visible
   problem the session meant to fix, which is listed as to file. The
   follow-ups the counsel decided to fix are still listed as to file.

Everything else in the section stays as it is: the one-source fetch, no
`FETCH_HEAD` written, the fetch before the safety check, the safety check
and fast-forward in one shell command naming the merge commit, the single
retry on `index.lock`, the confirmation, and the carrying on after a
failure.

## Edge cases

- A remote whose address names the repository under another host than
  github.com, through an ssh host alias: it matches, because the match is on
  `/<owner>/<name>` or `:<owner>/<name>` at the end of the address, and
  the fetch uses the alias
  the person set up.
- A fork remote and an upstream remote in one checkout: only the one whose
  address ends in a slash or colon followed by the merged repository's
  owner and name matches, so a fork owned by `xowner` does not match
  `owner/name`.
- The base moved on past the merge commit before the fetch: the tracking
  branch records where the remote's base really is, so the checkout shows
  behind its remote after the fast-forward, which is true. The fast-forward
  still lands on the merge commit.
- Another fetch in the same checkout holds the tracking branch's lock: the
  fetch exits with an error after the commit arrived, and point 5 above
  applies.
- `~/.claude/skills` is a symlink into the skills checkout's `skills`
  folder, and `~/.claude/agents` holds links to files in the same checkout:
  the checkout is found once and looked at once.

## Non-goals

- Detecting plugins loaded through settings or `--plugin-dir`. The step
  cannot see them; the **no links found** report names the possibility.
- Changing `mods/pilot`, `/cleanup` or any gate.
- Running `git fetch --all`, or fetching from more than one source.

## Failure modes

The failures stay as they are: a broken link or a failed lookup when no
checkout matched, a merge commit the fetch did not bring, a check that stops
the fast-forward or a fast-forward that refuses after the one retry for a
lock, and a confirmation that fails. On any of them the checkout is left
alone and the run carries on. **No links found** is not a failure, and a
fetch error with the merge commit present is not a failure.

## Verification

- `skills/implement/SKILL.md` states each behavior above, and the report
  lists six outcomes: updated (naming the fetch source), not linked, no
  links found, only worktrees linked, nothing to update, and left alone.
- A scratch script in the session's scratchpad runs the step's exact
  commands against throwaway repositories (a bare origin, a main checkout,
  symlinks standing in for `~/.claude`) and shows each case behaving as
  specified:
  - a remote matched by an https address, by an scp-style address, by an
    `ssh://` address and through an `insteadOf` rewrite, each compared in
    mixed case and with and without `.git`;
  - several matching remotes, choosing the tracked one, then `origin`, then
    the first by name;
  - no matching remote, falling back to the address and leaving the
    tracking branch alone;
  - after the combined fetch and fast-forward, `git status` shows the
    checkout neither ahead of nor behind its remote, `FETCH_HEAD` does not
    exist, and when the base moved past the merge it shows behind;
  - a fetch that exits with an error while the merge commit arrived (the
    tracking ref's lock held), going on to fast-forward;
  - a merge commit that arrived without one of its files, which the object
    check stops before the fast-forward writes anything, where the
    fast-forward alone would leave tracked changes behind;
  - a checkout that already holds the merge commit while its tracking
    branch is stale, whose tracking branch the fetch brings up to date
    without moving the checkout;
  - partial clones that left files, or files and folders, on the server,
    fetching from their own remote, another remote and the address: the
    missing objects arrive in at most three rounds of fetching, after
    which the object check starts no fetch of its own, the checkout's
    settings do not change, and with the server unreachable the object
    check fails before anything is written;
  - `~/.claude/skills` itself a symlink into the checkout, found as a link;
  - three folders with no symlinks at all, giving no links found.
  `gh` is not exercised there, since the throwaway repositories have no
  GitHub remote; its part is checked by reading.
- `git diff origin/main --stat` lists only this spec, its plan and
  `skills/implement/SKILL.md`.
- No gate reads `skills/` or `docs/`, so the gates passing says nothing
  about this change, and the report says so.

## Decided by the counsel

- After a merge, from where should the Merged step's linked-checkout update fetch the merge commit, so that it works on a machine that reaches GitHub only over ssh? The counsel chose From the checkout's own remote whose URL names the merged repository (whatever its protocol), choosing the remote the base branch tracks when several name it; when no remote names it, fall back to the https address from gh as today., 7 of 7.
- How should the linked-checkout update leave origin/<base> current, so that git status in the main checkout does not say "ahead of origin" after a merge? The counsel chose Bring the base branch into its remote-tracking branch in the same fetch that brings the merge commit, `git fetch --no-write-fetch-head <remote> <merge commit> +refs/heads/<base>:refs/remotes/<remote>/<base>`; when the fetch fell back to the https address, leave the tracking branch alone and say in the report that the checkout shows ahead of origin until its next fetch., 5 of 7.
- When the linked-checkout update finds no links at all (none of ~/.claude/skills, ~/.claude/agents and ~/.claude/commands is a symlink or holds one), what should the outcome and the report be? The counsel chose A new outcome, **no links found**, which is not a failure: the report names the three folders it looked in and says, in its own sentence, that if the skills or the mod load some other way (a plugin folder named in settings or with --plugin-dir, or a copy) this step updated nothing, so new sessions may run old code., 7 of 7.
- When the combined fetch (the merge commit plus the base into its remote-tracking branch) exits with an error but the merge commit did arrive, should the update go on? The counsel chose Yes: whether the merge commit arrived (`git cat-file -e <merge commit>^{commit}`) decides, as today. If the fetch exited with an error but the commit is there, the update goes on to the safety check and fast-forward, and the report adds one sentence quoting the fetch's message and saying the tracking branch may not have moved, so the checkout may show ahead of origin until its next fetch., 7 of 7.
- When the linked checkout is already on the base and already contains the merge commit (someone pulled first, or another session's update got there), should the update still run the fetch to refresh origin/<base>? The counsel chose Yes: run the same fetch from the matched remote, so origin/<base> is current; the outcome is updated whatever the fetch does, and a fetch error is one sentence in the report quoting git's message and saying the checkout may show ahead of origin until its next fetch. When no remote names the repository, skip the fetch., 7 of 7.
