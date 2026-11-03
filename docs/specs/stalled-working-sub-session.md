# A sub session that stopped mid-turn is not left saying working

Date: 2026-11-03.

## Goal

The person quit and relaunched the desktop app while sub sessions were in
the middle of a turn. On relaunch, two sub sessions each received the desktop
app's notice that their background agent had not finished, ended that turn
with no work, and sat idle. Their status files still said `working`, and
builder's once-a-minute rewrite of each file had stopped. Foreman's working
rule does nothing unless an idle stretch is already open, so foreman never
nudged them. The gone rule could have caught them, because the desktop app
listed both as not running, but it only wakes the parent, and the read of the
desktop app's list was failing at the time. The sessions stayed stalled until
the parent found them by reading their transcripts.

Two things caused this, and this change closes both:

1. Builder keeps its status memo (the ticket, the file's path and the desktop
   session id) in the engine's state, which survives a hot reload but not a
   restart. It looks for the ticket again only when a prompt is submitted. A
   relaunch turn that no submitted prompt started therefore never took the
   memo up, so builder neither rewrote the file nor wrote the turn's end.
2. Foreman treats a `working` file as work in progress however long it has
   gone without a rewrite.

## Users and trigger

The person runs a parent session with foreman, which starts `/implement` sub
sessions that run builder. The trigger is a sub session whose process
restarts, as when the desktop app is quit and relaunched, and whose file was
last written while a turn ran.

## Behavior

### Builder takes its memo up again after a restart

1. **At the session's start.** When the hooks start and the session has no
   memo in the engine's state, builder reads the transcript. When its first
   user message holds a ticket line, builder takes up a memo for that ticket,
   exactly as it would at a prompt: the file's path, the desktop session id
   and the parent's id come from the same places, the minute's rewrite
   starts, and the file is written at once with the true state. After a
   restart nothing runs, so that state is normally `idle`. When the transcript
   is empty, cannot be read, or its first user message holds no ticket, the
   session's start stores no memo at all, so that the first prompt still
   looks for the ticket as it does today. A brand-new session therefore
   behaves exactly as before.
2. **At the start of each of the session's own turns.** When a turn of the
   session's own starts and builder does not yet know whether this session
   has a ticket, builder looks for it in the transcript the same way. A turn
   that no submitted prompt started, such as one the desktop app starts with
   its notice after a relaunch, then takes the memo up, writes `working`
   while the turn runs and `idle` when it ends. As at the session's start,
   this look stores a memo only when it finds a ticket. It never falls back
   to the turn's own text, which may be the desktop app's notice rather than
   the first prompt, and it never stores the answer that the session has no
   ticket. Once the ticket is known, the look at each later turn's start
   returns at once.
3. The look at a turn's start must not delay the moment builder marks the
   session busy, so a foreman read during that turn sees `working` as it
   does today.
4. Both looks take the memo up through the same path a prompt uses
   (`takeUpMemo`), so that a newer copy of the module's memo is never written
   over and a memo is never taken up twice.

### Foreman nudges a stalled working sub session

5. **The stalled case.** A pairing's record is stalled when it says
   `working`, does not wait only on background work (it has no
   `backgroundOnly`), its file has not changed for more than five minutes
   (`GONE_MS`), and the desktop app's list, read on this read, shows its
   desktop session listed, not archived and not running.
6. **It goes through the idle rule.** A stalled record goes through the idle
   rule as an idle record does, counted from the file's last change: a nudge
   once the idle threshold has passed since that change, a second nudge one
   threshold later, and a wake of the parent with the idle reason one
   threshold after that. A record with no desktop session id is never
   stalled, because the list cannot show it running or not.
7. **The gone rule stays quiet for it.** The gone rule does not wake the
   parent for a stalled record, because the idle rule handles it and wakes
   the parent itself at its third threshold. A session that the list shows
   archived or missing is not stalled, and the gone and over rules handle it
   as today, since a nudge cannot reach it.
8. **The list is read on time.** Foreman asks for the desktop app's list on
   every read while a pairing's record says `working` without `backgroundOnly`,
   its file has not changed for more than five minutes, its idle stretch has
   nudged it for the stall and has not yet woken the parent. Before that first
   nudge the list is read as today, which is on every read while the record is
   still due its gone wake, so the first nudge lands on time too. After the
   idle wake has gone, list reads for it fall back to the existing limit of
   once every five minutes, so a handled record does not make every read wait
   on the list for good. A record of that shape that never stalls, such as one
   missing from a list that is not complete, whose gone wake then goes, or one
   whose pull request merged and whose session the list shows running, is read
   no more often than today. This way the second nudge and the wake land at
   their thresholds rather than on whichever later read happens to fetch the
   list.
9. **Without the list nothing changes.** When the list was not read or could
   not be read, or it shows the session running, a working record is treated
   exactly as today, except that a stall's own count is kept as it is rather
   than cleared, so that only a change to the file ends it.
10. When the file changes again, as when the nudge starts a turn and builder
    takes its memo up, the record is no longer stalled and the usual rules
    apply to whatever it says.

## Edge cases

- A sub session that is really in a long turn while builder's write hangs:
  the list shows it running, so it is not stalled and is not nudged.
