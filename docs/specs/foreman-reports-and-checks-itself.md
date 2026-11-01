# Foreman shows its reports and checks unwatched sub sessions itself

Written 2026-10-31. Seeded from an issue in the owner's tracker. The rules of
`docs/specs/foreman-wakes-for-milestones.md`,
`docs/specs/foreman-starts-queued-issues.md` and
`docs/specs/no-sub-session-stalls-unseen.md` stay in force except where this
spec changes them. The questions the issue left open were put to the counsel.

## Goal

Every `foreman: ` line wakes the parent's model, and each wake costs a parent
turn. Five of foreman's sentences only report something: a sub session's pull
request opened, got its verdict pair, merged or was closed, and foreman began
the next queued issue. The parent's model can do nothing with them except
repeat them to the person, so each one is a parent turn spent on relaying.

A sub session that foreman holds no record of costs more. Today foreman's
line of context asks the parent's model to schedule a check for each of its
turn-end notes, and the model then reads the sub session's events and nudges
it. In one run, a single such sub session cost about fifteen parent turns
that did nothing but move a timer.

This change makes foreman show the five report sentences itself, in its band,
its pane and a native notification, without waking the parent's model. It
also makes foreman check a sub session it holds no record of by itself, and
wake the parent's model only when that sub session still waits after one
nudge.

## Users/Trigger

The person runs a foreman parent session with sub sessions working on
issues. The reports trigger when foreman's read of the status files finds a
milestone, or when foreman sends the begin message to a queued sub session.
The check triggers each time the desktop app's turn-end note about a sub
session that foreman holds no record of reaches the parent: while foreman's
role is on, a sub session that no pairing holds; while it is off, a sub
session in foreman's list of unwatched sub sessions.

## Behavior

### Reports

1. The sentences for `opened`, `verdicts`, `merged`, `closed` and `began`
   keep their present words, except that the began sentence drops its
   instruction to the parent's model ("tell the person so in one line"),
   since no model reads it any more.
2. When one read or one begin produces report sentences, foreman does three
   things with them, in place of a wake:
   - It raises one native notification with `$.ui.notify`, titled "foreman",
     holding the sentences joined.
   - It adds each sentence to the pane's log.
   - It records the newest sentence and the time it was shown, and the band
     above the prompt shows that sentence as one extra line, beside the
     chips, for ten minutes from that time. A newer report replaces it. After
     ten minutes the band no longer shows it.
3. Report sentences are never put in a wake line, so a read that finds only
   reports wakes nobody. A read that finds reports and decision sentences
   wakes the parent with the decision sentences only, and reports the rest as
   point 2 says. The began sentence is no longer appended to the wake of the
   merge that freed the slot.
4. The band line is cut to fit the band's width. On a band too narrow for the
   chips and the line, the line is shortened or dropped, and the chips keep
   their space.
5. Every other sentence keeps waking the parent's model exactly as today:
   idle, unseen, background, cleanup, gone and slots free.

### Checking a sub session foreman holds no record of

6. When a turn-end note about such a sub session reaches the parent, foreman
   records, in its ledger, the sub session's `local_…` id, the time it read
   the note, and a due time of that time plus its idle minutes (five unless
   the person set otherwise). The parent's model is not asked to do anything:
   a prompt that holds only such notes is answered "Noted." the way foreman
   already answers notes it keeps, whether the role is on or off. While the
   role is on, a prompt with other parts gets foreman's existing context line
   asking for "Noted." for the notes. While the role is off, only the model
   reports the other sessions' outcomes, so a prompt with other parts gets a
   context line that names the checked sub sessions by their `local_…` ids,
   says foreman records the notes about them itself, so the model does not
   reply to those, and asks the model for a brief reply to the rest of the
   prompt in place of a bare "Noted.". That line names only ids that match the
   whole `local_…` id shape and repeats no other text from the prompt. The
   context line that asked the model to schedule a check is removed.
7. A newer note replaces the record's note time and due time, with one
   exception. The first note after foreman's nudge counts as the answer to
   the nudge: it moves the due time to that note's time plus the idle minutes
   but keeps the record's nudged mark. A second note after the nudge counts
   as new work and clears the mark.
