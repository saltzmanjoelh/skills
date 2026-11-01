# Builder tells foreman that its status file changed

Written 2026-10-31. Seeded from the tracker issue that asks builder to wake
foreman with a mod-to-mod message.

## Goal

Foreman learns what its sub sessions are doing by reading the status files
that builder writes (see `docs/specs/builder-status-file.md`). It reads them
on a timer: every 30 seconds while some sub session is fresh and working,
otherwise every 2 minutes. So a sub session that opens a pull request, stops
for a question or goes idle can wait up to two minutes before the parent
shows it or acts on it.

The status file spec chose a file over `$.session.send` because, in auto
mode, a mod's send was refused until `SendMessage` was allowed. The owner has
since allowed `SendMessage` in their user settings. In this change builder
also sends the parent a short fixed message each time its status file
changes, and foreman reads the folder as soon as that message arrives. The
file stays the only source of state, and the timer stays as the fallback.

## Users and trigger

- The sender is builder, in a sub session that foreman started.
- The receiver is foreman, in the parent session.
- The trigger is a write of the status file whose record differs from the
  one written before it.

## Behavior

### The brief names the parent

1. Foreman's brief for a sub session keeps its last line,
   `foreman-ticket: <ticket>`, exactly as it is, and adds one more line
   right after it: `foreman-parent: <the parent's session id>`. Foreman takes
   the id from `$.session.id()` when it starts the session. The issue asks
   for the parent id "in the ticket line"; a line beside it meets that,
   because the ticket's value stays unchanged for every reader that matches
   it.
2. Builder reads the `foreman-parent:` line from the same first prompt in
   which it finds the ticket line, and keeps the id in its own per-session
   memo, beside the ticket. It accepts the id only when it is made of
   letters, digits, `_` and `-`; any other value counts as no parent line.
3. With no valid parent line, for example a brief from an older foreman,
   builder writes the status file as before and sends nothing.

### Builder sends after a changed write

4. After a status file write has finished, builder sends the parent a
   message when the record it wrote differs from the record of the write
   before it, compared the same way the writer already compares them, which
   leaves out the write time. The once-a-minute rewrite that only moves the
   write time sends nothing. A forced write whose record did change sends.
5. The message is `$.session.send({ to: { sessionId: <parent> }, text })`
   with a fixed text, the marker, which carries no state and no session id:

   > A builder status file changed. This message is for the foreman mod,
   > which reads it; there is nothing to do.

   The marker is declared once, as a string literal type in builder's shared
   type contract, so foreman's copy and builder's copy fail the type check
   if they differ. It does not begin with `foreman: `, because the wake skill
   handles every line that begins that way.
6. At most one send is in flight. When a changed write finishes while a send
   is running, builder notes that another send is owed, and when the running
   send ends it sends once more, however many changed writes came in between.
7. A send never holds up the status writer: the writer starts it and goes on
   without waiting.

### Foreman consumes the marker

