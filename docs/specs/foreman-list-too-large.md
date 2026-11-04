# Foreman reads a session list that is too large to pass back whole

Date: 2026-11-03.

## Goal

Every read foreman makes of the desktop app's sessions list failed with "the
desktop app's list of sessions could not be read". The cause was measured:
`listSessions` in `mods/foreman/hooks/desktop.ts` asks the desktop app's
`list_sessions` tool for the hundred most recently active sessions, archived
ones included. With a long history of sessions that answer is about 58,000
characters, which is over Claude Code's limit for one tool answer (25,000
tokens). Claude Code then does not pass the answer back. It saves the full
answer to a file and passes back, as one text block, a notice that begins:

```
Error: result (57,997 characters across 1,441 lines) exceeds maximum allowed tokens. Output has been saved to <path>.
```

followed by a newline and more lines of advice to the model. A mod's
`$.mcp.call` goes through the same path as a model's tool call, so foreman
gets this notice in place of the list, cannot parse it as JSON, and reports
the list unreadable on every read. The queue never begins a waiting issue,
and no freed slot is ever seen, while the parent has many sessions in its
history.

Foreman must get a readable list in this state, and must keep getting one as
the history grows.

## Users and trigger

The parent session's model, which acts on foreman's lines, and the person
whose queue foreman serves. The trigger is any person whose desktop app holds
enough sessions that the answer to a list read crosses Claude Code's limit.
Every one of foreman's three list reads is affected: the read of the sessions
list each turn, the read of the parent's linked family, and the read that
finds the session working in a sub session's folder when foreman opens it
beside the parent.

## Behavior

1. **All three reads ask for the parent's linked family only.** The desktop
   app's `list_sessions` tool takes `linked: true`, which answers only the
   session that started the parent, the sessions it or they started, and
   their own linked sessions. Every session foreman tracks is one the parent
   started, so it is in that family.
   - `listSessions` asks with `{ linked: true, limit: 100, include_archived: true }`.
   - `linkedFamily` keeps asking with `{ linked: true, limit: 100, include_archived: true }`.
   - The read that finds a session by folder, `sessionIdOf`, asks with
     `{ linked: true, limit: 100 }`, still without archived sessions, because
     an archived session is never opened.
   A family of 21 sessions answers about 13,000 characters today, well inside
   the limit.
2. **A replaced answer is read from its saved copy.** When the first text
   block of any of the three answers is Claude Code's notice, foreman reads
   the saved copy instead and treats its contents exactly as it treats an
   answer's text. This covers a linked family that grows past the limit,
   which happens at about 40 sessions. The notice is recognised only in this
   exact shape: the text begins `Error: result (`, then any text without a
   closing parenthesis, then `) exceeds maximum allowed tokens. Output has
   been saved to `, then an absolute path, then `.` and a newline. The path
   is everything between `saved to ` and that final `.` before the first
   newline. Text in any other shape, including the notice Claude Code gives
   when it could not save the file and the shortened answer it gives when it
   does not store one, reads as unreadable, as an answer that is not a list
   does today.
3. **The path must lie in Claude Code's saved tool results.** The path is
   accepted only when it is exactly
   `<config>/projects/<one folder>/<one folder>/tool-results/<one file name>`,
   where `<config>` is `CLAUDE_CONFIG_DIR` when it is set, else the home
   folder's `.claude`, without trailing slashes, as foreman's status folder
   is found today. Each of the four parts after `projects` is one non-empty
   path segment, and none of them is `.` or `..`. The notice is text a tool
   answer could imitate, so this check keeps imitated text from steering
   foreman's read at any file outside saved tool results.
4. **The saved copy is parsed strictly.** The file's whole contents must
   parse as a JSON array. Each read then picks the fields it needs from the
   entries, as it does today. A read never answers a partial or empty list
   when the copy cannot be used; it answers a reason instead. Claude Code
   saves a copy only for an answer too large to pass back, so a copy in
   which no entry has a string `sessionId`, an empty array included, cannot
   be an honest list and answers the not-a-list reason. This keeps a copy
   saved in another form, such as an array of content blocks, from reading
   as an empty, complete list that would free every slot. An answer passed
   back directly may still be an empty list.
5. **The completeness rule stays.** A list is complete only when it holds
   fewer than 100 entries, entries foreman could not read included, whether
   the entries came from the answer or from the saved copy.
6. **Four new fixed reasons.** When foreman recognises the notice but cannot
   use the saved copy, the read answers one of four fixed reasons, one for
   each step that failed: the path lies outside saved tool results, the file
   is missing, the file is over the 4 MiB that `$.fs.read` reads, or its
   contents are not a JSON array. Each is a fixed sentence in `REASONS` in
   `mods/foreman/hooks/desktop.ts`, different from every other reason. A
   reason never names the path and never repeats the notice or the file's
   contents. The four reasons are list failures wherever foreman already
   treats `listUnreadable` as one, such as `LIST_FAILURES` in
   `mods/foreman/hooks/act.ts`, so a failed read keeps a freed slot and wakes
   no one, as a failed read does today.
