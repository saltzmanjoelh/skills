# Plan: follow-ups to the frontend screenshot rules

Date: 2026-11-05. Spec: `docs/specs/frontend-screenshot-rules-follow-ups.md`.

## How this plan was chosen

Three planners wrote plans without seeing each other's work. One aimed for the
smallest change, one for the most robust change, and one for the change that
makes the next steps cheapest. A judge compared them against the spec, the
code and the owner's preferences. The robust plan won, and this plan is that
plan with five ideas taken from the other two.

## Chosen approach

Move the two frontend passages of `skills/implement/SKILL.md` word for word
into `skills/implement/frontend.md`. A short preface at the top of the new file
makes the moved cross-references resolve, so the moved text itself needs no
rewording. `SKILL.md` keeps the facts row, the rule that an empty
`Frontend paths:` line counts as missing, and five pointers that say when to
read the new file. The edits of the spec's points 3 to 5 and 7 are made inside
the new file, point 6 is made in the caller section of
`skills/storypr/SKILL.md`, and point 2 adds one static bullet to `mergeLines`
in `mods/builder/hooks/step.ts`.

The mod keeps no new state. The only new durable record is the `Screenshots:`
line in commit messages, which git keeps, so a restart, a resumed or cleared
session, a compaction or a hot reload loses nothing. Two sessions writing at
once are already covered by the existing rule to read the body again just
before posting it.

## What each file gets

**`skills/implement/frontend.md` (new).**

- A preface, which is new text: read this file only when the base branch's
  `CLAUDE.md` names at least one glob under `Frontend paths:`. Steps, points
  and sections named here are those of `SKILL.md` beside this file. "The
  paragraph above" in the first section means step 7's paragraph that opens
  the pull request. Run every git command below from the worktree's top
  folder.
- `## A frontend change`, holding the current step 7 passage unchanged,
  including its bold run-in label.
- `## Screenshots on a frontend pull request`, holding the current section
  with these edits:
  - **The retake rule** asks every capturing commit to carry, after a blank
    line and outside the round's lists, `Screenshots: <path>, <path>`, naming
    every screenshot it captured, including identical ones. When nothing else
    is staged, the commit is made with `git commit --allow-empty`.
  - **The list rule** becomes the union of two sources: the paths on lines
    that begin with `Screenshots:` in `git log --format=%B origin/<base>..<head>`,
    split at commas and trimmed, and the files that
    `git log --no-renames --diff-filter=AM --name-only --format= origin/<base>..<head> -- '<screenshot directory>'`
    prints. A path is kept only when it appears word for word in
    `git ls-tree --full-tree -r --name-only <head> -- '<screenshot directory>'`.
    The rule says why the second source stays: it covers pull requests opened
    before the lines existed, and screenshots committed without the line. It
    says that a `Screenshots not retaken:` line is not a `Screenshots:` line,
    that a name from a message is only compared and never put in a command,
    and what `<head>` is in each use.
  - **The link rule** says "the newest commit that changed its file" instead
    of "the newest commit on the pull request that changed its file", and adds
    that for a screenshot the pull request never changed, this is a commit on
    the base branch, which holds the file, so the link resolves.
  - **The settled rule:** a listed commit is settled when every screenshot its
    line names appears word for word on a `Screenshots:` line in
    `git log --format=%B <listed sha>..<head>`, or in the output of
    `git log --no-renames --name-only --format= <listed sha>..<head> -- '<screenshot directory>'`.
    No name from a message reaches a command. A line for screens never
    captured is still never settled.
  - **The inert sentence** also covers a commit whose only screenshot record
    is a `Screenshots:` line, because such a commit changes the screenshot
    list.

**`skills/implement/SKILL.md`.** The facts row stays. Step 7's opening keeps
the empty-line rule and points at the section **A frontend change** of
`skills/implement/frontend.md`, in this skill's folder. The passage itself is
deleted. The screenshot section keeps its bold label as a pointer paragraph
that states the condition and names every moment: before making a commit,
after a push, on resuming, after a compaction and before running the merge
command. "When a turn ends", "Resuming" and "After a compaction" each gain the
condition and the file. About 1,300 words leave the file.

