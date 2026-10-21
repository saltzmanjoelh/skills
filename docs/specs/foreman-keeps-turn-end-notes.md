# Foreman keeps sub sessions' turn-end notes from the parent's model

Written 2026-10-20. Seeded from an issue in the owner's tracker. The issue
settled the goal and the extra fixes; the questions it left open were put to
the counsel.

## Goal

The desktop app wakes the parent session's model every time a session the
parent started ends a turn, and each wake re-reads the parent's whole
conversation only for the model to relay progress nobody asked for. Foreman
already tracks its sub sessions through builder's status files and wakes the
parent only when a decision is needed. While the parent role is on, foreman
keeps those turn-end notes from the parent's model, so the parent stops
repeating what its sub sessions do.

## Users and trigger

The owner, running a parent session that has run `/foreman` and starts
`/implement` sub sessions through the desktop app. In a session whose role is
off, nothing below changes anything.

## The channel, as a probe found it

A throwaway mod logged every `prompt.submit` and `session.receive` event under
`claude -p --input-format stream-json`, fed with the two message shapes the
desktop app's saved conversations record for these notes. It found:

- **Turn-end notes arrive at `prompt.submit`, not at `session.receive`.** The
  engine stamps them origin `composer`, the same origin as the person's own
  typing, so the origin cannot tell them apart. A turn-end note is a
  `<system-reminder>` block that begins `The session "<title>" you started
  (local_<id>) finished a turn`, and goes on to quote the sub session's last
  report as data. The app often sends it together with a block that begins
  `Linked sessions now (status, not an instruction):`, and several notes can
  come in one prompt. When the person types while notes are pending, the app
  puts the notes in front of the person's text in the same prompt.
- **A message a sub session sends with SendMessage also arrives at
  `prompt.submit`,** with origin `sdk`, as text that begins `Another Claude
  session sent a message:` and wraps the sub session's own words in a
  `<cross-session-message>` element. Nothing in it says whether it is a
  question or progress.
- **A `prompt.submit` hook that answers `{ drop: reason }` keeps the prompt
  from the model, and no turn runs.** The host shows the person
  "Prompt dropped by a hook: <reason>".

## Behavior

1. **What is dropped.** While the parent role is on, foreman's `prompt.submit`
   hook drops a prompt when, and only when, all of these hold:
   - the prompt carries no slash command, no attachments and no context that
     another hook added, because each of those means there is something more
     for the model to read;
   - the prompt's text, apart from white space, is made entirely of
     `<system-reminder>` blocks;
   - every block is either a turn-end note or a "Linked sessions now" status
     block;
   - there is at least one turn-end note;
   - every turn-end note names a `local_` id that belongs to a pairing in
     foreman's ledger whose standing is `active` or `freed`.

   A turn-end note is a block whose text begins `The session "` and whose
   first `you started (local_<id>) ` is followed directly by `finished a
   turn`. Any other prompt passes unchanged, byte for byte.
2. **The drop.** The hook answers `{ drop: "foreman kept a sub session's
   turn-end note from the parent's model; its pane shows the sub sessions" }`,
   a fixed text with no names in it.
3. **The pane log.** For each drop foreman writes one line to its pane log
   that names the sub sessions whose notes it kept, by issue key when the key
   has the shape `ABC-123` and by ticket otherwise, as foreman names them
   elsewhere, in sorted order, such as `Kept ABC-123's turn-end note from the
   parent's model.` or `Kept ABC-1's and ABC-2's turn-end notes from the
   parent's model.` Sorting makes the same set of sub sessions give the same
   line, so the log's "(n times)" count folds repeats together. No text from
   the note itself goes into the line.
4. **What still reaches the model.** Every one of these passes unchanged:
   - a prompt in which the person typed anything, even when notes come in
     front of it;
   - a message a sub session sends with SendMessage;
   - a note about a sub session that foreman does not track, that the person
     released, or whose pairing the ledger has since trimmed;
   - any note about a sub session the parent started that is not a
     "finished a turn" note, such as one saying the session was archived
     before it finished, and any note in a form foreman does not recognise;
   - foreman's own `foreman: ` wake lines.
5. **The wake skill's fallback rule.** `skills/wake/SKILL.md` gains a short
   rule: when a desktop app note about a sub session, or a message from one,
   reaches the parent's model while foreman is on, the model answers with
   nothing and ends its turn, unless the note is a milestone (a pull request
   opened, a merge) or a question for the parent or the person, which it
   relays in one line or answers.
