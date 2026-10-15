# Plan: the pilot mod hands the session the newest state once, at the right time

Spec: `docs/specs/pilot-handover-ordering.md` (SAL-244). Written 2026-10-12.

## Chosen approach

The most-robust plan won, trimmed in two places and with ideas grafted from
the other two. Its deciding idea is that `deliver` chooses which read to hand
over after its last await before the prompt, not when `lookAt` checks whether
it was overtaken. The other two plans chose at `lookAt`'s check, which leaves
a narrower form of SAL-219 open: a poll that was not overtaken at that check
enters `deliver`, waits on the told record and on `busy`, a newer observing
look stores a newer read meanwhile, and the poll then submits its own older
state. Every round of the SAL-160 review found a race of exactly that shape.

### `mods/pilot/hooks/github.ts`

- Export `DECISION_LABEL = 'needs-decision'` here, and have `register.tsx`
  import it instead of defining its own, so the label the mod adds and the
  set below cannot drift apart.
- Export `WORKFLOW_LABELS`, a set of `in-review`, `waiting-on-author`,
  `ready-to-merge`, `stuck` and `DECISION_LABEL`, and a helper
  `countedLabels(labels)` that drops them. `fingerprintOf` joins
  `countedLabels(s.labels)`, and `changesBetween` builds its "Labels added"
  and "Labels removed" lines from `countedLabels` on both sides. `snapshotOf`
  keeps every label.
- Export `snapshotIn(value: unknown): Snapshot | null`, which answers the
  value only when `head` and `state` are strings, `labels` and `checks` are
  arrays, and `verdicts` is null or an object with a string `sha`, and
  otherwise null. These are the fields `fingerprintOf` and `changesBetween`
  use.
- Export `isSameState(a, b)`, which accepts any two values and checks them
  itself with `snapshotIn`, so a caller can pass a stored value straight in:
  both null is the same; one null, or either failing `snapshotIn`, is different;
  otherwise it compares `fingerprintOf` of each, recomputed from the fields.
  It never reads the stored `fingerprint` string, and its comment says why.

### `mods/pilot/hooks/state.ts`

- `PUSH_OR_MERGE` uses `git(?:\s+-[cC]\s+\S+)*\s+push`. The whitespace and
  non-whitespace classes do not overlap, so the repetition cannot backtrack
  badly. The comment above `isPushOrMerge` names the `-c` and `-C` options
  and the known misses.

### `mods/pilot/hooks/register.tsx`

1. **The newest stored read.** Beside `newestStoredLook`, add
   `let newestRead: { r: PilotRun; s: Snapshot; seq: number } | null = null`.
   In `lookAt`, set it beside `newestStoredLook = seq`, before the
   `await update($, pr, …)`, so the read and its number are claimed together
   and never read back from the store. It is set by every look that leaves
   its read for others to tell, which `lookAt` names
   `leavesReadForHandover`: every look not given an `ownRead` mark. The CI
   event's look and the known look tell their own reads, so each runs
   through `tellingOwnRead`, which hands `lookAt` a mark; `lookAt` puts the
   mark in the set `untoldOwnReads` as soon as the look goes on with its
   read, right after the early return for an overtaken look that does not
   act on its read, so an overtaken look that does act on its read is
   marked as well, and `tellingOwnRead` takes it out in a `finally` once the
   look has told its read or given up. The data review of 89476b0 showed
   that marking only where the look stored its read let `/pilot poll`
   overtake the CI event's look, keep the failure in `newestRead`, and have
   a waiting poll tell it a second time while the overtaken look told it
   too. The review tool wraps its known look in
   `tellingOwnRead`, and the CI event handler wraps everything from its look
   to its `tell`, so both callers take their marks the same way.
   `newestStoredLook` still advances for every look that stores. `watch` sets it to null where
   it sets `currentSince`, so a new watch never sees the old watch's read.
   The comment on the module variables says a hot reload resets it to null.
2. **The wake log** compares with `!isSameState(shown, s)`; a pane snapshot
   that an older build saved fails the check inside `isSameState`, so it
   cannot throw in the middle of a look.
3. **`told()`** answers `snapshotIn(stored)`.
4. **`tell`** keeps today's order: check and claim `toldSeq` on entry with no
   await between, then await `promptedKey`, then queue the write. The queued
   work returns at once when `seq < toldSeq`, because a newer read was
   claimed as told after this one was queued; otherwise it writes the seen
   time and then the record, as now. `schedule` runs after the queued write,
   outside the queue. The told queue and the label queue are both built by
   one function, `oneAtATime({ passesErrors })`, and differ only in whether a
   failed piece of work reaches its caller: the told queue passes the error
   on, so `deliver` never reports a handover whose record was not written,
   while the label queue hides it, because its callers never wait for it.
   Either way the queue goes on with the next piece of work. (The first
   draft of this plan kept a separate copy of the label queue for the told
   queue; the review of fffa8144 asked for one function instead.)

   `watch` runs its `forgetTold` of the previous pull request through the same
   queue, so a write for that pull request already queued cannot land after
   the delete and bring the record back.
