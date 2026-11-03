# Plan: builder sets the state label, reports the late stages and lists missing commits

Written 2026-11-02 for `docs/specs/builder-sets-labels-stages-and-lists-commits.md`.
Three plans competed: the simplest change, the most robust design and the most
extensible design. A judge chose the most robust plan, with grafts from the
other two and four corrections.

## Chosen approach

Each job runs on a path the existing ordering rules already protect, and none
adds an await between choosing a read and handing it over.

### Commit listing

- `fetchSnapshot` in `hooks/register.tsx` builds the snapshot once, then calls
  `chooseStep(s, false)`. When the step is merge, ask whether to merge, or
  Merged, it awaits `listUnpushed` and returns the snapshot with an optional
  `unpushed` field. Every renderer reads the field from the read it hands
  over, so `stepFor` stays synchronous. Choosing with no question open is
  safe, because Merged comes before the question check, and a question step
  renders no listing.
- `fingerprintOf` builds a fixed list of fields, so the listing never wakes
  the session. A sentence in its comment says so.
- `headRefName` joins `PR_FIELDS` and `GhPullRequest` (optional), and
  `livePullRequest` drops its own `,headRefName` suffix.
- `listUnpushed($, r, live, s)` returns `{ kind: 'none' }`,
  `{ kind: 'some', commits, total, isAncestor }` or `{ kind: 'unlisted' }`, and
  never throws:
  1. It checks that the number is a positive integer, the head is a full sha,
     and the branch name is a string.
  2. It finds the worktree through `checkoutOf`, which compares the branch
     name in `worktreeWithBranch` and never passes it to git. Anything other
     than a worktree gives unlisted.
  3. It runs `git cat-file -e <head>^{commit}`, and only when the commit is
     missing does it fetch `pull/<n>/head`. A failed fetch gives unlisted.
  4. It runs `git rev-list <head>..HEAD`. A failure, or a line that is not a
     full sha, gives unlisted. No lines give none.
  5. With commits, it runs `git merge-base --is-ancestor <head> HEAD`. Exit 0
     and exit 1 give the answer; anything else gives unlisted.
  6. It keeps the first 20 hashes shortened to 12 characters, and the total.
- The `merge`, `ask-merge` and `merged` step kinds carry `unpushed`, filled by
  a pure `unpushedIn(s.unpushed)` in which a missing or malformed value reads
  as unlisted. The Closed step carries nothing.
- `unpushedLine` renders the sentence. `MERGED` becomes `mergedText(step)`.

### State label

- `STATE_LABELS` is defined once in `hooks/github.ts`, and `WORKFLOW_LABELS`
  is built from it and `needs-decision`.
- `labelFor(step)` in `hooks/step.ts` is an exhaustive switch:
  - review gives `in-review`;
  - failed, conflicting and changes-requested give `waiting-on-author`;
  - waiting, head-unchecked, merge and ask-merge give `ready-to-merge`;
  - over-limit and closed give `stuck`;
  - merged, question and runs-unread give no label. Runs-unread is not one of
    the spec's four approving outcomes: it exists because the runs read
    failed, so a `ready-to-merge` there would rest on a failed read, and it
    would also change the poll timing that `waitingOn` derives from the
    label. A code comment names this choice and the spec says it.
- A pure `labelActionOf(derived, record, liveLabels)` in `hooks/step.ts`
  returns none, record only, or write with the state labels to remove:
  - no derived label, or a derived label equal to the record, gives none;
  - while the live labels hold `stuck`, no record, or a derived label equal
    to the one derived at the job before (as after a failed edit), gives
    record, with no write of the derived label, removing only any other state
    label beside that `stuck`; the record notes the derived label before the
    job reads the labels, so the next job can tell;
  - otherwise it gives write, removing only the other state labels the live
    read saw, because a label on the pull request must exist in the
    repository, so removing it cannot fail for lack of the label.
- The record is kept in `$.store` under `state-label:<repo>#<number>` as
  `{ label, at }`, like the told records, with no session id. A pure
  `labelRecordIn(raw)` treats any other shape as no record.
  `pruneStateLabels` runs at session start beside `pruneTold` and `pruneOwed`.
- `requestStateLabel($)` queues one job through `inLabelQueue`, coalesced by a
  flag that the job clears before it starts. The job, `settleStateLabel`,
  rebuilds everything when it runs: it reads `run` and the stored `pr`
  snapshot, stops when their repository or number differ or the number is not
  a positive integer, derives the label from `chooseStep(s, await isAsking($))`,
  reads the record, reads the live labels with the same command
  `labelForQuestion` uses, stops unless the watch is still current, and acts on
  `labelActionOf`. A write is one `gh pr edit` with `--add-label` and, when
  needed, `--remove-label`, through `addLabel` generalised to take removals
  and keeping its create-and-retry. After the edit succeeds, the job reads
  the live labels again and removes, in one more `gh pr edit` with
  `--remove-label`, any other state label that a second session put on
  between the first read and the edit. A `stuck` the session set by hand in
  that time stays, and the label the job added comes off instead, through a
  pure `labelsToRemoveAfterEdit` in `hooks/step.ts`. The record is saved only
  when that second read shows nothing to remove or the removal succeeds, so
  a failed read or removal is tried again at the next look.
- `requestStateLabel` is called in `lookAt`'s branch for a look that was not
  overtaken, next to `takeOffAnsweredLabels`, and in `watch()` after the
  snapshot is stored.

### Stage reports

- `isMerge(command, mergePattern)` in `hooks/state.ts` matches `gh pr merge`
  or the project's merge command, built from the same command-start and
  command-end pieces as `isPushOrMerge`, which stays unchanged.
