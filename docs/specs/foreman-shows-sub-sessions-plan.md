# Plan: foreman shows the sub sessions

Written 2026-10-20 for `docs/specs/foreman-shows-sub-sessions.md`. Three
planners worked blind, from the simplest change, the most robust change and the
change easiest to extend; a judge compared them against the spec.

## Chosen approach

The most extensible plan won. It builds foreman in builder's shape, small pure
modules that the tests check without the engine and a `register.tsx` that wires
them, and splits the modules where the next step will cut, without building
anything the next step needs that this spec does not.

- **`hooks/record.ts`** alone declares the status record and parses it
  (`recordIn(text)`), with a comment saying to replace the type with an import
  from builder's contract once that contract has it. A file counts as not
  parsing unless it is a JSON object with a string `sessionId`, a non-empty
  string `issueKey` and one of the six states. Every other field falls back to a
  safe default when missing or of the wrong type: a stage outside builder's nine
  becomes null, and `stageDone` is held between 0 and 9.
- **`$.state` keeps the last good text of each file**, as
  `{ file, text, mtimeMs }`, never the parsed record, so the state contract
  stands alone and the last good read survives a hot reload. Drawing parses the
  kept text again.
- **`hooks/parent.ts`** holds the parent's settings,
  `{ isOn, slots: number | null, isPaused }`, with a tolerant reader and one
  writer that writes both `$.state` and the store key `parent:<session id>`.
- **`hooks/desktop.ts`** wraps `$.mcp.call` for the desktop app's tools: a call
  answers either its content or one of three causes, `not-connected` (the call
  rejected), `refused` (`isError`) or `unreadable` (an answer that is not what
  was asked for). `openSession` uses it to find the session and open it beside
  the parent, and answers either that it opened or the reason it did not.
- **`hooks/subs.ts`** holds the pure rules: what a read leaves in place
  (`afterRead`), `STALE_MS` and `isStale`, the delay to the next read, the busy
  count, the chips that fit the band with `+N more`, and `STATE_LOOK`, a table
  that gives every state its words and its tone (red, amber or plain). The
  table is typed as a record over every state, so adding the gone state in the
  next step fails the type check until it has an entry.
- **`hooks/commands.ts`** parses `/foreman` arguments into turn on, set slots,
  pause, resume, or the usage, without the engine.
- **`hooks/text.ts` and `hooks/art.ts`** are copies of builder's `printable`,
  `timeOfDay`, `isSvgSurface`, `hasSvg`, `xmlText`, `svgWidth`, `barCells`,
  `fitBar` and `barSvg`, because a mod cannot import another plugin's files.
  Each copy names the builder file it came from. **`hooks/stages.ts`** holds
  the nine stage labels, checked at compile time against `StageId` from
  builder's contract.
- **`hooks/pane.tsx`** draws the band and the pane from a `View`.
- **`hooks/register.tsx`** wires the events: `session.start`, `command.run`,
  the band and pane renders, and the presses.

## Grafts from the runners-up

1. **Re-arming after a reload (from the robust plan).** A hot reload drops the
   module's timers, and `session.start` is not the only hook that runs after
   one. While the role is on, `session.start`, `command.run`, `prompt.submit`
   and `turn.complete` each check that the read timer and the redraw ticker are
   armed, and arm them from the saved `nextReadAt` when they are not, reading at
   once when the read is overdue. Builder survives reloads the same way. No
   draw starts work.
2. **A failed listing (from the robust plan).** When `$.fs.list` rejects,
   foreman asks `$.fs.exists`: a missing folder reads as no sub sessions, and
   any other failure keeps the last list and writes the cleaned reason to the
   log. This avoids checking first and listing second, which can race.
3. **The log and the folder match (from the robust plan).** The log is
   appended with `update`, so two quick presses both get their line. Folders
   are compared without a trailing slash.
4. **One failure sentence and three tests (from the simplest plan).** Every
   failed open says `Could not open KEY: <reason>.`, as a toast and as the same
   log line, with a fixed reason for each cause, including a tool error with no
   text. Tests are added for `CLAUDE_CONFIG_DIR`, for `+N more`, and for
   staleness just under three minutes.

## Rejected alternatives

- **Rows only in a module variable (the simplest plan).** A hot reload empties
  it, so a file caught mid-write by the first read after a reload would drop
  out, although the spec keeps the last good read for the whole session. The
  same plan repaired a lost timer from inside a draw, which is a side effect
  where builder allows none.
- **One large `register.tsx` (the simplest plan).** It is not builder's
  pattern, and the next step would have to split it before adding its actions.