5. **`deliver`.** A helper `newestFor(r, s, seq)` answers null while
   `untoldOwnReads` holds any mark, because a look that tells its own read
   has stored it and not yet told it, and a look that only observes may
   since have read the same state and kept it in `newestRead`. The
   adversarial review of 7ffbd32 showed that without this rule `/pilot poll`
   after the CI event's look made a waiting poll tell the failure a second
   time. A change read meanwhile is delayed, never lost: the poll still
   schedules the next one, which compares with whatever was then told.
   Otherwise `newestFor` takes `newestRead` when
   its number is greater than `seq` and `isSameRun(newestRead.r, r)` holds,
   and otherwise `{ s, seq }`. It answers null when the number it took is
   below `newestStoredLook`, because the newer look that stored is then the CI
   event's look or the known look, which tells that state itself; `deliver`
   then hands nothing over, and the hold path records the look's own head as
   stalled. The adversarial review of 24cf956 found that without this rule a
   poll whose own read showed no change could hand over the CI event's read
   before the event told it, so the session heard of the failure twice.

   `deliver` also notes `toldSeq` just before it reads the told record, and
   hands nothing over at either choice when `toldSeq` has moved since. The
   data review of 3706993 showed that otherwise a poll whose read of the told
   record began before the CI event recorded the failure, and returned after
   it, found no mark left and took the failure `/pilot poll` had kept in
   `newestRead`, which differs from the old record it read, and told the
   session the failure a second time; the look after a posted review opens
   the same window. A number that has not moved means the record read is the
   newest, because every look that records a read as told claims its number
   before writing and finishes the write while it holds its mark or the
   delivering claim. The next poll compares with the new record, so a change
   is delayed and never lost. Re-reading the told record when the number
   moved was rejected: it adds an await before the choice that would need
   the same check again, for a delay the spec already accepts. The body:

   ```ts
   if (isDelivering) return false
   isDelivering = true
   try {
     const toldSeqBeforeRead = toldSeq
     const last = await told($, r)
     if (!(await stillWatching($, r))) return false
     const before = newestFor(r, s, seq)
     if (before === null || toldSeq !== toldSeqBeforeRead || before.seq <= toldSeq || isSameState(last, before.s)) return false
     if (await read($, busy)) {
       // The hold is recorded before busy is read again, with no await
       // between. The turn's end clears busy before it checks for a hold, so
       // either it sees this hold or the read below sees the turn ended.
       // A failed read is not caught, as the first read's is not: the hold
       // is already recorded. (Review of abdbd352: the engine skips a state
       // hook that throws, so a catch here could never be reached or tested.)
       isHeld = true
       if (await read($, busy)) {
         // Set again, because a turn end may have taken the hold while this
         // read ran and a new turn begun since.
         isHeld = true
         stalledHead = newestFor(r, s, seq)?.s.head ?? s.head
         return false
       }
       isHeld = false
     }
     // Chosen after the last await, with none between here and the submit.
     const handed = newestFor(r, s, seq)
     if (
       handed === null || !isCurrentWatch(r) || toldSeq !== toldSeqBeforeRead ||
       handed.seq <= toldSeq || isSameState(last, handed.s)
     ) return false
     const submitted = await $.prompt.submit({ text: changePrompt(handed.s, changesBetween(last, handed.s)) })
     if (submitted.drop !== undefined) { stalledHead = handed.s.head; return false }
     await tell($, r, handed.s, handed.seq)
     return true
   } finally {
     isDelivering = false
   }
   ```

   No await may be added between choosing the read and the submit.
   `isCurrentWatch(r)` is the synchronous half of
   `stillWatching`: `currentSince === undefined || r.since === currentSince`.
   The sequence guard is `<=`, not `<`, because the read chosen may be one
   that another look already told under that same number, such as the
   desktop app's CI event; the existing test "a poll whose handover is
   overtaken by the desktop app's CI event while it reads what was told sends
   no prompt repeating the event" fails with `<`. A look's own read can never
   equal `toldSeq` before its own `tell`, so `<=` changes nothing for it.
   The variable names in the comments are spelled out in sentences; no label
   such as "before" or "handed" is used in prose as shorthand.
