# The pilot mod reads reruns and workflow runs correctly from GitHub

Written 2026-10-12, on top of an earlier change to how the mod compares and
stores what it reads. A related problem was
left open here and settled later by `pilot-wake-ups.md` (see Non-goals).

## Goal

The pilot mod judges every check name by its newest run, everywhere it reads
checks, and it sees the head's unfinished GitHub Actions workflow runs. A run
that is queued, held, or cancelled before it registers a check then starts a
turn when it appears and when it finishes, and the mod waits on it as it waits
on a pending check.

## Users and trigger

A session running `/implement` with the pilot mod watching its pull request.
Two moments matter. The first is the merge step's "A check is pending, or a
run is unfinished": the session ends its turn waiting on checks and relies on
the mod to start the next turn when the run finishes, even when the run never
registers a check. The second is a rerun that GitHub lists beside the run it
replaced, as on a project repository's pull request: the mod must read the rerun's
result, not the old run's.

## Behavior

### Checks are judged by each name's newest run

1. `ciOf` in `mods/pilot/hooks/github.ts` judges each check name by its newest
   run, picked by the existing `newestRuns` helper (the last check of that name
   in the snapshot's sorted checks). A passing rerun listed beside an old
   failed run reads as `passed`.
2. The lists of failed check names in the session's state lines
   (`mods/pilot/hooks/prompts.ts`) and in the pane (`mods/pilot/hooks/pane.tsx`)
   come from the same newest runs, so they never name a failure that `ciOf`
   no longer counts.
3. `fingerprintOf` builds its check part from each name's newest run only. An
   old run that a newer run of the same name replaced is no longer in it, so
   GitHub listing or dropping that old run never changes the fingerprint. A
   rerun still changes it when it appears (it is pending, so it is the newest)
   and when it completes (its completion time is new).
4. `newestCompletions` keeps the later of two runs of one name that share a
   completion time (it replaces its pick on `<=`), so it picks the same run as
   `newestRuns` does.

### The head's unfinished workflow runs

5. Each look reads the head's workflow runs after `gh pr view` has given the
   head, with
   `gh api --paginate "repos/<repo>/actions/runs?head_sha=<head>&per_page=100"`
   and a `--jq` filter that keeps only runs whose `status` is not `completed`,
   and only their `id`, `run_attempt` and `name`.
6. The snapshot carries those runs as `runs`, each with its id, attempt and
   name (the name cleaned by `plainName`), sorted by id and then attempt.
7. The fingerprint records each run as its id and attempt and nothing else. A
   run appearing (newly queued, or rerun, which keeps its id and raises its
   attempt) or disappearing (it completed, with or without a check) changes the
   fingerprint and starts a turn. A move between unfinished statuses, such as
   queued to in progress or to waiting, does not.
8. When the runs read fails, for any reason, the look carries on with the
   pull request's other facts and keeps the runs of the snapshot the mod last
   stored for this pull request (its `pr` state), provided that snapshot has
   the same repository, number and head. Otherwise it keeps no runs. A failed
   read therefore never changes the fingerprint. The snapshot marks the runs
   as carried over, outside the fingerprint, and the session's state lines say
   that the workflow runs could not be read at the last look.
9. The change list names each run that moved: `Workflow run "<name>" started.`
   for a run that appeared with attempt 1, `Workflow run "<name>" started again
   (attempt <n>).` for a rerun, and `Workflow run "<name>" finished.` for a run
   that disappeared. A new head names none of them, because its runs are new
   runs on a new commit and the head-moved sentence already says so. Past the
   same limit the check sentences use, the run sentences are counted instead
   of listed.
10. `waitingOn` in `mods/pilot/hooks/state.ts` answers `ci` when the pull
    request is open, no check has failed, and either a check is pending or a
    run is unfinished. A failed check still answers `fix` first. Both poll
    every 90 seconds, so an unfinished run polls on the short interval.
11. The state lines say how many workflow runs are unfinished when there are
    any.

### Small corrections

12. In `checkSentences`, the "again" list is one `const`:
    `const again = isNewHead ? [] : completedAgain(before, after, namesThatMoved)`,
    under the comment that explains it.
13. The edge case in `docs/specs/pilot-failed-checks.md` about a check missing
    its time says that checks sharing a name and carrying no time are ordered
    by state and named once, and that otherwise a check without a time behaves
    as before.

## Edge cases

- A repository with no workflows answers an empty list, not an error, so its
  snapshots carry no runs and behave as before.
- A token without permission to read Actions fails the runs read on every look.
  The mod keeps no runs for it, so it behaves exactly as before this change,
  and the state lines say the runs could not be read.
- The runs read can start failing after a look has stored an unfinished run at
  the head. The look then keeps that run for as long as the reads fail at that
  head, so the mod keeps waiting on the checks and polls every 90 seconds, and
  the state lines say the runs could not be read. The merge step reads the runs
  from GitHub itself, so a stale run never decides a merge, and the next
  successful read corrects it.
- A stored snapshot or told record that an older build saved has no `runs`
  field. It counts as having no runs, so after the upgrade a pull request with
  no unfinished runs compares as unchanged and starts no turn. `isSameState`
  already recomputes both fingerprints with the current rule, so the
  newest-run change to the check part starts no turn on its own either.
- A run that starts and completes between two looks is never seen as
  unfinished. If it registered a check, the check reports it. If it did not,
  the mod does not see it, and the merge step's own read of the runs finds it
  when the session next decides.
- Two looks running at once may carry over runs from slightly different stored
  snapshots when both runs reads fail. Only the newer look stores its result,
  and the next successful read corrects the runs.
- The `--jq` filter runs on each page of `--paginate`, which is correct
  because it keeps or drops each run on its own.
- A run name is written by whoever can push a workflow, so it passes through
  `plainName` and is quoted in sentences, like a check name.

## Non-goals

- A check completing again with the same result was left open here, and
  `docs/specs/pilot-wake-ups.md` settled it: a check that completes again
  with the same passing result no longer changes the fingerprint or starts a
  turn. The counsel decided this on 2026-10-13 in place of watching a pull
  request with checks, and nobody watched the change live.
- A completed run that failed without registering a check (a broken workflow
  file, `action_required`) does not make `ciOf` or `waitingOn` answer
  `failed`. The merge step reads such runs itself; the mod only wakes the
  session when the run leaves the unfinished list.
- The pane shows no list of workflow runs.
- Nothing outside `mods/pilot` changes except the two spec documents, and
  `mods/pilot/README.md` only if its list of waiting states needs the
  unfinished run named.

## Failure modes

- `gh pr view` failing still fails the whole look, as today.
- The runs read failing is covered by Behavior point 8.
- Output from the runs read that is not one JSON object per line counts as a
  failed read.

## Verification

Tests in `mods/pilot/tests`, each seen to fail without its change:

- `ciOf` reads a passing rerun listed beside an old failed run of the same name
  as `passed`, and the state lines name no failed check for it.
- The fingerprint is unchanged when an old run that a rerun replaced is added
  to or dropped from the rollup, and it changes when the rerun appears pending
  and when it completes.
- Two runs of one name with the same completion time and different states: the
  "again" sentence names the state of the run `newestRuns` picks.
- A snapshot with an unfinished run, and a later one without it and with no
  check for it, have different fingerprints, and the change list says the run
  finished. A rerun (same id, higher attempt) changes the fingerprint and says
  it started again. A run moving from queued to in progress does not change
  the fingerprint.
- `waitingOn` answers `ci` for an open pull request whose checks all passed
  and which has an unfinished run, and `pollFor` gives 90 seconds.
- A look whose runs read fails keeps the stored snapshot's runs when the head
  is the same, keeps none when the head moved, and its fingerprint equals the
  stored one when nothing else changed.
- A stored snapshot without a `runs` field compares as the same state as a new
  snapshot with no runs.

The four gates in the project's `CLAUDE.md` pass. The edits to
`pilot-failed-checks.md` and this spec are read only by the reviewers.

## Decided by the counsel

- The issue about the fingerprint's check part says to build it from each check name's newest run only if GitHub is shown to list superseded runs inconsistently at one head. Should this pull request build it from each name's newest run anyway? The counsel chose Yes: build the fingerprint's check part from each name's newest run, the same runs that ciOf (once it judges each name by its newest run) and the change sentences judge, and close that issue., 5 of 6.
- For the head's unfinished workflow runs, what should the fingerprint record about each of the head's unfinished GitHub Actions workflow runs, and so which run changes start a turn? The counsel chose Presence only: each unfinished run's id and attempt number. A run appearing (queued, or rerun) or disappearing (it completed) starts a turn; a move between unfinished statuses, such as queued to in_progress or to waiting, does not., 6 of 6.
- For the head's unfinished workflow runs, the mod will read the head's workflow runs with a second gh call after `gh pr view`. When that second read fails (network error, rate limit, or a token without permission to read Actions), what should the look do? The counsel chose Carry on with the pull request's other facts, and keep the unfinished runs the last stored snapshot of this pull request had (none if there is no stored snapshot), so a failed read never changes the fingerprint., 6 of 6.