8. When a record's due time passes, foreman first reads this parent's family
   of linked sessions once for the pass, with the desktop app's
   `list_sessions` tool asked for the linked family alone, archived sessions
   included, up to 100 entries. A note's id comes from text that a sub
   session's title can forge, so only an id in that family reaches a read or
   a nudge.
   - The list cannot be read, because the tools are not connected, the call
     is refused, the answer cannot be read, or no answer comes within the
     call time limit: every record that fell due in that pass ends as a failed
     read, below, with the list's reason.
   - The list came back with fewer than 100 entries, so it is complete, and
     the sub session's id is not in it: the record ends as a failed read with
     the reason that it is not a session in this parent's family of linked
     sessions.
   - The list came back with 100 entries or more, so it may be incomplete:
     an id missing from it is not dropped, and the sub session is checked as
     usual.

   For a sub session that passes the family check, foreman reads its last
   events with the desktop app's `list_events` tool through `$.mcp.call`,
   with a small limit, and reads only the header line of the answer, which
   gives the session's state and whether it is archived. The header names the
   session only by its title, so foreman does not compare it with the sub
   session. It never parses the message blocks below the header.
   - The header says archived: foreman writes one log line and drops the
     record. Nothing else happens.
   - The call fails, is refused, does not answer within the call time limit,
     or answers something whose header foreman cannot read: this is a failed
     read. Foreman raises a notification naming the sub session's id and the
     reason, writes the same sentence to the log, and drops the record. No
     model wakes.
   - The header says the session is not idle, so it is inside a turn:
     foreman sets a new due time of now plus the idle minutes and does
     nothing else.
   - The header says idle and the record is not nudged: foreman sends the
     sub session its constant nudge text, `what's next?`, the same text it
     sends tracked sub sessions, marks the record nudged, and sets a new due
     time of now plus the idle minutes. A nudge that the desktop app refuses
     is treated like a failed read.
   - The header says idle and the record is nudged: the sub session still
     waits after the nudge. Foreman wakes the parent's model with one
     sentence naming the sub session by its `local_…` id and saying it still
     waits after foreman's nudge, and drops the record. The parent's model
     then reads the sub session itself and tells the person, as the wake
     skill says. Only a new note starts a new record.
9. The check runs whether foreman's role is on or off. While the role is on,
   the read loop that already runs takes due records into account when it
   picks its next read time, and handles them in the same pass. While the
   role is off, foreman arms a timer of its own only while at least one
   record is due, set to the soonest due time, and cancels it when no record
   is left. The two never run at once: turning the role on cancels the off
   timer and hands the records to the read loop, and turning it off hands
   them back to the off timer. A hot reload of the mod re-arms whichever
   applies from the ledger.
10. The records live in the ledger beside the list of unwatched sub sessions,
    are read back tolerantly like the rest of the ledger, and are capped at
    the same fifty entries.

### The wake skill and the README

11. The wake skill drops what foreman now handles: the sections for the four
    pull request sentences and the began sentence, the mention of those
    sentences in "When the parent speaks", "A line that names a ticket" and
    the slot-free section, the paragraph about foreman's context line asking
    for checks, and the section "Checking a sub session foreman does not
    watch". It gains a short section for the new still-waits sentence. Its
    description no longer says it handles those sentences or a scheduled
    check.
12. The README lists the five sentences as reports shown in the band, the
    pane and a notification rather than as wakes, and its section on what
    foreman does while off describes the check and its timer.

## Edge cases

- A read that finds a milestone for two sub sessions raises one notification
  holding both sentences, logs both, and the band shows the newest.
- A report arrives while the band already shows one: the newer replaces it
  and its ten minutes start again.
- The parent restarts: the records survive in the ledger, so a due check is
  still made. The band's report line is not kept across a restart.
- A turn-end note for a sub session that foreman later pairs with: the
  pairing's own watch takes over, and the record is dropped once a pairing
  holds that id.
- A sub session whose answer to the nudge was a real burst of work that then
  went idle is reported one idle period early. That errs toward telling.
- A turn started by someone else that happens to be the first after the
  nudge is counted as the answer. That also errs toward telling.
- A note lost on the way to the parent makes foreman believe a sub session
  still waits when it answered, which costs one parent turn.

## Non-goals

- The idle, unseen, background, cleanup, gone and slots free sentences keep
  waking the model unchanged.
- No change to the builder mod.
- No setting for the ten minutes, for the check timing, or to make the
  reports wake the model again.
- No parsing of the message blocks in a `list_events` answer, and no use of
  what the sub session said it waits on in the nudge.
- No standing timer that checks sub sessions with no pending record.
- No change to how foreman answers notes about sub sessions it does track.

