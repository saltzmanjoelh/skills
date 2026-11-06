# Plan: builder writes foreman status files on Windows

Date: 2026-11-06. Spec: `docs/specs/builder-status-file-on-windows.md`.

## Chosen approach

Three blind planners competed: the simplest thing, the most robust, and the
most extensible. A judge found that all three meet every behaviour, edge case
and verification item of the spec, and that none adds stored state. The
simplest plan won because it meets the spec with the least code. Five ideas
from the other two plans are grafted onto it.

Builder's pure rule `configDirOf` in `mods/builder/hooks/status.ts` takes a
third argument, the value of `USERPROFILE`. When `CLAUDE_CONFIG_DIR` is empty
or unset, the rule uses `HOME` when it is set and absolute, else `USERPROFILE`
when it is set and absolute, else it answers null. Both builder callers, in
`readUserClaude` and `memoFrom`, read the three variables with string
literals, because `claude plugin validate` lists only names spelled in the
source.

The pane line needs no new state. When a ticket is found and no folder can
be worked out, builder already stores a status memo that holds the ticket and
a null path, and `adoptMemo` already treats it as no ticket, so nothing is
written or sent. The pane reads the current session's memo while it draws
and shows one yellow line when the memo holds a ticket, a null path and a
session id that is safe as a file name. The band does not read it, so the
band is not subscribed to memo writes.

Foreman gets its own pure copy of the rule, because a mod cannot import
another plugin's files. Its `configFolderOf` answers null when no folder can
be worked out, and `readFolder` then reads nothing.

## Grafts

1. From the robust plan: foreman's copy of `configDirOf` goes in a new pure
   file, `mods/foreman/hooks/config.ts`. It is held to builder's answers
   through `fn: "configDirOf"` rows in `mods/foreman/tests/builder-drawn.ts`
   and an entry in the `COPIES` map of `mods/foreman/tests/art.test.ts`. That
   is the existing way foreman's copies are checked against builder, and it
   already fails when the copy and the recorded answers drift apart.
2. From the robust and extensible plans: the pane test is a pure function in
   `status.ts`, `isFolderless(memo)`, which also requires a safe session id.
   `buildPathOf` answers null for an unsafe id too, and the line must not
   blame the variables for that.
3. From the robust plan: a comment at foreman's `readFolder` explains why a
   null folder answers `{ found: [], exists: false }`. Answering
   `exists: true` would free the slot of every active pairing, and answering
   `found: null` would skip the rule that logs the five-minute line. A throw
   while reading the variables in `memoFrom` keeps meaning "try again later",
   never "no folder", because a memo once stored is not worked out again.
4. From the extensible plan: the builder and foreman READMEs and the wake
   skill's instruction for finding the status folder are updated, and the
   builder README gets a short paragraph stating behaviour 6. No gate reads
   these files, so the report says so.
5. From both runners-up: one builder test raises no classic event and still
   sees the status file rewritten each minute, which guards behaviour 6.

## Rejected alternatives

- Reading `USERPROFILE` only when `HOME` gives no folder, in case another
  plugin refuses that one variable. The engine does let a hook deny an
  environment read, but nothing shows such a plugin, and the guard costs a
  three-branch reader in each mod that repeats the rule's own tests.
- A new `folders.ts` copied byte for byte into both mods, with a
  `homeFolderOf` function and an object type for the variables. It prepares
  for the linked-checkout update and the `watch` path check, which the spec
  defers, and two identical files guarded only by mirrored tables are a
  weaker guard than the existing fixture.
- Putting foreman's copy in `subs.ts` with a hand-mirrored test table. The
  fixture pattern above already exists for this.
- A module variable set in `adoptMemo` for the pane line. It would be state
  that two copies of the module could disagree on and that a reload drops;
  the memo in engine state serves both.
- Repairing a stored null path when a memo is taken up after a reload. The
  spec makes sessions started before the change a non-goal, and the take-up
  changing only the generation is relied on elsewhere.

## Steps

1. Builder rule: change `configDirOf` to three arguments, add
   `isFolderless`, and test both in `mods/builder/tests/status.test.ts`.
2. Builder callers: pass `USERPROFILE` in `readUserClaude` and `memoFrom`,
   and update their comments.
3. Builder pane: add the `View` field, the `NO_STATUS_FILE` constant, the
   tree function placed after the stale line in both branches of `paneTree`,
   and the read in `view` for the pane only.
4. Foreman: add `hooks/config.ts`, the fixture rows and the `COPIES` entry,
   make `configFolderOf` and `statusFolderOf` answer null, return early in
   `readFolder` with the comment, and make the saved-copies config throw when
   the folder is null.
5. Documentation: the READMEs and the wake skill.
6. The four gates.

## Test plan

- Rule, both mods: the seven cases the spec lists, plus `HOME` winning over a
  different `USERPROFILE`, an empty `HOME`, a POSIX `HOME` such as
  `/c/Users/me`, trailing slashes and backslashes, and a relative
  `CLAUDE_CONFIG_DIR`. Builder tests them directly; foreman through the
  fixture rows.
- `isFolderless`: a ticket with a null path, no ticket, a ticket with a
  path, and an unsafe session id.
- Builder register tests: a ticketed first prompt with only `USERPROFILE`
  writes under `<USERPROFILE>/.claude/foreman/builds/` and keeps the ticket
  record with that path; a `Reviewer:` line in `<USERPROFILE>/.claude/CLAUDE.md`
  is read.
- Pane: with a ticket and only relative variables, nothing is written,
  nothing is sent to the parent, the yellow line shows, and the pane's text
  holds none of the variables' values; with no ticket, or with a usable
  folder, the line does not show.
- Behaviour 6: with a ticket and no classic events, the file is rewritten
  each minute.
- Foreman register tests: with only `USERPROFILE`, the band reads the sub
  sessions from `<USERPROFILE>/.claude/foreman/builds`; with neither
  variable, no folder is listed and the band shows no sub sessions.
- The four gates, with the load gate run again because a type changed shape.