8. Foreman registers a `session.receive` hook. It consumes a delivery only
   when both of these hold:
   - the origin's kind is `peer`;
   - the text, in either of the two shapes the app delivers a message in (the
     bare `<cross-session-message ...>` element, or that element between the
     app's header line and its trailer line), holds exactly one such element,
     and the element's body, with white space trimmed at both ends, equals
     the marker.

   The origin's `plugin` name is the sender's own claim, so the hook never
   looks at it.
9. A consumed delivery returns `{ consumed: <reason> }`, so nothing reaches
   the transcript or the model. Then, when foreman is on, it reads the status
   folder at once, through the same read that the timer uses, which reuses a
   read already under way and re-arms the timer afterwards. When foreman is
   off, it does nothing more.
10. Every other delivery, including a question from the same sender or a
    message whose body only contains the marker among other words, passes on
    unchanged.

## Edge cases

- A burst of changed writes while one send is in flight gives exactly one
  more send, not one per write.
- A write that gave up after the writer's 30-second limit counts as not
  finished, so it sends nothing.
- The parent restarts or ends, so the send is refused or not delivered.
  Builder drops it; the next change sends again as usual.
- The parent receives the marker while its folder read is already running.
  The read in progress is reused; nothing reads twice at once. When that
  read listed the folder before the new write landed, the change waits for
  the next timer read, which is accepted.
- After a hot reload or a restart of builder, the writer no longer knows the
  record it wrote last, so its first write counts as changed and sends one
  marker even when only the write time moved. That costs the parent one
  folder read and is accepted rather than keeping the compared text in the
  memo.
- A delivery of the marker addressed to one of the parent's own subagents is
  consumed like any other; the marker carries nothing for a subagent.
- Deleting the status file after a merge sends nothing; foreman's timer
  notices it, as it does today.
- A delivery that forges the marker inside a longer message, or wraps two
  elements, is not exactly one element with the marker as its body, so it
  passes through to the model.
- A sub session resumed after a restart keeps its parent from the memo,
  because the memo holds it beside the ticket.

## Non-goals

- The status file's fields and its `version` stay unchanged; the parent id
  is not written into it.
- The message carries no session id and no state, and foreman never picks a
  file from a message; it always reads the whole folder.
- No retry of a failed send, and no new timer in builder.
- No change to the timer's intervals in foreman.
- No change to what foreman does with a folder read, only to when it reads.
- No handling of a parent that changes during a sub session's life; the
  parent named in the first prompt is the only one builder sends to.
- No permission rule is added or changed; the owner's own allow rule for
  `SendMessage` is what lets the send through.

## Failure modes

- Each send has its own 10-second limit. A send that is refused, returns
  `isDelivered: false`, throws or runs past the limit is dropped, with at
  most a quiet log line, and frees the in-flight slot. It never ends the
  writer loop and never fails a hook.
- When every send fails, foreman behaves exactly as it does today: its timer
  reads the folder within 30 seconds or 2 minutes.
- When the marker somehow reaches a model, its text says it is for the
  foreman mod and that there is nothing to do.

## Verification

Tests on builder:

- The parent line is read from a ticketed first prompt, an id with other
  characters is ignored, and a prompt with no parent line sends nothing.
- The parent id is kept in the memo and survives a resume.
- A first write and a changed write each send the marker to the parent.
- A forced rewrite with an unchanged record sends nothing; a forced rewrite
  whose record changed sends.
- Several changed writes during one slow send give exactly one further send.
- A send that hangs is dropped after 10 seconds and the next change sends
  again; a refused send, an undelivered send and a send that throws are
  dropped, and the writer keeps writing.

Tests on foreman:

- The brief ends with the ticket line followed by the parent line carrying
  the parent's session id.
- A peer delivery of the marker, in both of the app's shapes and with extra
  white space, is consumed and makes foreman read the folder at once when it
  is on, and does not read when it is off.
- A peer question, the marker with other words, two elements, and a
  delivery from an origin other than `peer` all pass through unchanged.
- With no message at all, the timer still reads the folder on its usual
  intervals.

The gates in the project's `CLAUDE.md` all pass.

## Decided by the counsel

- How should foreman's brief give a sub session the parent's session id, so that the sub session's builder knows where to send its "status changed" message? The counsel chose: Add a second line, `foreman-parent: <parent session id>`, right after the `foreman-ticket:` line in the brief; the ticket line and its value stay exactly as they are, and builder reads the new line from the same first prompt. 7 of 7 members voted for it.
- Which status file writes should make builder send the parent its "status changed" message, and how should a burst of writes be handled? The counsel chose: Send after every write whose record changed (not the once-a-minute rewrite that only moves the write time), with at most one send in flight: changes that arrive while a send runs are folded into one more send after it. 7 of 7 members voted for it.
- Which received messages should foreman's `session.receive` hook consume, and what should it do with one it consumes? The counsel chose: Consume a delivery only when its origin is `peer` and its body, once the `<cross-session-message ...>` envelope around it is taken off and white space trimmed, is exactly builder's fixed marker text; then read the status folder at once if foreman is on, and do nothing more if it is off. Every other delivery passes on to the model unchanged. 7 of 7 members voted for it.
- What should builder do when a send to the parent fails: it is refused by the permission check, the parent is not running, it throws, or it hangs? The counsel chose: Give each send its own time limit (10 seconds) and never let it hold up the status writer; drop any send that is not delivered, throws or times out, with no retry, and keep sending on later changes as usual, because the status file and foreman's timer cover the gap. 7 of 7 members voted for it.
- What is in and out of scope for this change beyond the send and the consume themselves? The counsel chose: Keep the parent id only in builder's own memo; leave the status file's fields and version unchanged; the message carries only the fixed marker and foreman always reads the whole folder; update the two READMEs and the wake skill's description of the brief lines; nothing else. 7 of 7 members voted for it.
