# Plan: the pilot mod reads reruns and workflow runs correctly from GitHub

Spec: `docs/specs/pilot-checks-and-runs.md` (SAL-245). Written 2026-10-12.

## Chosen approach

Three planners wrote blind plans from the simplest, the most robust and the
most extensible priors, and a judge scored them against the spec. The simplest
plan won (8 of 10, against 7.5 and 7): it covers every Behavior point, keeps
almost all the change in pure code in `mods/pilot/hooks/github.ts`, and leaves
`lookAt` and `watch` untouched. Five ideas from the runners-up are grafted on.

In outline:

- `newestRuns` in `github.ts` is exported, and `ciOf`, the fingerprint's check
  part and a new shared `failedCheckNames(checks)` read each name's newest run.
  `prompts.ts` and `pane.tsx` take their failed lists from `failedCheckNames`.
- `newestCompletions` replaces its pick on `<=`, and `checkSentences` writes
  its "again" list as one `const`.
- The snapshot gains two optional fields, `runs?: WorkflowRun[]` (each run's
  `id`, `attempt` and cleaned `name`) and `runsCarriedOver?: true`. A value an
  older build stored has neither, and every reader writes `s.runs ?? []`.
- `github.ts` gains `RUNS_JQ`, a parser `runsOf(out)` that answers `null` for
  output it cannot read, a pure `carriedRuns(stored, repo, number, head)`, and
  a fourth `snapshotOf` parameter, `runs = []`. The fingerprint appends each
  run as `id.attempt`. `changesBetween` adds the run sentences.
- `fetchSnapshot` in `register.tsx` makes the second `gh` call after
  `gh pr view`, with the head that call returned. When the read fails it reads
  the `pr` state at that moment and carries runs through `carriedRuns`, and it
  sets `runsCarriedOver` after the fingerprint is computed, so the mark stays
  out of the fingerprint.
- `waitingOn` checks a failed check first, then a pending check or an
  unfinished run, which answer `ci`.

## Grafts

1. **The parser removes duplicate runs by id and keeps the highest attempt**
   (from the robust and extensible plans). `--paginate` fetches page by page,
   so a run queued while it pages can be listed twice in one read and once in
   the next, which would start a turn with nothing in it.
2. **The runs read is wrapped in `try`/`catch`, and truncated output counts as
   a failed read** (from the robust plan). The spec says a failure for any
   reason lets the look carry on, and the `git` helper in `register.tsx`
   already treats `isStdoutTruncated` as unusable output.
3. **`snapshotIn` rejects a `runs` field that is present but not an array**
   (from the extensible plan). Every reader writes `s.runs ?? []`, so such a
   value would otherwise throw in the middle of a look, which is what
   `snapshotIn` exists to prevent; a missing field still passes.
4. **README line 44, "Every look runs one `gh pr view`", is corrected** (from
   the extensible plan), because each look now also reads the workflow runs.
5. **The carry-over rule is the pure function `carriedRuns`** (from the robust
   plan), so the same repository, number and head rule is tested directly in
   `github.test.ts`, and the register tests only show it is wired in.

Also taken, as small extras: a missing `run_attempt` reads as 1 (one line),
and two of the robust plan's register tests: failed reads followed by a good
read give exactly one "finished" prompt, and the runs call uses the head from
`gh pr view`, not the local checkout.

## Rejected alternatives

- **Re-sorting a copy inside `newestRuns`** (robust plan). It fixes records
  stored during a few days in October, for a name listed twice with a pending
  run; today's fingerprint already has the same spurious turn for them, and
  told records expire after 14 days.
- **Validating the repository and head before the runs call** (robust plan).
  The repository has already been accepted by `gh pr view --repo` and reaches
  gh as one argument with no shell, and the head is GitHub's own `headRefOid`.
- **Ending the filter in `| tojson`** (robust plan). The session measured on
  2026-10-12 that `gh api --jq` already prints one compact object per line
  when its output is not a terminal, and nothing for a head with no runs.
- **Reading the stored `pr` state before the gh calls** (extensible plan). It
  can only be older than reading it when the runs read fails, and it widens
  the signatures of `lookAt`, `watch` and `fetchSnapshot`.
