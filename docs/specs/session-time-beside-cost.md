# Builder records how long its issue takes, and foreman adds the times up beside the cost

Written 2026-11-03. Seeded from an issue in the owner's tracker. Builder and
foreman already record what each sub session spends (see
`docs/specs/session-token-cost.md`), but nothing records how long a piece of
work takes. The owner could not tell a slow build from one that waited a night
for an answer, nor see which review round was slow next to what it cost. The
issue asked for times to follow the same path as cost, so that they survive an
archive the way cost does, and left three questions open: which clock to
measure with, how long the history is kept, and whether an export is wanted
now. Those and the gaps around them were put to the counsel.

## Goal

Builder records, for the session it runs in, when the session started, when it
entered each `/implement` stage, when its pull request opened and merged, how
long each review round took, and how its elapsed time divides into working,
waiting on the person and other waiting. It shows these in its pane and writes
them into the status file it shares with foreman. Foreman adds the time each
ticket spent waiting in its queue, keeps every sub session's times in the same
ledger entry as its cost, and shows each sub session's times and their sums
beside the existing spending lines in its pane.

## Users and trigger

The owner, reading builder's pane in a session that runs `/implement`, and
reading foreman's pane in a parent session that starts sub sessions. Nothing has
to be started: builder records from the moment it loads, and foreman reads the
times whenever it reads a sub session's status file.

## Behavior

1. **One clock.** Every time is a stamp from the engine's clock, `$.clock.now()`,
   taken in the hook or tool that sees the event, in milliseconds since the
   epoch as the status file's other times are. Every duration is the difference
   of two such stamps. No time is taken from GitHub, from a commit's date or
   from foreman's reads of the status file.
2. **The events builder stamps.**
   - **Start:** the first time builder loads in the session.
   - **Stages:** the first time each `/implement` stage is reached, whether the
     session reported it through the progress tool or the mod reported it
     itself from the watch. A stage reported again keeps its first stamp. A new
     title starts a new set of stages, as the progress bar does.
   - **Pull request opened:** the first time a watch sees the pull request
     open.
   - **Merged:** the first time a watch sees it merged. Because the watch
     polls, both stamps can be late by up to one poll interval.
3. **Time per state.** Builder keeps a total for each state of its status
   record (`working`, `needs-you`, `waiting-on-builder`, `idle`, `in-cleanup`,
   `done`). When the state changes, the time since the state began is added to
   the outgoing state's total, in the same store write that moves the state's
   start, so no stretch is added twice. Whenever the totals are read, for the
   pane or the status file, the state that is still open counts up to that
   read. Working time is the `working` total, waiting on the person is the
   `needs-you` total, and other waiting is the sum of the rest. Once the merge
   is stamped, the totals stop growing, so the issue's time runs from start to
   merge.
4. **Review rounds.** A round is a head that the package tool packaged. Builder
   keeps one entry per head: the head, the stamp of the first package call for
   it, the stamp of the post_review call that posted the review at it, and how
   the round ended. Entries are appended in order and never overwritten.
   - A second package call for the same head starts nothing new.
   - When the package tool packages a different head while an earlier entry is
     still open, that earlier entry is closed at the new call's stamp and
     marked superseded, because a push replaced it before its review.
   - A post_review call at a head with no entry, such as a review that carries
     verdicts over from the approved head, adds an entry whose start and end are
     both that call's stamp, marked carried over.
   - A post_review call at a head with an open entry closes it, marked
     reviewed.
   - Only the newest 20 entries are kept, with a count of the older ones.
5. **Where builder keeps them.** Builder keeps the stamps, totals and rounds in
   its store under a key of their own for the session, pruned after two weeks
   without an update, as the usage count is. A restart, a reload or a resumed
   session carries on from what is stored.
6. **Builder's pane.** The pane shows the elapsed time from start to merge, or
   to now before the merge, split into working, waiting on the person and
   other waiting; the stages with the time each was entered; when the pull
   request opened and merged; and each round with its duration and how it
   ended, an open round counting up to now.