- **Refusing to open when two sessions share a folder (the robust plan).** The
  spec takes the session whose folder matches, every sub session has its own
  worktree, and the spec's list of failures does not include it. Foreman takes
  the first match.
- **Refusing a subcommand before `/foreman` (the robust plan).** The spec
  refuses only bad arguments. A slots or pause command before `/foreman` is
  stored and answered, and takes effect once the role is on.
- **A timeout on opening, a file size limit, a limit on reads at once, numbered
  reads, skipping files whose size and time are unchanged, and deleting old
  store entries (the robust plan).** None is in the spec, and the skip could
  miss a rewrite of the same size within the same timestamp.

## Steps

1. Write the manifest (`dependencies` naming builder, `userConfig.slots`
   defaulting to two, `types`), `hooks/hooks.json`, `tsconfig.json`,
   `.gitignore` and `types/index.d.ts`. Change the first gate in the root
   `CLAUDE.md` to load both plugin folders and check both types folders, and
   add the other three gates for `mods/foreman`. Run the first gate.
2. Copy `text.ts` and `art.ts`, write `stages.ts`, with a test that the copies
   draw what builder's do for the same input.
3. Write `record.ts` and its tests, then make them pass.
4. Write `subs.ts` and `commands.ts` and their tests, then make them pass.
5. Write `parent.ts` and `desktop.ts` with `openSession`, and their tests.
6. Write `pane.tsx` and `register.tsx`, with the engine tests below.
7. Add the mod's README, the marketplace entry and the root README's entry.
8. Run all four gates for both mods.

Each test is written first and seen to fail before the code that passes it.

## Test plan

The engine tests share one helper: `mock.clock`, `mock.store`, `mock.env` with
`HOME`, hooks on `fs.list`, `fs.exists` and `fs.read` that answer from a
fixture folder that the test can change and that count their calls, a hook on
`mcp.call` that records each call and answers from a script, and a hook on
`ui.toast` that records each toast.

1. **Both surfaces.** On the terminal and the desktop, after `/foreman`, the
   band holds `foreman:`, `2 of 2 slots busy`, both issue keys, a stage, the
   words `needs you`, and `next read in 30s`; the pane holds the issue button,
   the bar (`3 of 9` on the terminal, an image on the desktop), the state with
   its reason, Nudge and Release. With no files the band reads
   `foreman: 0 of 2 slots busy · no sub sessions · next read in 2m`. A narrow
   band ends with `+N more`.
2. **Opening.** Pressing the issue button in the pane and a chip in the band
   each call `open_session_in` with the record's desktop session id and the
   target `split`. Without a desktop session id, `list_sessions` is called
   first and the session whose folder matches is opened, a trailing slash
   included.
3. **Failed opens.** One test for each cause: no id and no folder, no session
   in that folder, the call rejected, a list that cannot be read, and
   `open_session_in` answering an error with text and with none. Each shows a
   toast equal to the newest log line, with that cause's reason, and the raw
   error text appears in neither.
4. **The role.** Without `/foreman`, the band draws what the engine would draw
   and no file is listed after ten minutes on the clock. `/foreman` turns the
   role on and writes the store. With the store already holding an on value,
   `session.start` alone draws the band and reads the folder, and the clock
   moving 30 seconds causes the next read. After a simulated reload that loses
   the timer, a `turn.complete` re-arms it.
5. **Commands.** `/foreman slots 3` makes the band say `of 3`; `slots 0`,
   `slots 2.5`, `slots x` and `slots` alone are refused with the range or the
   usage and change nothing; `pause` adds `paused` and `resume` removes it. The
   `slots` option set to 4 shows `of 4` when no command set the count.
6. **Files.** A file that becomes half-written JSON keeps its earlier row; a
   record without a state, or with an unknown state, is never listed; a file
   that leaves the folder leaves the list; a listing that fails on a folder
   that exists keeps the rows and logs the reason; a missing folder shows no
   sub sessions; `CLAUDE_CONFIG_DIR` moves the folder.
7. **Staleness.** A file three minutes and one second old is dimmed with
   `no update for 3m` and still counts as busy; one two minutes and 59 seconds
   old is not stale.
8. **When the next read comes.** It comes at 30 seconds, and not at 29, after a
   read with a working file that is not stale, and at two minutes after a read
   whose only working file is stale or that has none.
9. **Nudge and Release.** Each press adds its log line and calls nothing.
10. **Text.** A record whose key, title and reason hold escape sequences is
    drawn without them on both surfaces, and the desktop image's source is
    escaped.

The pure modules have their own tests: `recordIn` on each required and
optional field, `afterRead`, `isStale` on both sides of the boundary, the
delay, the busy count, `fitChips`, `STATE_LOOK`, and `commandOf` on every form.