- **A `checkKey` seam for SAL-162** (extensible plan). SAL-162 is a non-goal.
- **Passing a `RunsRead` value into `snapshotOf`** (extensible plan). A plain
  runs parameter and a mark set by `fetchSnapshot` do the same with one layer
  fewer.
- **One combined count sentence past the limit** (extensible plan). Counting
  started and finished runs separately says more for the same cost.

## Accepted race

A newer look whose runs read fails quickly can read the `pr` state before an
older, slower look stores a read showing a run finished. The newer look then
carries the old run and stores it, which can give one false "started" sentence
and one extra turn; the next successful read corrects it. The spec's edge case
about two looks running at once accepts this class of race.

## Steps

Each step writes its test first and sees it fail, except where noted.

1. **`newestCompletions` on `<=`** (spec point 4). Test in
   `tests/github.test.ts`: before `[passed at T1]`, after `[failed at T2,
   passed at T2]` gives `['Check "tests" passed again.']`; today it says
   "failed again".
2. **Newest runs in `ciOf` and the failed lists** (points 1 and 2). Export
   `newestRuns`; add `failedCheckNames`; use them in `ciOf`, `stateLines` and
   the pane. Test: a failed run at T1 beside a passing rerun at T2 gives
   `ciOf` `passed`, `failedCheckNames` `[]`, and state lines with
   `Checks: passed.` and no `failed:`. Update the three existing
   `changesBetween` tests in `github.test.ts` (around lines 239, 257 and 269)
   that now also say "The checks went from X to Y.", and say so in the pull
   request.
3. **The fingerprint's check part from newest runs** (point 3). Test: `[passed
   at T2]` and `[failed at T1, passed at T2]` have equal fingerprints; `[failed
   at T1]` and `[failed at T1, pending]` differ; `[failed at T1, pending]` and
   `[failed at T1, passed at T2]` differ.
4. **`const again`** (point 12). No behaviour changes, so no new test; the
   existing "again" tests guard it.
5. **Types, `runsOf`, `RUNS_JQ`, the `snapshotOf` parameter, the fingerprint's
   runs part and the `snapshotIn` guard** (points 5 to 7). Tests: `runsOf('')`
   is `[]`; non-JSON, an array line and a string `id` give `null`; duplicates
   collapse to the highest attempt; a missing attempt reads as 1; names are
   cleaned and runs sorted. A snapshot with run 1 differs from one without it;
   attempt 2 differs from attempt 1; the same run parsed from lines with
   `queued` and `in_progress` gives equal fingerprints. A stored snapshot with
   `runs` deleted is the same state as a new one with no runs; `snapshotIn`
   rejects `runs: 'x'`.
6. **Run sentences** (point 9). Tests: finished, started, started again
   (attempt 2), none at a new head, seven runs counted by kind.
7. **`waitingOn`** (point 10). Tests in `tests/state.test.ts`: passing checks
   with one run give `ci` and `pollFor` 90 seconds; a failed check with a run
   gives `fix`.
8. **State lines** (points 8 and 11). Tests: the unfinished count with runs,
   and the could-not-be-read line on a snapshot marked carried over.
9. **`carriedRuns`** (point 8, pure part). Tests: the same repository, number
   and head keep the stored runs; a moved head, another number, another
   repository, `null` and a stored value without `runs` keep none.
10. **The look** (points 5 and 8). First add a runs branch to `fakeGitHub` in
    `tests/register.test.ts` that answers the world's runs, one JSON line
    each, and can fail on request, and run the whole suite to see it still
    passes. Then write the register tests and see them fail: with a run
    stored, failing reads hand nothing over, and the next good read without
    the run hands over exactly one prompt with `Workflow run "build"
    finished.`; with the head moved and the read failing, the prompt says the
    head moved, names no run, and says the runs could not be read; the runs
    call's arguments carry `head_sha=` with the head from `gh pr view`. Then
    change `fetchSnapshot`.
11. **Documents.** README lines 44 and 50; the edge case in
    `docs/specs/pilot-failed-checks.md` (point 13).
12. **Gates.** The four gates in `CLAUDE.md`, in order. No gate reads the
    README or the two spec documents, and the report says so.
