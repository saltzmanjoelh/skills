# Builder chooses which step of the list applies

Written 2026-11-01, from the tracker issue that asks the builder mod to choose
the step of `/implement`'s list that applies while a pull request is open, and
to hand the turn only that step's instructions. The issue is large, so this
spec covers its first part, and the rest is filed as follow-ups (see
Non-goals).

## Goal

While a pull request is open, every turn the mod starts today tells the model
to read the whole nine-step list in "With the pull request open" and pick the
first step that applies. The facts that decide which step applies are ones the
mod already reads: the head, the verdicts, the checks and workflow runs, the
labels, the mergeability, and the push and round counts. The model rereads and
re-derives the same answer on every turn, which costs context on each turn and
sometimes gets the order wrong.

After this change, a tested, pure function in the mod chooses the step from
those facts, and each turn the pull request starts carries the state lines,
the chosen step's name and that step's fixed text. The skill's definitions of
a replaced, an unfinished and a failed workflow run move into that code, with
tests. The skill's list shrinks to a short paragraph saying the mod names the
step and hands its instructions. Every step that needs judgement stays with
the model: the step text tells it what to do, not the mod.

## Users and trigger

A session running `/implement` with the builder mod watching its pull request.
The turns affected are every turn that starts from the pull request's state:

- the change prompt the mod submits when the pull request changes;
- the context the mod adds to the desktop app's continuous integration event;
- the stuck prompt after the session has been quiet;
- the answer of the `mcp__builder__watch` tool;
- the prompt that resumes after a usage limit, while a pull request is watched.

## Behavior

### The facts the chooser reads

The chooser is a pure function in a new file under `mods/builder/hooks/`. It
reads:

- the snapshot, including every workflow run at the head, not only the
  unfinished ones;
- whether a question to the person is open;
- the project's limits (`Max pushes per round:`, `Max rounds:`) and its
  `Checks:` fact, read from the base branch's `CLAUDE.md` with
  `git show origin/<base>:CLAUDE.md`, where the base is the pull request's
  `baseRefName`, which the mod adds to the fields it reads;
- the pull request's `createdAt`, which the mod also adds, so that before the
  first changes-requested verdict the push count is the number of commits
  committed after the pull request was opened, as the skill already says.
  Today the mod reports zero in that case.

### The steps, in order

The chooser takes the first that applies.

1. **Merged.**
2. **Closed without merging.**
3. **An open question** to the person.
4. **Over a limit**, either pushes or rounds, naming which and the counts.
5. **Conflicting.**
6. **A check or a workflow run failed at the head**, naming the failed check
   names and the failed run ids.
7. **Review this head**, whenever no verdict review is at the head. Its text
   says to run a review round's first half unless the focused reviewers
   already ran at this head and found nothing to fix, which the session knows
   from the package tool's answer and its own reviewers' reports, and then the
   second half. The mod never guesses which half is due.
8. **The newest verdict at this head requests changes.**
9. **Both verdicts approve at this head.** This step has four outcomes, which
   the chooser decides in this order:
   - **The runs could not be read** at this look, so the snapshot carries the
     stored runs over: the step says the runs could not be read, that nothing
     may be merged, and to end the turn so the mod looks again.
   - **Waiting on checks**: a check is pending or a run is unfinished. The step
     says to set `ready-to-merge`, say "waiting on checks" and end the turn.
   - **Merge**: at least one check exists and every check passed, or there are
     no checks and the base says `Checks: none`. The step names the merge
     command, the pull request's number and the head, and keeps the guard that
     a worktree holding commits the pull request lacks stops the merge.
   - **Ask whether to merge without checks**: there are no checks and the base
     says `Checks: expected`.

A failed check or run at a head whose verdicts both approve chooses step 6,
because step 6 comes first, which matches the skill's rule that a failure sets
`waiting-on-author` and starts the list again.

### The run definitions in code

The mod reads every run at the head with the fields `id`, `workflow_id`,
`event`, `run_number`, `status`, `conclusion`, `run_attempt` and `name`, and
keeps the unfinished subset where its existing readers need it. The
definitions the skill gives today become functions with tests:

- **A run is unfinished** until its status is `completed`.
- **A completed run failed** when its conclusion is anything other than
  success, skipped or neutral.
- **A check passed** when it succeeded, or was skipped or neutral.
- **A run is replaced**, and stops counting, when a run of the same
  `workflow_id`, started by the same `event`, with a higher `run_number`, has
  not completed or did real work. A completed run did real work when its
  conclusion is not `skipped` and at least one of its jobs ended other than
  `skipped`. An empty jobs list, or a jobs read that fails, means it did no
  real work. A run that did no real work replaces nothing and counts by its own
  conclusion.

The mod reads a run's jobs only for a completed run that has an older run of
the same workflow and event, and at most once for each run id and attempt, so
a head with one run per workflow and event reads no jobs.

### What a turn carries

Every turn listed under "Users and trigger" carries the state lines, the
chosen step's name and the step's full text, on every turn, whatever the
previous turn carried. The step texts are fixed strings in the mod. The only
values put into them are checked ones: shas, numbers and run ids. Names that
come from GitHub, such as check and label names, stay in the quoted state
lines. The reload line after a compaction stays as it is.

### The skill

