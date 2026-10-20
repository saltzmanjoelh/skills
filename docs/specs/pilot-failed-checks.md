# The pilot mod waits on a fix when a check fails, and wakes when a check completes again

Written 2026-10-07.

## Goal

When a check has failed at the head of the watched pull request, the pilot mod
says it is waiting on a fix and polls on the short interval. When a check
completes again with the same result, as a rerun that fails the same way does,
the mod counts that as a change and starts a turn that says so.

## Users and trigger

A session running `/implement` with the pilot mod watching its pull request.
Two moments matter. The first is any time a check at the head has failed: the
status line above the prompt and the pane read the waiting state. The second is
after the session reruns a failed check and ends its turn: it relies on the mod
to start the next turn when that rerun finishes.

## Behavior

1. `waitingOn` in `mods/pilot/hooks/state.ts` gains a state, `fix`, returned
   when the pull request is open and a check at the head has failed (`ciOf`
   answers `failed`). It is checked in the same place as the pending-checks
   state: after the open question and the running agents, which keep
   precedence, and before `ready-to-merge`.
2. The status line and the pane name the state as "waiting on a fix". The
   other states keep the words they show today.
3. `POLL_MS.fix` is 90 seconds, the same as `POLL_MS.ci`.
4. Each check in the snapshot carries when it last completed: `completedAt` for
   a check run, and for a commit status the time that status was reported. gh
   queries a commit status's `createdAt` and prints it as `startedAt` in its
   JSON, so the mod reads `startedAt` and falls back to `createdAt`. A check
   that has not completed carries nothing.
5. The fingerprint includes that time for each check, so a check that
   completes again, with any result, changes the fingerprint and the mod hands
   the change over.
6. The change list names it: a check whose state is unchanged but whose
   completion time moved gives `Check "<name>" failed again.` or
   `Check "<name>" passed again.`, where the state is that of the name's newest
   completion. A name that already has a sentence because its state moved gets
   no second one. These sentences sit with the other per-check
   sentences and count toward the same limit past which moves are only
   counted. When the head moved, no "again" sentence is written: the checks
   at a new head are new runs on a new commit, and the head-moved sentence
   already says so.

## Edge cases

- A check run that is still running reports GitHub's zero time,
  `0001-01-01T00:00:00Z`, as `completedAt`. A pending check carries no time,
  so its zero time never enters the fingerprint.
- Two checks can share a name. On a project repository's pull request the rerun of a
  failed check appeared in the rollup as a second check run with the same name
  beside the first, both failed. For the "again" sentence, checks are compared
  by name using the newest completion time each name has, so that rerun reads
  as `Check "<name>" failed again.` and two different checks are never paired.
  GitHub promises no order for checks, so checks that share a name are also
  ordered by completion time in the snapshot, and a reorder alone does not
  change the fingerprint.
- A check that is missing the time field, as old fixtures and any unexpected
  gh output are, carries no time. Checks that share a name and carry no time
  are ordered by their state, so a reorder alone does not change the
  fingerprint, and the name is named once in the change list. Otherwise a
  check without a time behaves as it did before times were read.
- The first poll after this change ships sees a fingerprint that differs from
  the stored one, because the stored one has no times. It hands over one turn
  whose change list says the pull request changed in a way the lines below
  show. The owner chose on 2026-10-07 to accept that one extra turn rather
  than add code that recognises a fingerprint without times.

## Non-goals

- Workflow runs that never register a check (the follow-up recorded in the
  plan for the merge step's checks handling) are out of scope.
- Nothing outside `mods/pilot` changes, and nothing in `mods/pilot` changes
  beyond what is listed above, except for two descriptions that would
  otherwise go stale: the comment on `POLL_MS`, which today says failed checks
  are left to the desktop app's wakes, and the list of next steps and poll
  intervals in `mods/pilot/README.md`.

## Failure modes

- If gh stops printing the time fields, the mod falls back to today's
  behavior: failed checks still show "waiting on a fix", and only a rerun that
  fails the same way goes unnoticed.

## Verification

Tests in `mods/pilot/tests`, each of which fails when its fix is removed:

- `waitingOn` answers `fix` for an open pull request with a failed check and no
  running agents or open questions, and `POLL_MS.fix` equals `POLL_MS.ci`.
- The status line and the pane say "waiting on a fix" for that state.
- Two snapshots that differ only in a failed check's completion time have
  different fingerprints, and `changesBetween` names the check as failed again.
  The same holds when the rerun appears as a second check with the same name.
  A new head whose checks end in the same states gives no "again" sentence.
- `checkOf` reads `completedAt` from a completed check run and `startedAt`, or failing that `createdAt`, from
  a commit status, and none from a check run that is still running.

The gates, run from `mods/pilot`: `npx -y -p typescript@5.6.3 tsc -p . --noEmit`,
`claude plugin test .` and `claude plugin validate .`.
