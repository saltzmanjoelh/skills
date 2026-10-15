# The pilot mod hands the session the newest state once, at the right time

Issue: SAL-244, covering SAL-216, SAL-217, SAL-219, SAL-221 and SAL-225.
Written 2026-10-12.

## Goal

The pilot mod hands a change on the watched pull request to the session with a
prompt, and records what it handed over as told. The review of SAL-160 went
four heads deep on the ordering of `lookAt`, `tell` and `deliver` in
`mods/pilot/hooks/register.tsx`, each head finding a narrower race. This
change closes the three races still open, designed together:

- A change held while the session's turn runs can miss its handover at the
  end of the turn and wait ten minutes (SAL-216).
- Two overlapping records of what was told can be written in the wrong order
  if the engine finishes a plugin's store calls out of order (SAL-217).
- A delivering look that a newer look overtook can tell the session an older
  state than the one the mod already stored and shows (SAL-219).

It also stops the session being woken by label changes the workflow makes
itself, which in past sessions cost a full re-read of the session's context
and did nothing. It widens the push pattern and writes its remaining misses
into the spec (SAL-221), and corrects how the README and specs describe
polling while a subagent runs (SAL-225).

## Users and trigger

A session running `/implement` with the pilot mod watching its pull request.
The races need a look at the pull request to overlap another look, a turn's
end or the desktop app's CI event; the label wake-ups happen every time the
session sets a state label.

## Behavior

1. **The workflow's own labels never wake the session.** The fingerprint that
   decides whether the pull request changed leaves out `in-review`,
   `waiting-on-author`, `ready-to-merge`, `stuck` and `needs-decision`. A
   change confined to those labels is not handed over and not counted as a
   change in the wake log. Any other label added or removed still is. The
   snapshot keeps every label, so the poll interval (`waitingOn` reads
   `ready-to-merge`) and the pane are unchanged. The five names live in one
   named constant, and the prompt's "Labels added" and "Labels removed" lines
   leave them out too.
2. **Every comparison of states uses the current rule.** Whether two
   snapshots differ is decided by one helper that recomputes both
   fingerprints from their fields, never by comparing stored fingerprint
   strings. `deliver`, the CI event's before-and-after comparison and the
   wake log all use it, so a told record that an older build saved compares
   correctly and causes no wake-up after the upgrade. A stored record whose
   `labels` or `checks` is not an array counts as no record rather than
   throwing.