The list in "With the pull request open" is replaced by a short paragraph
saying the mod names the step and hands its instructions, and that the model
follows them. "When a turn ends" stays, telling the model to call
`mcp__builder__watch` and follow the step it names. The run definitions and
their worked example leave the skill. The shared sections that step texts
point to stay: "A review round", "Commits the pull request lacks", "State
labels", "Updating the linked checkout" and "Questions". The merge step's text
does not depend on any shared section.

## Edge cases

- **The runs read fails.** The snapshot carries the stored runs over, and the
  chooser holds at step 9. The recovery must wake the session: whether the
  runs were carried over becomes part of the fingerprint, so a successful read
  after a failed one is news and starts a turn.
- **The mergeability is unknown.** It holds nothing. The merge command with
  `--match-head-commit` refuses a conflicting pull request anyway.
- **The base `CLAUDE.md` cannot be read.** The limits take their defaults. The
  `Checks:` fact leans to `expected`, so a project that needs checks is never
  merged as if it had none. The merge step tells the model to read the
  `Merge command:` line from the base itself, and never to merge around a
  project's own gate with the default command.
- **The worked example of runs #40, #41 and #42** from the skill: #40 is
  cancelled before its jobs start, #41 from the same workflow and event skipped
  every job. #40 still counts as failed and #41 as passed. When #42 runs and
  passes, it replaces both. While #42 is unfinished, the step waits.
- **Runs of one workflow from different events** do not replace each other.
- **A run whose jobs read fails** did no real work.

## Non-goals

- The mod setting the state labels. The step texts still tell the model to.
- The mod reporting the stage bar. The step texts still tell the model to.
- The mod listing the commits the pull request lacks.
- The mod updating the linked checkout after a merge.
- Telling apart which half of a review round is due.
- Holding on a mergeability of unknown.
- Leaving out a step's text that an earlier turn carried.
- Any use of `$.llm`, and any change to the foreman mod.

The first four are filed as follow-up issues, each to merge on its own.

## Failure modes

- A failed read of the runs holds the merge and says so, and the next good read
  wakes the session.
- A failed read of the base `CLAUDE.md` gives the defaults above, never a
  looser rule than the project's own.
- A failed jobs read counts the run as having done no real work, which keeps
  the older run counting, the safe direction.

## Verification

- A table of tests pins which step the chooser picks for each state: merged,
  closed, an open question, over the push limit, over the round limit,
  conflicting, a failed check, a failed run, no verdict review, changes
  requested, and the four outcomes of step 9, including no checks with each
  `Checks:` value and runs that could not be read.
- Tests for the run definitions, including the #40, #41 and #42 example and
  runs from different events.
- Tests that the jobs are read only when a replacement is in question.
- Tests that each step text holds its essentials, such as the merge command
  with `--match-head-commit`, the number and the head in the merge step.
- A test that every `SKILL.md` section heading a step text names still exists
  in `SKILL.md`.
- A test that a successful runs read after a failed one changes the
  fingerprint.
- Tests that each of the turns under "Users and trigger" carries the step's
  name and text.
- The push count before the first changes-requested verdict counts commits
  after `createdAt`.

## Decided by the counsel

- The issue is large. Which part should this run deliver as its pull request, with the rest filed as follow-up issues that each merge on their own? The counsel chose: Part 1 only: a tested function in the builder mod that chooses which step of /implement's list applies from the pull request's state, with the definitions of a replaced, unfinished and failed workflow run moved into it (which needs the mod to read each run's workflow, event, run number and conclusion, and the jobs only when a replacement is in question); the turns the pull request starts carry only that step's instructions; the skill's list and run definitions are trimmed to match. Labels, the stage bar, the commits the pull request lacks and the linked checkout update are filed as follow-ups. 7 of 7 members voted for it.
- Once builder chooses the step, where do that step's instructions live, and what does the turn carry? The counsel chose: The instructions of each step in the list move out of the skill into the mod, as one tested text per step; the turn the pull request starts carries the state lines, the chosen step's name and that step's text; the skill's list shrinks to a short paragraph saying builder names the step and gives its instructions, and keeps the shared sections the step texts point to (A review round, Commits the pull request lacks, State labels, Updating the linked checkout, Questions). 7 of 7 members voted for it.
- At a head with no verdict review, the list has two steps: "The focused reviewers have not run at this head" (run a review round's first half) and "No verdict review at this head" (run the second half). Should builder tell those two apart itself, or hand the model one review step that says how to tell? The counsel chose: One review step: builder chooses "review this head" whenever no verdict review is at the head, and its text says to run the first half unless the focused reviewers already ran at this head and found nothing to fix (which the session knows from the package tool's answer and its own reviewers' reports), and then the second half. Builder never guesses which half is due. 7 of 7 members voted for it.
- What should builder choose when a fact the step depends on could not be read at the latest look? The counsel chose: Hold only on unread runs: when the workflow runs read failed at this look (the snapshot carries the runs over from the stored one), builder chooses a step that says the runs could not be read, that nothing may be merged, and to end the turn so the mod looks again; a mergeability of UNKNOWN does not hold anything, because the merge command with --match-head-commit refuses a conflicting pull request anyway; a base CLAUDE.md that cannot be read gives the facts their defaults. 6 of 7 members voted for it.
- Should every turn the pull request starts carry the chosen step's full text, or only when the step changed since the mod last handed one? The counsel chose: Every turn carries the full text of the chosen step, whatever the previous turn carried. 6 of 7 members voted for it.
