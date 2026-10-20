# Plan: the pilot mod waits on a fix when a check fails, and wakes when a check completes again

Spec: `docs/specs/pilot-failed-checks.md`. Written 2026-10-07 from a plan
tournament of three blind planners (simplest, most robust, most extensible)
and a judge.

## Chosen approach

The simplest plan won. It changes four files in `mods/pilot` and adds no file,
no dependency and no module. `register.tsx` and `prompts.ts` do not change:
`deliver` already hands a change over whenever the fingerprint differs from
the one the session was last told, and words it with `changesBetween`, so once
the fingerprint carries completion times and `changesBetween` names a rerun,
the existing path starts the turn. `PR_FIELDS` does not change either, because
`statusCheckRollup` already makes gh print each check's times.

1. `types/index.d.ts`: `Check` gains an optional `completedAt?: string`, absent
   (not set to `undefined`) when a check has no time, so old fixtures and stored
   snapshots compare exactly as today. `WaitingOn` gains `'fix'`.
2. `hooks/github.ts`:
   - `GhCheck` gains `completedAt`, `startedAt` and `createdAt` as optional
     strings.
   - `checkOf` reads a check run's `completedAt` only after its status is
     `COMPLETED`, so the zero time a running run reports is never read. A commit
     status that is not pending reads `startedAt`, then `createdAt`. A small
     `withTime(check, time)` adds the key only for a non-empty string.
   - A named `compareChecks` orders checks by name, then by completion time,
     then by state, and `snapshotOf` sorts with it. A check with no time sorts
     after every check with one, because a run that has not completed is newer
     than any that has, so the last check of each name is its newest run.
   - `fingerprintOf` writes `name:state@time` for a check with a time and
     `name:state` otherwise.
   - `checksMoved` becomes `checkSentences`. A moved sentence compares each
     name's newest run on each side (`newestRuns`), so an old run GitHub keeps
     beside a rerun is never read as a move, and a name moves at most once.
     `completedAgain` adds the "again" sentences: for each name, the newest
     completion in the earlier snapshot is compared with the newest in the
     later one (`newestCompletions`), and a name that already has a moved
     sentence gets none. `changesBetween` passes whether the head moved, and
     no "again" sentence is written when it did. Past `CHECK_SENTENCE_LIMIT` sentences,
     the moves and the checks that completed again are counted separately.
3. `hooks/state.ts`: `waitingOn` answers `fix` when `ciOf` is `failed`, after
   the pending-checks test and before `ready-to-merge`. `POLL_MS.fix` is
   90 seconds, and the comment on `POLL_MS` is corrected: a rerun that fails
   the same way raises no event from the desktop app, so only the poll sees it.
4. `hooks/pane.tsx`: the wording table in `nextStep` gains
   `fix: 'waiting on a fix'`. The line above the prompt and the pane's `Next:`
   line both come from `nextStep`.

Times are compared as strings with `<`, not `localeCompare`. GitHub's API
returns every time in one fixed UTC form, `YYYY-MM-DDTHH:MM:SSZ`, which gh
prints unchanged, so the string is stable from look to look and orders
correctly.

## Grafts from the runners-up

- **An end-to-end rerun test in `register.test.ts`**, from the robust and
  extensible plans. It is the only test that proves the 90-second poll, the
  stored snapshot's round trip through the store, and the fingerprint are wired
  together. The pane in that test reads "waiting on a fix · next look in 2m".
- **A guard test for the upgrade turn**, from the robust plan. An earlier
  snapshot without times against a later one with times gives exactly the
  fallback sentence and no "again" sentence, which pins down the one extra turn
  the owner accepted.
- **A named `compareChecks`**, from the extensible plan, because a three-key
  sort written inline is hard to read.

## Rejected alternatives

- **Rewriting each time to a fixed form with `Date.parse` and `toISOString`,
  and typing the gh fields as `unknown`** (robust plan). This guards against
  output nobody has seen, adds checks through the code, and lengthens the
  fingerprint.
- **Comparing moved states through each name's newest completion** (robust
  plan). A snapshot stored by the older build has no times, so no "again"
  sentence can come from it, and every snapshot stored afterwards is sorted by
  time, so the existing "last wins" map already reads each name's newest
  state. The rewrite would change code the spec does not list.
- **Accepting only whole-second UTC times with a regular expression**
  (extensible plan). If gh ever printed fractions of a second, every time would
  be dropped without a word and reruns would go unnoticed again.
- **Exported helpers for each per-check concern** (extensible plan). Seams for
  changes nobody has asked for.
- **Filtering GitHub's zero time explicitly.** A check that has not completed
  returns before its time is read, which is what the spec asks.

## Steps

1. Write the tests below and see each fail against today's code.
2. Make the type changes, then `state.ts` and `pane.tsx`, then `github.ts`.
3. Run the gates from `mods/pilot`: `npx -y -p typescript@5.6.3 tsc -p . --noEmit`,
   `claude plugin test .` and `claude plugin validate .`.

## Tests

Each maps to a bullet of the spec's Verification section and fails when its
fix is removed.

- `state.test.ts`: an open pull request with a failed check waits on `fix`; a
  running agent still gives `agents`, an open question still gives `owner`,
  and the `ready-to-merge` label still gives `fix`. `POLL_MS.fix` equals
  `POLL_MS.ci`.
- `pane.test.ts`: with a failed check, `nextStep` and `abovePromptLine` say
  "waiting on a fix".
- `github.test.ts`:
  - A failed check rerun in place (same name, newer time) changes the
    fingerprint and gives exactly `Check "tests" failed again.`
  - A rerun listed as a second check with the same name, listed newest first,
    gives the same single sentence.
  - The same checks in another order give the same fingerprint.
  - A name whose state moved gets only its moved sentence, and a passing rerun
    reads "passed again".
  - Seven checks rerun with the same result give "7 checks completed again.",
    and moves and reruns past the limit are counted separately.
  - Two runs of one check that moved the same way give one sentence, and an
    old failed run kept beside a newer passing run gives no sentence when
    something else changes.
  - A pending rerun listed beside a failed run reads as the check going back
    to pending.
  - A new head whose checks end in the same states gives no "again" sentence.
  - An earlier snapshot without times gives exactly the fallback sentence.
  - `checkOf` reads a completed run's `completedAt` (not `startedAt`), gives a
    running run with the zero time no key, reads a status's `startedAt` and then
    `createdAt`, and gives a pending status no time.
- `register.test.ts`: watched with `tests` failed at one time, a poll later
  with `tests` failed at a newer time hands over exactly one prompt containing
  `Check "tests" failed again.`, and the pane reads
  "waiting on a fix · next look in 2m".

## Follow-up, out of scope

If GitHub lists a passing rerun beside the old failed run instead of replacing
it, as it listed the failed rerun on a project repository's pull request, `ciOf` still
answers `failed`, because it looks at every check rather than each name's
newest. The mod would then keep saying it waits on a fix. `ciOf` is outside
this change.
