# Plan: builder keeps a sub session's ticket across a restart

Date: 2026-11-03. This plan implements
`docs/specs/builder-ticket-survives-restart.md`. Three planners wrote plans
from different starting points: the simplest change, the most robust one,
and the most extensible one. A judge scored them against the spec and the
code. The simplest plan won with five grafts. It meets the spec in full, it
adds no state held only in memory, and it is the smallest of the three.

## Chosen approach

Builder keeps one record per ticketed session in its `$.store`, under the
key `ticket:<session id>`. The change touches existing functions and adds
no new module and no new module variable.

- **Reading the record.** `startStatus` reads the record when `$.state`
  holds no memo for the session. The hooks' start calls `startStatus`, and
  so does `lookForTicket` before it reads the transcript, so both places
  read the store first without any change to `lookForTicket`. A record that
  reads well becomes the memo through `newMemo` and `takeUpMemo`, with this
  copy's load stamp as the generation.
- **Storing and refreshing it.** Both happen in one place, `writeStatus`,
  right after a file write that succeeded. The write that `adoptMemo`
  forces when the ticket is first found stores the record. Later writes
  store it again only when the stored stamp is more than a day old, or when
  the record is missing or cannot be read. The minute's tick goes through
  `writeStatus`, so a session that waits for weeks refreshes its record
  once a day.
- **Deleting it.** `deleteAfterMerge` deletes the record right after the
  `rm -f` of the status file, on the merged path only.
- **Sweeping it.** A new `pruneTickets`, written like `pruneUsage`, runs at
  `session.start` beside the other sweeps and drops records whose stamp is
  more than fourteen days old, or that cannot be read.

## Grafts from the other plans

1. **The fence checks the session as well as the generation.** After a
   `/clear`, `reopenForNextConversation` sets `statusClosed` back to false,
   and the new conversation's take-up sets `statusGen` back to the same
   load stamp. A fence on `statusClosed` and the generation alone would then
   let a refresh that started before the end store a merged session's record
   again. So the check right before the store write also requires
   `ticketFor === memo.sessionId`. This came from the extensible plan.
2. **The store calls in the refresh have a time limit.** The refresh is
   awaited inside the status write, so a store call that never settled
   would hold that write forever and freeze the file, which is the failure
   this change exists to end. Each store call in the refresh goes through
   `withinTimeout`, as the file write beside it does. This came from the
   robust plan.
3. **The record reader is strict.** The stored path flows into `rm -f`, so
   the reader rejects a path that is not absolute, that has a `..` or `.`
   segment, or that does not end in `/foreman/builds/<session id>.json`. It
   also requires the ticket to come back unchanged through `ticketIn`. This
   came from the robust and extensible plans.
4. **A test proves the order of the deletes.** A spy on `store.delete`
   records whether the `rm -f` of the file has already run, which is the
   order Behavior 5 states. This came from the extensible plan.
5. **Pure tests pin down the reader.** `tests/status.test.ts` tests the
   reader on its own, with a session id that does not match, a bad path, an
   empty ticket, a stamp that is not a number and a damaged parent id. This
   came from the robust plan.

## Rejected alternatives

- **A separate module for the record, with a version field and fields kept
  for later.** This was the extensible plan. It adds a file, a version
  policy and handling for unknown fields that no requirement asks for, and
  it changes the return type of `takeUpMemo`, which every take-up passes
  through. The owner prefers the smallest change that fully works.
- **A write queue, a count of queued steps and a second delete after the
  queue settles.** This was the robust plan. It adds three module variables
  that must stay exact across a hot reload and two copies running at once.
  The second delete only does what the fourteen-day sweep already does.
- **Storing the record on every take-up, inside `adoptMemo`.** Both larger
  plans did this, so that a session ticketed before this change gains a
  record on a hot reload. The spec does not ask for it, and the refresh in
  `writeStatus` already stores a missing record at the next write.
- **Running the sweep after this copy's own refresh.** The robust plan did
  this, so that a session restarted after fourteen days refreshes its old
  record instead of losing it. That conflicts with Behavior 6, and it could
  bring back a merged session whose record delete was refused. Here a
  record older than fourteen days is neither taken up nor kept.
- **Caching the stamp in a module variable.** Both larger plans did this to
  save one store read per file write. A local store read once a minute is
  cheap, and the cache is state that a hot reload loses and a `/clear` must
  reset.
- **Storing the record in `lookForTicket` at the moment of the find.** The
  extensible plan did this, which matches Behavior 1 most literally. The
  write that `adoptMemo` forces runs at once after the find, so storing it
  there gives the same result from one place.

## Steps

1. In `mods/builder/hooks/status.ts`, add the record type, its builder from
   a ticketed memo, and its strict reader, beside `statusMemoIn` and
   `newMemo`.
2. In `mods/builder/hooks/register.tsx`, add the key prefix, the fourteen
   day and one day constants, and a time limit for store calls beside the
   usage store's constants.
3. Add the function that reads the record, with every failure counted as no
   record and a record older than fourteen days refused, and use it in
   `startStatus`.
4. Add the refresh, with the fence and the time limits, and call it in
   `writeStatus` after a successful write, catching every error.
5. Delete the record in `deleteAfterMerge` right after the file's delete.
6. Add `pruneTickets` and start it in `session.start` beside the other
   sweeps.
7. Amend `docs/specs/builder-status-file.md` (Behavior 2 and the edge case
   about a resumed session) and `mods/builder/README.md` (the paragraph on
   the first prompt and the list of what the mod keeps).

Each test below is written first and seen to fail before the code that makes
it pass.

## Test plan

The tests in `mods/builder/tests/register.test.ts` use `foremanSession` with
a stored record and a transcript whose first user message is a compaction
summary holding only `- foreman-ticket: slot-1`.

1. **The record is stored.** A ticketed first prompt with a parent id
   stores the record with the ticket, the path, the desktop id, the parent
   id, the working folder and a stamp. A second case with no desktop id
   stores no desktop id. This covers Verification item 1.
2. **A restart takes the record up and the merge deletes it.**
   - At the hooks' start, the stored record gives a status file with the
     ticket, and the transcript is never read.
   - With the store read refused at the start and allowed again at the
     first prompt, the prompt writes the file.
   - After a watched pull request merges, the end deletes the file and the
     record, and the delete spy shows that the record's delete ran after
     the file's.
   - This covers Verification item 2.
3. **A first prompt without a ticket stores nothing,** both when the
   transcript is read and when its read is refused. This covers
   Verification item 3.
4. **An end without a merge leaves the record,** both for an ordinary end
   and for a `/clear`. This covers Verification item 4.
5. **The stamp and the sweep, on the fake clock.**
   - A record stamped more than a day ago is refreshed at the first write.
   - A record stamped less than a day ago is not written again over a
     stretch of minute ticks.
   - The sweep drops a record more than fourteen days old, a value that is
     not a record, and a record whose path names another file, and keeps a
     thirteen-day-old record.
   - A record more than fourteen days old is not taken up.
   - This covers Verification item 5.
6. **Refusals.**
   - A refused store read falls back to the transcript and finds a strict
     ticket line there.
   - A refused store write leaves the session writing its file, with its
     state times unchanged.
   - A store call that never settles does not stop later writes.
   - After a merged session's end and a `/clear`, a refresh that was in
     flight does not store the record again.
   - This covers Verification item 6 and grafts 1 and 2.

The pure tests in `mods/builder/tests/status.test.ts` cover the reader case
by case and check that a record built from a memo reads back unchanged.

The existing tests must pass unchanged, in particular the hot reload test
that reads the transcript once, the `/clear` tests and the test that deletes
the file after a merge.
