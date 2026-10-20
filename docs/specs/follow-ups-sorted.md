# Follow-ups are fixed, dropped or filed once

Written 2026-10-14.

## Goal

An `/implement` pull request leaves behind at most one follow-up issue, and
that issue holds only problems a person could actually run into. Cheap
follow-ups are fixed inside the pull request, and follow-ups that nobody
would notice, or that nobody has seen happen, are dropped with a short
record on the pull request.

## Users and trigger

Every `/implement` session, at the point where reviews raise follow-ups and
at the **Merged** step, and the person who reads the issue tracker
afterwards. The trigger: four runs (the ones behind
`old-review-tools-deleted.md`, `implement-runs-unattended.md`,
`pilot-handover-ordering.md` and `pilot-checks-and-runs.md`) merged and
filed 27 issues, and the owner labelled about twenty of them `not-worthy`,
because they were wording in specs and comments, tests that could be
stronger, code structure, and problems nobody had seen happen. The cause is
in `skills/implement/SKILL.md`: the verdict reviewers class every
non-blocking finding as `FOLLOW-UP:` (from round 3, almost every finding), a
speculative finding also becomes a follow-up, and the **Merged** step files
one issue "for each `FOLLOW-UP:` in the reviews". Nothing asks whether a
follow-up is worth doing, and nothing groups them.

## Behavior

### The reviewers say what a person would see

`pilot:spec-reviewer` and `pilot:adversarial-reviewer`, the only agents that
write `FOLLOW-UP:`, end every `FOLLOW-UP:` finding with
`If never fixed: <what a person would see>`, or `If never fixed: nothing
visible`. "A person" means whoever uses what the pull request ships: a
person running a skill, a session following it, or someone reading its
output. The four focused reviewers do not change, because their findings
are either fixed or dropped and never become follow-ups.

### The session sorts every follow-up into one of three kinds

The sort happens in each review round's second half, after the claim
checker and before the review is posted, for every follow-up of that round.

- **Cheap.** Wording in specs, plans, comments and the README, rewrapping,
  renames, and small test tightening. The session fixes it in the pull
  request.
- **Dropped.** A follow-up that is speculative (the claim checker answered
  speculative, or could not confirm it), or that the reviewer marked
  `nothing visible` and that is not cheap. The session does not change code
  for it and does not file it.
- **To file.** A follow-up that describes something a person could run
  into (a wrong result, a stall, a misleading message, lost work) and that
  is too large to fix in this pull request. A visible problem that is small
  enough to fix is fixed in the pull request instead, and goes through a
  normal round like any other change.

The step "A speculative finding becomes a follow-up, never a code change"
in the first half becomes "a speculative finding is dropped and listed as
dropped, never a code change".

### How cheap fixes reach the merge

- In a round that requests changes, the cheap fixes ride along in the push
  that fixes the blocking findings, and the next round reviews them.
- In a round where both verdicts approve, the session fixes the cheap
  follow-ups, commits them, and always posts the round's review at the
  approved head first, so the round's record survives whatever happens
  next. It then checks the diff from the approved head to its new commit.
  When every changed line is inert (defined below), it pushes and posts a
  short review at the new head with both verdicts carried over, saying
  which head the reviewers read and listing each commit and file since
  then. The **Merged** step's list then counts both halves as run at that
  head, in the same way a head that only merged the base in counts the
  focused reviewers as run. When that short review is refused because the
  head moved, or is never posted, the new head goes through a normal
  round.
- When any changed line is not inert, the session pushes the fixes after
  posting, and the new head goes through a normal round.

A changed line is **inert** when it is one of these:

- a line in a Markdown file under the project's spec directory (its specs
  and plans), or in `README.md` at the repository's root, where the spec
  directory is read from the base branch so that a pull request cannot
  widen it;
- a whole-line comment in a code file, which is a line that, after its
  indentation, begins with `//` in JavaScript, TypeScript or Swift, or with
  `#` in Python, shell or YAML.

These are never inert:

- block comments (`/*`, `*` and `*/` lines), because a `/*` line above
  unchanged code and a `*/` line below it would switch that code off;
- a comment that shares a line with code, and text inside a string, a
  heredoc, a template literal or a YAML block scalar;
- a comment directly after a line that ends in a backslash, because the
  shell joins the two lines and the comment swallows the rest of the
  command;
- a comment that instructs a tool, such as `#!`, `@ts-`, `eslint-`,
  `/// <reference`, `# type:`, `# noqa`, `swiftlint:` or a coding line;
- every line of a file that Claude Code loads as instructions (skills,
  agents, commands, plugins and mods), comments included, because a model
  reads those as instructions, so rewording them can change what a session
  does;
- a Markdown line that a gate, a test, a build or another tool in the
  project reads, includes or runs, such as a fenced code block that a
  doctest runs, and any Markdown line the session cannot be sure no tool
  reads that way, as the counsel's decision requires;
- a file that is added, deleted or renamed, a change of file mode, and a
  binary file, because the whole file is new, gone, moved or not text,
  whatever its lines say.

### The review records the sort

Each verdict review's body has a section headed **Follow-ups** with three
short lists: fixed (each with its commit), dropped (each with one sentence
on why), and to file (each with one sentence on what a person would see).
The last review posted before the merge repeats the dropped and to-file
lists of every earlier round, so the pull request's record of what was
dropped is in one place.

### The Merged step files at most one issue