6. **The CI event handler** compares with `isSameState` and also checks
   `isSameRun(r0, r)` explicitly, because the fingerprint does not include
   the repository or the number.
7. **`turn.complete`** is unchanged in code. Its comment gains one sentence:
   it clears `busy` before it checks for a hold, which the second read in
   `deliver` relies on.
8. **Comments.** The comment above `lookAt` and the one above `deliver` say
   that a delivering look hands over the newest stored read of the same watch
   under that read's number, chosen after its last await, and name each guard
   in full sentences.

### Documentation

No gate reads these; the reviewers check them.

- `mods/pilot/README.md`:
  - The paragraph on numbered looks says a delivering look hands over the
    newest stored read.
  - A sentence says the workflow's own five labels never wake the session.
  - The subagent line says a background subagent's finish starts a turn and
    a foreground one's returns inside the turn already running, and either
    way a turn of the session's own ends afterwards.
  - The intervals sentence becomes the spec's.
  - It says a rerun of a failed check and a pending merge also wait 10
    minutes while a subagent runs, and why that is acceptable.
  - The push description names the `-c` and `-C` options.
- `docs/specs/pilot-shows-what-runs.md`: the push behavior names the options,
  and its edge cases gain the quoted-string false match and the misses for a
  `-c` value quoted with spaces and for `--git-dir=…`.
- `docs/specs/pilot-polls-on-events.md`: the `agents` row and the edge case on
  subagents gain the rerun and merge note and the background-or-foreground
  wording.

## Grafts

- From the simplest plan: the short, literal hold block; the claim on entry
  to `tell`.
- From the extensible plan: `DECISION_LABEL` exported from `github.ts`;
  `countedLabels` shared by the fingerprint and the prompt; the `snapshotIn`
  validator, which also checks `verdicts`, used by `told()` and the wake log;
  setting `isHeld` again when the second read still finds the session busy.

## Rejected alternatives

- **Choosing the newer read only at `lookAt`'s overtaken check** (the
  simplest and extensible plans). It misses a newer read stored while
  `deliver` waits.
- **A synchronous mirror of `busy`, set at the top of `turn.start` and
  `turn.complete`** (the robust plan). It is a second record of one fact, is
  lost on a hot reload so the state read is still needed as a fallback, and
  the spec says `deliver` reads `busy` a second time. The ordering argument
  makes the literal second read correct.
- **Awaiting `promptedKey` before claiming `toldSeq`** (the robust plan).
  During that await an older delivering look could pass its last guard and
  submit an older state; the claim on entry refuses it today.
- **A told queue that swallows errors** (the simplest plan). `deliver` would
  report a handover whose record was never written.
- **Rewriting stored records, recognising `gh pr edit`, quote awareness in
  the push pattern.** Rejected by the counsel; see the spec.

## Steps

Each test is written first and seen to fail before its fix.

1. `github.ts` and `state.ts`, with the tests for verification items 1 and 10,
   and the two `github.test.ts` fixtures that add `stuck` moved to
   `do-not-merge`.
2. `register.tsx`: `told()` through `snapshotIn`, every comparison through
   `isSameState`, and `DECISION_LABEL` imported; tests for items 2, 3 and 4.
3. `register.tsx`: `newestRead`, its reset in `watch`, and the late choice in
   `deliver`; tests for items 5 and 6, and later for items 11 to 13 and 15
   to 20.
4. `register.tsx`: the second read of `busy`; tests for items 7 and 8.
5. `register.tsx`: the told queue, the claim order, and `forgetTold` through
   it; the test for item 9.
6. The CI handler's `isSameRun` check and the comments.
7. The documentation.
8. The gates, in the order `CLAUDE.md` gives.

## Test plan

Tests 2 to 9, 11 to 13 and 15 to 20 go in `mods/pilot/tests/register.test.ts` with
`mock.clock`, `fakeGitHub` and, where a record is edited, `memoryStore`.

1. `github.test.ts`, "the workflow's own labels leave the fingerprint
   unchanged and any other label moves it": loops over `WORKFLOW_LABELS`,
   checks `do-not-merge` differs, and checks `changesBetween` for a new head
   plus `in-review` names the head and has no labels line.
2. "a change confined to in-review draws no prompt at a poll or at a held
   turn end, and do-not-merge draws one": the poll part also checks the wake
   is recorded as unchanged.
3. "a told record whose stored fingerprint no rule produces draws no prompt
   against an unchanged pull request": the stored string is
   `OPEN|cccccccccccc|in-review|older-format`.
