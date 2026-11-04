# Foreman's pane shows its state at a glance, with the log folded away

Date: 2026-11-04.

## Goal

Foreman's pane is a long column of text. To learn whether anything needs them,
the person has to read every sub session's rows, the queue, five lines of
spending and times, and a log that grows to twenty lines. The log also shows
two lines for one report whenever a notification cannot be raised, because the
report's sentence and the notification's failure are logged separately.

This change redraws the pane so the person sees at a glance how many slots are
busy, which sub session needs them, what waits in the queue and what the run
has cost, and it folds the log and the token counts away until the person asks
for them. It also gives each notice exactly one log line, marked when its
notification was not raised. It changes how the pane draws what foreman
already knows, not what foreman tracks.

## Users and trigger

The person running a parent session, which is a session where `/start-foreman`
turned foreman's role on, looking at foreman's pane on the desktop app or in
the terminal. The pane redraws whenever it does today: on every read, every
press and every tick of the redraw timer.

## Behavior

The pane of a parent draws five sections, top to bottom. On a surface that
draws images (the desktop app, the mobile app and the editor) the slot lights
and each card's stage bar are drawings. On the terminal every section is text,
in the same order and with the same content.

1. **Slot lights.** One light for each slot, then the words `N of M busy`,
   where N is the number of busy sub sessions and M is the slot count. A busy
   sub session is one that is neither released nor done, as the band counts
   it today. Each busy sub session takes one light, in the order of its card:
   green while it is working or waiting on builder, red while it needs the
   person, and amber while it is idle or in cleanup. A sub session whose
   status file is stale has a muted light. Each slot that no busy sub session
   takes is drawn as a dashed empty ring. When more sub sessions are busy than
   there are slots, as when the person lowered the slot count, the pane draws
   one light for each busy sub session and no empty ring. After the words
   comes a badge: `N queued` when sub sessions wait in the queue, `queue
   empty` in the warning color when nobody waits and a slot is free, and
   nothing when nobody waits and no slot is free, exactly as the band words it.
   On the terminal each light is a character: `●` for a busy slot, in the
   state's color, and `○` for a free one.
2. **Cards.** One card for each busy sub session, in issue-key order. A card
   holds:
   - a top line with the issue key, drawn as a link when the issue has one,
     then the issue's title cut short, and at the right the state as a colored
     word with an icon;
   - the stage bar, one segment for each of the nine stages, with the stages
     done filled and the current stage highlighted, in red when the sub
     session needs the person;
   - one dim line with the stage, the pull request and its checks, or the
     reason the record gives, then the wait on a background task when there is
     one and the stale age when the file is stale, and at the right the time
     the sub session has worked and what it spent in dollars, or `cost
     unknown`;
   - an open button, which opens the sub session beside the parent as the
     issue button does today, and a small `⋯` button at the right.
   Pressing `⋯` shows a row under that card holding the Nudge and Release
   buttons, and pressing it again hides the row. The row is hidden until
   `⋯` is first pressed. A card whose sub session needs the person has a red
   border on the desktop. On the terminal the card is its lines of text, the
   bar is cells of text, and a card that needs the person starts with `!`.
   When the probably-hung mark applies today, the state word is drawn in the
   warning color, unless it is red already.
3. **Not busy.** Under the cards, each released or done sub session gets one
   dim compact line: its key, the word `released` or `done`, a button that
   opens the session, and its working time and cost. These lines have no `⋯`
   button, so they cannot be nudged or released.
4. **Up next.** A row of chips in the order the queue begins them, each with
   its place, its key (or its ticket when it has no whole key) and how long it
   has waited. Each chip opens its waiting sub session, as the Queued rows do
   today. When nobody waits, the row reads `Up next: nothing queued`.
5. **Tiles.** Three tiles side by side on the desktop, and three lines on the
   terminal:
   - **Spent:** the dollars of the sub sessions and this session together,
     with the split, `sub sessions $X · this session $Y`, in small print.
   - **Working:** the working time summed over every sub session this parent
     started, with the time spent waiting on the person in small print.
   - **Merged:** how many issues merged, with the average cost per merged
     issue in small print.
