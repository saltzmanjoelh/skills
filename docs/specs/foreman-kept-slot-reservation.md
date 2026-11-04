# Foreman reserves a kept slot for the parent's hand begin

Date: 2026-11-03. Issue: the follow-ups left by the change that made foreman
begin a waiting sub session in a freed slot (see
`docs/specs/foreman-queue-begins-waiting-session.md`).

## Goal

When a slot frees while sub sessions wait in foreman's queue, and the desktop
app's list does not show the first of them as surely open, foreman wakes the
parent with the kept sentence. That sentence names the waiting issues and tells
the parent to send each named session foreman's begin message by hand. Foreman
records nothing about that hand begin. A waiting session counts as busy only
once its status record shows progress, which `/implement` writes within about a
minute, so during that minute `freeSlots` in `mods/foreman/hooks/act.ts` still
counts the slot as free. If a read in that minute shows another waiting
session as surely open, such as a proposal card the person has just started,
`queueStep` claims and begins that one too, and the queue runs one more sub
session than it has slots.

After this change, the slot the kept sentence names stays kept for the named
session for the gone wait (`GONE_MS`, five minutes), so nothing else takes it
while the parent begins that session by hand. The wake skill also tells the
parent the truth about when the kept sentence comes and about this hold.

The follow-up issue listed six items. Two of them change here: the race above,
and the wake skill's account of the kept sentence after a failed read of the
list. The other four were already done on the base branch, and are closed on
the issue with the reason (see Non-goals).

## Users and trigger

The parent session's model, which acts on every `foreman:` line, and the
person whose queue it serves. The trigger is a read of foreman's engine that
wakes the parent with the kept sentence, and every read after it.

## Behavior

1. When a read wakes the parent with the kept sentence, foreman stamps each
   waiting session the sentence stands for with the time of that read. These
   are the waiting sessions taken first in the queue's order, never more than
   the free slots, which are the same sessions the sentence names. When the
   sentence cannot name them safely and speaks of "the issues waiting in its
   queue", the same first sessions are stamped. The stamp is kept in foreman's
   ledger on the waiting pairing, so it survives a reload of the mod.
2. A waiting session is reserved while it is active, unclaimed, stamped, and
   the stamp is no more than `GONE_MS` old.
3. A reserved session counts as busy in `freeSlots`, so no other waiting
   session is claimed into its slot and a new start waits in the queue.
4. A reserved session is left out of the waiting sessions that no slot has
   claimed yet (`waitingUnclaimed` in `mods/foreman/hooks/tickets.ts`). So it
   is neither counted twice by `startWaits`, nor named again by a later kept
   sentence, nor counted as waiting when a read without the list decides
   whether to keep a freed slot.
5. Foreman never claims a reserved session and never sends it a begin message,
   even when the list shows it surely open. The parent's hand begin is the only
   begin while the reservation lasts.
6. The reservation ends early in the two ways a waiting session already
   leaves the queue. When its status record shows progress, it counts as begun
   and busy, as on the base branch. When the list shows it over, it is dropped
   from the queue with the existing log line, as any unclaimed waiting session
   is, and no key is held.
7. On the first read after the stamp is more than `GONE_MS` old, with neither
   of those having happened, foreman writes one log line saying that the slot
   kept for that issue is no longer kept, because its waiting session showed
   no progress within five minutes. It then clears the stamp. From then on the
   session is an ordinary unclaimed waiting session again: foreman claims it,
   or any earlier waiting session in the queue, when a slot is free and the
   list shows it surely open, under the existing rules. Nothing wakes the
   parent and nothing notifies the person for the lapse.
8. The kept sentence's wording does not change.
9. The wake skill (`mods/foreman/skills/wake/SKILL.md`) changes in its
   kept-sentence section. It says that the sentence comes on the read that
   freed the slot, or on a later read when that read could not read the
   desktop app's list. It also says that foreman holds the slot for each named
   session for five minutes, so the parent should send the begin message
   promptly and start no other session for that slot. Its claim that foreman
   begins a waiting session by itself on a later read now holds only once
   those five minutes are over, and its claim that the slot stays free for
   them is bounded the same way.
10. The foreman README's account of the queue says the same as the skill.

## Edge cases

- **A ledger written before this change** has no stamp. Its reader takes a
  missing or damaged stamp as no stamp, so the session is not reserved, and
  the ticket is not treated as damaged.
- **The named session is a proposal card** with no desktop session id yet. It
  is reserved like any other. If the person starts the card within five
  minutes, its record shows progress and the reservation ends. If not, the
  reservation lapses as in point 7, and the card is then owed a slot only as
  `waitingUnclaimed` already allows.
- **The parent begins the session after the five minutes.** Foreman may have
  claimed it by then and sent its own begin message, which says to ignore it
  if already begun, so two begins to the same session do no harm. Foreman may
  also have given the slot to an earlier waiting session the list showed. This
  is the window the wake skill's "promptly" is for.
