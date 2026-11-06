# Foreman keeps waiting sub sessions lined up, so a freed slot fills without a typed message

Date: 2026-11-04.

## Goal

Foreman runs a fixed number of sub sessions, its slots, and when one finishes
it should start the next issue. Today a freed slot with an empty queue wakes
the parent's model with "one slot free; pick the next issue and start it.",
and the parent calls `start_session` on that turn. The desktop app refuses
it, because that turn began from a mod's prompt and not from the owner's
typed words, so foreman holds the key, and the issue starts only when the
owner next types something. In a long run, every freed slot therefore waited
for the owner, which defeats the point of running foreman unattended.

Reading the installed desktop app showed what is open. A start made on a
turn the owner typed has no hard limit (from the eleventh start on such a
turn, the app asks the owner with a permission card), a waiting sub session
that is idle does not count against the app's limit on working children, and
`send_message` to an existing session has no check on who sends it. Foreman
already begins waiting sessions with `send_message` when a slot frees (see
`docs/specs/foreman-starts-queued-issues.md`). This change keeps that queue
full: on every turn the owner types, foreman has the parent start enough
issues, following the project's `Next issue:` fact, to keep one waiting
session per slot, so each freed slot is filled by foreman alone.

## Users/Trigger

- The owner, who types anything in a foreman parent session, including
  `/start-foreman`.
- The parent's model, which starts the issues foreman asks for, one
  `start_session` call at a time, following the wake skill.
- Foreman, which counts busy and waiting sessions, asks for the top-up,
  begins waiting sessions when slots free, and shows the queue.
- A begun sub session whose issue turned out to be already done or already
  taken while it waited.

## Behavior

1. **The target.** Foreman keeps one waiting session per slot: the target is
   twice the slot count, counted as busy sessions plus waiting sessions.
2. **The top-up line.** On every prompt the owner types in a parent while
   foreman is on, foreman adds one context line when busy plus waiting is
   below the target. The line says how many issues to start: the gap to the
   target, but never more than 5. The 5 counts every start the parent makes
   from that line on, so issues the owner names in the same message come out of
   it. Starts beyond the free slots get the existing wait line and join the
   queue in the order they are started. When busy plus waiting already meets
   the target, foreman adds no line. A prompt typed while a turn is already
   running gets the line too, with its count worked out afresh from the
   ledger, and the newest line on a turn replaces any earlier line's number.
   This replaced an earlier rule that left such a prompt without a line; see
   `docs/specs/foreman-tops-up-mid-turn-messages.md`.
3. **Following `Next issue:`.** The wake skill gains a top-up section: the
   parent starts that many issues, each the next one the project's
   `Next issue:` fact picks, skipping any issue that already has a sub
   session in foreman's rows or queue. When the project has no `Next issue:`
   fact, the parent starts nothing for the line and the owner names issues
   as before.
4. **`/start-foreman`.** A plain `/start-foreman` now reaches the parent's
   model on the owner's own typed turn. Foreman still turns itself on and
   sets the slots there, and it replaces the start-foreman skill's text, which
   otherwise says that the mod is not loaded, with text telling the parent to
   top up the queue as the wake skill says, with the same count rule as the
   top-up line. Words after the command keep the meaning they have today.
5. **Beginning.** When a slot frees and a session waits, foreman begins the
   first one with its begin message, as it does today.
6. **A stale issue.** The begin message keeps its current text as its start,
   so a session already waiting still recognises it, and gains a sentence: if
   `/implement` stops because the issue is already done on the base branch or
   already has an open pull request, the session does not wait for an answer.
   When the issue is already done but the tracker still shows it not started,
   it comments on the issue with the evidence and moves it to the tracker's
   in-progress state, so the `Next issue:` search skips it and the owner
   closes it after reading the comment. Then it runs `/cleanup`, which
   touches only its own worktree and archives the session. Foreman frees the
   slot on its next read, because an archived session holds none, and begins
   the next waiting session.
7. **The queue ran dry.** When a slot frees and no session waits, foreman no
   longer wakes the parent's model. It shows one report itself, in the band,
   the pane's log and one desktop notification, saying that the queue ran
   dry and that the owner's next message lines up more. Foreman holds no key
   for it. The notification fires once each time the queue runs dry, not
   again on later reads while it stays empty; a later waiting session arms
   it again.
8. **The pane.** Under the busy rows, a `Queued` section lists the waiting
   issues in the order they will begin. Each entry shows its place, its key
   (a link when the project names an issue address) and how long it has
   waited. Pressing an entry opens that session. When nothing waits, the
   section reads `Queued: none — your next message lines up more`.
9. **The band.** The queue size follows the busy count, as in
   `foreman: 3 of 3 slots busy · 4 queued · ABC-123 build · …`. While the
   queue is empty and a slot is free, the band shows `queue empty` in amber
   in the queue's place.

## Edge cases

