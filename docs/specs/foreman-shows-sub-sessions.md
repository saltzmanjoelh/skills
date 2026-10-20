# Foreman shows the sub sessions from a parent session

Written 2026-10-20. Seeded from an issue in the owner's tracker, the third of
five steps in building the foreman and builder mods, and from the owner's
approved plan for those steps. The issue settled most questions; the five it
left open were put to the counsel.

## Goal

A new mod, foreman, lets one parent session see every `/implement` sub session
at a glance: a band above the prompt and a pane, both drawn from the status
files that builder writes, one per sub session. Pressing a sub session's issue
opens that session beside the parent. In this step foreman only shows and
opens; it takes no action on a sub session. The later steps make it nudge,
release, wake the parent's model and start new work.

## Users and trigger

The owner, running one parent session that starts several desktop sub
sessions and runs `/implement` in each. Foreman is installed everywhere and
does nothing until a session runs `/foreman`, which makes that session the
parent. A sub session, or any session that never ran `/foreman`, looks and
behaves exactly as it does without the mod.

## Behavior

1. **The mod.** It lives at `mods/foreman`, with the four files every mod in
   this repository has: the manifest, `hooks/hooks.json`, the hooks module and
   its state contract. Its manifest names builder under `dependencies`, so
   that its type check reads builder's contract.
2. **The status record.** Foreman reads the record that builder writes. The
   record's type belongs in builder's contract, which a change running at the
   same time adds. Until that change has merged, foreman declares the same
   type in a file of its own code, `hooks/record.ts`, and its comment says to
   replace it with an import from builder's contract. The fields are the ones
   proposed to that change: `sessionId`, `ticket`, `desktopSessionId` (once
   known), `cwd`, `issueKey`, `issueTitle`, `stage` (one of builder's nine, or
   null), `stageDone` (out of nine), `pr` (`number`, `state` and `checks`, or
   null), `state`, `reason`, `stateSince`, `writtenAt`, and `cleanup` (the
   failed calls since cleanup began and the last error line) in the in-cleanup
   state. The states are `working`, `waiting-on-builder`, `idle`,
   `needs-you`, `in-cleanup` and `done`.
3. **The role.** `/foreman` turns the role on for this session and opens the
   pane. The flag is kept in `$.state`, and in `$.store` under the session's
   id, so that a resume or a hot reload of the mod keeps it: when a session
   starts, foreman reads the store for its id and turns the role back on if
   it was on. In a session without the flag every hook passes straight
   through: the band draws whatever it would draw without foreman, no timer
   runs and no file is read.
4. **The commands.** `/foreman slots <n>` sets this parent's slot count to a
   whole number from 1 to 20, kept like the flag; without it the `slots`
   option in the manifest's `userConfig` applies, which defaults to two.
   `/foreman pause` and `/foreman resume` set and clear a paused flag, kept
   like the role flag, which in this step only changes what the band says.
   Each command answers in one sentence. A `slots` value that is not a whole
   number from 1 to 20 is refused with the range.
5. **Reading the folder.** Foreman lists the status folder,
   `$CLAUDE_CONFIG_DIR/foreman/builds/` when that variable is set and
   `$HOME/.claude/foreman/builds/` otherwise, and reads each file in it whose
   name ends in `.json`. It reads once when the role turns on, and then on a
   timer: 30 seconds after a read in which any sub session was working and
   its file was not stale, and 2 minutes after any other read. A missing
   folder reads as no sub sessions. A file that does not parse as a record is
   skipped, and the last good read of it from this session is kept in its
   place. A file that has left the folder leaves the list. Every file in the
   folder is listed; narrowing the list to this parent's tickets belongs to
   step 4.
6. **Stale files.** A file whose modification time, as the listing gives it,
   is more than three minutes before the read is stale. A stale sub session
   is drawn dimmed and uncolored, with its last state and its age, such as
   `working · no update for 5m`. The three minutes is one named constant.
7. **The band, in the parent only.** One row, starting with `foreman:`:
   - the slots busy out of the slots allowed, as `2 of 2 slots busy`, where
     every listed sub session whose state is not done counts as busy, stale
     ones included, and the word `paused` after it while paused;
   - a chip for each sub session, holding its issue key and, while it is
     working or waiting on builder, its stage, or otherwise its state in
     words;
   - when the next read is due, as `next read in 30s`.

   Only "needs you" is colored red and only idle or in cleanup is colored
   amber; every other chip is the plain text color, and a stale chip is
   dimmed instead. Pressing a chip opens that sub session. With no sub
   sessions the row says `foreman: 0 of 2 slots busy · no sub sessions ·
   next read in 2m`.
8. **The pane.** One row for each sub session, in issue-key order:
   - **The issue key and its pull request line**, such as
     `→ ABC-123 · #N open · checks passed`, drawn as one button in the accent
     color with the arrow, so it reads as pressable. Pressing it opens the
     session.
   - **Progress.** The nine-stage bar, drawn the way builder draws its own:
     an image on the desktop and other image surfaces, and filled and empty
     cells with `n of 9` on the terminal.
   - **State.** The state in words with its reason, such as
     `needs you · the counsel could not decide`, colored as the band colors
     it, and dimmed with its age when stale.
   - **Actions.** A Nudge button and a Release button. In this step each one
     only writes a line to the log saying it was pressed and that the action
     comes in a later step.

   Under the rows, the log: the last 20 lines of what foreman did, newest
   last, each with its time.