4. "a told record without a labels array counts as no record and does not
   throw": the record's head differs from the pull request, so
   `changesBetween` runs; expects the "no record" prompt.
5. "an overtaken poll hands over the newer stored read: a rerun that passed,
   not a failure": a held gh read (`world.hold`) answers a failure, `/pilot
   poll` stores the passing rerun, the release follows; expects "passed
   again", no "went from passed to failed", and the told record holding the
   newer completion time.
6. "an overtaken poll whose newer stored read is what the session was told
   sends no prompt": as 5, but the newer read is the original told state.
7. "a hold recorded after the turn ended is handed over at once": a
   `state.get` hook, registered before the engine, holds the first read of
   `busy` after `gh pr view 7` is recorded, answering the value from when the
   read began. Watch, start turn t1, push head D, advance 10 minutes, end t1,
   settle, release, settle with no advance; expects one prompt naming
   `dddddddd`, and still one after another 10 minutes.
8. "a turn that starts again before the second read of busy keeps the hold":
   as 7, with turn t2 started before the release; no prompt until t2 ends,
   then one. This passes on the base and guards the fix.
9. "two overlapping tells whose writes finish newest first leave the newer
   read told": a custom store holds the poll's `prompted:` write, the desktop
   app's CI event tells head D without being awaited, the held write is
   released, then the event is awaited; expects the told record at head D.
10. `state.test.ts`: `git -c a=b push`, `git -C x -c a=b push` and
    `git -c a=b -c c=d push` match; `git -c a=b pushx` and `git -c a=b log`
    do not; every existing negative still does not.
11. "a poll overtaken by the desktop app's CI event hands over neither its own
    older read nor the event's, so the failure is told once": the poll's gh
    read is held answering checks running, the CI event's look stores the
    failure while `holdCiPrompt` holds its prompt, then both are released;
    expects no change prompt.
12. "a poll that read no change hands over nothing for a read the desktop
    app's CI event stored and has not yet told": `storeHoldingTold` holds the
    poll's read of the told record while the CI event's look stores a failure
    and its prompt is held; expects no change prompt.
13. "a poll that read no change hands over nothing for a read the look after
    posting a review stored and has not yet told": as 12, with the look after
    the post held on its read of the seen time, which `holdNext` now takes a
    key prefix for.
14. The existing register, state and github suites pass. This passes on the
    base by definition.
15. "a poll that read no change hands over nothing while the desktop app's
    CI event has not yet told its read, even after another look reads the
    same failure": as 12, with `/pilot poll` run after the event's look
    stores the failure and before the poll's read of the told record is
    released; expects no change prompt, none after another 10 minutes, and
    the told record on the failure at head C. Test 12 also checks that
    record.
16. "a poll that read no change hands over nothing while the look after
    posting a review has not yet told its read, even after another look
    reads the same review": as 13, with `/pilot poll` in the same place.
17. "a change a poll reads while the CI event's prompt is held is handed
    over once, after the event, and the told record ends on it": the branch
    moves to D while the event's prompt is held; expects one change prompt
    after the next poll and the told record at head D. This passes on the
    base, where the poll handed the move over at once; it guards that the
    delay loses nothing.
18. "a poll whose read of the told record is older than the CI event's
    record of the failure hands over nothing, even after another look reads
    the same failure": as 15, but the event's prompt is released and the
    event awaited before the poll's read of the told record is released;
    expects no change prompt after another 10 minutes and the told record on
    the failure.
19. "a poll whose read of the told record is older than the record the look
    after posting a review wrote hands over nothing, even after another look
    reads the same review": as 16, with the post awaited before the poll's
    read of the told record is released.
20. "a refused CI event prompt leaves the failure for the next poll, which
    hands it over once": the event's prompt is dropped; after two polls,
    expects one change prompt and the told record on the failure. It passes
    on the base, and fails when the mark is taken out only after the read is
    recorded as told.
21. "a poll that read no change hands over nothing while the desktop app's
    CI event, overtaken by /pilot poll, has not yet told the failure it
    read": as 15, but the CI event's read of the pull request is held with
    `world.hold` while `/pilot poll` stores the failure first, then released
    so the event's look is overtaken while its prompt is held; the poll is
    released before the event's prompt. Expects no change prompt after
    another 10 minutes and the told record on the failure. It fails on
    89476b0, where the overtaken look left no mark.
22. "a poll that read no change hands over nothing while the look after
    posting a review, overtaken by /pilot poll, has not yet told the review
    it read": as 21, with the look after the post held in its read of the
    pull request by `world.hold` set in `onPost`, and then held on its read
    of the seen time while the poll chooses. It fails on 89476b0 for the
    same reason.
