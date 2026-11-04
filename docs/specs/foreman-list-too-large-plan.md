# Plan: foreman reads a session list that is too large to pass back whole

Date: 2026-11-03. Spec: `docs/specs/foreman-list-too-large.md`.

## Chosen approach

The simplest plan won the tournament, with ideas grafted from the other two.
It adds no file, no dependency and no state. Every read looks up the
configuration folder and the saved copy fresh, so a restart, a resumed or
cleared session, a hot reload and two copies running at once create no new
case.

1. **Arguments.** In `mods/foreman/hooks/desktop.ts`, `listSessions` sends
   `{ linked: true, limit: LIST_LIMIT, include_archived: true }`,
   `linkedFamily` keeps the same arguments, and `sessionIdOf` sends
   `{ linked: true, limit: LIST_LIMIT }`. The comments at `LIST_LIMIT` and
   above `listSessions` say the list is the parent's linked family.
2. **An injected reader.** Next to `DesktopCall`:
   `export type SavedCopies = { config: () => Promise<string>; read: (path: string) => Promise<string>; size: (path: string) => Promise<number> }`.
   `listSessions(call, saved)`, `linkedFamily(call, saved)` and
   `openSession(call, record, saved)` take it as a required argument, so a
   call site that forgets it fails the type check. `sendMessage` and
   `readHeader` do not change.
3. **One shared list read.** `listEntries(call, saved, args)` answers either
   `{ entries }` or `{ reason }`, and never rejects: every injected call,
   `config()` included, is caught, because the read in `register.tsx` at
   about line 380 has no `.catch`. In order: a rejected call answers
   `notConnected`; a tool error answers `listRefused`, even when its text is
   the notice; no first text block answers `listUnreadable`; text that is
   the notice goes to the saved copy; any other text is parsed as today and
   a non-array answers `listUnreadable`. The three reads keep their own
   field picking and their own `entries.length < LIST_LIMIT`.
4. **The notice.** `savedPathIn(text)` matches
   `/^Error: result \([^)]*\) exceeds maximum allowed tokens\. Output has been saved to ([^\n]*)\.\n/`.
   The greedy capture backs up to the last `.` before the first newline, so
   the path is everything between `saved to ` and that final `.`.
5. **The path check.** `isSavedResult(path, config): boolean`. The path
   must start with `/` and with `${config}/projects/`; the rest, split on
   `/`, must be exactly four parts, none empty, `.` or `..`, and the third
   exactly `tool-results`. A refused path, or a `config()` that rejects,
   answers the outside reason, and nothing is read.
6. **The saved copy.** Read first, with `saved.read(path)`. When the read
   rejects, ask `saved.size(path)`: a size over 4 MiB (4 × 1024 × 1024)
   answers the too-large reason, and a size that rejects or is not over the
   limit answers the missing reason, which also covers a refused read. The
   engine's error text is never parsed. After a read, `JSON.parse` of the
   whole text must give an array in which at least one entry has a string
   `sessionId`, or the read answers the not-a-list reason.
7. **Four reasons** in `REASONS`, fixed sentences that fit the frames
   "Could not open X: …", the list-failed notice and the stopped-checking
   line, and name no path:
   - `savedOutside`: the list was too large to pass back whole, and the
     place named for its saved copy is outside Claude Code's saved tool
     results.
   - `savedMissing`: …, and its saved copy is missing.
   - `savedTooLarge`: …, and its saved copy is over the 4 MiB foreman can
     read.
   - `savedNotList`: …, and its saved copy is not a list of sessions.
8. **register.tsx.** Split `configFolderOf($)` out of `statusFolderOf`, and
   have `statusFolderOf` build on it, so the two cannot drift. Add
   `savedCopies($)` next to `desktopCall`, built from `configFolderOf`,
   `$.fs.read` and `$.fs.stat(path).size`, and pass it at the three call
   sites.
9. **act.ts.** Add the four reasons to `LIST_FAILURES` on its existing line.
10. **README.** Describe the linked-family requests and the saved-copy read
    where the list reads are described: about line 53, the open at about
    line 141 and its failures, the paragraph near the table at about lines
    150 to 156, the list of list failures at about line 178, and the hold
    release at about line 230, which now sees only sessions in the family.

## Grafts

- From the robust and extensible plans: the leading `/` check, because a
  relative `CLAUDE_CONFIG_DIR` would otherwise let a relative path through.
