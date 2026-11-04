# Foreman wakes the parent when a sub session's status file freezes

Date: 2026-11-03.

## Goal

Builder rewrites a sub session's status file once a minute for as long as the
session runs, in every state, done included. A file that has gone much
longer than that without a rewrite means something has stopped: builder lost
its memo, the session hung, or the session ended without the desktop app's
list saying so. Today foreman acts on such a file in only two cases. The gone
rule wakes the parent when the file is five minutes old and the list shows the
session not running, archived or missing. The stall rule nudges a `working`
record whose session the list shows stopped. When the list shows the session
running, or the list cannot be read at all, a frozen file gets nothing, and
the gone wake never says what state the file last showed. In one incident the
list read kept failing while two sub sessions sat idle behind files that
still said `working`, and nobody was told until the parent read their
transcripts.

This change adds one wake. When a sub session's status file has not been
rewritten for ten minutes, foreman tells the parent, naming the session and
the state the file last showed, once for each frozen stretch.

## Users and trigger

The person runs a parent session with foreman, which starts `/implement` sub
sessions and pairs each with a status file under
`<config>/foreman/builds/<session id>.json`. The trigger is any read of that
folder, on foreman's usual schedule, at which an active pairing's file has not
changed for longer than the new limit.

## Behavior

1. A new constant, `FROZEN_MS`, is ten minutes, twice `GONE_MS`.
2. A frozen stretch is one unchanged modification time of the file. Foreman
   judges the file's age by its modification time, as the gone rule does,
   not by the `writtenAt` field inside it. A file whose modification time
   changes ends the stretch, and a later freeze is a new stretch.
3. On a read where an active pairing's file has not changed for longer than
   `FROZEN_MS`, its pull request has not merged, and the parent has not
   already been woken for this stretch (rule 4), foreman adds a `frozen`
   reason to the wake line. Its sentence names the session as the other
   sentences do, gives the minutes since the file last changed, and gives the
   state the file last showed. The rule covers every state, done included.
4. The parent has already been woken for this stretch when the stored
   `goneWokeFor` equals the file's modification time, which the gone wake
   and the frozen wake both set, or when the record's idle stretch has woken
   the parent for this stall, that is, the stretch counts idleness, has
   woken, and its last nudge belongs to this stall as `stallsOwn` says. A
   stall that the stall rule has only nudged has not woken the parent, so
   it does not silence the frozen wake.
5. When the frozen wake goes, it sets `goneWokeFor` to the file's
   modification time. When the record's idle stretch has nudged for this
   stall, it also marks that stretch as woken, as the gone rule does. Neither
   the gone rule nor the stall rule then wakes the parent again until the
   file changes.
6. The frozen rule needs no read of the desktop app's list, so it still
   wakes the parent when the list cannot be read. It runs after the state
   rule and the gone rule on the same read, so when both the gone rule and
   the frozen rule could wake, the gone wake goes and the frozen wake stays
   quiet. It never runs for a pairing that the over rule or the done rule
   freed on that read.
7. The stored mark is the existing `goneWokeFor` field. No field is added to
   the stored pairings, so they need no new default and no migration. The
   field's comment says that the frozen wake sets it too. The one new value
   is `watchingSince` in foreman's session state, which rule 10 describes; it
   is not part of the stored pairings, and a restart clears it.
8. The wake skill gets a section for the new sentence. The parent finds the
   session in `list_sessions` by its key or ticket, as the idle section
   does. If the list shows it not running, archived or missing, the parent
   handles it as the gone section says. Otherwise the parent reads its last
   few events and sends it one specific message with `send_message` naming
   its next step. The parent tells the person in one line when the events
   show the session waits on the person, or when the lookups fail or match
   no single session. It never releases the issue unasked, and it does not
   nudge again for the same stretch. The skill's description lists the new
   kind of wake.
9. The README's rules table and wake list name the new rule and sentence,
   and the test that pins every wake sentence pins the new one.
10. The frozen rule waits until foreman has listed the status folder for two
    minutes, twice builder's one-minute rewrite interval, without a gap of
    more than five minutes between successful listings. The first listing
    after foreman starts, and the first after a longer gap, begin a new
    watch. The reason is the machine sleeping: when it wakes, foreman's first
    read and each builder's rewrite race, so foreman can find every live file
    as old as the sleep before its builder rewrites it, and would wake the
    parent for every live sub session. The five-minute gap limit stays above
    foreman's slowest read interval of two minutes, or every quiet read would
    begin a new watch, and well below `FROZEN_MS`. A file whose builder really
    stopped still gets the wake, two minutes into the watch.

## Edge cases

- A working record whose session the list shows running. No stall rule
  applies, so the frozen wake is the first word the parent gets, at ten
  minutes.
- A list that cannot be read. The gone rule and the stall rule both need
  the list, so the frozen wake is the only wake, at ten minutes.
