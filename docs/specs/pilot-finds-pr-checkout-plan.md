# Plan: the pilot mod finds the pull request's checkout

Date: 2026-10-12. Spec: `docs/specs/pilot-finds-pr-checkout.md`.

## Chosen approach

Three planners wrote blind plans (simplest thing, most robust, most
extensible) and a judge compared them. The most extensible plan won, with
grafts from the most robust one.

- A new module with no side effects, `mods/pilot/hooks/checkout.ts`, holds
  the parsing and the wording:
  - `type Checkout = { dir: string; branch: string; how: 'worktree' | 'no-worktree' | 'unlisted' }`
  - `worktreeWithBranch(listing: string, branch: string): string | null`
    reads the output of `git worktree list --porcelain -z`. Records are
    separated by an empty field, each field ends with a NUL byte, and the
    path is everything after `worktree `. It returns the first path whose
    record has a field exactly equal to `branch refs/heads/<branch>`. An
    exact comparison means `feature` never matches `feature-2`, and a
    detached or bare entry has no `branch` field, so it never matches. A
    prunable entry still matches. An empty branch matches nothing.
  - `checkoutSentence(c: Checkout): string` returns one of the spec's three
    sentences, with the branch printed through the existing
    `printable(branch, 100)` from `hooks/text.ts`, because on a pull request
    from a fork someone outside the repository chose the name.
- In `mods/pilot/hooks/register.tsx`:
  - `livePullRequest` asks for `${PR_FIELDS},baseRefName,headRefName`, and
    `PrForReview` gains `headRefName: string`. `PR_FIELDS` does not change,
    because the polling snapshot never reads the branch.
  - `checkoutOf($, from: string, branch: string): Promise<Checkout>` runs
    `git worktree list --porcelain -z` through the existing `git` helper in
    `from`. A null answer, which the helper gives for an error exit, a thrown
    command or cut-off output, is `unlisted`; no match is `no-worktree`.
    It takes a folder and a branch rather than a run, so the counsel
    follow-up can call it as it is.
  - `servePackage` calls `checkoutOf($, r.cwd, live.headRefName)` right after
    the live read and uses the folder it found for `rev-parse HEAD`, the
    fetch, both diffs, the log, `packageDir` and `projectDocuments`. The
    refusal is today's sentence, one space, and `checkoutSentence`.
  - `serveReview` calls `checkoutOf` after the checks that can refuse it, and
    uses the folder only for `packageDir`. The `gh` post keeps `r.cwd`.
- `mods/pilot/README.md`: the lines that say "the checkout's git folder"
  say how the checkout is found, and one sentence says the counsel tool still
  uses the session's starting folder.

## Grafts

- From the robust plan: a test for a prunable worktree at `/gone`, because
  the spec names that edge case and nothing else would prove it.
- From the robust plan: the parser's own tests are required, not optional,
  in `mods/pilot/tests/checkout.test.ts`.
- From the robust plan: the default fake listing has `/repo` on the head
  branch, so every existing test goes through the path where a worktree is
  found, and the failing listings contain `/wt` on the head branch, so a test
  would catch code that parsed a failed or cut-off listing.
- Instead of the robust plan's handling of quoted paths, the command uses
  `-z`, which prints paths unquoted (the spec was updated to say so).

## Rejected alternatives

- The simplest plan's fake, which answered no listing by default. Every
  existing test would then run the fallback, and the found path would go
  untested.
- Printing the branch raw. The mod already prints names chosen outside the
  repository through `printable`.
- The robust plan's preference for the worktree whose `HEAD` is the head
  when two worktrees share a branch. Git refuses that state without
  `--force`, and the spec does not describe it.
- The robust plan's regular expression that replaces an unusual branch name
  with other words, and its checks for relative paths and carriage returns,
  which git never produces.
- Storing the folder at watch time, a watch input, and `$.session.root()`,
  all decided against by the counsel in the spec.

## Steps

1. Test fake, in `mods/pilot/tests/register.test.ts`:
   - `openPullRequest` gains `headRefName: 'feature'`.
   - `world.ran` records `{ argv, cwd: e.init?.cwd }` beside `world.calls`,
     which keeps its shape.
   - `world.heads[cwd] ?? world.head` answers `git rev-parse HEAD`.
   - `world.gitDirs[cwd] ?? '/repo/.git'` answers
     `git rev-parse --absolute-git-dir`, after the existing `gitDirFails`.
   - `world.worktrees` is a list of `{ path, head?, branch? }`, rendered in
     the `-z` format, defaulting to `/repo` on `feature`.
   - `world.worktreesFail` is `null | 'exit' | 'throw' | 'cut'`.
   - `fakeFiles` treats `/wt` as a directory when a test seeds files there.
2. The tests below, committed with the fake before any change to the mod,
   and seen failing.
3. `checkout.ts` and its tests, then the changes to `register.tsx`.
4. The README.
5. The four gates from the project's `CLAUDE.md`, in order.

## Test plan

In `mods/pilot/tests/register.test.ts`, mapped to the spec's Verification:

1. Main checkout `/repo` on `main` at D, `/wt` on `feature` at C, with
   `/wt/CLAUDE.md` naming a document only `/wt` has. The package tool writes
   `/repo/.git/worktrees/wt/pilot/cccccccc/package.md`, which names that
   document; `git rev-parse HEAD`, the fetch, the diffs and the log ran in
   `/wt`; the listing ran in `/repo`. Before the fix it refuses with "The
   checkout is at dddddddd but the pull request's head is cccccccc", which is
   the 2026-10-12 refusal.
2. The same world: the review tool stages `review.md` under
   `/repo/.git/worktrees/wt/pilot/cccccccc/` and posts that file.
3. `/repo` at the head C and `/wt` behind at D: the answer is today's
   sentence followed by "It compared /wt, the worktree that has feature
   checked out." Before the fix a package is wrongly written from `/repo`.
4. No worktree has `feature`; the list has `feature-2` and a detached
   worktree at the head: the refusal names `/repo` and says no worktree has
   `feature` checked out.
5. For each of an error exit, a throw and cut-off output, with `/wt` on
   `feature` in the listing: the refusal names `/repo`, says git could not
   list the worktrees, does not contain "no worktree has", and nothing is
   written under `/wt`'s git folder.
6. A prunable `/gone` on `feature`, where every command in `/gone` throws:
   the refusal says "an unknown commit" and names `/gone` as the worktree
   that has `feature` checked out.
7. The existing package and review tests pass unchanged.

In `mods/pilot/tests/checkout.test.ts`, for `worktreeWithBranch`: a prefix
branch, a detached entry, a bare entry, a path with spaces, a prunable
entry, an empty listing, an empty branch, and the first of two matches.
For `checkoutSentence`: each of the three sentences, and a branch name with
a control character printed through `printable`.
