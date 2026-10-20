# /implement starts the pilot mod before it checks the issue

Written 2026-10-08.

## Goal

From the first moments of an `/implement` session, the person can see the
pilot mod working: right after Remote Control is turned on, the session
opens the mod's pane, and only then reads the project's facts and checks
the issue. The skill lists its startup actions in the order the session
performs them, in one place.

## Users and trigger

A person who starts `/implement <issue>` or `/implement --resume #N` and
wants to follow it, in the terminal or from another device. Today nothing
mentions the mod until the pull request opens, the pane opens only when the
person types `/pilot`, and the skill contradicts itself about what comes
first: "The project's facts" says to say the facts "before starting", while
step 1 says to turn Remote Control on "first".

## Behavior

1. **A new session tool opens the pane.** The pilot mod registers
   `mcp__pilot__open_pane`, which takes no input and opens the pane with the
   same `$.ui.open({ id: PANE, title: 'pilot' })` call that `/pilot` makes,
   through one shared helper so the two cannot drift apart. The helper also
   builds the reply from what the engine answered, so `/pilot` stops always
   saying "Pane opened." when the pane only waits. Like the other
   session tools, it is listed in `SESSION_TOOLS`, so a subagent's call is
   refused. Its reply begins `pilot: ` and says what the engine answered:
   that the pane is open when `isPlaced` is true, and otherwise that it
   waits, with the engine's reason (see Edge cases). It never says the pane
   opened when the engine only queued it.
2. **Step 1 of `/implement` performs the startup in this order,** each as
   its own item: turn Remote Control on; start the pilot mod by calling
   `mcp__pilot__open_pane`; read the project's facts and say the base
   branch, the gates and the limits in one line; make the worktree; read
   the architecture and gotchas documents. Step 2, checking the issue, comes
   after all of these.
3. **"The project's facts" keeps its table and its rules about reading the
   merge facts from the base branch,** but no longer says when to speak;
   step 1 says that.
4. **A refused or failed Remote Control does not stop the session.** The
   session says in one sentence, at that moment, that Remote Control is off
   and why, then starts the mod and carries on.
5. **A missing pilot tool stops the session.** If `mcp__pilot__open_pane`
   is not available, the mod is not loaded; the session says so and stops,
   because watching the pull request and every reviewer depend on the mod.
6. **Resuming starts the same way.** `/implement --resume #N` begins with
   step 1's first two actions, Remote Control and then starting the mod,
   before it finds the branch and worktree. The Resuming section points
   back to step 1 rather than copying its text. The issue does not mention
   resuming; it is included because a resumed session is a new session
   after a restart and has neither Remote Control nor the pane.
7. **The README lists the new tool** in its table of what the session can
   call.

## Edge cases

- **A terminal too narrow for the pane.** Opened by a tool call rather than
  by the person, the pane is placed only from 144 terminal columns (110 for
  a pane the person opened before), and otherwise waits undrawn until the
  person types `/pilot` or the terminal widens. The tool replies that the
  pane waits, quoting the engine's reason word for word and adding that
  `/pilot` or a wider terminal shows it; the session says that in one
  sentence and carries on.
- **An app that places no panes** (an older desktop): the engine answers
  `isPlaced: false` with its reason, handled as the narrow terminal is. The
  quoted reason is what tells the person which remedy applies; the reply
  does not promise that `/pilot` seats the pane on every surface.
- **A pane that is already open.** A second call retitles it in place and
  answers that it is open; nothing else changes.
- **A `claude -p` run.** The engine places every pane, so the tool answers
  that it is open.

## Non-goals

- Changing what the pane draws, or when the mod polls. With nothing
  watched, the pane draws its idle view and the mod does not poll.
- Starting to watch anything before the pull request exists.
- Reading the gate commands and the worktree setup command from the base
  branch rather than from the checkout the session started in. The security
  reviewer raised this in the counsel; it is a separate change.
- Adding a rule to the skill about keeping its steps in order. The issue
  asks only that the order be applied this time.

## Failure modes

- Remote Control refused: one sentence, then the session carries on.
- The pilot tool is missing: the session says the mod is not loaded and
  stops.
- The pane waits: the session repeats the tool's reply in one sentence and
  carries on.

## Verification

- `claude plugin test` in `mods/pilot` includes a test that calling
  `mcp__pilot__open_pane` opens the pane with the pane's id and title, one
  that the reply says the pane waits, with the engine's reason, when the
  engine answers `isPlaced: false`, one that the reply says the pane is
  open when the engine answers `isPlaced: true`, one that `/pilot` gives the
  same reply as the tool for each answer, and one that a subagent's call is
  refused.
- The type check and `claude plugin validate` pass.
- A reader of `skills/implement/SKILL.md` finds step 1 listing, in order:
  Remote Control, `mcp__pilot__open_pane`, the facts line, the worktree,
  the documents; finds no sentence elsewhere that says when to say the
  facts; finds the Remote Control and missing-tool cases stated; and finds
  the Resuming section beginning with step 1's first two actions. No gate
  reads `skills/`, so only the reviewers check this.

## Decided by the counsel

- The issue behind this spec says that /implement should "start the pilot mod" right after it turns on Remote Control and before it checks the issue. What should starting the mod mean in the skill? The counsel chose Add a session tool to the pilot mod that opens its pane (calling $.ui.open, as the /pilot command already does). Step 1 of /implement calls that tool right after Remote Control. If the tool is missing, the mod is not loaded, and the session stops and says so., 3 of 3; security-reviewer, performance-reviewer and data-reviewer abstained.
- Where in /implement's ordered startup should the session read the project's facts and say the base branch, gates and limits in one line, now that the order must be Remote Control, then starting the pilot mod, then checking the issue? The counsel chose Inside step 1, right after the pilot mod starts and before the worktree is made: Remote Control, start the mod, read the facts and say them in one line, make the worktree, read the architecture and gotchas documents. The facts section keeps its table but no longer says when to speak., 3 of 4; performance-reviewer and data-reviewer abstained.
- Should `/implement --resume #N` also turn Remote Control on and start the pilot mod (open its pane through the new tool) before it does anything else, the way a fresh /implement now does? The counsel chose Yes: the Resuming section begins with the same two actions as step 1, Remote Control and then starting the mod, before it finds the branch and worktree., 3 of 3; security-reviewer, performance-reviewer and data-reviewer abstained.
- When turning Remote Control on fails or is refused (by a permission check, or because the app reports it unavailable), what should /implement do before going on to start the pilot mod? The counsel chose Carry on: say in one sentence that Remote Control is off and why, then start the mod and continue. The session works without it; only following from another device is lost., 4 of 4; performance-reviewer and data-reviewer abstained.
- When the new pilot tool reports that the pane is open but waiting undrawn (the engine's $.ui.open answered isPlaced false, because the terminal is under 144 columns or the attached app places no panes), what should the tool reply and the session do? The counsel chose The tool replies that the pane waits, quoting the engine's reason and saying that /pilot or a wider terminal shows it; the session repeats that in one sentence and carries on., 3 of 3; security-reviewer, performance-reviewer and data-reviewer abstained.