6. **Folded rows.** Two rows that start folded:
   - **Log**, which while folded shows only the newest line, as
     `last: <text> <time of day>`, and while open shows every kept line,
     newest last, each with its time, as the log does today.
   - **Token details**, which while open shows the four token kinds (input,
     output, cache read and cache write) for the sub sessions together and for
     this session, then one line for each sub session shown with what it
     spent, then the count of builder's status messages consumed since
     foreman's hooks loaded, as the pane shows them today.
   Pressing a row's heading opens it, and pressing it again folds it. A row
   stays as the person left it until they press it again, or until a restart.

The fold states (the Log row, the Token details row and each card's `⋯` row)
are kept in `$.state`, so they survive a hot reload of foreman's hooks and are
all folded again after a restart. A card's `⋯` state is kept by the card's
status file, and is dropped when that file no longer has a card.

**The empty pane.** A parent with no sub sessions shows the slot lights, all
free, the up-next row and the tiles, then the folded rows. The line `No sub
sessions are in the status folder.` is gone. A session that is not a parent
shows the one line it shows today.

**The merged figures.** The count is the number of entries in the ledger's
spent list whose last timing reading has a merge time. The average is the
summed known dollars of those entries divided by the number of them that have
a dollar figure, so an entry whose cost is unknown is never counted as zero.
This reads the counsel's "divided by their count" as the count of merged
entries with a known cost, because `docs/specs/session-token-cost.md` rules
that an unknown cost is never shown as zero.
When no merged entry has a dollar figure, the small print reads `cost
unknown`, and when nothing has merged it reads nothing. Entries folded into
the earlier total once the list passed 200 entries count in neither.

**One log line for each notice.** When foreman cannot raise a notification,
the log holds one line for that notice: its own text followed by
`(notification not raised: <reason>)`. A report's sentence is no longer logged
separately from its failed notification. The separate reason line, which names
the surfaces attached, is still written once per reason per load, as it is
today, and it is written before the notice's own line, so that the folded
log's `last:` line is the notice. A notice whose notification was raised logs
what it logs today.

## Edge cases

- A record's text (the issue title, the key, the reason, the pull request's
  state and checks) reaches a drawing only as element text, cleaned and
  escaped by `xmlText`. Every attribute of a drawing holds a number or a fixed
  class name.
- A key that `printable` cut or cleaned is drawn as plain text, never as a
  link, as today.
- A sub session with no stage yet draws its bar with nothing filled and no
  stage highlighted, and its dim line reads `no stage yet`.
- A time or a cost foreman does not know shows as unknown, never as zero or
  `$0.00`.
- A `⋯` row left open for a card whose sub session is then released or
  finishes disappears with the card, and its fold state is dropped, so a new
  card for the same file starts folded.
- The `last:` line never begins with a time of day, so it cannot be mistaken
  for an open log line.
- The log's line that merges repeats, ` (N times)`, appears on the `last:`
  line too.
- A narrow terminal cuts each line as the pane's text rows are cut today; the
  slot lights and the badge come first, so they are the last to be cut.

## Non-goals

- The band above the prompt is unchanged, including its head, its chips and
  its report.
- Builder's mod is unchanged, and so is `mods/foreman/hooks/art.ts`, the copy
  of builder's drawing code that a test holds to builder's answers. Foreman's
  new drawings go in a module of their own.
- What foreman tracks is unchanged: no new field in the ledger, the status
  folder or the store. Only the fold states are new, and they live in
  `$.state` alone.
- The fold states do not survive a restart.
- Raising notifications when no surface is attached is not fixed here; only
  how the failure is logged changes.
- Merged issues folded into the earlier total are not counted, because the
  earlier total does not keep merge times.

## Failure modes

- If a drawing cannot be built, the surface still has the text form, because
  every drawing carries its text as its alternative.