**`skills/storypr/SKILL.md`, caller section only.** Point 2 adds the
`Screenshots:` line and the empty commit for identical captures. The closing
paragraph adds that when every screenshot failed point 1's check, or none
could be kept, it commits nothing, writes no body, and returns a reason.

**`mods/builder/hooks/step.ts`.** One bullet is added to `mergeLines`, after
the fetch bullet and before "Read the pull request again". It applies to a
pull request whose body has a `## Screenshots` section and whose fetched base
branch's `CLAUDE.md` names a `Frontend paths:` glob. It says to read
`skills/implement/frontend.md`, in the /implement skill's folder, again, and
to bring the screenshot section up to date first. It ends by saying that a
pull request without such a section skips the bullet. Its wording avoids the
form `"<name>" in /implement` and any "point N" phrase, because the pinning
tests in `tests/step.test.ts` would require those names in `SKILL.md`.

## Ideas taken from the other plans

- **The settled rule, from the extensible plan.** It compares names against
  the commits' file lists instead of running `git log -- '<path>'` with a path
  from a message, so message text never reaches a command, and a later
  deletion also settles the line.
- **The link-rule edit, from the simplest plan.** Without it, the sentence
  about "the newest commit on the pull request" becomes false for an
  unchanged screenshot, and point 4 is not met.
- **The test setup, from the simplest and extensible plans.** The test copies
  the setup of the neighbouring test that already renders both the merge step
  and the ask-merge step.
- **The position check, from the extensible plan.** The test asserts that the
  bullet comes after "Before merging:" as well as before the reread bullet,
  so a missing bullet fails instead of passing on an index of -1.
- **Naming the file.** The text names `skills/implement/frontend.md`, as the
  spec does, and adds "in this skill's folder", as the robust plan does, so the
  path resolves in another project too.

## Rejected alternatives

- **An exported constant of frontend sections, a helper and a new pinning
  test**, from the extensible plan. The spec allows one mod line only, and one
  pointed-at section does not need a pinning list.
- **Editing the comment over `SKILL_SECTIONS`**, from the robust plan, for the
  same reason.
- **Settling with `git log -- '<path>'` on a path from a message**, from the
  simplest and robust plans, because it puts message text into a command.
- **Running `ls-tree` "from the root" alone, without `--full-tree`**, because
  a session in a subfolder would match nothing.
- **Dropping the bold run-in label of the moved passage**, because the spec
  forbids rewording the moved text.

## Steps

1. Add the test to `mods/builder/tests/register.test.ts`, run the first gate
   and then `claude plugin test .` from `mods/builder`, and see it fail.
2. Add the bullet to `mergeLines`, and see the test pass. Commit.
3. Create `skills/implement/frontend.md` with the moved passages and the
   edits, and replace them in `SKILL.md` with the pointers. Commit.
4. Edit the caller section of `skills/storypr/SKILL.md`. Commit.
5. Run all four gates through `/verify-loop`.

## Test plan

- **The mod.** One test after "a base CLAUDE.md without a Checks: line asks
  whether the base has workflow files" renders the merge step and the
  ask-merge step with the same fakes. For each text, it asserts that the
  bullet is present, names `skills/implement/frontend.md` and
  `` `## Screenshots` ``, says a pull request without the section skips it,
  and sits after "Before merging:" and before "- Read the pull request again
  with". The four gates must pass, including the pinning tests in
  `tests/step.test.ts`.
- **The skills,** which no gate reads, are checked by reading the diff:
  - The moved passages match the removed lines word for word, apart from the
    preface and the edits above.
  - Each of the five pointers states the condition, and the screenshot
    pointer names all five moments.
  - `wc -w` shows `SKILL.md` about 1,300 words shorter.
  - The other sections of `/storypr` show no change.
- **Names.** The issue-key search of `.claude/rules/no-project-names.md` runs
  on every staged change.
