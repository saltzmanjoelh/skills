# Plan: foreman's pane opens from the band, and a failed open says why

Date: 2026-11-02. Spec: `docs/specs/foreman-pane-opens-from-band.md`.

Three plans competed: the simplest change, the most robust change and the most
extensible change. The judge ranked the simplest plan first, because it meets
the spec exactly with the fewest new parts, and none of the three adds stored
or module-level state. This plan is the simplest plan with the grafts listed
below.

## Chosen approach

One function in `mods/foreman/hooks/register.tsx`, `openPane($)`, calls
`$.ui.open` for foreman's pane and never throws. When the pane is placed it
returns null and shows nothing. When the engine answers that the pane is not
placed, it builds the sentence `foreman's pane waits and is not drawn yet. The
engine says: "<reason>"`. When the call rejects, it builds the sentence `Could
not open foreman's pane (<error message>).`. It then shows that sentence as a
toast and writes it to foreman's log, each inside its own try, so that a toast
that throws does not stop the log line, and returns the sentence.

`becomeParent` returns what `openPane` returned, in place of throwing the
answer away. `applyCommand` passes that result to the answer builders in
`mods/foreman/hooks/commands.ts`. The answer without a slot count, which today
is a literal inside `applyCommand`, moves into `commands.ts` beside the answer
with a slot count, so that both answers share one helper. When the pane was
placed, both answers are exactly what they are today. When it was not, they say
that foreman shows its sub sessions above the prompt, then give the sentence,
then say that pressing the band's head opens the pane. A session that is
already the parent and runs `/start-foreman <n>` makes no open, and its answer
does not change.

In `mods/foreman/hooks/pane.tsx`, `BandPresses` gains a second press for the
pane, and the head is drawn as a plain `Button` with a `Text` child, the same
form as the chips, so the band's text and width do not change. The band with
no sub sessions draws its head apart from the rest of its line so that the
head can be pressed. The `AbovePrompt` render hook wires the press to
`openPane($)` and ignores the sentence, because the toast and the log line are
the only places a press can report.

## Grafts from the other plans

- **Update the `BAND_BEFORE` snapshot** in
  `mods/foreman/tests/issue-links.test.ts`, which pins the head as a `Text`.
  Both other plans named it. Without it the gates fail on the first run.
- **Record closes and list open panes in the fake engine.** Add a `ui.close`
  recorder and a `ui.panes` lister to `engine()` in
  `mods/foreman/tests/world.ts`. Both other plans had them. The spec's check
  that a press "closes nothing" proves something only when a close would be
  recorded.
- **An empty reason reads "no reason was given".** Both other plans had this.
  A small helper in `register.tsx` cleans engine text and falls back to that
  phrase, and `reasonOf` calls it, so the waits sentence is cleaned exactly as
  foreman cleans other engine text and never quotes an empty string.
- **Update the README.** The most robust plan did this. The band section says
  only that chips can be pressed, and the commands table says `/start-foreman`
  opens the pane. Both should say what the head does and what happens when the
  pane waits. No gate reads the README.
- **The fake engine rejects through `{ deny }`.** The judge checked that a
  `deny` answer rejects the mod's call with the deny text as its message,
  while this test engine swallows a throw from some hooks. So the "throws"
  setting of the new `answers.open` knob answers `{ deny: … }`.
- **Extra failure tests from the most robust plan.** The role stays on after
  an open that waits and after one that throws, and a toast that throws still
  leaves the log line.
- **The answer with words after the command.** One test checks that the
  passed-on sentence follows the waits sentence correctly.

## Rejected alternatives

- **A 30-second timeout around the open** (most robust plan). The spec names
  two sentences, not three. A timeout also creates a wrong report when the
  engine places the pane after the limit, and leaves a timer that can survive a
  hot reload.
- **A new `opening.ts` module with a three-kind result type** (most extensible
  plan). The answer needs only the sentence, so a string or null carries the
  same information with no new file.
- **Naming the press so that `+N more` can reuse it later** (most extensible
  plan). Making `+N more` a button is a non-goal of the spec.
- **Treating an answer of unknown shape as placed, or as not placed** (both
  other plans). The engine's types allow only the two documented answers.
- **Drawing the head as a `Button` with a `label` and no children** (most
  robust plan). It differs from the chips and may change the text that the
  existing band tests read.
- **More fake-engine settings, such as a refused open or a hung open** (most
  robust plan). The spec's verification asks for placed, not placed and throws.

## Steps

1. In `world.ts`, add the `answers.open` knob (placed, not placed with a
   reason, or throws through `deny`), the `ui.close` recorder and the
   `ui.panes` lister.
2. Write the failing tests (see the test plan) in a new file,
   `mods/foreman/tests/pane-open.test.ts`, and the unit cases for the answers
   in `mods/foreman/tests/commands.test.ts`. Run them and see them fail.
3. In `commands.ts`, add the shared helper, the answer without a slot count,
   and the second argument of the answer with one.
4. In `register.tsx`, add the cleaning helper and `openPane`, make
   `becomeParent` return its result, and build the answers from it.
5. In `pane.tsx`, add the press and draw the head as a button in both bands.
   Wire the press in the `AbovePrompt` render hook.
6. Update `BAND_BEFORE` and the README.
7. Run the gates.

## Test plan

Each item maps to the spec's Verification section.

- Pressing the head opens foreman's pane in a band with chips and in a band
  with no sub sessions, and the band text is unchanged.
- Pressing the head while the pane is listed as open calls `$.ui.open` again
  and records no close.
- An open that answers not placed shows the waits toast with the cleaned
  reason and writes the same log line, for the press and for `/start-foreman`.
  An empty reason reads "no reason was given".
- An open that throws shows the "Could not open" toast and log line, for the
  press and for `/start-foreman`.
- A placed open shows no toast and writes no such log line.
- The `/start-foreman` answer, with and without a slot count and with words
  after the command, is today's answer when the pane is placed, and otherwise
  carries the sentence and points at the band's head.
- `/start-foreman <n>` in a session that is already the parent makes no open.
- The role stays on after a failed open, and a toast that throws still leaves
  the log line.
- The gates in the project's `CLAUDE.md` pass.
