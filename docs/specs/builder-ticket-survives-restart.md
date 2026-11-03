# Builder keeps a sub session's ticket across a restart

Date: 2026-11-03. This is the builder half of the issue "An archived sub
session frees its foreman slot". The foreman half, freeing the slot of a sub
session that the desktop app lists as archived, is already on the base branch
(see `docs/specs/foreman-queue-begins-waiting-session.md`).

## Goal

A foreman sub session opened a pull request, merged it, ran the cleanup and
was archived, yet its builder status file still said `waiting-on-builder`
with no pull request, and foreman counted it as busy for more than a day. The
file had frozen two days earlier. The desktop app had stopped the session's
process after a compaction and later started it again. In the new process
builder's memo of the ticket was gone, because `$.state` does not survive a
process restart. Builder then looked for the ticket in the transcript's first
user message, which after a compaction is the summary, and the summary had
reworded the `foreman-ticket:` line as a bullet. So builder found no ticket,
wrote nothing for the rest of the session, and at its end did not delete the
file after the merge. A second sub session on the same machine froze the same
way.

This change keeps the ticket in builder's store, which does survive a
restart, so a ticketed session goes on writing its status file after any
number of restarts and deletes it after its merge.

## Users and trigger

Every session that foreman starts, whose first prompt holds a
`foreman-ticket:` line, and whose process the desktop app or the person stops
and starts again. Foreman reads the file; the person reads foreman's pane.

## Behavior

1. **The ticket is stored when it is found.** When builder finds a ticket in
   a session's first prompt, it stores the facts that never change for that
   session in its own `$.store`, under a key made of a fixed prefix and the
   session id: the ticket, the status file's path, the desktop session id
   and the parent session id when the prompt gave them, and the working
   folder. The stored record also carries a stamp, the time it was stored.
   The memo's generation, which decides which copy of the hooks owns the
   memo, is not stored.
2. **Only a found ticket is stored.** A session without a ticket stores
   nothing, so the store holds no record for the person's ordinary
   sessions, and a "no ticket" answer reached after a refused transcript
   read never outlives the process.
3. **A restarted process takes the stored ticket up.** When builder has no
   memo for the session, at the hooks' start or at a prompt, it reads the
   stored record for the session id before it reads the transcript. A
   record that is present and well formed becomes the memo, as a ticket
   found in the first prompt would, and the session writes its status file
   from then on. Only when there is no record does builder read the
   transcript, with the strict ticket line as today.
4. **The stamp follows the session's life.** While the session is ticketed,
   builder refreshes the record's stamp when it writes the status file and
   the stamp is more than a day old, so a session that waits for weeks keeps
   its record. The refresh never stores a record again once the session's
   end has begun.
5. **The record goes with the file after a merge.** At the session's end,
   when the watched pull request merged, builder deletes the stored record
   in the same step that deletes the status file, after the file's delete
   has been run. It never deletes the record at an end without a merge,
   because a process that the desktop app will start again ends the same
   way.
6. **Old records are dropped.** A record whose stamp is fourteen days old,
   or that cannot be read as a record, is dropped by the same kind of sweep
   that drops builder's other stored records.
7. **The spec it amends.** `docs/specs/builder-status-file.md` says that a
   resumed session finds its ticket in the transcript. That edge case is
   rewritten to say the ticket is read from the store first, and the
   transcript only when the store has none.

## Edge cases

- **A restart before any compaction** takes the stored ticket up too, so the
  transcript is not read at all.
- **A session ticketed before this change ships** has no stored record; a
  restart after a compaction still loses its ticket, as today. Its next
  lookup in a process with this change stores nothing new, because it finds
  no ticket.
- **A `/clear`** starts a conversation under a new session id, which has no
  record, so it looks for its own ticket. The old record ages out.
- **Two copies of the hooks** in one process, before and after a hot reload,
  read the same record; it only seeds a memo, and the memo's existing
  ownership rule decides which copy writes.
- **A session resumed after its merge** finds no record, because the merge
  deleted it. When its transcript begins with a compaction summary, it
  writes nothing, which matches the file being gone. When its transcript
  still begins with the first prompt, it finds the ticket line there again
  and writes the file once more, as it did before this change (see
  Non-goals).

## Non-goals

- Remembering that a session's pull request merged. A session resumed after
  its merge whose transcript still holds the ticket line writes its status
  file again, as it does without this change, because the store keeps only
  a ticket that was found and never a mark that a session is finished.

- Foreman acting on a status file whose write time has stopped moving. Its
  pane already shows such a file as stale, but no rule wakes the parent.
  That is filed as its own issue.
- Loosening the ticket line so that it matches a ticket reworded in a
  compaction summary.
- Storing that a session has no ticket.
- Repairing status files that froze before this change; foreman's rule for
  archived sessions already frees their slots.
- A transcript longer than `$.session.messages()` returns, for a session
  with no stored record, which stays as `docs/specs/builder-status-file.md`
  describes.

## Failure modes

- **A refused store read** counts as no record, and builder reads the
  transcript as today.
- **A refused store write,** including one past the store's size limit,
  leaves the session ticketed in its process; a later restart then falls
  back to the transcript. Nothing about the status file's writing changes.
- **A refused delete after a merge** leaves the record, which the age sweep
  drops later. A restart before then would write the file again for a
  merged session; the record's delete is attempted only after the file's.

## Verification

Tests in `mods/builder/tests/register.test.ts`. Each test for items 1, 2,
4, 5 and 6 fails on the base branch or without the part of the change it
names. The tests for item 3 pass on the base branch, which stores no record
at all, and guard against a later change that stores one for a session
without a ticket:

1. A ticketed first prompt stores the record under the session id, with the
   ticket, the path, the desktop id, the parent id and a stamp.
2. A session whose store holds the record and whose transcript begins with a
   summary holding only `- foreman-ticket: <value>` writes its status file
   at its first prompt and at the hooks' start, and, after a watched pull
   request merges, deletes the file and the record at its end.
3. A first prompt without a ticket stores nothing.
4. An end without a merge leaves the record.
5. With a fake clock, a status write more than a day after the stamp
   refreshes it, one within a day does not, and the sweep drops a record
   fourteen days after its last stamp and keeps one refreshed within that
   time.
6. A refused store read falls back to the transcript, and a refused store
   write leaves the session writing its file.

The gates in the project's `CLAUDE.md` all pass.

## Decided by the counsel

- How should builder find a foreman sub session's ticket again after the session's process restarts and its transcript now begins with a compaction summary? The counsel chose: Keep the ticket memo (ticket, parent session id, desktop session id, status file path) in builder's $.store under the session id when it is first found, and read it there before the transcript when the in-memory memo is gone. 7 of 7 members voted for it.
- Should builder's store also record that a session has no ticket, or only a ticket that was found? The counsel chose: Store only a ticket that was found; a session without one stores nothing and, after a restart, looks in the transcript again with the strict pattern. 6 of 7 members voted for it.
- When should builder remove a session's stored ticket from its store? The counsel chose: By age, and also at the session's end once its watched pull request merged, in the same step that deletes the status file. 4 of 7 members voted for it.
- Should this change also make foreman act on a sub session whose status file has stopped being rewritten, or leave that to a follow-up issue? The counsel chose: Leave it out of this change, list it under Non-goals, and file it as its own issue. 7 of 7 members voted for it.
- How does a stored ticket count as untouched for the fourteen-day age rule, given that a sub session can live for days? The counsel chose: Stamp it when it is stored and refresh the stamp while the session is ticketed, at most once a day, when builder writes the status file; the sweep drops a record whose stamp is fourteen days old. 7 of 7 members voted for it.