- **A second slot frees during the reservation.** The reserved session already
  holds its slot, so the second slot goes to the next waiting session the list
  shows, or the kept sentence names the next unclaimed one, never the reserved
  one again.
- **The slot count goes down during the reservation.** The reservation still
  counts as busy, so no slot is free until something ends, as with any busy
  slot.
- **The person releases the named issue** by archiving its waiting session.
  The list shows it over and it is dropped as point 6 says, with no held key.

## Non-goals

- Changing the kept sentence's wording, or putting the five minutes in it.
- Waking the parent again, or notifying the person, when a reservation lapses.
- Showing the reservation in foreman's band or pane.
- A way for the parent to tell foreman that it has begun a session by hand.
- The gap in which a Release that frees a slot while someone waits unclaimed
  defers to a read that does not count the released slot as freed, so that the
  parent can get no wake for it. It is filed as its own issue.
- The issue's items that were already done on the base branch, which are
  closed on the issue with a reason naming where each is done: reporting a
  failed open of foreman's pane, the band's head opening the pane, and nudging
  a `working` record whose file stopped and whose session is not running. The
  comment above `decide` was also checked and already describes what the
  function does now, so it is closed the same way.

## Failure modes

- A reservation that never ended would hold a slot for good. The stamp's age
  bounds it to `GONE_MS`, and the lapse clears the stamp.
- A reservation counted both as busy and as owed a slot would make new starts
  wait one slot too long. Point 4 prevents that.
- A stamp that a reload lost would reopen the race for the rest of the five
  minutes, which is why the stamp lives in the ledger.

## Verification

Tests in `mods/foreman/tests`, each failing on the base branch or without the
change it covers:

- After a read that wakes the parent with the kept sentence for one waiting
  session, a read one minute later whose list shows a second waiting session
  as surely open gives no begin effect and no claim for it.
- A reserved session that the list shows surely open gets no claim and no
  begin effect while the reservation lasts.
- On the first read more than `GONE_MS` after the stamp, the log holds the
  lapse line once, the stamp is cleared, and the session is claimed under the
  existing rules when a slot is free and the list shows it.
- A reserved session whose record shows progress counts as busy, and one that
  the list shows over is dropped with no held key and no notification.
- `freeSlots` counts a reserved session as busy, `waitingUnclaimed` leaves it
  out, and `startWaits` does not count it twice.
- The ledger's reader keeps a stamp across a write and a read, and reads a
  pairing with no stamp, or a damaged one, as unstamped.

The gates in the project's `CLAUDE.md` run on the change. No gate reads the
wake skill or the README, so the reviewers check those.

## Decided by the counsel

- How should foreman stop a second waiting sub session from being begun in a slot that the parent is filling by hand after foreman's kept sentence? The counsel chose: Reserve the slot: when the kept sentence names a waiting session, foreman stamps it as kept for a hand begin. For GONE_MS after that, it counts as busy in freeSlots and is left out of the waiting-unclaimed list, so no other waiting session takes its slot. The reservation ends early when its record shows progress or foreman claims it itself once the list shows it, and if the list shows it over it is dropped like any unclaimed waiting session. 7 of 7 members voted for it.
- When foreman claims a reserved waiting session itself, because the list now shows it surely open, and a later read shows that session over before it showed progress, should foreman hold its issue key as it does for any claimed session, or drop it as it would an unclaimed waiting session? The counsel chose: Never claim a reserved session: while the reservation lasts foreman neither claims it nor sends it a begin message; after the reservation ends it is an ordinary unclaimed waiting session again, which foreman may claim under the existing rules. 4 of 7 members voted for it.
- What should this change do with the issue's items that are already done on the base branch, and with a related gap found while checking them, where a Release that frees a slot while someone waits in the queue can leave the parent without a wake? The counsel chose: Close items 2, 4, 5 and 6 with a reason written on the issue, naming where each is done, and file the Release gap as a new issue without touching it here. 7 of 7 members voted for it.
- What should the parent be told about the kept sentence, now that foreman reserves the named session's slot for five minutes and the sentence can come on a later read after a failed list read? The counsel chose: Change only the wake skill: correct the line about when the kept sentence comes (on the read that freed the slot, or on a later read when that read could not read the list), and add that foreman holds the slot for the named session for five minutes, so the parent should send the begin message promptly and start no other session for it. Leave the kept sentence's wording as it is. 6 of 7 members voted for it.
- When the five-minute reservation of a session named by the kept sentence ends and the session has still shown no progress, what should foreman do? The counsel chose: Write one log line in foreman's pane when the reservation ends, and otherwise change nothing: the session goes back to being an ordinary unclaimed waiting session. 5 of 7 members voted for it.

The second decision replaces the part of the first that let foreman's own claim
end the reservation early.
