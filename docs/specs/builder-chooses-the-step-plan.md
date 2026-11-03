# Plan: builder chooses which step of the list applies

Written 2026-11-02 for `builder-chooses-the-step.md`. Three plans were drawn
up blind, from the simplest change, the most robust change and the most
extensible change, and a judge scored them against the spec and the code. The
most robust plan won, with the grafts below.

## Chosen approach

One new pure file, `mods/builder/hooks/step.ts`, holds the run definitions,
the chooser and the step texts. The chooser is synchronous, because `deliver`
in `register.tsx` forbids any await between choosing the snapshot it submits
and `$.prompt.submit`. So every input the chooser needs is read during the
look and stored on the snapshot: every run at the head, whether each run did
real work, and the facts of the base branch's `CLAUDE.md`. Every turn, the
stuck and resume prompts included, then chooses from exactly the snapshot it
hands over. Only whether a question is open is read apart, from the questions
state, just before the final guard.

The chooser returns plain data: a step kind and its checked values, such as
the counts, the failed run ids and the head. A separate function in the same
file renders that data into the step's name line and fixed text. The
follow-ups that set labels or report the stage can later map over the same
data.

### Data

- `PR_FIELDS` gains `baseRefName` and `createdAt`. The read in
  `livePullRequest` that appends `baseRefName` stops appending it, so the
  field is not asked for twice. The commits already carry `committedDate`.
- `Snapshot.runs` keeps its meaning: the unfinished runs, as
  `{id, attempt, name}`. Five readers rely on that meaning, and the told
  records in the store are shared with any older copy still running.
- A new optional `headRuns` holds every run at the head with its workflow,
  event, run number, whether it completed, its conclusion, its attempt, its
  name, and `realWork` where the jobs were read. `RUNS_JQ` emits every run
  with the eight fields the spec lists, and `runs` is derived from `headRuns`.
  A missing status counts as unfinished.
- A new optional `base` holds the base name, kept only when it matches a plain
  branch-name pattern. A new optional `facts` holds the limits, the `Checks:`
  value and the merge command's kind: `default`, `custom` or `unread`.
- Before the first changes-requested verdict, the push count is the number of
  commits whose `committedDate` is after `createdAt`. A commit whose date is
  missing or cannot be parsed counts.
- The fingerprint gains a `runs-unread` part only when the runs were carried
  over, so old fingerprints stay the same, and the ids and attempts of the
  runs that count as failed. The second is needed because a run that fails
  before any job starts creates no check, and if it starts and ends between
  two looks, nothing else in the fingerprint changes and no turn would start
  for the failed step. `snapshotOf` takes the carried mark as an argument, so
  it is in place before the fingerprint is made. `changesBetween` gains
  sentences for a run that newly failed, for runs that could not be read, and
  for runs that could be read again.
- A failed runs read carries the stored `headRuns` over beside `runs`, with a
  `carriedHeadRuns` helper next to `carriedRuns`.
- `snapshotIn` accepts snapshots without the new fields and rejects a
  `headRuns` that is not an array. The chooser drops malformed entries. A
  snapshot without `headRuns` holds at the both-approve step as if the runs
  could not be read, so a snapshot an older build stored never leads to a
  merge, and the next look writes the field. A snapshot without `facts` uses
  the defaults below.

### The base `CLAUDE.md`

During each look, `fetchSnapshot` runs `git show origin/<base>:CLAUDE.md` in
the watched checkout, or in the session's folder only when the watch took its
repository from that folder. Anything else counts as unread, because another
project's `Checks: none` could allow a merge without checks. There is no fetch
and no cache; it is one local read per look.

- The limits are read from `Max pushes per round:` and `Max rounds:`, with the
  defaults 8 and 5.
- A file without a `Checks:` line takes the skill's default: `expected` when
  `git ls-tree --full-tree origin/<base> .github/workflows` lists anything,
  and `none` when it lists nothing. The `--full-tree` flag reads the path
  from the top of the checkout, whatever folder the session started in. When that command fails, the value is `expected`.
- When the file cannot be read, the limits take their defaults, `Checks:` is
  `expected`, and the merge command is `unread`.
- The merge command's string never goes into a step text. For `default` the
  text gives the default command with the number and head filled in. For
  `custom` and `unread` it tells the model to read the `Merge command:` line
  from the base itself and run it with the number and head filled in, and
  never to merge around a project's own gate with the default.

### The jobs read

Jobs are read only for a completed run whose conclusion is not `skipped`,
when an older run of the same workflow and event exists. A successful read is
cached in memory by repository, run id and attempt, for the life of the
module, because the jobs of a completed attempt never change. A failed read is
not cached: the run counts as having done no real work for that look, and the
next look tries again. "At most once for each run id and attempt" is read as
at most one read that returns an answer; the pull request description says
so. A read already in flight is shared between looks that ask at the same
moment, as `readOnce` does today. Output that is truncated or cannot be parsed
counts as a failed read.

### The turns