7. **The status file.** The record builder writes gains an optional `timing`
   field holding the start, the stages, the pull request's opened and merged
   stamps, the per-state totals as of the write, and the rounds with the count
   of older ones. The record's version stays 1, as it did when `usage` was
   added, and a reader that predates the field keeps working. Only a ticketed
   session writes a status file, as before.
8. **Queue time, measured by foreman.** When foreman puts a ticket in its queue
   it stamps when the ticket was queued, before anything else overwrites the
   pairing's times. When it sends the begin message, the queue time is the
   difference, and foreman stores it in that ticket's ledger entry. A ticket
   begun without waiting in the queue has a queue time of zero, which the
   ledger keeps apart from an unknown queue time.
9. **Foreman's ledger.** Foreman keeps each ticket's last read times inside the
   same ledger entry as its spending, read only from the owner's row as
   spending is. An entry can exist with times and no spending yet, because
   queue time is known before the first status file is read. The per-state
   totals and the queue time keep the larger of the stored and the new value,
   so they never fall. The stamps and the rounds take the newest reading, and
   a reading without them leaves the stored ones as they were. The entry
   outlives the status file and the pairing, as spending does. Past 200
   entries, the oldest entries whose pairing is gone fold into the `earlier`
   total exactly as spending does; the folded total keeps only the four sums
   (working, waiting on the person, other waiting, queued), not stages or
   rounds.
10. **Foreman's pane.** Each sub session's row shows its working, waiting on
    you, other waiting and queued times. Next to the line with the sub
    sessions' spending, the pane shows the sum of each of those four over every
    sub session this parent started, the entries plus the folded total, with
    wording that says they are summed over sub sessions, since sub sessions
    run side by side and the sums can exceed the run's length. A row or sum
    whose times are missing shows them as unknown, never as zero.

## Edge cases

- **A reload in the middle of a state.** The state's start comes back from the
  store, so the stretch is counted once, in the state it belonged to.
- **A head replaced by a push before its review.** Its round entry is closed
  as superseded at the next package call, so it never shows as a round that is
  still running.
- **A review carried over with no package call.** It gets an entry of zero
  length, marked carried over.
- **More than 20 rounds.** The oldest entries drop off and the count of older
  ones grows.
- **A pull request that merges while builder is not loaded.** The watch stamps
  the merge when it next sees it, so the stamp is late by the time builder was
  away.
- **A status file without `timing`.** Foreman shows that row's times as
  unknown, and its entry keeps whatever it already held.
- **A damaged stored timing record in builder.** It reads as none, and builder
  starts again from that moment rather than failing.
- **A damaged ledger.** It reads as empty, as it does for spending.
- **A ticket begun without being queued.** Its queue time is zero, not unknown.

## Non-goals

- An export of the history, such as a file per finished issue, or any copy of
  it off this machine.
- History across different parent sessions.
- A time budget, or an alert when a sub session runs long.
- Per-stage and per-round times in foreman's pane. They are kept in the ledger
  and shown in builder's pane only.
- GitHub's own `createdAt` and `mergedAt` as a cross-check of the stamps.
- Back-filling sessions, or parts of a session, that ran before this change.
- Time that passes while builder is not loaded. This is a known gap: a stretch
  while builder is unloaded is counted in whichever state was open when it
  unloaded, and an event it would have stamped is stamped when builder next
  sees it.

## Failure modes

- **The store refuses a write.** Builder keeps the times in memory for the
  rest of the session and tries again at the next change, so the pane stays
  right and only a restart before a good write loses the latest change.
- **The status file cannot be written.** Builder's existing handling of a
  failed write applies; the times are still in the store.
- **The ledger grows without bound.** It cannot: each entry holds at most 20
  rounds and the list folds past 200 entries, as it does for spending.

## Verification

