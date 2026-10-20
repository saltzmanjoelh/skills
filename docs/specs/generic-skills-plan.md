# Plan: make the remaining skills generic

Spec: `docs/specs/generic-skills.md`. Written 2026-10-08.

## Chosen approach

The most-extensible plan won. Every file that states a fact uses one shape,
and every default has one wording, so that a new fact key, a new skill that
reads facts, or a later gate that checks the defaults costs one row and one
grep.

- **One wording per default.** For every key that `implement` reads, the
  default is `implement`'s table cell, character for character. The README
  is written first, and every skill copies its cells.
- **One shape.** Each of the six skills gets a `## Project facts` section
  after its opening paragraph, with the same opening sentence and a table in
  `implement`'s shape, `| Fact | Default |`, rows in `implement`'s order.
  The opening sentence is: "Read these facts from the project's `CLAUDE.md`.
  Each is either one `Label: value` line anywhere in the file or a section
  under its own heading. When a fact is missing, or there is no `CLAUDE.md`,
  use its default." A skill that reads a directory fact adds that the fact
  stands for the directory without its trailing slash.
- **One naming convention.** The text refers to a fact's value by its label
  in lower case inside angle brackets, such as `<base branch>`,
  `<spec directory>` and `<screenshot directory>`. That keeps the base branch
  apart from `storypr`'s existing `<branch>`, which means the pull request's
  own branch. The README states the convention.
- **No new tooling.** No script, no gate and no file beyond this plan.

## Grafts

- **Checks that can fail (from the most-robust plan).** Before each edit,
  its check is run and must print hits; after the edit it must print nothing.
  This shows each check is able to fail.
- **No gates at all (from the most-robust plan).** When `verify-loop` finds no
  `## Gates` section, detects nothing from the manifests, and the person names
  no gate, it stops and reports that the project has no gates. Without this, a
  project with no gates could pass by having nothing to fail, which is the
  same failure as a suite that ran zero tests.
- **Frontmatter guard (from the simplest plan).** A plain YAML value cannot
  contain a colon followed by a space, so no edited `description:` line may
  contain one. An em dash in a description becomes a period, a comma or
  parentheses, never a colon.

## Rejected alternatives

- **One commit for every skill's edits (simplest plan).** A mixed diff of
  facts, behavior and punctuation across six files is the hardest to review
  hunk by hunk, which is the spec's only guard against a rewording that
  changes an instruction.
- **A punctuation-only commit for the em dashes (most-robust plan).** Many em
  dashes need their sentence rewritten, so that commit would not be
  punctuation-only, and lines with em dashes inside behavior hunks would be
  edited twice.
- **Fetching and a three-dot diff in `storypr` (most-robust plan).** More
  correct when the local base branch is stale, but it changes the commands
  and not only the branch they name, which the spec does not ask for. It is
  a follow-up.
- **Offering to create a missing `CLAUDE.md` in `verify-loop`, and naming the
  skipped document in `plan-tournament`'s brief (most-robust plan).** Both go
  beyond the spec's list of what changes.
- **Checking key placement by eye (simplest plan).** No gate reads these
  files, so the check has to be mechanical.

## Edits

**README.md.** Delete the sentence about a reviewer that moved to another repository.
Leave the lists of skills and agents to the change that deletes the old
review tools (see `old-review-tools-deleted.md`). Add a `## Project facts`
section: each fact is one `Label: value` line anywhere in the project's
`CLAUDE.md`; the gates and the hard rules are sections under their headings;
a skill refers to a fact's value by its label in lower case inside angle
brackets. Then: this table is the contract; each skill restates the defaults
of the facts it reads, because a skill is loaded alone into another project
where this README is not in view; the skills must agree with this table word
for word, and adding a fact or changing a default changes this table and
every skill its row names. The table is `| Fact | Default | Read by |`, one
row per key, thirteen rows, defaults copied from `implement`, with
`Screenshot directory:` after `Gotchas document:`.

**spec.** Facts: `Spec directory:`. The description says the spec goes in the
project's spec directory. Interview rule 4 reads the specs in
`<spec directory>` and in the spec directory of each sibling worktree. The
output is `<spec directory>/<feature-slug>.md`.

**plan-tournament.** Facts: `Spec directory:`, `Architecture document:`,
`Gotchas document:`. The precondition checks `<spec directory>/<feature>.md`.
The brief includes the architecture and gotchas documents the facts name,
leaving out each one that does not exist. The judge checks the invariants in
the architecture document when there is one. The plan goes to
`<spec directory>/<feature>-plan.md`. The `/lens-review` mention stays for
the change that deletes the old review tools.

**verify-loop.** Facts: the `## Gates` row. Step 1 reads the bullets under the
project's `## Gates` heading, in order; with no such section it detects
candidates from the manifests, confirms them with the person once, and offers
to write them under a `## Gates` heading, one bullet per gate; with nothing
detected and nothing named, it stops and reports that the project has no
gates. The `adopt-project` mention goes. Its own `## Hard rules` heading
becomes `## Rules`, so that the key `## Hard rules` appears only where the
README says. The "Report honestly" bullet is replaced by a `## Report`
section stating the spec's per-gate report, with each gate's counts from its
most recent run and that run's round, the failing tests and exact error for
each failing gate, zero tests as not passed, gates that did not run, and
changed files no gate reads, and that "green" is only the stopping
condition. A test gate that ran zero tests also counts as failed inside the
loop, next to the stopping condition. The stuck report begins with that
per-gate report.
The trigger phrase "make it green" stays.

