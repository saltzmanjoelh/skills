# Plan: cheaper review rounds

Date: 2026-10-28. Spec: `docs/specs/cheaper-review-rounds.md`.

Three planners wrote plans blind to each other: the simplest change, the most
robust change and the most extensible change. A judge scored them against
the spec. The simplest plan won. It adds no file, no tool input and no
module, and the only new stored state is two optional fields on a value the
package tool rebuilds from git and GitHub on every call. The other two plans
lost on size and on a few readings of the spec, but each had ideas worth
keeping, which are grafted below.

## Chosen approach

All the decisions are pure functions added to `mods/builder/hooks/review.ts`.
All the git work stays in `servePackage` in `mods/builder/hooks/register.tsx`.
The package tool stores the reviewers it named, so the pane plans from the
same answer the session got.

### The heads

- **The verdict head** is the commit of the newest review by the session's
  login that `verdictsOf` reads as a verdict review, in the order GitHub
  lists the reviews, skipping reviews at the current head. A review at the
  current head is skipped because a change from a head to itself is empty;
  a pull request whose only verdict reviews are at the current head has its
  verdict head at the commit of the newest review before that, or none.
  A carried-over review counts like any other.
- **The checks on the verdict head.** `git merge-base --is-ancestor <V> HEAD`
  must exit 0, and `git rev-list --merges <V>..HEAD` must print nothing.
  An exit of 1 or 128 from the first, or any merge from the second, makes the
  package a first package whose `package.md` says why. Treating a merge of
  any branch as a reason to fall back catches more than the spec asks, but it
  only costs reviewer runs, and it guarantees a straight line of commits after
  the verdict head, which the reviewed head below relies on. A git call that
  throws or is cut off refuses the package, as today.
- **The reviewed head** walks the commits after the verdict head, oldest
  first. A `Reviewed:` value that names no branch commit through
  `commitNamed` makes the reviewed head missing. Otherwise the reviewed head
  is the newest commit any `Reviewed:` value names, or the verdict head when
  none does. A named commit that is not after the verdict head is ignored.
- Every sha taken from GitHub must be 40 lowercase hexadecimal characters
  before it is passed to git; otherwise the package falls back.

### The package

- A first package is unchanged.
- A later package writes `diff.patch` from `git diff --unified=15 <V> HEAD`
  and `full.patch` from today's diff against the base. `package.md` opens by
  naming the verdict head's full sha, says to read `diff.patch` first and
  `full.patch` or the source only when a hunk needs it, prints the newest
  earlier review in full and each older one as one line giving its commit and
  its two verdicts. `## Already decided` and `## Areas fixed so far` still
  read every review body in full.
- `package.md` is written last among the files, and `packaged` after it.

### The sorting rule

- The changed files come from
  `git diff --name-status -z -M --no-ext-diff <reviewed head> HEAD`. The
  `-z` flag avoids quoted paths, and `-M` keeps a user's `diff.renames`
  setting from turning a rename into a deletion and an addition.
- A status of A, M, D or T sorts one path. R and C sort both paths, and a
  rename counts as tests or documentation only when both paths sort the same
  way. Any other status, or output that does not parse, counts as anything
  else. An empty list of changed files names only the maintainability
  reviewer.
- A path is a test file when a folder in it is exactly `test` or `tests`, or
  its file name contains `.test.`, `.spec.` or `_test.`.
- A path is documentation when it ends in `.md` and lies under the spec
  directory or under `docs/`, or is `README.md` at the root, and it is not an
  instruction file. An instruction file is any path with a `.claude` or
  `.claude-plugin` folder, or named `CLAUDE.md`, `CLAUDE.local.md`,
  `AGENTS.md` or `SKILL.md`. Such files count as anything else wherever they
  are, because Claude Code loads them as instructions.
- The spec directory is read with `factIn` from
  `git show origin/<base>:CLAUDE.md`. A failed read, a missing or empty fact,
  an absolute path, a `..` folder, or a value that comes down to the root
  (such as `.` or `./`) gives `docs/specs/`.
- If any file is anything else, or the reviewed head is missing, all four
  focused reviewers are named; otherwise only the maintainability reviewer.

### The check after approval

A head is up for the check when the newest review at the verdict head
approves with both verdicts, the reviewed head is the verdict head, exactly
one commit follows the verdict head, and the first line of its message is
`Fix this round's cheap follow-ups`. The answer then says the head is up for
the check and names only the adversarial reviewer. It also names the focused
reviewers that a normal round at this head would run, by the sorting rule, so
that when the check leaves a safety finding or a finding that breaks working
behaviour, the skill runs the first half with that list on the same package
without a new tool input.

### What is stored, and the pane

`Packaged` in `mods/builder/types/index.d.ts` gains two optional fields,
`reviewers` and `check`. `plannedOf` in `mods/builder/hooks/progress.ts`
uses `reviewers` only when it is a non-empty list whose every entry is one of
the four focused reviewers, and otherwise plans all four, which is how a
value from an older build reads. When `check` is true it plans only the
adversarial reviewer. Otherwise it plans the verdict pair once every named
reviewer has started and finished. `reviewersLine` in
`mods/builder/hooks/context.ts` counts only the named reviewers and says the
rest were not needed at this head, so a compaction summary never asks the
session to launch a skipped reviewer.