- **The owner types while busy plus waiting already meets the target.** No
  top-up line is added and nothing starts.
- **A large gap.** With many slots, a turn starts at most 5 issues; the next
  typed turn starts the rest, so a typed turn stays well below the app's
  permission card.
- **The app refuses a top-up start.** Foreman's existing hold covers it: the
  key starts on the owner's next message, and the owner is told once.
- **A slot frees while the queue is empty and another frees later.** One
  notification only, and the band stays amber until the queue refills.
- **A waiting session the owner archives.** It leaves the queue as today; the
  next typed turn tops the queue up again.
- **The begun session's issue is done.** Behavior point 6; the slot frees
  through the archive, not through a merge.

## Non-goals

- (a) No reuse or clearing of finished sessions: time and cost are tracked per
  session, so each issue gets its own.
- (b) No tracker check by foreman at begin time; the begun session's own check in
  Behavior point 6 handles a stale issue.
- (c) No command to remove or reorder queued issues; archiving a waiting session
  drops it.
- (d) No change to the desktop app and no way around its start check. A separate
  backstop that uses the app's own wake is other work.
- (e) No setting for the queue depth; it follows the slot count.
- (f) No notice when the project has no `Next issue:` fact; the owner names
  issues as before.

## Failure modes

- **The parent ignores the top-up line.** The queue stays short, and the
  band's amber `queue empty` and the dry-queue report show it.
- **The owner's `/start-foreman` turn is not counted as typed by the app.**
  The starts are refused and held, and start on the owner's next message.
- **A begun session whose issue is done does not run `/cleanup`.** Its slot
  stays busy, and foreman's idle nudges and the idle wake reach the parent as
  today.
- **`send_message` fails.** As today: retried while the target is listed
  unarchived, with one notification.

## Verification

- Tests in `mods/foreman/tests`, using the fake app in `tests/world.ts`,
  show: the top-up line on a typed prompt with the right count, capped at 5,
  and its absence at the target and on a prompt foreman submitted; the
  `/start-foreman` command reaching the model with the replaced skill text,
  and that replacement never carrying the "not loaded" text; the begin text
  starting with the old text and carrying the stale-issue sentence; a freed
  slot with an empty queue raising one report and no wake, and no second
  notification on later reads until a session waits again; the Queued
  section's entries, order, links, wait times and empty text; the band's
  queue count and amber `queue empty`.
- The README and the wake skill are updated with the new texts, and the wake
  skill's free-slot section becomes the top-up section.
- Not verified by the gates: whether the app counts the `/start-foreman`
  turn as typed. That is a live check.
- The issue is done when, in a real desktop session with one slot and a queue
  topped up from the tracker, at least two issues in a row start after the
  merges before them, with no message from the owner in between. The report
  says plainly whether this was seen.

## Decided by the counsel

- How many issues should foreman keep lined up as waiting sub sessions when the parent tops up its queue on a typed turn, and should the owner be able to change that number? The counsel chose: Keep one waiting session per slot, but never ask for more than 5 new starts on one typed turn, so a typed turn stays well under the app's 10 starts that trigger a permission card. 5 of 7 members voted for it.
- When foreman begins a waiting sub session hours after it was queued and /implement finds its issue already done or taken, how should that session's slot be freed? The counsel chose: Change foreman's begin message so the begun session, when /implement stops because its issue is already done or already has an open pull request, runs /cleanup, which archives it; foreman then frees the slot on its next read and begins the next waiting session. 7 of 7 members voted for it.
- When a sub session that foreman began finds through /implement that its issue is already done on the base branch, but the tracker still shows it not started, what should it do to the issue before it runs /cleanup, so that the next top-up does not pick the same issue again? The counsel chose: The begun session comments on the issue with the evidence and moves it to the tracker's in-progress state, so the `Next issue:` search skips it and the owner closes it after reading the comment, and then runs /cleanup. 5 of 7 members voted for it.
- The issue says the parent tops up foreman's queue on every typed turn "including /start-foreman". Today a plain /start-foreman is answered by foreman's command hook and nothing reaches the parent's model on that turn. How should /start-foreman lead to a top-up? The counsel chose: Let /start-foreman reach the parent's model on its own typed turn, with foreman supplying the text (through the command or skill hook) that tells the parent to top up the queue there and then, as the wake skill says; if the app refuses those starts, foreman's existing hold starts them on the owner's next message. 7 of 7 members voted for it.
- When a slot frees and foreman's queue has no waiting session to begin, how should foreman tell the owner that the queue ran dry and that their next message refills it? The counsel chose: Make it a report that foreman shows itself, in the band, the pane's log and one desktop notification, with no wake of the parent's model; the band's amber "queue empty" stays until the owner's next message refills the queue. 7 of 7 members voted for it.
- What does this change deliberately leave out of scope? The counsel chose: Leave all of (a) to (f) out of scope, as listed. 6 of 7 members voted for it.
