# Foreman starts the person's queued issues by itself when a slot frees

Date: 2026-10-30.

## Goal

The person gives a foreman parent session an ordered queue of issues, such
as "run ABC-1, then ABC-2", and wants each one to start as soon as a slot is
free, without typing anything more. Today a freed slot wakes the parent's
model with a foreman line, the parent calls `start_session` on that turn, and
the desktop app refuses it, because a turn that began from a mod's prompt is
an automated turn and the app starts sessions only on the person's own typed
words. In the incident behind this change, the parent then fell back to a
proposal card, the app's permission check blocked the card too, and the
person was asked again to approve an issue they had already queued.

Reading the installed desktop app showed why no automated turn can ever
start a session: the check looks at how the current turn began, not at who
makes the call, so a call from the mod meets the same check. Two things are
open without a typed turn, though. A start made on the person's own typed
turn has no limit on how many sessions it starts, and `send_message` to a
session that already exists has no check on who sends it; foreman already
uses it for its idle nudges. This change uses both: every queued issue's sub
session starts at once on the person's typed turn, the ones beyond the free
slots wait, and foreman itself tells the next waiting one to begin when a
slot frees.

## Users/Trigger

- The person, who types a queue into a foreman parent session, in any words
  that name more issues than there are free slots.
- The parent's model, which starts every queued issue in the person's order,
  one `start_session` call at a time, following the wake skill.
- Foreman, which decides which starts wait, keeps the queue, and sends the
  begin message when a slot frees.

## Behavior

1. **Which starts wait.** When the parent makes a keyed `start_session` call
   while no slot is free, foreman adds a wait line to the brief beside the
   ticket, and the session it starts is a waiting session. The order of those
   calls is the queue's order. The count of free slots for this decision
   includes the sessions paired in the ledger that have no status file yet,
   so several starts in one turn see each other, and the count and the
   pairing are decided inside the same ledger write.
2. **The wait line.** The brief does not run `/implement` and then say to
   wait. It says that the session runs `/implement <issue>` only once
   foreman's begin message arrives, and that until then it replies only that
   it waits, and makes no change to any file, branch or issue. The line is a
   fixed text in the mod, and the mod's tests check it word for word.
3. **The queue.** Foreman records each waiting session in the ledger with its
   ticket, its `local_` id, its issue key and its place in the queue. A
   waiting session is not busy: it does not count against a slot, foreman
   does not nudge it, and its missing status file raises no wake. The
   builder mod starts a status file for every session whose first prompt
   holds a ticket, so a waiting session soon has one that shows it idle with
   no issue, no stage and no pull request; foreman ignores that file while
   the session waits.
4. **Beginning.** When a slot frees, foreman takes the first waiting session,
   records in the ledger that it claimed it, and only then sends it the begin
   message through `send_message`. The begin message is a fixed constant,
   never built from issue text, and goes only to a session id the ledger
   recorded. It tells the session to bring its branch up to date with the
   base branch first, with the app's tool for that, and then run
   `/implement <issue>`. The session now counts as busy, and foreman watches
   it like any other.
5. **Telling the person.** Foreman wakes the parent with one line, such as
   "foreman began ABC-2, the next issue in the queue, in the slot ABC-1
   freed; tell the person so in one line.", added to the same wake that
   reports the merge when there is one. The parent says that line in the
   chat and does nothing else for it: no `start_session`, no `send_message`
   and no change to the queue.
6. **The queue against the `Next issue:` fact.** While the queue has a
   waiting session, a freed slot begins it and the parent is not asked to
   pick. Once the queue is empty, a freed slot wakes the parent as it does
   today, and the parent follows `Next issue:`.
7. **More slots.** When the person raises the slot count with
   `/start-foreman n`, foreman begins waiting sessions in the new slots the
   same way.
8. **A refused start.** The hold that foreman keeps today for the Remote
   Control refusal also covers the app's refusal on an automated turn. A held
   key is told to the person once, in one line naming the issue, is never put
   to the person again for approval, and starts on their next prompt,
   whatever that prompt says. The hold's texts no longer say why the person
   is where they are: they say only that the app refused the start and that
   the issue starts on the person's next message.
9. **A begin that is not sent.** When `send_message` fails, foreman keeps the
   claim and tries again on each later read, but only while the session list
   shows the target unarchived, and raises one notification on the first
   failure. Once the target is archived or missing from the list, foreman
   takes it out of the queue, holds its key so the parent starts the issue
   again on the person's next prompt, raises no second notification for that
   key, and begins the next waiting session.

## Edge cases

- **Several queued issues in one turn.** The parent starts them one call at
  a time, in the person's order, and each call sees the pairings the earlier
  ones recorded, so exactly as many start at once as there are free slots.
- **A waiting session that does not wait.** If a waiting session's status
  file shows `/implement`'s progress before its begin message, that is an
  issue key, a stage or a pull request, foreman treats it as begun: it takes
  it out of the queue and counts it as busy. The person can see this, because
  more sessions then run than there are slots.