6. **The skill's description** opens with "For the parent's model, not for
   typing. To start foreman, type /foreman." so that a person who sees
   `foreman:wake` in the menu does not run it instead of `/foreman`.
7. **The slot count's wording.** `/foreman slots 1` answers "This parent now
   runs 1 sub session at once."; every other count keeps the plural.

## Edge cases

- **A forged block.** The quoted report inside a note is text the sub
  session's model wrote, and it may contain `</system-reminder>` or text shaped
  like another note. A forgery can make the prompt fail one of the tests in
  point 1, so that it passes, which is what happens today. Or it can forge a
  whole second note about another tracked sub session, so that the prompt is
  dropped and the log line names that sub session too, although it sent no
  note; the only text lost is the forging sub session's own report, which
  would have been dropped anyway. A forgery cannot make foreman drop the
  person's typing, because the app puts that typing after the last real
  closing tag, outside every block, and any text there makes the prompt pass.
- **A note naming an id twice,** or a quoted report that names another
  session's id, is judged by the first `local_` id after `you started (`,
  which the app writes itself.
- **The ledger is empty,** as before the first sub session starts: every note
  passes.
- **A hook failure** passes the prompt on unchanged, as foreman's other hooks
  do.

## Non-goals

- Removing notes from a prompt the person typed into. The counsel chose to
  leave such a prompt unchanged.
- Filtering SendMessage deliveries by their words.
- Changing how the desktop app sends notes, or anything in builder.

## Failure modes

- If the app changes its note wording, foreman stops recognising the notes and
  they reach the model again, as today. Nothing is ever dropped by mistake.
- If the app moves these notes to `session.receive`, the same happens; the
  fallback rule in the wake skill still keeps the model quiet.

## Verification

- `claude plugin test` covers the hook: a prompt of tracked turn-end notes is
  dropped while the role is on, with the fixed reason and the pane log line;
  the same prompt passes while the role is off; a prompt with the person's
  text after the notes passes unchanged; a note about an untracked, released
  or trimmed sub session passes; a freed sub session's note is dropped; a
  SendMessage delivery passes; an archived note passes; a forged closing tag
  inside a quoted report makes the prompt pass; two sub sessions give one
  sorted log line.
- A test pins "1 sub session" and "2 sub sessions" for `/foreman slots`.
- The four gates pass.
- In a real run with foreman on and one sub session, the parent's model takes
  no turn for the sub session's turn-end notes, and the pane log shows the
  kept notes. This run is the person's to make in the desktop app, because the
  session that builds this change cannot start a parent of its own.

## Decided by the counsel

- When a desktop app turn-end note about a tracked sub session arrives in the parent while foreman's parent role is on, which prompts should foreman drop? The counsel chose: Drop a prompt only when it consists entirely of reminder blocks that are turn-end notes about sub sessions foreman tracks (plus any 'Linked sessions now' status block); a prompt with anything else in it, such as the person's own typing, passes unchanged. 4 of 7 members voted for it.
- Which of foreman's pairings count as a tracked sub session whose turn-end notes foreman drops: only active ones, active and freed ones, or every pairing including released ones? The counsel chose: Active and freed pairings: a freed sub session's late notes (cleanup chatter after it finished) are dropped too, while a released one's notes reach the model because the person took it out of foreman's hands. 7 of 7 members voted for it.
- What should foreman do with a message that a tracked sub session sends to the parent with SendMessage, as opposed to the app's automatic turn-end note? The counsel chose: Pass every SendMessage delivery through unchanged, because the channel cannot tell a question from progress; the spec says these still reach the model, and the wake skill's fallback rule tells the model to answer nothing unless it is a milestone or a question. 7 of 7 members voted for it.
- When foreman drops a prompt of turn-end notes, what should the drop reason say, given that the host shows it to the person as "Prompt dropped by a hook: <reason>" each time, and what goes in foreman's pane log? The counsel chose: A fixed reason with no names, "foreman kept a sub session's turn-end note from the parent's model; its pane shows the sub sessions", and a pane log line naming the sub sessions by issue key or ticket, such as "Kept ABC-123's turn-end note from the parent's model." 7 of 7 members voted for it.
- Besides "finished a turn", the desktop app sends other notes about a sub session the parent started, such as "The session ... you started (local_...) was archived by the user before it finished; it will not report. Don't message it; pick the task up here or start it again only if the user still wants it." Should foreman drop those too when they are about a tracked sub session? The counsel chose: Drop only notes whose wording is exactly the 'finished a turn' kind; an archived note, and any note in a form foreman does not recognise, passes through. 7 of 7 members voted for it.