**pr-comments.** Facts: `## Gates`. Step 5 runs the gates under the `## Gates`
heading of the project's `CLAUDE.md`. The project-specific section becomes
`## When the project requires approvals`, with both lessons: an approval from
one required reviewer is not permission to stop working on another's threads,
and an approval refers to the commit it was written against, so each required
reviewer approves again after fixes are pushed and each reply names the
commit. It says the section does not apply when no reviewers are named. The
reference to the owner's "How to talk to me" section becomes a reference to
the writing rules in the user's `~/.claude/CLAUDE.md`, if it has any. The
`skeptic` references stay for the change that deletes the old review tools.

**storypr.** Facts: `Base branch:`, `Screenshot directory:`. The diffs use
`<base branch>..HEAD`; screenshots are added with
`git add <screenshot directory>/*.png`; the example links and the `gh api`
example use `<screenshot directory>/`; `gh pr create` passes
`--base <base branch>`; the image folder convention points to the fact;
"verify URLs" becomes "check that every image link resolves". The gates item
asks for the gate report as `verify-loop`'s `## Report` section describes it,
so that a story pull request never states a one-word verdict, except that it
never pastes raw error output, which the published description could leak.

**cleanup.** Facts: `Base branch:`. Check 3 says reachable from
`origin/<base branch>`. "A developer's machine" becomes "One machine".

**Pilot mod.** `mods/pilot/README.md`: the link command takes
`<path to this repository>`. `mods/pilot/tests/counsel.test.ts`: the comment
drops the ticket number. `mods/pilot/agents/performance-reviewer.md`: "linear
costs the same to write" becomes "work proportional to the input costs the
same to write".

**Em dashes and words.** Each em dash becomes a period, colon, comma or
parentheses, and the sentence stays complete; never a hyphen. New text avoids
words the case-insensitive grep catches: "develop…", "scenarios", "ratios",
"linear", "URLs", "screw", "thumbnails", "cynical", "universal-", "skim-".

## Step sequence

1. Commit this plan alone.
2. Run every check below and record that it prints hits.
3. README contract. Commit.
4. `spec` and `plan-tournament`. Check: `git grep -n -E 'docs/specs|architecture\.md|gotchas\.md' -- skills/spec skills/plan-tournament` hits before, and afterwards only the facts rows. Commit.
5. `verify-loop`. Check: `adopt-project`, "fake green" and `## Hard rules` hit before. Commit.
6. `pr-comments`. Check: the project name hits before. Commit.
7. `storypr` and `cleanup`. Check: `main\.\.` and `docs/screenshots/` hit before; afterwards `docs/screenshots/` only in the facts row. Commit.
8. The three pilot mod files. Commit.
9. Run every check, then the four gates.

## Test plan

Each item maps to the spec's Verification section.

1. The spec's word grep, exactly as written, prints nothing.
2. The spec's em dash grep, exactly as written, prints nothing.
3. Key placement. For each key, `git grep -l -F "<key>" -- skills README.md`
   lists exactly the README and the skills its Read by cell names:
   `for k in 'Base branch:' 'Spec directory:' 'Architecture document:' 'Gotchas document:' 'Screenshot directory:' 'Issue tracker:' 'Worktree setup:' 'Max pushes per round:' 'Max rounds:' 'Merge command:' 'Checks:' '## Gates' '## Hard rules'; do echo "[$k]"; git grep -l -F "$k" -- skills README.md; done`
4. Defaults agree. For each key, the Default cells across every table print
   one distinct value:
   ``for k in …; do echo "[$k]"; git grep -h -F "| \`$k" -- skills README.md | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}' | sort -u; done``
5. `storypr`: `git grep -n -E 'main\.\.|docs/screenshots/' -- skills/storypr`
   shows only the facts row, and its `gh pr create` passes `--base`.
6. `verify-loop`: `git grep -n -i green -- skills/verify-loop` shows only the
   trigger phrase and the stopping condition; the `## Report` section states
   zero tests as not passed, gates that did not run, and changed files no
   gate reads.
7. `pr-comments`: the approvals section exists and `git grep -n '^## ' -- skills/pr-comments`
   shows no project-specific section.
8. Frontmatter: `head -4 skills/*/SKILL.md` shows no colon followed by a space
   inside any `description:` value.
9. The four gates in `CLAUDE.md`, run in order, with their counts. The report
   says they read none of `skills/` or `README.md`.
10. `git diff --name-only main...HEAD` lists only the six skills,
    `README.md`, the three pilot mod files, the spec and this plan.

## Follow-ups

- The change that deletes the old review tools runs the spec's word and em
  dash greps with nothing excluded.
- `storypr` could fetch the base branch and diff with three dots, so a stale
  local base branch does not mislead it.