- If the ledger cannot be read, the tiles show unknown, as the spending lines
  do today, and the merged count shows as unknown rather than as zero.
- A press on `⋯`, on a folded row's heading or on a card's open button that
  arrives after its card went away does nothing.

## Verification

Tests in `mods/foreman/tests/`, run by `claude plugin test .`:

- The Log row and the Token details row are folded on a fresh mount: the open
  log lines and the token counts are absent, and the `last:` line shows the
  newest log line. Pressing a heading shows the rows, and pressing it again
  hides them.
- The fold states survive a remount that keeps `$.state`.
- Nudge and Release are absent from a card until its `⋯` is pressed, present
  after it, and absent again after a second press. The existing nudge and
  release tests press `⋯` first.
- The slot lights for each state: working and waiting on builder are green,
  needs you is red, idle and in cleanup are amber, a stale file is muted, and
  each free slot is a dashed ring, on the desktop drawing and in the terminal
  text. More busy sub sessions than slots draw one light each and no ring.
- The badge reads `N queued`, `queue empty` in the warning color, or nothing,
  as the band does.
- A card that needs the person has the red border on the desktop and the `!`
  on the terminal, and its current stage is highlighted in red.
- Released and done sub sessions get the compact line with an open button and
  no `⋯`.
- The Merged tile counts only entries with a merge time, averages over the
  ones with a known cost, and reads `cost unknown` when none has one.
- A report whose notification fails leaves one log line, marked
  `(notification not raised: <reason>)`, after the once-per-reason line, and a
  second failed report with the same reason leaves exactly one more line.
- The empty parent pane shows the lights, the up-next row and the tiles, and
  no longer shows the line about the status folder.
- The terminal pane shows the same sections in the same order as the desktop.
- Every new drawing places record text only through `xmlText`: a record whose
  title holds `<`, `&` and a quote draws escaped text and no new attribute.
- The gates in the project's `CLAUDE.md` pass.

## Decided by the counsel

- In foreman's redrawn pane, each busy sub session becomes one card, and the issue says Nudge and Release should move "behind a press on the card or a small menu" so they no longer sit on every row. Today the card's main press opens the sub session beside the parent. Which shape should the card take? The counsel chose: Pressing the card's issue key or its open button still opens the sub session, and a small '⋯' button at the card's right toggles a row holding Nudge and Release under that card; the row stays open until '⋯' is pressed again. 7 of 7 members voted for it.
- When foreman cannot raise a notification, the issue asks for one log line for the report, marked to show the notification failed, instead of two lines. Which lines should the log hold? The counsel chose: Each notice gives one marked line as in the first option, and the separate reason line with the surfaces attached is still written once per reason per load, because it is the only record of which surfaces were attached. 5 of 7 members voted for it.
- The Merged tile shows how many issues merged, with the average cost per issue in small print, and the issue says not to change what foreman tracks. Where should the count and the average come from? The counsel chose: Count the entries in the ledger's spent list whose last timing reading has a merge time (prMergedAt not null). The average is the summed dollars of those merged entries divided by their count. Entries folded into the earlier total after the list passed 200 drop out of both, and the small print reads 'cost unknown' when no merged entry has a dollar figure. 7 of 7 members voted for it.
- The issue gives one card to each busy sub session. Today the pane also lists released sub sessions (dimmed, still openable, still showing what they spent) and sub sessions whose state is done. How should the redrawn pane show the rows that are not busy? The counsel chose: Busy rows get full cards. Released and done rows each get one dim compact line under the cards, with the key, the word 'released' or 'done', a button that opens the session, and its time and cost. These lines have no '⋯' menu, so they cannot be nudged or released. 7 of 7 members voted for it.
- Which of these should this change leave out of scope? The counsel chose: Only foreman's pane and the log line change. The band above the prompt, builder's mod and the copied drawing code in foreman's hooks/art.ts stay exactly as they are. The fold states (the Log row, the Token details row and each card's '⋯' row) live in $.state only, so they survive a hot reload but not a restart, after which everything is folded again. 7 of 7 members voted for it.
