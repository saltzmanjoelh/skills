# Foreman begins a waiting sub session instead of asking for a new issue

Date: 2026-11-02. Issue: a report from a parent session that foreman freed a
slot and told the parent to pick a new issue four times in a row while queued
sub sessions were waiting.

## Goal

A parent ran three slots with two issues waiting in foreman's queue. One of
its active sub sessions had been archived, but its status file still said
`waiting-on-builder`, because builder never wrote `done` before the archive.
Foreman frees a slot only through the `done` rule in
`mods/foreman/hooks/act.ts`, which needs the file to say `done`, so the
archived sub session held its slot for good. `freeSlots` stayed at zero and
`queueStep` never claimed a waiting session. On the reads where some other
slot did free, no waiting session could be claimed, and `decide` woke the
parent with "one slot free; pick the next issue and start it." while two
issues still waited.

Three things must hold after this change. A slot whose sub session the desktop
app's list shows is over frees on that read, so the queue begins the waiting
session. Foreman never tells the parent to pick a new issue while an issue
waits unclaimed in its queue. And when foreman cannot read the list, so it
cannot tell what waits, the person learns of it instead of only a log line.

## Users and trigger

The parent session's model, which acts on every `foreman:` line, and the
person whose queue it serves. The trigger is any read of foreman's engine,
which runs on a timer and on every status file change.

## Behavior

1. **An archived sub session frees its slot.** When a read of the desktop
   app's list shows an active pairing's desktop session archived, foreman sets
   the pairing's standing to `freed` on that read, whatever state its status
   file says and whether or not its pull request merged. The log line names
   the issue, the state the file last said and its pull request, or says it
   had none. The slot then counts as free, and `queueStep` may claim it for a
   waiting session on the same read.
2. **A deleted sub session frees its slot when the list proves it.** The same
   happens when the pairing's desktop session is missing from the list, but
   only when the list is complete (it came back shorter than its limit of 100)
   and the ledger held that desktop session id before the list was asked for.
   This is the test `queueStep` already uses before it drops a waiting session
   as no longer listed, and the two rules share one helper so they cannot
   drift apart. A pairing with no desktop session id never counts as missing.
3. **The list is read whenever behaviors 1 and 2 could act.** It is read on
   every read while any active sub session's file is `done` or its gone wake
   is still due, and at least once every gone wait while any other active sub
   session's file has not changed for longer than the gone wait. The second
   case covers a sub session whose gone wake went out or whose pull request
   merged, so an archived sub session frees its slot with no queue within
   about one gone wait, while reads made every 30 seconds for another sub
   session that works do not each wait on the list for it.
4. **A sub session that is not running but still listed unarchived keeps its
   slot**, and keeps today's gone wake. Only the person or the parent ends it.
5. **No "pick the next issue" while an issue waits.** When a read frees a slot,
   no waiting session can take it, and someone still waits unclaimed in the
   queue, foreman wakes the parent with a new sentence in place of the
   slot-free line. The sentence names the waiting issues foreman could not
   find in the desktop app's list, says the slot is kept for them, and tells
   the parent to send foreman's begin message by hand or release the issue,
   not to start a new one. Names that fail the `isWhoName` check are left out,
   and the sentence then speaks of the waiting issues without naming them.
   It fires once per freed slot, on the read that frees it, as the slot-free
   line does today. The slot stays free, so a later read whose list shows the
   waiting session claims it, and a new start the parent makes anyway waits in
   the queue behind the unclaimed sessions.
6. **A failed list read reaches the person.** When foreman's read of the list
   fails (the desktop app's tools are not connected, the tool answers an
   error, the answer cannot be parsed, or no answer comes within 30 seconds),
   foreman shows a notification with the fixed reason once when reads start
   failing. It shows it again only after a read has succeeded in between. A
   ledger mark records that the notification went out. It is set in the same
   ledger write as the outbox's `notify` entry and cleared only by a read that
   actually got a list. A read that skipped the list because no rule needed it
   does not clear it. The log line on every failure stays as it is today. Only
   the fixed reasons appear, never the tool's own error text.
7. The `foreman:wake` skill describes the new sentence, and its text about
   "one slot free" says it comes only when no issue waits in the queue.

## Edge cases

- The list is read while the archived sub session's file has already left the
  folder. The slot frees once, through whichever rule sees it first, and the
  pairing is not freed twice.
- An archived sub session whose pull request merged and whose file says
  `done` keeps today's `done` rule path and its log line.
- A read frees two slots and one waiting session can be claimed. The claim
  takes one slot, and the other gets the new sentence only if someone still
  waits unclaimed, otherwise the slot-free line.