9. **Opening a session.** The desktop session id is the record's
   `desktopSessionId` when it has one. Otherwise foreman calls the desktop
   app's `list_sessions` through `$.mcp.call` and takes the session whose
   working folder is the record's `cwd`. It then calls the desktop app's
   `open_session_in` with that id and the target `split`, so the sub session
   shows beside the parent and the parent's band and pane stay on screen.
   An open that worked writes a line to the log.
10. **Text from a record.** Every string a record holds is drawn as plain
    text: control characters and escape sequences are removed and long text
    is cut, as builder does with text a model supplied. No path is built from
    a record's fields.

## Edge cases

- The folder holds a file being written at the moment of the read: it does
  not parse, so the last good read of it stands.
- A file parses but lacks a field foreman needs (an issue key, a known state,
  a session id): it counts as not parsing.
- The same session's file is renamed or the record's `sessionId` differs from
  the file name: foreman keys each row by the file name.
- A session whose record has no `cwd` and no `desktopSessionId` cannot be
  opened; the press says so.
- The folder holds many files: every one is listed; the band draws as many
  chips as fit its width and ends with `+N more`.
- The person presses a chip twice quickly: each press calls the tool once;
  the desktop app reports an already-visible session as nothing to do.

## Non-goals

- Nudging, releasing, waking the parent's model, starting sessions, adding
  the ticket to a brief, and the gone state: step 4.
- Narrowing the list to the tickets this parent started: step 4.
- The `foreman` skill and the next-issue fact: step 5.
- Any change to builder.

## Failure modes

- **The folder cannot be listed** for any reason other than not existing: the
  last good list stays, and the log says the read failed with the reason.
- **An open fails** because no session in `list_sessions` has the record's
  folder, because the desktop app's tools are not connected (as in a terminal
  session), or because `open_session_in` answers with an error or a refusal
  (the parent did not start that session, or is not on screen): the person
  sees a toast saying why, and the same line in the pane's log. Each of these causes has its own short reason; a tool error that carries no text still gives a reason. The raw text of a tool error is not repeated.
- **A command's arguments are wrong:** the command answers with the usage and
  changes nothing.

## Verification

`claude plugin test mods/foreman`, with status files given as fixtures to the
test's `$.fs` hooks and the clock mocked:

- On both the terminal and the desktop surface, the band and the pane are
  drawn from fixture files, and their text holds each sub session's issue
  key, the slot count, the state words and the next read.
- Pressing the issue in the pane, and a chip in the band, calls
  `open_session_in` with the record's desktop session id and the target
  `split`; with no desktop session id, foreman first calls `list_sessions`
  and uses the session whose folder matches.
- Each way an open can fail shows a toast and writes the same line to the log, with that cause's reason.
- A session that never ran `/foreman` draws no band of foreman's and reads no
  file; `/foreman` turns the role on, and a new load of the module with the
  same session id finds it on again.
- `/foreman slots 3` changes the band to `of 3`; `/foreman slots 0` is
  refused; `/foreman pause` adds `paused`.
- A file that does not parse keeps the last good read of it; a file that
  leaves the folder leaves the list.
- A file older than three minutes is drawn dimmed with its age and still
  counts as busy; one just under three minutes is not stale.
- The next read comes 30 seconds after a read with a working sub session and
  2 minutes after a read without one.
- Nudge and Release each add a line to the log and call nothing.
- Text in a record with escape sequences is drawn without them.

The four gates in the root `CLAUDE.md` run for `mods/foreman` as well as for
`mods/builder`. The marketplace and the root README list the new mod.

## Decided by the counsel

- Which status files should the foreman pane and band list in this step, before step 4 makes foreman start sub sessions with tickets of its own? The counsel chose: Show every file in the folder in this step; step 4 narrows the list to the tickets this parent started. 7 of 7 members voted for it.
- When the person presses a sub session's issue in the foreman band or pane, how should foreman show that session through the desktop app's open_session_in tool? The counsel chose: split: show the sub session beside the parent, so the parent's band and pane stay visible. 6 of 7 members voted for it.
- How should the foreman band and pane show a sub session whose status file has stopped updating, in this read-only step? The counsel chose: Once the file is older than three minutes, show the last state dimmed with the age beside it, uncolored. 6 of 7 members voted for it.
- Which sub sessions should count toward "slots busy" in the foreman band's "busy out of allowed" figure? The counsel chose: Every listed sub session whose state is not done, including stale ones. 7 of 7 members voted for it.
- When pressing a sub session's issue cannot open it (no desktop session id can be found, or open_session_in answers with an error or a refusal), what should the person see? The counsel chose: A toast saying why, and the same line in the pane's log. 6 of 7 members voted for it.