- A pure `afterSeen(prev, seen, watchSince, now)` in `hooks/progress.ts`
  returns null with no record, when the watch began before the record's
  start, when the stage would move back, or when the stage and note are
  unchanged. Otherwise it returns `afterReport` with the record's own title.
- `reportSeen($, stage, note)` applies it to the `progress` atom and
  redraws; failures are caught and leave the bar as it was.
- Call sites: `serveWatch` reports `pr` after a successful watch of an open
  pull request; `servePackage` reports `review` with the note `round N` when
  `roundInProgress` of the live read gives a round above 1; the `tool.call`
  hook, for the session's own Bash calls only, reports `merge` before
  `foreground(...)` runs the command.

### Text changes

- `hooks/step.ts` drops the sentences that set a derived label (Closed, Over a
  limit, waiting, failed's first bullet, changes-requested, the merge step's
  head-moved bullet and its `ready-to-merge` and progress sentence), keeps the
  judgement `stuck` sentences, and replaces the listing instructions with the
  rendered result and what to do with it.
- `skills/implement/SKILL.md`: the stage table says the mod reports `pr`,
  `review` and `merge`; step 7 drops setting `in-review`; "Commits the pull
  request lacks" keeps only what to do with the result; "State labels" says the
  mod sets the derived label and the session sets `stuck` only by judgement;
  Resuming keeps reporting `review` before the watch, because a resumed session
  has no progress record and that report is what lets the mod's later reports
  apply, and drops the session's own listing and `merge` report.
- `mods/builder/README.md` describes the record and its prune, the three
  reports and the listing, and notes that `ready-to-merge` now also comes from
  the mod.
- `docs/specs/builder-chooses-the-step.md` says a failed jobs read is read
  again at the next look.

## Grafts

- From the simplest plan: the review note comes from `roundInProgress`, not
  from the last reported stage. The skill has the session report `build` again
  while it fixes findings, so a rule based on the last stage would drop the
  round on every later round. Also from the simplest plan: no new files.
- From the most extensible plan: the pure `labelActionOf`, so the label rules
  are tested as a plain function, and `STATE_LABELS` as the one source of the
  label names.
- From the judge: look for the head commit before fetching, so a fork whose
  `origin` lacks `pull/<n>/head` does not always give "could not be listed".

## Rejected alternatives

- Building each label job from the snapshot passed when it was queued (the
  simplest plan): a backlog replays older labels and flips the label on
  GitHub. Rebuilding from the stored snapshot when the job runs avoids it.
- Taking the labels to remove from the snapshot (the most extensible plan):
  the snapshot can be minutes old, so a `stuck` the session set after it would
  be missed, and the "no record while `stuck` is on" check would read stale
  data.
- An `afterStepChosen` seam and two new modules for the checkout update: they
  serve a follow-up that has not been specced yet and add code without
  behaviour.
- Lowercasing the repository in the key, checking hashes again in
  `chooseStep`, a third label call site in `asking`, and a per-name missing
  label set in the test fake: each adds a rule or test churn for little gain.
- Runs-unread giving `ready-to-merge`: see the label section.

## Steps

1. `hooks/github.ts`: `STATE_LABELS`, `WORKFLOW_LABELS` from it,
   `headRefName` in `PR_FIELDS` and `GhPullRequest`, `unpushed` in
   `SnapshotExtras`; `types/index.d.ts`: `Unpushed` and `Snapshot.unpushed?`.
   Run the load gate again.
2. `hooks/step.ts`: `labelFor`, `labelActionOf`, `labelRecordIn`,
   `unpushedIn`, `needsListing`, the step fields, `unpushedLine`,
   `mergedText`, and the text edits, test-first in `tests/step.test.ts`.
3. `hooks/progress.ts` `afterSeen` and `hooks/state.ts` `isMerge`, test-first.
4. `hooks/register.tsx`: `listUnpushed` and the `fetchSnapshot` change, with
   fake rules for `cat-file`, `rev-list` and fetch failures and the listing
   tests.
5. `hooks/register.tsx`: the label record, `settleStateLabel`, coalescing,
   the generalised `addLabel` and the prune, with the label tests. Update the
   existing tests that count calls.
6. `hooks/register.tsx`: `reportSeen` at the three call sites, with tests.
7. The skill, the README and the earlier spec sentence.
8. All gates for both mods, then the issue-key search on the staged diff.

## Test plan

- Every step kind's label, including no label for Merged, An open question and
  runs-unread (`tests/step.test.ts`).
- `labelActionOf`: equal to the record gives none; no record with `stuck` on
  gives record only; otherwise write, removing only the state labels present.
- Through the fake world: a first watch writes `in-review` and saves the
  record; a second look writes nothing; a failed edit saves nothing and the
  next look retries; a missing label is created and retried; the reload case
  records without writing and a later change removes `stuck`; Merged and An
  open question write nothing.
- `afterSeen`: no record, a watch older than the record, moving back, and no
  change each give null; the title is kept. `isMerge`: true for `gh pr merge`
  and a project pattern, false for `git push`.
- Through the fake world: a watch after a reported stage shows `pr`; a package
  call shows `review`, and a round-2 package call shows `round 2`; a session
  Bash `gh pr merge` shows `merge` before the command runs; `git push` and a
  subagent's merge change nothing; no record, or a record newer than the
  watch, gives no report.
- The merge, ask-merge and Merged texts carry none, the hashes with the
  ancestor answer, and could not be listed; the Closed text carries none; a
  missing commit is fetched, and a failed fetch, listing or ancestor check,
  or no worktree, gives could not be listed; a review step and a closed pull
  request run no listing.
- No step text tells the session to set a derived label, to call
  `mcp__builder__progress`, or to list commits itself. The skill and README
  are read only by reviewers, and the report says so.
- The four gates for both mods.
