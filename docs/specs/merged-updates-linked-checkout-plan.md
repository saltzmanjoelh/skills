# Plan: a merge reaches the checkout that new sessions load

Spec: `docs/specs/merged-updates-linked-checkout.md` (SAL-186). Written
2026-10-08 from a tournament of three plans: simplest, most robust and most
extensible.

## Chosen approach

The simplest plan won. Only the **Merged** step of
`skills/implement/SKILL.md` changes. It keeps its existing control flow and
gains the spec's steps (six in the skill, which splits the fetch step
in two) and one paragraph on failures. The base branch
and the merge commit come from one call,
`gh pr view <n> --json mergeCommit,baseRefName`. No new fact, no change to
the Rules, no committed helper script. (As planned the steps sat inside
item 1; review moved them into their own subsection, as "Changed in
review" below says.)

Exploring the machine showed three facts the wording has to handle:

- The links under `~/.claude/agents` point at files, and `git -C` refuses a
  file, so git runs in the folder that holds a file target.
- `~/.claude/commands` does not exist here; a missing folder is skipped.
- Another skill link points into a second, unrelated checkout, so the match
  really chooses between two checkouts today.

## Grafts

1. **A short opening for item 1** (from the most extensible plan). Item 1
   opens with one sentence saying the update comes first, then the
   original text about the issue, follow-ups, `/cleanup` and stopping, then
   the closed-without-merging line. The steps follow below, so the step's
   control flow stays readable. The opening also says why this moves the
   main checkout although the session otherwise never works in it, and the
   safety check says why it is looser than `/cleanup`'s rule.
2. **The three report outcomes, listed in the confirm step** (from the most
   robust plan): updated and confirmed, not linked, and left alone with the
   reason.
3. **Two kinds of broken link** (from the most robust plan). A link whose
   target does not exist is a failure. A target that exists but is not
   inside a git repository points into no checkout and is skipped.
4. **A `gh` failure in an unrelated checkout** (from the most extensible
   plan's flag). When another checkout matched, the failure is named in one
   sentence and the update goes ahead. When nothing matched and any lookup
   failed, the step reports a failure, not "not linked".
5. **More cases for the scratch script**: an untracked file the
   fast-forward would overwrite, a file link and a folder link into the same
   checkout, `pull.rebase=true`, and a detached `HEAD`.

## Rejected

- **Reporting "contains the merge" after a failed fast-forward** (most
  robust). The spec says a refused fast-forward is reported as a failure.

- **A clause in the Rules about credentials in quoted messages** (most
  robust). The spec limits the change to the Merged step, and the step's
  own wording already asks for the check.
- **A named, reusable sub-procedure** (most extensible). It builds for the
  SAL-160 follow-up and `/cleanup`, which the spec puts out of scope.
- **Comparing names ignoring letter case** (most robust). `nameWithOwner` is
  GitHub's own form, so an exact comparison is what the spec states.
- **A test of two concurrent runs** (most robust). It cannot be made
  deterministic, and the spec's reasoning about concurrent merges covers it.

## Changed in review

The tournament rejected running the checks and the fast-forward as one
shell command. Review round 1 adopted it: the slow fetch had sat between
the branch check and the fast-forward, so a branch checked out in that
window would have been moved. The fetch now comes first, the checks and
the fast-forward run as one command that says which check stopped it, and
the confirmation checks the branch again. The same round replaced the bare
`pull --ff-only` with a fast-forward to the named merge commit, fetched
from the merged repository's own address so no other remote is contacted;
added `--no-overwrite-ignore`, because git otherwise replaces an ignored
file; and required the base to be the default branch, because a checkout
on another branch passed the branch check whenever a pull request was
merged into that branch.

Round 1 also moved the procedure out of item 1 into its own subsection,
"Updating the linked checkout", which item 1 names as its first action,
because seventy lines inside the decision list hid the list's shape; the
review round already lives in a subsection the same way. This is not the
rejected reusable sub-procedure: it states no inputs for other callers and
nothing else uses it. The report's outcomes moved into their own block,
since most of them come from steps before the confirmation; later in
review the three became five, adding "only worktrees linked" and
"nothing to update" for a merge into another branch. And the
step now reads the merged repository's address and default branch with
`gh repo view <owner>/<name> --json url,defaultBranchRef`.

## Steps

1. Write the scratch script `<scratchpad>/linked-checkout-check.sh` first,
   running the commands exactly as the new wording gives them, and see it
   fail against the current skill in the one way it can: the current Merged
   step has none of these commands, which `grep` on the skill shows.
2. Rewrite item 1 of `skills/implement/SKILL.md` as above.
3. Run the scratch script; every case passes.
4. Run `gh repo view --json nameWithOwner --jq .nameWithOwner` by hand in
   `~/Projects/skills` and in the other linked checkout.
5. Run the mod's gates from `mods/pilot` (`tsc`, `claude plugin test .`,
   `claude plugin validate .`), which this change cannot move but which the
   project runs on every pull request.

## Test plan

Mapped to the spec's Verification section.

- **The wording.** The Merged step lists the update first, has the six
  steps, and gives the report wording for each outcome. A `grep` for
  `git-common-dir`, `untracked-files=no`, `merge --ff-only` and
  `is-ancestor` in the skill finds each.
- **The scratch script.** Each case builds a bare origin with `main`, a
  main checkout cloned from it, a second clone that pushes the commit
  standing for the merge, and a fake `.claude` with a folder link and a file
  link into the main checkout. It runs the step's commands and prints PASS
  or FAIL per case, exiting non-zero on any failure:
  - both links resolve to the same single checkout;
  - clean and on `main`: fast-forwards, and the ancestor check passes;
  - an untracked file: still fast-forwards, and the file is still there;
  - an untracked file the fast-forward would overwrite: it refuses and
    `HEAD` does not move;
  - an ignored file the fast-forward would overwrite: it refuses, and the
    local file is kept (added in review, round 1);
  - a changed tracked file: the guard stops it and `HEAD` does not move;
  - on another branch: the guard stops it;
  - detached `HEAD`: the guard stops it;
  - diverged local commits: the fast-forward refuses, and the ancestor check fails;
  - `pull.rebase=true` with diverged commits: `--ff-only` still refuses;
  - the branch tracks a fork that has moved: the fast-forward still lands
    on the merge commit, not on the fork (added in review, round 1);
  - a dead extra remote: it is never contacted, and the fast-forward goes
    ahead (added in review, round 1);
  - a merge into a branch other than the default: left alone (added in
    review, round 1);
  - a link into a worktree: detected, since its top folder is not the main
    checkout (added in review, round 1);
  - a branch switched mid-step: the confirmation fails, and the branch's
    reflog shows the fast-forward and its old position (added in review,
    round 1);
  - the fetch: the merge commit arrives and `FETCH_HEAD` is not written
    (added in review, round 1);
  - a fast-forward that meets another session's `index.lock`: it fails
    without moving, and the one retry succeeds once the lock is gone
    (added in review, round 1);
  - a branch checked out between the check and the fast-forward: the
    confirmation fails (added in review, round 1);
  - the merge already contained: nothing moves, and the check
    passes;
  - a dangling link: resolving it fails; a link to a folder outside any
    repository: no checkout.
- **By hand**: `gh repo view` in the two real checkouts prints
  `saltzmanjoelh/skills` and a different name.
- **Scope**: `git diff origin/main --stat` lists only the spec, this plan
  and `skills/implement/SKILL.md`.
