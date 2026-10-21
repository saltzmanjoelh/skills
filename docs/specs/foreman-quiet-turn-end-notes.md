# Foreman keeps turn-end notes from the parent's model without a red warning

Written 2026-10-21. Seeded from an issue in the owner's tracker. It follows
`docs/specs/foreman-keeps-turn-end-notes.md` and
`docs/specs/foreman-quiet-parent.md`, whose rules stay in force except where
this spec changes them. The questions the issue left open were put to the
counsel.

## Goal

Foreman's `prompt.submit` hook drops every prompt made only of the desktop
app's turn-end notes about sub sessions it tracks, so that the parent's model
does not spend a turn on them. The desktop app draws every prompt a hook drops
as a red "Prompt blocked by a hook" warning, so a busy sub session, which ends
a turn each time it waits on its background agents, fills the parent's
transcript with a column of what look like errors. Foreman keeps those notes
from the parent's model as before, and the transcript no longer shows a red
warning for them.

## Users and trigger

The owner, running a parent session that has run `/start-foreman` and starts
`/implement` sub sessions through the desktop app. In a session whose role is
off, nothing below changes anything.

## The probe

A throwaway mod ran under `claude -p --input-format stream-json
--output-format stream-json` on Claude Code 2.1.300, which was not signed in,
so any real model request showed up as an authentication failure. It found:

- **There is no quiet drop.** A `prompt.submit` hook that answers `{ drop }`
  makes the host emit a system event of subtype `informational` and level
  `warning`, with `prompt_submit_outcome` of kind `dropped_by_hook`. A hook
  that answers without calling `next` emits the same kind of warning, with
  kind `not_passed_on`.
- **`session.receive` never sees these notes.** Its `{ consumed }` answer is
  quiet, but a prompt the SDK host writes to the CLI's input never reaches
  it.
- **An empty rewrite still asks the model.** Rewriting the prompt's text to
  `""` starts a turn that makes a model request.
- **A `turn.step` hook can answer a turn alone.** A `turn.step` hook written
  as an async generator that yields its own text chunk and a stop chunk
  without calling `next` makes no model request (cost zero, no
  authentication failure), emits no warning, and records an assistant reply
  with that text. At that step, `$.session.messages()` ends with the
  rewritten prompt as a user message whose text is exactly the rewritten
  line.

## Behavior

1. **Which prompts take the new path.** Exactly the prompts that the earlier
   spec's point 1 says foreman drops: while the role is on, a prompt with no
   slash command, attachments or added context, made only of turn-end notes
   about sub sessions whose pairing is active or freed, with status blocks
   and a side-sessions element allowed. Every other prompt keeps today's
   handling, unchanged.
2. **The rewrite.** For such a prompt, foreman writes its pane log line, then
   passes the prompt on with its text replaced by that same line, built by
   `keptLine` from `keptNames`, such as `Kept ABC-123's turn-end note from
   the parent's model.` or `Kept ABC-1's and ABC-2's turn-end notes from the
   parent's model.` The line holds only foreman's own words and the sub
   sessions' issue keys or tickets, never text from the note, and never
   begins `foreman: `. The hook no longer answers `{ drop }`, and the fixed
   drop reason is removed.
3. **The marker.** Before passing the rewritten prompt on, foreman sets a
   one-time marker in its state (an atom, which survives a hot reload)
   holding the exact line.
4. **The answer.** Foreman's `turn.step` hook answers a step alone, by
   yielding the text `Noted.` and a stop chunk with stop reason `end_turn`
   and no usage, without calling `next`, only when all of these hold:
   - the marker is set;
   - the step is the first of its turn (`index` 0);
   - the step belongs to the session's own loop (no `agentId`);
   - the conversation's last message, read with `$.session.messages()`, is
     a user message whose text is exactly the marker's line;
   - the message before it, if there is one, is not a user message, so the
     line is the only prompt the turn holds.

   The conversation is read only when the first three hold. The first step
   of a turn of the session's own loop clears the marker, whatever it
   decides. In every other case, and whenever anything throws, the step goes
   on to the model through `next`.

## Edge cases

- **The person types while a note waits.** The app puts the notes in front
  of the person's text in one prompt, which is not made only of notes, so it
  passes as before.
- **The person's prompt runs before the note's turn,** or the engine merges
  the two. The first step sees a last message other than the line, clears
  the marker and asks the model. The note's line then reaches the model on
  a later turn as an ordinary short message.