- From both: one shared helper that also makes the call, so the old three
  reasons and the four new ones live in one tested place.
- From the robust plan: the rule that the helper never rejects.
- From both: one failure setting in the engine stand-in, as below.
- From the robust plan: the stand-in answers a tool error for a
  `list_sessions` call without `linked: true`, so a dropped argument fails
  loudly.
- From both: one engine test of the incident itself.
- From both: the README edits at lines 141, 178 and 230.
- From the extensible plan: extra near-miss and happy-path cases; from the
  robust plan: the lookalike prefix and the tool error whose text is the
  notice.
- From the robust plan: the guard that a copy with no readable session is
  not a list, which the spec now states.

## Rejected alternatives

- **Returning the path's parts from the check.** It serves only the
  narrowing to this session's folder, which the spec makes a non-goal.
- **A general answer-text layer with failure codes for the events read.**
  Reading the events answer from a saved copy is a non-goal.
- **Exporting a list of failure reasons for `act.ts`.** `NO_ANSWER` lives in
  `act.ts`, so it would still leave two places, and the `act.test.ts` loop
  catches a reason left out.
- **Unwrapping a copy that is one content block.** The spec asks for the
  whole contents to be an array; the no-readable-session guard covers the
  danger without a second parse path.
- **Injecting the whole stat result with its kind, and a read typed as
  answering anything.** A directory already fails the read with a small
  size, and the engine types `read` as answering a string.
- **Two failure settings in the stand-in.** They now mean the same thing.
- **Engine tests beyond the one queue test.** They cover no further line of
  the spec's Verification section.

## Steps

1. Tests first in `mods/foreman/tests/desktop.test.ts`: the arguments, the
   saved-copy happy path, the near misses, the path table, the failure
   reasons. See them fail.
2. Build `desktop.ts`: the reader type, the reasons, `savedPathIn`,
   `isSavedResult`, `listEntries`, and the three reads on top of it.
3. Tests in `mods/foreman/tests/act.test.ts`, then add the reasons to
   `LIST_FAILURES`.
4. Change the stand-in in `mods/foreman/tests/world.ts`, wire
   `register.tsx`, add the engine test in `mods/foreman/tests/queued.test.ts`,
   and fix the tests the stand-in change moves, checking each expectation
   rather than loosening it, including `unwatched.test.ts` at about line 427
   and its linked-failure tests.
5. The README.
6. The four gates.

## Test plan

Mapped to the spec's Verification section.

- **Arguments** (`desktop.test.ts`): update the expectations at about lines
  37 and 82; add a test that checks all three reads' arguments side by side.
- **Saved copy read**: the exact notice with its advice lines, a path under
  `/cfg/projects/p/s/tool-results/`, for each of the three reads: a short
  copy is complete; 100 entries, one unreadable, is not; `linkedFamily`
  answers the ids; `openSession` finds and opens the folder's session. Both
  "N characters across M lines" and "N characters", and file names ending
  `.txt` and `.json`. The reader saw one read of exactly that path and no
  size call.
- **Near misses**: other wording, no final `.`, no newline after it, a `)`
  inside the parentheses, the notice only in a second text block, the
  could-not-save notice, a shortened answer of cut JSON. Each answers
  `listUnreadable` from all three reads with no reader call. A tool error
  whose text is the notice answers `listRefused`.
- **Path table**: accepted under another session's and another project's
  folder; refused with `savedOutside` and no read or size call for `.` and
  `..` segments, a relative path, one outside `projects`, a segment too many
  or too few, a folder other than `tool-results`, an empty segment, a
  trailing slash, the lookalike prefix `/cfg-other/projects/…`, and a
  `config()` that rejects.
- **Failure reasons**: missing when read and size reject, and when the read
  rejects at exactly 4 MiB; too large at 4 MiB plus one byte; not a list for
  an object, `null`, an empty file, cut JSON, `[]`, and an array of content
  blocks. No result contains the path or the word `SECRET` planted in the
  path and the file. The existing check that every reason is different
  covers the four.
- **Freed slots** (`act.test.ts`): extend the loop at about line 301 with the
  four reasons; add a test that each keeps a freed slot and wakes no one, as
  `listUnreadable` does.
- **Engine** (`queued.test.ts`): a list answer replaced by the notice is
  read from its saved copy, so a waiting issue begins in the slot a finished
  sub session freed.
- **Gates**: the four gates in the project's `CLAUDE.md`.
