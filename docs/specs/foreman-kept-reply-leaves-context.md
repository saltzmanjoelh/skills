# Foreman's own "Noted." reply to a kept note leaves the parent's context

Written 2026-11-03. Seeded from an issue in the owner's tracker. It follows
`docs/specs/foreman-quiet-turn-end-notes.md`, whose rules stay in force
except where this spec changes them.

## Goal

Foreman keeps the desktop app's turn-end notes from a parent's model. It
rewrites such a prompt to one line, such as `Kept ABC-123's turn-end note
from the parent's model.`, and its `turn.step` hook answers that turn with
`Noted.` without asking the model. Each kept note therefore leaves two rows
in the parent's conversation, and every later real turn sends both of them
to the model. The model reads the `Noted.` row as something it said itself.
When asked whether the notes wake it, a parent's model concluded wrongly
that it had been woken for each one.

After this change, foreman's own `Noted.` reply is stored empty, so no later
model request carries it and the model never reads a reply it did not
write. The kept line stays. It is foreman's honest account of what happened,
and the earlier spec's counsel chose it for the person to see and the model
to read.

## Users and trigger

The owner, running a parent session that has run `/start-foreman` and that
starts `/implement` sub sessions through the desktop app. The change applies
to exactly the turns that foreman answers alone today.

## The probe

A throwaway mod ran on the desktop app's own engine, Claude Code 2.1.317,
with the flags the app passes: `--output-format stream-json --verbose
--input-format stream-json --replay-user-messages --include-partial-messages`.
Each run sent a real prompt, a kept prompt rewritten to the line and answered
alone, and a second real prompt. It measured:

- **The engine has no quiet way to drop a prompt.** A `{ drop }` answer at
  `prompt.submit`, or an answer without `next`, still produces the warning,
  and the turn-end notes never reach `session.receive`, whose `{ consumed }`
  answer is the only quiet one.
- **Emptying the stored reply works.** A `session.append` hook that rewrites
  the content of the `Noted.` row (door `response`) to an empty list is not
  refused and produces no warning. The engine stores the row as the text
  `(no content)`, and `$.session.messages()` still lists it as an assistant
  message. The stream sends no assistant message for it, the turn still makes
  no model request and costs nothing, and the turn's result text reads
  `(no content)`. The later real request leaves the row out entirely, and
  carries the kept line as plain text at the start of the next user message,
  followed by the person's own text.
- **The streamed chunk must stay.** When `turn.step` streams an empty text
  chunk, or no text chunk, in place of `Noted.`, the engine adds a "no
  visible output" nudge to the conversation and makes a real model request.
  So the hook keeps streaming `Noted.`, and only the stored row is emptied.
- **The engine cannot tell foreman's reply from the model's.** The row
  foreman's answer produces carries the origin `{ kind: 'model' }` with the
  session's model, the same as a real reply.
- **Other routes are worse or closed.** Emptying the prompt row as well
  stores and sends `(no content)` in place of the line. Running `/compact`
  with a `session.compact` hook that answers the list without the kept pair
  makes no model request, but adds `/compact` and `Compacted` rows to the
  transcript and three text blocks to the next request. A mod cannot hide a
  transcript row in the desktop app, because `ui.render` is never raised
  there, and no hook may set `isMeta`.

## Behavior

1. **The reply marker.** When foreman's `turn.step` hook has decided to
   answer a step alone, as the earlier spec's point 4 says, it sets a second
   one-time marker in its state, an atom that survives a hot reload, before
   it yields anything. The marker says that the next stored reply of the
   session's own loop is foreman's `Noted.`. A failure to set it does not
   stop the answer: the reply is then stored as today.
2. **Emptying the reply.** Foreman adds a `session.append` hook. For a row
   that came in by the door `response` and has no `agentId`, it reads the
   marker and, when it is set, clears it in one swap. When the marker was
   set and the row's content is text alone that reads exactly `Noted.`, the
   hook passes the row on with an empty content list. Every other row passes
   on unchanged, and so does any row met by a hook that throws.
3. **What stays the same.** The `prompt.submit` rewrite, the line, the pane
   log line, the first marker, `answersAlone` and the streamed `Noted.`
   chunk are unchanged. So is every prompt that foreman does not keep,
   including a note that arrives together with the person's own message.
4. **A stale reply marker.** The start of every turn of the session's own
   loop clears the reply marker, so a marker whose reply was never stored
   cannot empty a later reply. The marker is set during a turn, after that
   turn's start, so this never clears the marker for the reply it belongs
   to.