## Failure modes

- `$.ui.notify` fails or the desktop app shows no notification: the report is
  still in the log and the band.
- The desktop app's tools are not connected: every due check ends as a failed
  read, with a notification and a log line, and no model wakes.
- The ledger cannot be written: the records live only in memory until the
  next successful write, as the rest of the ledger does today.

## Verification

Each point is checked by a test in `mods/foreman/tests` that fails if the
behavior breaks.

- A read that finds an opened, verdicts, merged or closed milestone, and a
  begin that went, wakes nobody, raises one notification with the sentence,
  and logs it.
- A read that finds a milestone and an idle sub session wakes with the idle
  sentence only.
- The band shows the newest report within ten minutes of it and not after,
  and a newer report replaces an older one.
- On a narrow band the report line is shortened or dropped and the chips keep
  their full text.
- A turn-end note about a sub session foreman holds no record of wakes no
  model, gets "Noted.", and writes a record with the right due time, both
  while the role is on and while it is off.
- At the due time, an idle header nudges once with the constant nudge text;
  the first note after the nudge keeps the mark; at the next due time an idle
  header wakes the parent once with the still-waits sentence; a second note
  after the nudge clears the mark instead.
- A header that is not idle reschedules without a nudge or a wake.
- An archived header logs and drops the record with no notification; a failed
  call, a refused call and an unreadable answer each raise a notification,
  log, drop the record and wake no model.
- A family of linked sessions that cannot be read ends every record due in
  that pass as a failed read with the list's reason, and reads no header and
  sends no nudge. An id missing from a complete family ends as a failed read
  with the reason that it is not in the family, and reads no header and sends
  no nudge. An id missing from a family of 100 entries or more is checked as
  usual.
- While the role is off, a timer runs only while a record is due; turning the
  role on stops it and the read loop handles the record, and the two never
  both handle one due record.
- The gates in the project's `CLAUDE.md` pass. No gate reads the wake skill
  or the README, so the reviewers check those.

## Decided by the counsel

- When foreman shows a report-only sentence itself (a sub session's pull request opened, got its verdict pair, merged or closed, or foreman began a queued issue) instead of waking the parent's model, what should the band above the prompt show? The counsel chose: The band shows the newest report sentence as one extra line for ten minutes after it, beside the chips, and the pane's log and a native notification carry it too. 7 of 7 members voted for it.
- Foreman will check a sub session it holds no record of by itself (read its last events with list_events when the check falls due, nudge it once with its constant nudge text, and wake the parent's model only when it still waits after the nudge). Should foreman do this only while its role is on in the parent, or also while the role is off? The counsel chose: Both: while the role is off, foreman arms a timer of its own only for these checks, for the sub sessions in its unwatched list, so no wake skill section about Cron checks remains. 5 of 7 members voted for it.
- When foreman's own check of a sub session it holds no record of falls due and finds the sub session archived or no longer listed, or the desktop app's list_events call fails or answers something foreman cannot read, what should foreman do? The counsel chose: Archived: stop checking it, with a log line only. Gone or unreadable: raise a native notification naming the sub session's id and the reason, add the same log line, stop checking it, and wake no model. 7 of 7 members voted for it.
- What does this change deliberately leave out of scope? The counsel chose: Only the five report-only sentences and the unwatched check change. Every other sentence (idle, unseen, background, cleanup, gone, slots free) keeps waking the model exactly as today, the builder mod is not changed, and no new setting is added for the ten minutes or the check timing. 7 of 7 members voted for it.
- When foreman's own check of a sub session it holds no record of falls due a second time, after foreman nudged it once, how does foreman judge that the sub session still waits after the nudge, and so wake the parent's model? The counsel chose: The ledger decides: it still waits when no turn-end note about it has arrived since foreman's nudge, and list_events at the second due time shows it idle (not in a turn) and not archived. Foreman does not parse the blocks' contents beyond the header. 4 of 7 members voted for it.
- The turn that answers foreman's nudge ends with a turn-end note of its own. How should that note count, so that a sub session that only answers nudges with "still waiting" is reported rather than nudged again every idle period? The counsel chose: The first turn-end note after foreman's nudge counts as the answer to the nudge: it moves the due time to that note's time plus the idle minutes but keeps the nudged mark, so at that due time an idle, unarchived header wakes the parent's model. A second note after the nudge counts as new work and clears the mark. 6 of 7 members voted for it.