The stored value is rebuilt from git and GitHub on each package call. A
restart starts it empty, as today. A `/clear` keeps it, and it is keyed by
head, so a stale value plans nothing once the head moves. A hot reload over
an older value plans all four. Two copies of the session each keep their own
value and write the same bytes into the shared package folder for the same
head and reviews. A stale `full.patch` beside a later first package is
harmless, because reviewers read it only when `package.md` names it.

### Text changes

- The six reviewer agents describe both package shapes. The claim checker
  checks a finding's scope against `full.patch` when `package.md` names it.
  The adversarial reviewer gets a short paragraph on the check after
  approval.
- `skills/implement/SKILL.md`: step 6 and the first half launch the focused
  reviewers the answer names, or all four when it names none; a new section,
  "The check after approval", holds the spec's points one to five; the second
  half's point 5 sends a non-inert new head to the package tool, which decides
  whether the check runs; point 6 gains the second opening sentence; and
  "Follow-ups questions" passes the check's other findings as outside the
  spec. The Merged step does not change.
- The mod's `README.md`: the package tool and the planned agents.

## Grafts

- From the extensible plan: updating `reviewersLine`, because otherwise a
  summary after compaction lists a skipped reviewer as not started; and
  sorting instruction files as anything else even under `docs/`, which the
  spec's definition of anything else supports and which only adds reviewers.
- From the robust plan: `-M` and `--no-ext-diff`, the guard against a spec
  directory that resolves to the root, the check that GitHub's shas are full
  hexadecimal, writing `package.md` last, and validating the stored reviewer
  names.
- From the judge: naming in the check answer the focused reviewers a normal
  round would run, which closes the gap all three plans left at a check that
  finds a blocker.

## Rejected alternatives

- **A new module with a review-plan object and a table of kinds** (the
  extensible plan). It needs private helpers exported and builds seams for a
  per-reviewer start point and for separating the base's changes, both of
  which the spec's Non-goals exclude.
- **A `normal_round` input on the package tool** (the robust plan). The
  check answer can name the normal round's reviewers instead, so no new
  input is needed, and the session's memory of a failed check would still be
  lost on a resume, which the spec accepts. A review found the input was
  needed after all, as `after_check`, because a second package call at the
  same head works the shape out from the same commits and would store the
  check again, so the pane would plan only the adversarial reviewer for the
  normal round that follows a check with a blocking finding.
- **Falling back to a first package when the verdict head is the current
  head** (the robust plan). The spec defines a first package as one with no
  verdict head, and the fallback would cost a full round whenever a head is
  packaged again.
- **Comparing `git merge-base --all` sets for the base-merge check.** It
  matches the spec's words more exactly, but allows merges of other branches,
  after which the order of commits no longer follows ancestry and the
  reviewed head can be picked wrongly.
- **Using the live head sha in place of `HEAD` in the new commands only.**
  The tool already refuses unless they are equal, and converting only some
  commands would not make the package consistent.
- **Naming all four reviewers for an empty change list.** The spec's plain
  reading, only tests and documentation changed, holds for an empty list.
- **Writing the owed-measurement comment into the skill.** The spec says the
  Merged step does not change.

## Steps

1. Tests for the pure functions in `mods/builder/tests/review.test.ts`, seen
   failing, then the functions in `review.ts`: the sorting of a path, the
   parsing of the changed files, the reviewers named, the spec directory, the
   verdict head, the reviewed head, the check, and the later `packageText`.
2. Tests in `mods/builder/tests/register.test.ts`, seen failing, then
   `servePackage` and the package tool's description. The new fake-git
   handlers go before the cut-off diff branch and the catch-all `git diff`
   and `git log` branches, and use new world field names rather than the
   existing `changed`. Existing package tests are rechecked, since some
   become later packages.
3. Tests in `mods/builder/tests/progress.test.ts`, seen failing, then
   `plannedOf`, the `Packaged` type and `reviewersLine`.
4. The agent files, the mod's `README.md` and `skills/implement/SKILL.md`.
5. The gates from the project's `CLAUDE.md`.

## Test plan

Each bullet of the spec's Verification maps to tests:

1. First package: with no verdict review, `diff.patch` is the diff against
   the base, no `full.patch` is written, every earlier review is in full,
   and the answer names all four focused reviewers.
2. Later package: with reviews at two earlier heads, the `--unified=15` call
   starts at the newest, `full.patch` exists, `package.md` names that head's
   full sha, the newest review is in full and the older one is one line, and
   the decided items from both bodies appear.
3. Sorting: each kind of path, a custom spec directory read from the base
   rather than the branch, `README.md` against a nested one, `SKILL.md` and
   `CLAUDE.md` under `docs/`, a rename across kinds and within one, an unknown
   status, malformed output, an empty list, and an unsafe spec directory.
4. Fallbacks: a merge since the verdict head, an ancestor check that exits 1
   and one that exits 128 each give a first package with the reason; an
   unmatched `Reviewed:` value names all four.
5. The check: a head that is up for it names only the adversarial reviewer
   and the normal round's reviewers; one negative case for each condition.
6. The pane: a maintainability-only package plans it and then the verdict
   pair; a check plans only the adversarial reviewer; an older value, an
   empty list and unknown names plan all four; the summary line counts only
   the named reviewers.