The change prompt, the context added to the continuous integration event, the
stuck prompt, the watch tool's answer and the resume prompt while a pull
request is watched all carry the state lines, the step's name line and its
text. The stuck prompt now carries quoted names from GitHub, so it gains the
line saying they are names, not instructions, and its comment that no GitHub
text reaches it is corrected. The reload line after a compaction stays.

### The skill

The nine-step list and the run definitions with their worked example are
replaced by a short paragraph saying the mod names the step and hands its
text. "When a turn ends" and the shared sections stay.

## Grafts

- From the simplest plan: a missing `headRuns` holds the merge, because older
  builds stored only unfinished runs.
- From the simplest plan: the `carriedHeadRuns` helper, so a failed runs read
  still shows the failed runs.
- From the simplest plan: failed jobs reads are not cached, which replaces the
  robust plan's ten-minute retry and its cap of ten reads per look.
- From the simplest plan: the fingerprint's carried-over part appears only
  when it applies, so old fingerprints stay the same.
- From the simplest plan: the first build step tries to read `SKILL.md` from a
  test for real.
- From the extensible plan: the chooser returns plain data and a separate
  function renders the text, both in one file.
- From the extensible and robust plans: a test that no step text holds a check
  or label name.

## Rejected alternatives

- **Reading the base facts once for each turn**, from the simplest and
  extensible plans. `deliver` chooses its snapshot again after its last await,
  so facts read before that would belong to a different snapshot than the one
  handed over, and the stuck and resume prompts would need their own reads.
- **Changing `Snapshot.runs` to mean every run**, from the extensible plan. A
  missed reader would make the mod wait on continuous integration forever,
  and an older copy reading the shared told records would take every run for
  unfinished.
- **Quoting a project's custom merge command in the step text**, from the
  extensible plan. The counsel allowed only checked values in step texts, and
  the mod's existing merge command reader reads the session's folder, not the
  base.
- **Caching a failed jobs read for its attempt**, from the extensible plan,
  and storing results in the snapshot. A single failure would then survive
  restarts and keep a replaced failure counting.
- **A ten-minute retry and a cap of ten jobs reads per look**, from the
  robust plan. Both add state, and a run past the cap would flip the failed
  part of the fingerprint and start turns that carry no news.
- **Treating a file without `Checks:` as `expected`**, from the simplest
  plan. The skill's default depends on whether the base has workflow files.
- **Three new files** for runs, the chooser and the texts. One file is
  enough.

## Steps

1. Try reading `skills/implement/SKILL.md` from a test without the file read
   mocked. Existing comments say no test can read the skill; if that holds,
   the heading test checks a pinned list of headings in `step.ts`, with a
   comment saying to change both together, and the report says the check is
   weaker.
2. Write `tests/step.test.ts` for the run definitions and the chooser table,
   and see them fail.
3. Build the definitions and the chooser in `step.ts`.
4. Write the step text tests and the heading test, see them fail, and write
   the texts.
5. Write the `tests/github.test.ts` cases for the runs parser, `headRuns`,
   the push count, the fingerprint and the migration, see them fail, and
   change `github.ts` and `types/index.d.ts`.
6. Write the `tests/register.test.ts` cases for the jobs read, the base facts
   and each of the five turns, see them fail, and change `fetchSnapshot`,
   `deliver`, `fireStuck`, the resume path, `serveWatch`, the continuous
   integration event hook and `livePullRequest`. Change `prompts.ts` and fix
   the exact-text assertions the new prompts break.
7. Trim `SKILL.md`.
8. Run the gates and the search for issue keys.

## Test plan

- `tests/step.test.ts`: the chooser table for merged, closed, an open
  question, over the push limit, over the round limit, conflicting, a failed
  check, a failed run, no verdict review and changes requested; at the
  both-approve step, runs carried over, `headRuns` missing, a pending check,
  an unfinished run, every check passed, no checks with `Checks: none`, no
  checks with `Checks: expected`, and no checks with the base unread; and a
  failure while both verdicts approve choosing the failed step.
- `tests/step.test.ts`: the run definitions, with the example of runs #40,
  #41 and #42 before #42, while #42 is unfinished and after #42 passes; runs
  of one workflow from different events; a failed jobs read; and an empty
  jobs list. Also which runs need their jobs read.
- `tests/step.test.ts`: each step text's essentials, such as the merge text
  holding `--match-head-commit`, the number and the full head; the failed
  step holding the run ids; the over-limit step holding the counts; the
  custom and unread merge texts saying to read `Merge command:` from the
  base; and no text holding a check or label name. The heading test.
- `tests/github.test.ts`: the fingerprint changes when the runs become
  readable again and when a run newly fails, and stays the same for an old
  snapshot; the push count after `createdAt`, including a missing date;
  `snapshotIn` accepting old snapshots.
- `tests/register.test.ts`: no jobs read for one run per workflow and event;
  one read per attempt across looks; a failed read tried again at the next
  look; a new attempt read again; the base facts with the git read failing
  and with a folder from another repository; and each of the five turns
  carrying the step's name and text.