5. **The README** says that the transcript shows the short line for each
   kept note, that foreman's `Noted.` reply is stored empty so later turns
   of the model do not read it, and that the line still reaches the model
   as text on its next turn.
6. **The follow-up issue.** One issue is filed in the owner's tracker for the
   part of the done list this change cannot reach: the kept line row in the
   transcript, and the line in later requests. It is worded as foreman work
   that waits on the engine offering a quiet consume at `prompt.submit` or a
   hidden-row flag on `session.append`. It says that the work should start
   by checking whether the engine offers one, and that nobody has yet
   checked how the desktop app draws the streamed `Noted.` text when no
   stored assistant message follows it.

## Edge cases

- **The model itself replies `Noted.`**, for example to a prompt carrying
  foreman's Noted context. No reply marker is set, so the row is stored as
  the model wrote it.
- **Two kept notes in a row.** The first reply row stays in
  `$.session.messages()` as an assistant message reading `(no content)`, so
  the second line's previous message is not a user message, and the second
  turn is still answered alone.
- **A subagent's reply** carries an `agentId` and is never looked at.
- **A reply row whose text is not exactly `Noted.`** while the marker is set,
  which would mean the engine stored something other than foreman's answer,
  clears the marker and is stored unchanged.
- **A hot reload between the answer and the stored row.** The marker is an
  atom, so it survives the reload.
- **The role is off.** Foreman answers alone whatever the role, for notes
  about sub sessions it checks, so the reply is emptied whatever the role
  too.

## Non-goals

- The kept line row in the parent's transcript, and the line in later model
  requests. The engine offers no quiet consume at `prompt.submit` and no
  way for a mod to hide a row in the desktop app. The follow-up issue in
  point 6 holds this.
- Rows already stored in parents that are running now, which no hook can
  reach.
- Stripping kept lines from what a compaction reads, and running a
  compaction to remove them.
- Asking for the engine change itself, which does not go in this tracker.
- The streamed `Noted.` text and the turn's `(no content)` result text,
  which the engine sends and foreman cannot change without making a model
  request.
- Every prompt that foreman does not keep, and builder.

## Failure modes

- If the engine stops storing an emptied row as `(no content)` and drops
  it from `$.session.messages()` instead, two kept notes in a row would put
  two user lines next to each other, and `answersAlone` would let the model
  answer the second. That costs one ordinary model turn and loses nothing.
- If the engine starts refusing an empty content list, the hook's failure
  passes the row on unchanged, and the reply is stored as today.
- If the desktop app draws a streamed `Noted.` that no stored message
  follows as a lasting row, the transcript looks as it does today, and the
  model still no longer reads the reply.

## Verification

- `claude plugin test` covers: a response row of the session's own loop
  reading `Noted.` with the reply marker set is passed on with empty
  content, and clears the marker; the same row with no marker set, a model
  reply `Noted.` included, passes unchanged; a subagent's row and a row of
  another door pass unchanged and leave the marker set; a row whose text is
  not exactly `Noted.` clears the marker and passes unchanged; a turn start
  of the session's own loop clears the marker and a subagent's does not;
  the `turn.step` answer sets the marker before it yields and a step that
  goes to the model does not; a marker that cannot be read lets the row
  pass unchanged; and two kept notes in a row, with the first reply stored
  as `(no content)`, are both answered alone. The existing tests pass.
- The four gates pass.
- In a real run with foreman on and one busy sub session, the parent's
  transcript shows the short line for each kept note and no red warning,
  and the parent's model, asked what it said after a kept note, finds no
  reply of its own there. This run is the person's to make in the desktop
  app, because the session that builds this change cannot start a parent of
  its own.

## Decided by the counsel

- The engine has no way to keep a kept turn-end note's two rows completely out of both the parent's transcript and later model requests. Which design should foreman build for the prompts it keeps from the parent's model? The counsel chose: Empty only the stored Noted. reply through session.append, so later requests carry the kept line as user text and nothing as the model's own, and the transcript keeps the line row. 4 of 7 members voted for it.
- With only the stored "Noted." reply emptied, part of the issue's done list stays unmet: the kept line still shows in the parent's transcript, and later model requests still carry it as user text, because the engine offers no quiet consume at prompt.submit and no way for a mod to hide a row in the desktop app. What should this change do about the part it leaves out? The counsel chose: Do the same, and also file one follow-up issue in the tracker that names the engine gap and asks to finish the transcript and request items when the engine offers a quiet consume or a hidden-row flag. 7 of 7 members voted for it.