- Builder tests with a fake clock:
  - a stage reported twice keeps its first stamp, and a stage the mod reports
    itself is stamped too;
  - the pull request's opened and merged stamps are taken from the first watch
    that sees each;
  - a state change adds the stretch to the outgoing state's total in the same
    store write that moves the state's start, and an open state counts up to
    the read;
  - the totals stop growing after the merge;
  - a round runs from the first package call to post_review, a second package
    call for the same head starts nothing, a replaced head is closed as
    superseded, a carried-over review adds a zero-length entry, and past 20
    entries the oldest drop and the count grows;
  - a damaged stored record reads as none;
  - the status record carries `timing` and stays version 1.
- Foreman tests:
  - queue time is stamped when a ticket is queued and stored at the begin
    message, and a ticket begun without queuing gets zero;
  - an entry can hold times with no spending;
  - a file's times enter the owner's entry and a fork's file changes nothing;
  - the totals never fall, and a reading without stamps keeps the stored
    ones;
  - past 200 entries the fold keeps the four sums unchanged;
  - a row and the sums show unknown, never zero, when times are missing.
- The four gates pass for both mods.
- A hand check: in one real `/implement` session, the times in builder's pane
  match the session's own transcript timestamps for the stages, the pull
  request and one round.

## Decided by the person

- Does the owner ever reset a pull request's branch by hand to a commit it already had and force push it, so that an old head comes back while the review is running? No, never. Builder therefore checks only the newest round entry when the package tool packages a head again.

## Decided by the counsel

- Where should builder take the times it records for an issue (session start, entering each /implement stage, pull request opened, merged, each review round's start and end), and how should a duration be computed from them? The counsel chose: Builder stamps each event with the engine's clock in the hook or tool that sees it (the progress tool for stages, the watch for the pull request opening and merging, the package and post_review tools for rounds), keeps the stamps in its store and copies them into the status file; durations are differences of those stamps. 7 of 7 members voted for it.
- How should builder split a sub session's elapsed time into time working, time waiting on the person, and other time, and who measures the time a ticket spent waiting in foreman's queue before its session began? The counsel chose: Builder adds the time spent in each state of its status file (working, needs-you, waiting-on-builder, idle, in-cleanup, done) to a per-state total each time the state changes, stamped with the engine's clock and kept in its store; working time is the working total, waiting on the person is the needs-you total, and the rest is shown as other waiting. Foreman measures queue time itself, from when it reserved or queued the ticket to when it sent the begin message, because only foreman sees the queue. 7 of 7 members voted for it.
- What marks the start and the end of a review round for its duration, and how many rounds does builder keep? The counsel chose: A round is a head that the package tool packaged. It starts at the first package call for that head and ends when post_review posts the review at that head; builder keeps one entry per head (the head, its start, its end or none while open, and whether it carried verdicts over without a round), appended in order and never overwritten, capped at the newest 20 entries with a count of the older ones. 6 of 7 members voted for it.
- Where should foreman keep each sub session's times, and what total for the run should its pane show next to the existing Spent line? The counsel chose: Foreman keeps each ticket's last read times (start, stages, pull request opened and merged, the per-state totals, the rounds) inside the same ledger entry as its spending, so they outlive the file and fold past 200 entries into the 'earlier' total exactly as spending does; its own queue time goes into the same entry. Each row shows its sub session's working, waiting-on-you, other-waiting and queued times, and next to the Spent line the pane shows the sum of each of those four over every sub session this parent started. 7 of 7 members voted for it.
- What should this change leave out, so the spec can name it under Non-goals? The counsel chose: Leave out all of these: an export of the history (such as a file per finished issue) or any copy off this machine; history across different parent sessions; a time budget or an alert when a sub session runs long; showing per-stage and per-round times in foreman's pane (they are kept in the ledger and shown in builder's pane only); GitHub's own createdAt and mergedAt as a cross-check; back-filling sessions that ran before this change; and time while builder is not loaded, stated as a known gap. 7 of 7 members voted for it.