7. **The saved copy is left where it is.** Foreman only reads it. The folder
   and its files belong to Claude Code.
8. **The README says so.** `mods/foreman/README.md` describes the linked-family
   requests and the saved-copy read where it describes the list reads today.

## Edge cases

- The notice names a path under another session's folder, or under another
  project's folder. Foreman reads it, because nobody has yet seen which
  session folder a mod's own call is saved under.
- The notice names a path with a `..` segment, a relative path, a path under
  `<config>` but outside `projects`, or a path with more or fewer segments
  than the layout above. Foreman reports the outside-the-folder reason and
  reads nothing.
- The text is close to the notice but not exact, for example with different
  wording or without the final `.`. It reads as unreadable, never as an empty
  list.
- The saved file was removed between the answer and the read. Foreman reports
  the missing-file reason.
- The saved copy parses as a JSON object, or as nothing, or as an array in
  which no entry has a string `sessionId`. Foreman reports the not-a-list
  reason.
- The linked family holds 100 sessions or more. The list is not complete, as
  today.

## Non-goals

- Removing saved copies after reading them.
- Paging through the list, or changing the limit of 100.
- Narrowing the path check to this engine session's own folder, or matching
  the file name Claude Code gives the copy. Either can follow once someone
  observes the path a mod's own call gets.
- Following or refusing symbolic links inside the tool-results folder.
  Planting one there needs write access to the configuration folder already.
- Reading any tool answer other than the three list reads from a saved copy,
  such as the events read.
- Logging the path foreman refused.

## Failure modes

- A list read whose notice cannot be used answers one of the four new
  reasons. The person sees it where they see a list failure today, in
  foreman's log and its notice of a failed list read, and the queue waits
  for the next read.
- A desktop app that does not understand `linked: true` would answer its
  whole list or an error. The whole list still reaches foreman through the
  saved copy when it is too large, and an error reads as refused, as today.

## Verification

- Tests in `mods/foreman/tests/desktop.test.ts` check the exact arguments
  each of the three reads sends.
- A test feeds each read the notice in the exact shape Claude Code writes,
  with a path under the tool-results layout, and a file reader stand-in that
  holds a JSON array, and checks the read answers that array's sessions with
  the completeness rule applied.
- Tests show that slightly different wording, a missing final `.`, and the
  could-not-save notice each read as unreadable rather than as an empty list.
- A table of paths shows which the check accepts and which it refuses: one
  under another session's folder is accepted; one with `..`, a relative one,
  one outside `projects`, and ones with a segment too many or too few are
  refused with the outside-the-folder reason, and the file reader is never
  called for them.
- Tests show the missing-file, too-large and not-a-list reasons, and that no
  reason contains the path or the file's text. The not-a-list cases include
  a copy that is an empty array and a copy that is an array of content
  blocks.
- A test in `mods/foreman/tests/act.test.ts` shows that each new reason keeps
  a freed slot and wakes no one, as `listUnreadable` does.
- The four gates in the project's `CLAUDE.md` pass.

## Decided by the counsel

- How should foreman get a readable session list when the desktop app's answer is too large for Claude Code to pass back whole? The counsel chose: Both: ask for the linked family only, and also read the saved copy whenever any list answer comes back replaced. 6 of 7 members voted for it.
- When foreman recognises the engine's replacement text but cannot use the saved copy (the path is outside this session's tool-results folder, the file is missing or over the 4 MiB read limit, or it is not a JSON array), what should it report? The counsel chose: A new fixed reason that also names which step failed (outside the folder, missing, too large, not a list), one fixed sentence for each. 4 of 7 members voted for it.
- Should the third list read, the one that opens a sub session beside the parent by finding the session that works in its folder, also ask for the parent's linked family only? The counsel chose: Yes: sessionIdOf asks list_sessions with { linked: true, limit: 100 }, like the other two reads, and also gets the saved-copy read. 7 of 7 members voted for it.
- Each oversized list answer leaves a saved copy (about 58 KB today) in the parent session's tool-results folder. Should foreman remove the saved copy after reading it? The counsel chose: Leave it: the folder and its files are Claude Code's, foreman only reads them, and removing them is out of scope. 6 of 7 members voted for it.
- How strict should the check be on the path foreman reads the saved copy from? The counsel chose: Any session's folder: <config>/projects/<one folder>/<one folder>/tool-results/<one file name>, with no '.' or '..' segment, so a copy saved under a different session folder than foreman expects is still read. 4 of 7 members voted for it.