- **The person archives a waiting session.** It leaves the queue on the next
  read, and the issue is dropped. This is how the person removes an issue
  from the queue.
- **A start the person wants at once while every slot is full.** It waits
  too, at the back of the queue. The person raises the slot count to run it
  at once.
- **A target that stays unarchived but keeps refusing messages.** It stays
  first in the queue and holds every waiting session behind it until the
  person acts, for example by archiving it. The person sees the one
  notification raised on the first failure and nothing more. This is an
  accepted case, not a defect.
- **A restart or a hot reload of the mod.** The queue and the claims live in
  the ledger in the mod's store, so they survive both, and a claim recorded
  before a begin that never went out is retried on the next read.

## Non-goals

- No command to remove or reorder queued issues. Archiving a waiting session
  drops it, and a new start goes to the back.
- No cap on how many sessions may wait at once. A waiting session runs no
  turns and holds only a worktree and a session row.
- No change to the `/implement` skill. The brief's wait line is the whole
  instruction.
- No limit on retrying a begin against an unarchived target beyond the one
  notification.
- No change to how the `Next issue:` fact is used once the queue is empty.
- No timer: every retry happens on a read foreman makes anyway.
- No way around the app's own start check. Every start is still made on the
  person's typed turn, and the app still judges it.

## Failure modes

- **The app refuses the parent's starts.** The keys are held as Behavior
  point 8 says, and the issues start on the person's next prompt.
- **A begin message is not sent.** Behavior point 9.
- **A later version of the desktop app adds a check on who sends
  `send_message`.** Every begin then fails while the targets stay unarchived,
  so the queue stops with one notification, as for a target that keeps
  refusing. The person can still start each issue by typing. This risk is
  recorded here so that a reviewer of such an app version knows where to
  look.
- **The ledger write that claims a session fails.** No begin message is
  sent, and the next read tries the claim again.

## Verification

- Tests in `mods/foreman/tests`, using the fake app in `tests/world.ts`,
  show each Behavior point and edge case above: starts beyond the free slots
  carry the wait line and enter the queue in order; a waiting session is not
  busy, not nudged and raises no missing-file wake; a freed slot claims and
  begins the first waiting session with the fixed begin message, and the
  parent's wake carries the one line naming it; the empty queue falls back to
  today's wake; raising the slot count begins waiting sessions; the
  automated-turn refusal is held with one notification and texts that make
  no claim about where the person is; a failed begin is retried while the
  target is unarchived and, once it is archived, its key is held without a
  second notification and the next session begins; a waiting session whose
  status file shows `/implement`'s progress counts as begun, while one whose
  file shows it idle with no issue does not; a restart keeps the queue.
- The README, the wake skill and `tests/held.test.ts` quote the hold's texts
  and are updated together with them. The wake skill's "When the parent
  speaks" section gains a bullet for the begin line.
- The issue is done when, in a real desktop session, a queue of two small
  issues with one slot starts the second issue's sub session after the first
  one's merge, with no message from the person. The report says plainly
  whether this was seen.

## Decided by the counsel

- How should a freed slot start the next issue in the person's queue when no person typed the turn? The counsel chose: Start every queued issue's sub session at once, on the person's own typed turn that gives the queue; the sessions beyond the free slots get a line in their brief telling them to wait, and when a slot frees foreman itself sends the first waiting one a begin message through the desktop app's send_message tool, which it already calls without a typed turn for its idle nudges. 7 of 7 members voted for it.
- Which sub session starts should wait for a begin message, and who decides that? The counsel chose: Foreman decides by itself: any keyed start_session call in a parent while no slot is free waits. Foreman adds the wait line to the brief beside its ticket, and the order of those starts is the queue's order. The parent's model only has to start every queued issue in the person's order. 6 of 7 members voted for it.
- When foreman sends a waiting sub session its begin message, how is the person told in one line which issue started? The counsel chose: Foreman wakes the parent's model with one line, such as "foreman began ABC-2, the next issue in the queue, in the slot ABC-1 freed; tell the person so in one line.", added to the same wake that already reports the merge when there is one, and the parent says that line in the chat. 7 of 7 members voted for it.
- What should foreman do when a queued issue still cannot begin, either because the app refuses its start_session or because the begin message cannot be sent? The counsel chose: Widen the hold to the automated-turn refusal as in Option 1, and retry a begin message that is not sent on each later read only while the target session is listed unarchived, with one notification on the first failure; once the target is archived or missing, take it out of the queue and hold its key so that the parent starts the issue again on the person's next prompt, and the next queued session begins. 7 of 7 members voted for it.
- What does this change deliberately leave out of scope? The counsel chose: Leave all of them out: no remove or reorder command (archiving a waiting session drops it), no cap on waiting sessions, no change to /implement (the brief's wait line is the whole instruction), no limit on retrying a begin against an unarchived target beyond the one notification, and the Next issue fact keeps today's behaviour once the queue is empty. 6 of 7 members voted for it.