- A list that comes back after ten minutes and shows the session ended. The
  gone rule runs first on that read and wakes; the frozen wake stays quiet.
- A stall that was nudged twice and then woke the parent through the idle
  rule. The frozen wake stays quiet for that stretch.
- A stall that was nudged once and whose list then stops reading. Nothing
  else can wake for it, so the frozen wake goes and marks the stretch as
  woken, which also stops the stall's own list reads.
- A done record whose session never ends. Its slot is still held, so it gets
  the wake. A done record whose pull request merged does not.
- A record whose pull request was closed without merging still holds its
  slot, so it gets the wake once.
- A record with no desktop session. The stall rule never applies to it, and
  the frozen wake covers it.
- A modification time later than the clock. The file is not older than the
  limit, so nothing wakes.
- Foreman restarts during a stretch. `goneWokeFor` is stored with the
  pairing, so the wake does not repeat.
- The machine wakes from a sleep longer than five minutes, or the folder's
  listings fail for that long. The first listing that works begins a new
  watch, so a live file that its builder has not yet rewritten does not wake
  the parent; a file still unchanged two minutes later does.
- Foreman starts with files already more than ten minutes old. The first
  listing begins a watch, so the wake comes two minutes later.

## Non-goals

- Foreman sends no nudge of its own for a frozen file; the parent's wake
  skill sends the one nudge.
- Foreman frees no slot because a file froze, however long it stays frozen.
  Slots are freed only on the list's proof, as today.
- Builder, the pane and the band are unchanged, including the pane's own
  three-minute staleness mark.
- The gone rule and the stall rule change only to honour and leave the
  shared mark. Their limits, nudges and sentences stay as they are, and the
  gone sentence still does not name the file's state.
- A record waiting only on background work is not treated as a stall here;
  its background wake and the frozen wake can both come for one stretch.

## Failure modes

- A wrong file age, such as a file touched by something other than builder,
  can only delay or end a stretch early; it never frees a slot or sends a
  message to a sub session.
- If the stored pairings cannot be written, the mark is lost and the wake may
  come again on a later read, as with the gone wake today.

## Verification

Tests in `mods/foreman/tests/act.test.ts` drive `decide()` with a frozen file
and show:

- the wake goes at ten minutes in each state, done included, and names the
  state, and not before ten minutes;
- it goes once per stretch, and again after the file changes and freezes
  anew;
- a merged pull request gets no wake;
- a gone wake for the stretch silences it, on an earlier read and on the
  same read;
- a stall wake for the stretch silences it;
- a stall that was only nudged, with a list that cannot be read, still gets
  it, and its stretch is marked as woken;
- after it goes, the gone rule does not wake for the same stretch;
- it goes with a list that cannot be read and with a list that shows the
  session running.
- a read that begins a new watch, after a gap of more than five minutes,
  brings no wake, and a read two minutes into the watch does; the read loop
  carries the watch across reads and begins a new one after failed listings;
  and the gap limit stays between the slow read interval and the frozen
  limit.

`mods/foreman/tests/wake.test.ts` pins the new sentence. The four gates in
the project's `CLAUDE.md` pass.

## Decided by the counsel

- How long must a sub session's status file go without a rewrite before foreman wakes the parent to say it has frozen? The counsel chose: Ten minutes, a new fixed constant, so the new wake comes clearly after the gone rule has had its chance. 5 of 7 members voted for it.
- When a frozen stretch has already been taken up by the gone rule or the stall rule, should the new frozen wake (at ten minutes without a rewrite) still come for that same stretch? The counsel chose: The frozen wake stays quiet when any rule has already woken the parent for this modification time (the gone wake, or the stall rule's wake), but not merely because the stall rule has nudged; and when it goes, it records itself as that stretch's wake, so neither the gone rule nor the stall rule wakes the parent again until the file changes. 6 of 7 members voted for it.
- Which sub session records should the frozen wake cover? The counsel chose: Every state, done included, but not when the record's pull request has merged, because a done file whose session never ends still holds its slot. 7 of 7 members voted for it.
- What should the foreman wake skill tell the parent to do when the frozen line arrives for a sub session? The counsel chose: Look, then nudge once: find the session in list_sessions as the idle section does; if the list shows it not running, archived or missing, handle it as the gone section says; otherwise read its last few events and send it one specific message with send_message naming its next step; tell the person in one line when the events show it waits on the person, or the lookups fail or match no single session. Never release the issue unasked. 5 of 7 members voted for it.
- What does this change deliberately leave out? The counsel chose: Everything but the wake: foreman adds the frozen wake, its stored mark, its sentence, its wake-skill section and its README entries, and the gone and stall rules change only to honour and leave the shared mark; foreman sends no nudge of its own for it, frees no slot because of it, and builder, the pane and the band are unchanged. 7 of 7 members voted for it.