- **A note that arrives while a parent turn runs** is handled as when the
  parent is idle. If it later runs as its own turn, that turn gets `Noted.`.
  If the engine delivers it into the running turn, its line reaches the model
  at a step other than the first, and the next first step clears the marker.
  If the engine delivers it after the person's prompt started a turn but
  before that turn's first step, the message before the line is the person's
  prompt, so the model answers both.
- **A stale marker,** left by a hook that threw after setting it or a note
  whose turn never started, is cleared by the next first step of the
  session's own loop, which asks the model unless the last message is
  exactly the line.
- **A typed or forged copy of the line,** with no marker set, reaches the
  model. With the marker set, a prompt that is exactly the line foreman just
  wrote gets `Noted.`; that text is foreman's own, so nothing is lost.
- **A subagent's turn** carries an `agentId` and is never answered.
- **A hook failure** in `prompt.submit` passes the prompt on unchanged, as
  before; one in `turn.step` lets the model answer.

## Non-goals

- Every prompt that today reaches the model with the Noted context
  (SendMessage deliveries, archived notes, notes about released or untracked
  sub sessions) keeps that handling, and so does any prompt the person typed
  into.
- Changing how the desktop app sends notes or draws transcripts, or anything
  in builder.
- Removing the lines already in a parent's transcript, or the two short rows
  each kept note now adds to it, which later turns of the model read.

## Failure modes

- If the app changes its note wording, foreman stops recognising the notes
  and they reach the model with the Noted context, as today.
- If the engine stops letting a `turn.step` hook answer alone, the step that
  calls `next` is the model's ordinary short turn on a one-line prompt.
- If the engine changes what `$.session.messages()` returns for the last
  user message, the exact match fails and the model answers; nothing is
  ever swallowed.

## Verification

- `claude plugin test` covers the new path: a prompt of tracked turn-end
  notes enters as the log line with the marker set and one log line; the
  next first step of the session's own loop with that line last yields
  `Noted.` without calling `next`, and clears the marker; a step that is not
  the first, a subagent's step, a step whose last message differs, a step
  whose line follows another user message and a step with no marker each
  call `next`; a stale marker is cleared by a step that
  refuses; a failed read of the conversation lets the model answer; a typed
  copy of the line with no marker reaches the model. The existing notes tests
  pass, with the drop expectations changed to the rewrite.
- The four gates pass.
- In a real run with foreman on and one busy sub session, the parent's
  transcript shows the short line and `Noted.` for each turn-end note and no
  red warning. This run is the person's to make in the desktop app, because
  the session that builds this change cannot start a parent of its own.

## Decided by the counsel

- Foreman must keep a tracked sub session's turn-end note from the parent's model without the desktop app drawing a red "Prompt blocked by a hook" warning for it. Which path should foreman take? The counsel chose: Let the note's prompt enter, rewritten to one short line, and have a turn.step hook answer that turn's first model request itself with "Noted.", so no model request is made and no warning is drawn. 7 of 7 members voted for it.
- How should foreman's turn.step hook know that a turn is a rewritten turn-end note's turn, which it answers itself with "Noted." instead of asking the model? The counsel chose: Both a marker and the text: prompt.submit sets a one-time marker in foreman's state holding the exact line it wrote, and turn.step answers alone only when the marker is set, the step is the first of a turn of the session's own loop (index 0, no agentId), and the conversation's last message is a user message whose text is exactly that line; the first such step clears the marker whatever it decides, and any failure lets the model answer. 7 of 7 members voted for it.
- What should the one short line say that replaces a tracked sub session's turn-end note in the parent's transcript, which the person sees and the parent's model reads on later turns? The counsel chose: The same words as foreman's pane log line for the note, naming the sub sessions by issue key or ticket in sorted order, such as "Kept ABC-123's turn-end note from the parent's model." 5 of 7 members voted for it.
- Which prompts take the new quiet path (rewritten line plus a "Noted." answered without the model), and which are left out of this change? The counsel chose: Only the prompts foreman drops today (made only of turn-end notes about active or freed sub sessions, with status blocks and a side-sessions element allowed); every other prompt, including SendMessage deliveries, archived notes and notes about untracked or released sub sessions, keeps today's handling unchanged (the Noted context, a real model turn), and so does any prompt the person typed into. 7 of 7 members voted for it.
- When a tracked sub session's turn-end note prompt arrives while one of the parent's own turns is running (prompt.submit's input carries a turnId), what should foreman do with it? The counsel chose: The same as when the parent is idle: rewrite it to the line and set the marker. If the note then runs as its own turn, that turn's first step answers "Noted."; if the engine delivers it into the running turn instead, the next first step finds a different last message, clears the marker and asks the model, and the running model reads only the one short line. 6 of 7 members voted for it.