3. **An overtaken delivering look hands over the newest stored read.** When a
   delivering look (the poll, or the held handover at a turn's end) finds that
   a newer look has already stored its read, it hands over that newer read,
   under that newer read's number, instead of its own. Only a read that its
   own look leaves for others to tell is handed over this way: one stored by
   another delivering look, or by a look that only observes other than the
   desktop app's CI event. The CI event's look and the look after the mod
   posts a review each tell the session their own read, so when the newest
   stored read is one of theirs, the delivering look hands over nothing at
   all, neither that read nor its own older one. For the same reason, while
   either of those looks has gone on with its read and has not yet told it
   or given up, a delivering look hands over nothing at all, even a read of
   the same state that a look which only observes stored before or after
   it. Such a look goes on with its read both when it stores it and when a
   newer look overtook it, because it tells the session that read either
   way. A
   change read in that time is handed over by the next poll, once that look
   is done, so it is delayed and never lost. A delivering look also hands
   nothing over when any read was recorded as told after it began reading the
   told record, because the record it read no longer says what the session
   was told, and a change measured against it could be one the session has
   already heard. It notes the number of the read last recorded as told just
   before it reads the record, and checks that number again at both points
   where it chooses what to hand over; the next poll compares the pull
   request with the new record, so the change is delayed and never lost. The
   newer read and its
   number are kept together in memory when the newer look stores them, with no
   await between, and never read back from the store, so the pair always
   matches. The read to hand over is chosen after the handover's last await
   before the prompt, so a newer look that stores its read while the handover
   waits on the told record or on `busy` also counts as overtaking it. Every
   existing guard still applies to the handed-over read: it is
   refused if a newer read was already told, if it matches what was told, or
   if the watch changed. The CI event's own prompt is the desktop app's and is
   unchanged; it still acts on its own read.
4. **A hold recorded after the turn ended is handed over at once.** `deliver`
   records the hold before it reads whether the session is busy a second
   time, with no await between recording the hold and starting that read. If
   the second read finds the turn has ended, `deliver` takes the hold back and
   goes on to hand the change over itself, inside the same claim, with no
   poll. Because the turn's end clears `busy` before it checks for a hold,
   either the turn's end sees the hold or `deliver` sees the turn ended. A
   turn that started again before the second read keeps the hold, and that
   turn's end hands it over.
5. **The told record ends on the newest read whatever order the engine
   finishes store calls in.** Every write of a told record runs through a
   one-at-a-time queue, and inside the queue the write is skipped when a newer
   read has been claimed as told since it was queued. The seen time is
   written before the record, as now.
6. **The push pattern accepts global options.** `git` followed by any number
   of `-c <key=value>` and `-C <dir>` options before `push` counts as a push.

## Edge cases

- **A real change arrives together with a workflow label change.** The real
  change moves the fingerprint by itself, so it is handed over, and the
  prompt names it without the workflow labels.
- **A person changes a state label by hand.** The session is not woken. The
  `/implement` skill never decides from the state labels, so nothing is lost.
- **A session on the old build shares the store.** It compares stored strings
  with its own rule and can wake once on a record this build wrote. No change
  here can prevent that; it stops when that session updates.
- **The newer stored read is already what the session was told.** The
  overtaken look hands nothing over.
- **The desktop app's CI event, or the look after posting a review, stores a
  read while a poll waits.** The poll hands nothing over, whether its own
  read showed a change or not, because that look tells the session the newer
  state itself. This holds also when a look that only observes, such as
  `/pilot poll`, reads the same state after that look stored it and before
  it told it. If the CI event's prompt is refused, nothing records its read
  as told, and the next poll hands it over.
- **The CI event, or the look after posting a review, records its read as
  told while a poll waits on its read of the told record.** The record the
  poll read is then older than the one now stored. The poll hands nothing
  over, even when a look that only observes, such as `/pilot poll`, read the
  same state before that look recorded it and the poll would otherwise hand
  that read over against the older record. The next poll compares against
  the new record.
- **The pull request changes again while the CI event's prompt is still on
  its way.** The poll that reads the change hands nothing over, and the next
  poll hands it over against the state the event recorded as told.
- **The watch changed while an overtaken look ran.** It hands nothing over,
  and the newer read it would have used belongs to the old watch and is
  dropped with it.
- **The newer look itself is still writing its read to the store.** The
  overtaken look uses the in-memory pair, so it never hands over the older
  value the store still holds.
- **The second read of `busy` fails.** The hold stays recorded, because it was
  recorded before the read, and the error reaches the look as a failed first
  read's does; the turn's end hands the change over. The engine skips a state
  hook that throws, so the test kit cannot make this read fail, and no test
  covers it.
- **The push pattern still misses or over-matches.** It matches `git push` or
  `gh pr merge` inside a quoted string, such as `echo "a; git push"`, which
  costs one extra read of the pull request. It misses a `-c` value quoted
  with spaces in it, such as `git -c "a=b c" push`, and other global options
  such as `--git-dir=…` before `push`; each miss costs one look, which the
  looks after the turn ends recover. The pattern is not taught about quotes.

## Non-goals

- Any change to the intervals, to when the looks after a turn end, a push or
  a merge run, or to which looks deliver.
- Recognising the session's own `gh pr edit` commands.
- Rewriting stored told records.
- A guarantee from the engine about the order of store calls; the queue makes
  the mod independent of it.

## Failure modes

- If the second read of `busy` or the handover's prompt fails, the change is
  treated as today: the hold or the stalled head stays, and the turn's end or
  the next poll hands it over.
- If the queue's write throws, the queue goes on with the next write, as the
  label queue does, and the record stays at the last write that succeeded.

## Documentation (SAL-221, SAL-225)

- `docs/specs/pilot-shows-what-runs.md` gains the push pattern's remaining
  misses under its edge cases, and its push-pattern behavior names the global
  options.
- `docs/specs/pilot-polls-on-events.md` and the README section "How often it
  looks at the pull request" say that a rerun of a failed check and a pending
  merge are also polled every 10 minutes while a subagent runs, since
  `waitingOn` returns `agents` first, and that this is acceptable because the
  subagent's finish ends a turn of the session's own whose looks work the
  interval out again.
- The README's sentence "The intervals are long where something pushed ends
  the wait, and short where only a look would see it end" becomes: the
  intervals are short where a change on GitHub's side is expected soon and
  only a look would see it, and long otherwise.
- The README stops saying a subagent's finish always "reaches the session as
  a task notification, which starts a turn". A background subagent's finish
  starts a turn; a foreground subagent's finish returns inside the turn
  already running. Either way a turn of the session's own ends afterwards and
  arms the same looks.
- The README paragraph on numbered looks and the comment above `lookAt` say
  that an overtaken delivering look hands over the newest stored read.
- The README says the workflow's own labels never wake the session.

## Verification

Each item is a test in `mods/pilot/tests/`, run by `claude plugin test .`
from `mods/pilot`, that fails on the base and passes with the change, except
items 8, 12, 13, 14, 17 and 20, which say why they cannot fail on the base.

1. `fingerprintOf` gives the same value for two snapshots that differ only by
   each of the five workflow labels, and a different value when they differ
   by another label such as `do-not-merge`.
2. A pull request whose only change is `in-review` being added, after the
   session was told its state, draws no prompt at the next poll or at a held
   turn end; a `do-not-merge` label added the same way draws one.
3. A told record whose stored fingerprint string differs from what the
   current rule computes from its fields, against an unchanged pull request,
   draws no prompt. The stored string is one no rule produces, because a
   genuine old-rule string for a pull request labelled `in-review` is exactly
   what the base computes, and a test with it would pass on the base.
4. A told record without a `labels` array, whose other fields differ from the
   pull request, counts as no record and does not throw.
5. The SAL-219 reproduction: a poll reads a failed check, a newer observing
   look reads the rerun passing and stores it, then the overtaken poll
   finishes. The prompt says the checks passed, not that they went from
   passed to failed, and the told record holds the passing read.
6. An overtaken poll whose newer stored read matches what the session was
   told, because the pull request went back to the told state, sends no
   prompt.
7. The SAL-216 reproduction: hold the poll's read of `busy` until
   `turn.complete` has run, push a new head, release it. A prompt is
   submitted without the clock moving, not after 600000 ms.
8. A turn that starts again before the second read of `busy` keeps the hold,
   and that turn's end hands the change over. This passes on the base too; it
   guards the fix against handing over while the new turn runs.
9. The SAL-217 case: two overlapping tells whose store writes the test
   finishes in reverse order leave the newer read as the told record.
10. `isPushOrMerge` matches `git -c a=b push`, `git -C x -c a=b push` and
    `git -c a=b -c c=d push`, and still rejects every negative case in the
    existing table.
11. A poll overtaken by the desktop app's CI event, whose own read is older
    than the failure the event stored and has not yet told, sends no prompt,
    and the next poll repeats nothing, so the failure is told once.
12. A poll whose own read shows no change, and which waits on its read of
    the told record while the CI event's look stores a failure and the
    event's prompt is held, sends no prompt. This passes on the base, which
    never handed over another look's read; it guards against handing over a
    read the event tells itself.
13. As 12, with the look after posting a review in place of the CI event,
    held between storing the review and recording it as told. This passes on
    the base for the same reason.
14. The existing register, state and github tests still pass.
15. As 12, with `/pilot poll` reading the same failure after the CI event's
    look stored it and before the poll's handover chooses its read. No
    prompt is sent, none follows at the next poll, and the told record holds
    the failure.
16. As 15, with the look after posting a review in place of the CI event.
17. A branch move read by a poll while the CI event's prompt is held is
    handed over once, by the next poll after the event, and the told record
    ends on the new head. This passes on the base, which handed the move
    over at once; it guards that the delay loses nothing.
18. A poll whose own read shows no change waits on its read of the told
    record, which answers the record as it stood before the CI event. The
    CI event's look stores a failure while the event's prompt is held,
    `/pilot poll` reads the same failure, and the event's prompt goes on and
    records the failure as told, all before the poll's read of the told
    record returns. No change prompt is sent, none follows at the next poll,
    and the told record holds the failure.
19. As 18, with the look after posting a review in place of the CI event.
20. The CI event's prompt is refused, and the next poll hands the failure
    over exactly once and records it as told. This passes on the base; it
    guards that the mark of a look that tells its own read is taken out
    when that look gives up, and fails if the mark is taken out only after
    the read is recorded as told.
21. As 15, except that the CI event's look is held in its read of the pull
    request while `/pilot poll` reads the failure and stores it first, so
    the CI event's look is overtaken and still goes on with its read. No
    change prompt is sent, none follows at the next poll, and the told
    record holds the failure. This fails on 89476b0, where the overtaken
    look left no mark and the waiting poll told the failure a second time.
22. As 21, with the look after posting a review in place of the CI event.

The documentation items are checked by the reviewers, since no test reads
the README or the specs.

## Decided by the counsel

- When the only change on the watched pull request is to its labels, which label changes should still wake the session with a prompt? The counsel chose Ignore only the labels the workflow itself manages (the state labels in-review, waiting-on-author, ready-to-merge and stuck, plus the mod's own needs-decision) by leaving them out of the change comparison; any other label added or removed by anyone still wakes the session., 6 of 6.
- When a delivering look (the poll, or the held turn-end look) finds that a newer look has already stored a newer read of the pull request that has not been told to the session, what should it hand over? The counsel chose Hand over the newer stored read instead of its own, as if it had made that read itself, so the session is told the latest state the mod knows., 5 of 6.
- When a delivering look decides to hold a change because the session's turn is running, but by the time it records the hold that turn has already ended (so the turn-end hook has already checked for a hold and found none), how soon should the held change be handed over? The counsel chose At once: the delivering look notices that the turn ended while it was deciding, and hands the change over itself (or starts the turn-end handover) without waiting for any poll., 6 of 6.
- The pattern that recognises the session's own `git push` and merge commands matches inside quoted strings (such as `echo "a; git push"`) and misses `git -c key=value push`. Should SAL-244 change the pattern, or only write the misses into the spec? The counsel chose Tighten the pattern to accept any number of `-c key=value` and `-C dir` options before `push`, and write the quoted-string false match into the spec's edge cases as a known, harmless miss., 6 of 6.
- Told records saved before this change carry a fingerprint that includes the workflow's own labels, so after the upgrade every watched pull request whose label set includes one of them would compare as changed once. How should that be handled? The counsel chose Compare by recomputing the fingerprint from both snapshots' fields with the current rule at every comparison, never trusting the stored fingerprint string, so an old record compares correctly and no extra wake-up happens., 6 of 6.
