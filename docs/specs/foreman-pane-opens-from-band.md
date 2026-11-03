# Foreman's pane opens from the band, and a failed open says why

Date: 2026-11-02.

## Goal

Foreman opens its pane once, when a session becomes the parent, and ignores
what the engine answers. In a desktop parent session the pane never appeared,
nothing in the band could open it, and the person did not learn why. Without
the pane the person also loses foreman's log and its Release and Nudge
buttons, and in that incident the Release button was the only way to free a
slot that a finished session still held.

This change gives the band a way to open the pane at any time, and makes
every open that foreman makes report an open that did not place the pane,
somewhere the person can see it without the pane.

## Users and trigger

The person running a parent session, which is a session where
`/start-foreman` turned foreman's role on. Two opens are covered:

- the open that foreman makes on its own when `/start-foreman` makes the
  session the parent, or when `/start-foreman` runs again in a session that
  is already the parent;
- the open made when the person presses the band's head.

## Behavior

1. **The head is a button.** The band's head, `foreman: N of M slots busy`,
   is drawn as a plain button with the same text, so the band's width and the
   way chips are fitted do not change. The head is a button in every band a
   parent draws, including the band with no sub sessions, whose head is drawn
   apart from the rest of its line so that it can be pressed.
2. **Pressing the head only opens.** A press calls `$.ui.open` for foreman's
   pane. It never closes the pane, whether or not the engine lists the pane
   as open.
3. **A pane that waits.** When `$.ui.open` answers `isPlaced: false`, foreman
   shows the toast `foreman's pane waits and is not drawn yet. The engine
   says: "<reason>"` and writes the same line to foreman's log, where
   `<reason>` is the engine's reason, cleaned of control characters and cut
   to length as foreman cleans other engine text.
4. **An open that throws.** When `$.ui.open` throws, foreman shows the toast
   `Could not open foreman's pane (<error message>).` and writes the same
   line to its log, with the message cleaned the same way.
5. **A pane that is placed** shows no toast and writes no log line.
6. **The `/start-foreman` answer tells the truth.** When the command's open
   placed the pane, the answer is what it is today. When it did not, the
   answer no longer says that foreman shows its sub sessions in its pane. It
   says that foreman shows them above the prompt, then gives the sentence of
   point 3 or point 4, and says that pressing the band's head opens the pane.
   This holds for the answer with a slot count and the answer without one.
7. Points 3 and 4 apply to both opens. The press on the head reports through
   the toast and the log line, since it has no command answer.

## Edge cases

- The engine places an open made in answer to the person's press at any
  width, but one that the mod makes on its own waits undrawn below 144
  columns. So point 3 is common for `/start-foreman` in a narrow window and
  rare for a press.
- A toast that throws does not stop the log line, and neither one stops the
  role from turning on or the command from answering.
- `/start-foreman <n>` in a session that is already the parent makes no
  open, as today, and its answer does not change.

## Non-goals

- Builder's band presses, which also throw away an answer that did not place
  builder's pane, are not changed. That is a separate issue in another mod.
- Foreman's `+N more` stays plain text. The head already opens the pane that
  lists every sub session.
- The head does not toggle the pane closed. The engine's own pane controls
  close it.
- No new slash command opens the pane; `/start-foreman` already reopens it.

## Failure modes

- The engine leaves the pane undrawn: the person sees the toast with the
  engine's reason and, at `/start-foreman`, an answer that says so, and the
  line stays in the log for when the pane opens.
- `$.ui.open` throws: the person sees the failure sentence with the error's
  message, in the same places.

## Verification

Tests in `mods/foreman/tests`, with the fake engine's `ui.open` able to
answer placed, not placed with a reason, or throw:

- Pressing the head opens foreman's pane, both in a band with chips and in a
  band with no sub sessions, and the band text is unchanged.
- Pressing the head with the pane already listed as open calls `$.ui.open`
  again and closes nothing.
- An open that answers not placed shows the waits toast with the reason and
  writes the same log line, for the press and for `/start-foreman`.
- An open that throws shows the "Could not open" toast and log line, for the
  press and for `/start-foreman`.
- A placed open shows no toast.
- The `/start-foreman` answer, with and without a slot count, says the pane
  shows the sub sessions only when the open placed it, and otherwise carries
  the reason and points at the band's head.
- The gates in the project's `CLAUDE.md` pass.

## Decided by the counsel

- Which part of foreman's band should become the button that opens foreman's pane? The counsel chose: Make the band's head text ("foreman: 2 of 3 slots busy") itself a button that opens the pane, like the builder band's agent-count button. 7 of 7 members voted for it.
- When foreman's pane is already open, what should pressing the band's head do? The counsel chose: Always open: pressing the head only ever opens or brings forward the pane, and never closes it. 6 of 7 members voted for it.
- When foreman's $.ui.open answers isPlaced false, or the call throws, where should foreman say why? The counsel chose: A toast and a log line for both opens, and also the /start-foreman answer says the pane waits and why, instead of saying foreman shows its sub sessions in its pane. 7 of 7 members voted for it.
- What is out of scope for this change? The counsel chose: Foreman only: builder's band presses, which also throw away an unplaced answer, and making foreman's "+N more" a button are both left out and written down as non-goals. 7 of 7 members voted for it.
- How should foreman word the toast and log line when its pane does not open? The counsel chose: Two sentences: the waits sentence above when isPlaced is false, and "Could not open foreman's pane (<error message>)." when $.ui.open throws, since a throw means the open failed rather than waits. 7 of 7 members voted for it.