- The list read fails on the read that frees a slot while someone waits. The
  freed slot is kept silently, as `docs/specs/foreman-failed-list-keeps-freed-slot.md`
  already requires, and the failure notification covers the person.
- The list is full (100 entries) and an open but quiet sub session falls
  outside it. Its slot is not freed.

## Non-goals

- Reporting the answer of `$.ui.open` in the parent's start, as builder does.
- Giving foreman's band a way to open its pane.
- Treating a `working` record whose file has stopped changing and whose
  session is not running as idle, so that it gets nudged.
- Finding out why the list read fails in a given parent. The new notification
  makes the reason visible, and a fix waits on what it shows.
- Freeing the slot of a sub session that is not running but still unarchived.

The first three go to a follow-up issue.

## Failure modes

- A wrongly freed slot would let foreman run more sub sessions than its slots
  allow. The completeness and known-id tests in behavior 2, and the rule that
  only archived or provably missing sessions free a slot, are what prevent it.
- If the ledger write that carries the notification mark fails, neither the
  mark nor the outbox entry is written, so the next failing read tries again.
- If the notification itself cannot be shown, the log line still records the
  failure.

## Verification

Tests in `mods/foreman/tests/`, written before the code:

- An active pairing whose file says `waiting-on-builder` with no pull request,
  and whose session the list shows archived, is freed on that read, its log
  line names the state and the missing pull request, and the queue claims the
  waiting session for the slot.
- The same pairing missing from a complete list, with an id the ledger knew,
  is freed. Missing from a list of exactly 100 entries, or with an id the
  ledger learned during the read, or with no desktop session id, it keeps its
  slot.
- A pairing whose session is listed unarchived but not running keeps its slot
  and still gets the gone wake.
- A freed slot that no waiting session can take, because the list leaves the
  waiting session out, wakes the parent with the new sentence and not with
  "pick the next issue". The existing test in `queue.test.ts` that pins the old
  wake is rewritten to this. A second read with the same state sends no new
  wake, and a third read whose list shows the waiting session claims the slot.
- A run of failing list reads shows the notification once. A successful read
  and then another failure show it again. A read that skipped the list does
  not.
- All four gates pass for both mods.

## Decided by the counsel

- When foreman's read of the desktop app's session list shows that an active sub session's desktop session is archived, but that sub session's status file never reached `done` (for example it still says `waiting-on-builder` because builder never wrote `done` before the archive), what should foreman do with its slot? The counsel chose: Free the slot on that read, log why, and let the queue claim it, whatever state the file says and whether or not its pull request merged. 7 of 7 members voted for it.
- When a read frees a slot, someone still waits in foreman's queue unclaimed, but no waiting sub session can be claimed because the desktop app's list did not show its session as surely unarchived (it fell outside the list's 100 most recent sessions, its entry's archived flag was not exactly false, or the pairing has no desktop session id), what should foreman tell the parent? The counsel chose: Wake the parent with a new sentence instead of the slot-free line: it names the waiting issues foreman could not find in the list, says the slot is kept for them, and tells the parent to send foreman's begin message by hand or release the issue, not to pick a new one. 7 of 7 members voted for it.
- When foreman's read of the desktop app's session list fails (the desktop app's tools are not connected, the tool answers an error, the answer cannot be parsed, or no answer comes within 30 seconds), how should the person learn of it? The counsel chose: Show a notification with the fixed reason once when reads start failing, and again only after a read has succeeded in between; keep the log line on every failure as today. 6 of 7 members voted for it.
- The parent's comment on the issue also suggests three changes beyond the queue: report the answer of `$.ui.open` in `becomeParent` as builder does, give foreman's band a way to open the pane, and treat a `working` record whose file has stopped changing and whose session is not running as idle so it gets nudged. Which of them belong in this pull request? The counsel chose: None: this pull request covers only the queue (archived sessions free their slots, the new wake when waiting sessions cannot be found, the notification for a failed list read); the three go to a follow-up issue. 7 of 7 members voted for it.
- An active sub session whose status file never reached `done` may also be missing from the desktop app's list altogether (for example because its session was deleted), rather than listed as archived. Should that free its slot too? The counsel chose: Yes, but only when the list is complete (it came back shorter than its limit of 100), the same test `queueStep` already uses before it drops a waiting session as no longer listed. 7 of 7 members voted for it.

## Decided by the person

- Does the person ever unarchive a foreman sub session and let it carry on working? No: an archived sub session is finished, so freeing its slot for good on the read that shows it archived is right, and foreman does not take the slot back if the session is later unarchived.