The **Merged** step reads the to-file list from the last review. When it is
empty, nothing is filed. Otherwise the step files one issue, titled
`Follow-ups from <owner>/<name>#<n>`, that links the pull request and holds
every item, each in one sentence saying what a person would see. Before
filing, it searches the issue tracker for that exact title and files
nothing when an issue has it, so a resumed session never files a second.

### The hard rule no longer names the clean-up issues

The hard rule in the root `CLAUDE.md` loses its first sentence, which said
that some files name a project today and that two issues, the ones behind
`old-review-tools-deleted.md` and `generic-skills.md`, were cleaning them
up, because both issues have merged. The second sentence, that a reviewer
applies the rules to the text a pull request adds or changes, stays.

### storypr fetches the base and diffs with three dots

`storypr` first runs `git fetch origin <base branch>`, then reads the log
with `git log --oneline origin/<base branch>..HEAD` and both diffs with
three dots, `git diff --stat origin/<base branch>...HEAD` and
`git diff origin/<base branch>...HEAD`. A stale local base branch then
neither hides commits nor shows the base's own new commits as the branch's.

## Edge cases

- **An earlier review has no Follow-ups section,** because a session that
  predates this change posted it: the next review sorts its `FOLLOW-UP:`
  lines with its own, so they reach the record.
- **The last verdict review has no Follow-ups section,** because a session
  that predates this change posted it: the **Merged** step files nothing
  and the report names that review as the place the follow-ups are.
- **A line that looks like a comment sits inside a string,** a heredoc or a
  template literal: `git diff --unified=0` shows it without its
  surroundings, so the session reads it in the file with the lines around
  it, and a line it cannot place for certain is not inert.

- **A follow-up with no `If never fixed:` part,** from an older reviewer or
  a reviewer that forgot it: the session treats it as `nothing visible`
  unless the finding itself plainly describes a visible failure.
- **A cheap fix that turns out to need a code change:** it is no longer
  cheap, and it goes through a normal round.
- **Limits:** a review posted at a new head counts as a round in the mod,
  and a cheap-fix commit counts as a push. When fixing cheap follow-ups
  would take the pull request past `Max rounds` or `Max pushes per round`,
  and nothing else needs a push, the session drops them instead and lists
  them as dropped, even when every line is inert.
- **No issue tracker:** when the project names no issue tracker and the
  session has none connected, nothing is filed, and the report says the
  to-file list is in the last review.
- **The search for the follow-up issue fails:** the session files nothing
  and says so, because filing twice is the failure this spec exists to stop.
- **The pull request merges while the worktree holds unpushed cheap
  fixes,** for example when a person merges by hand before step 8 pushes
  them: the **Merged** step does not run `/cleanup`, and the report names
  the commits so they are not deleted, and files the `To file:` items of
  a cheap-fix commit among them.
- **The check for unpushed commits fails,** because someone else moved
  the pull request's head and the worktree lacks it, or a git command
  errs: the session fetches the head first, and when a command still
  fails it assumes unpushed commits exist, sets `stuck` and never runs
  `/cleanup`.
- **The push of cheap fixes fails** after the review was posted at the
  reviewed head: the session sets `stuck` and asks the person, and the
  merge step checks the worktree for commits the pull request lacks and
  pushes them instead of merging, because the review lists them as fixed.
- **The session stops between committing the cheap fixes and posting the
  review:** the commit's message holds the round's sorted lists, so the
  resumed session, which pushes the commit, carries them into the next
  review. When the pull request merges before that review, the **Merged**
  step takes the commit's `To file:` items into the list it files.
- **The carried-over review is refused** because the head moved again: the
  list starts again from **Merged**, and the new head goes through a
  normal round.

## Non-goals

- No change to the pilot mod's code. `post_review` already takes any body,
  and nothing in the mod parses `FOLLOW-UP:`.
- No change to which findings block, or to the rule for rounds.
- No change to the four focused reviewers.
- The difference between the spec reviewer's and the adversarial
  reviewer's wording about which rounds use `FOLLOW-UP:` is left as it is.

## Failure modes

- A session that misjudges a follow-up as cheap when it is not costs at
  most one extra round, because only inert lines skip review.
- A session that misjudges a visible problem as `nothing visible` drops a
  real problem, but the drop is listed on the pull request, so a person
  reading it can file it by hand.

## Verification

No gate reads `skills/` or `docs/`, so the reviewers check these by
reading. The pilot mod's gates still run, because the agent files live in
the mod.

- `skills/implement/SKILL.md`: the **Merged** step files at most one issue
  from the last review's to-file list; the first half drops speculative
  findings; the second half sorts follow-ups and states the inert rule and
  the carried-over review; step 6 and step 7 name the carried-over head.
- `mods/pilot/agents/spec-reviewer.md` and
  `mods/pilot/agents/adversarial-reviewer.md`: the finding format has the
  `If never fixed:` part for a `FOLLOW-UP:`.
- `CLAUDE.md` no longer names the two clean-up issues.
- `skills/storypr/SKILL.md` fetches the base and diffs with three dots.
- `grep -rn "for each \`FOLLOW-UP:\`" skills mods` finds nothing.

## Decided by the counsel

- When the session fixes cheap follow-ups (wording in specs, plans, comments and the README, rewrapping, renames, small test tightening) after both verdict reviewers have approved a head, the head moves and the merge step requires both verdicts to approve at the head. How should a head that only adds such fixes reach the merge? The counsel chose The approval carries over only when every changed line since the approved head is checkably inert: lines in Markdown files that no gate or tool reads as instructions to execute, or comment lines in code; anything else (renames, test tightening, any code line) goes through a normal round like any other push., 6 of 6.