- A stalled record whose stretch already woke the parent: no further nudge
  or wake comes for that stretch, as with any idle stretch, and the gone
  rule stays quiet for it.
- A stalled record whose session starts running again before the second
  nudge: on such a read the record is not stalled, so nothing is nudged or
  woken on it, but the stall's count is kept until the file changes, so a
  nudged turn that changes nothing still leads to the second nudge and the
  wake on time.
- A relaunched session whose transcript cannot be read at the session's start
  but can be read at its first turn's start: the turn's start takes the memo
  up.
- A relaunched session that runs no turn at all: the session's start takes
  the memo up and writes `idle`, so foreman's ordinary idle rule nudges it.
- A record whose pull request was closed without merging: the idle rule
  already neither nudges nor wakes for it, and that holds for a stalled
  record too.

## Non-goals

- Why the read of the desktop app's list fails. That has its own issue, and
  foreman already raises a notification when the read fails.
- Nudging a stalled working record when the list cannot be read. The counsel
  chose not to, because foreman cannot then tell a stalled session from a
  busy one.
- Any change to how the band or the pane draws a row. They already dim a row
  whose file has not changed for three minutes and say how long ago it was
  written.
- Keeping the status memo across a restart in some store other than the
  engine's state.
- Builder's `busy` flag after a restart. It already starts false, which is
  the true state of a session with no turn running.

## Failure modes

- If the transcript cannot be read at either look, builder writes nothing,
  as today, and the next submitted prompt looks again. Foreman's stalled rule
  is then the safety net, as long as the list can be read.
- If a nudge does not reach the sub session, the idle rule's own wake tells
  the parent at the third threshold, as for any idle sub session.

## Verification

Foreman, in `mods/foreman/tests/act.test.ts`, through `decide`:

- A working record whose file is more than five minutes old, with the list
  showing its session listed, unarchived and not running, is nudged once the
  idle threshold has passed since the file's last change, again one threshold
  later, and the parent is woken with the idle reason at the third; no gone
  reason is pushed on any of those reads.
- The same record with a list that shows the session running, with a failed
  list, or with no list read, gets no nudge and no wake, as today.
- The same record with the list showing it archived or missing gets the gone
  or over handling as today, and no nudge.
- A working record with `backgroundOnly` keeps the background wait's
  behaviour.
- `needsList` is true on every read while a stalled working record has been
  nudged for the stall and has not woken the parent, including a read inside
  five minutes of the last list check, and it falls back to the five-minute
  limit after the idle wake. A record of that shape whose gone wake went, or
  whose pull request merged, without a stall nudge, keeps the five-minute
  limit.

Builder, in `mods/builder/tests/register.test.ts`:

- A session whose hooks start with no memo and whose transcript's first user
  message holds a ticket writes its file at the session's start with state
  `idle`, and the minute's rewrite runs.
- A session whose hooks start with no memo and an empty transcript writes no
  file and stores no memo, and its first prompt that holds a ticket still
  writes the file.
- A turn that starts with no submitted prompt, in a session with no memo whose
  transcript holds a ticket, writes `working` during the turn and `idle` at
  its end.
- A turn that starts with no submitted prompt and an unreadable transcript
  stores no memo, and a later prompt with a ticket still writes the file.

All four gates pass for both mods.

## Decided by the counsel

- How long must a sub session's status file that says working go unchanged, while the desktop app lists the session as not running, before foreman treats the session as idle, and from when does the idle rule count its nudges? The counsel chose: After five minutes unchanged, the gone rule's threshold (GONE_MS in mods/foreman/hooks/act.ts), so the list is already being read for it and no new list reads are added; the idle rule counts from the file's last change. 4 of 7 members voted for it.
- For a sub session whose file says working, has not changed for more than five minutes, and which the desktop app lists as not archived and not running, what should the gone rule do while the idle rule nudges it, and how often should foreman read the desktop app's list for it? The counsel chose: The gone rule does not wake the parent for such a record, because the idle rule now handles it and wakes the parent itself at its third threshold; and foreman reads the list on every read while such a record waits on the idle rule, until that rule has woken the parent, so the second nudge and the wake are not delayed by the once-every-five-minutes limit on list reads. 7 of 7 members voted for it.
- Where should builder take its status memo up again after a restart, so that a relaunched sub session writes its true state instead of leaving working behind? The counsel chose: Both: at the session's start as in the second option, and at the start of each own turn as in the first, so either path takes the memo up. 5 of 7 members voted for it.
- When foreman cannot read the desktop app's session list, should it still treat a sub session as idle when its file says working and has not changed for more than five minutes? The counsel chose: No. Without a list that shows the session not running, the working rule behaves as it does today; this change leaves the failing list read to its own issue, and builder's new restart handling is what stops a relaunched session from leaving working behind in the first place. 7 of 7 members voted for it.
- While foreman treats a stalled working record as idle and nudges it, should the foreman band and pane show that row differently from today? The counsel chose: No. The band and pane stay as they are: they already dim a row whose file has not changed for three minutes and say how long ago it was written, and the nudge itself shows in the sub session; this change touches only foreman's rules and builder's restart handling. 7 of 7 members voted for it.
