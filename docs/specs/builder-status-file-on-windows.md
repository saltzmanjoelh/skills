# Builder writes foreman status files on Windows

Date: 2026-11-06.

## Goal

A foreman sub session on Windows writes its status file, and the foreman
parent reads it, in the same `.claude` folder that Claude Code uses, so the
band and the pane show the sub session as they do on macOS and Linux.

## Users/Trigger

A person runs a foreman parent in the Claude desktop app on Windows, with
`CLAUDE_CONFIG_DIR` unset, and the parent starts `/implement` sub sessions.
In the incident behind this issue, six sub sessions each received the
`foreman-ticket:` line in their first prompt, yet none ever wrote a status
file, `~/.claude/foreman/` was never created, and foreman logged after five
minutes that each one had written no status file. The person suspected that
a built-in security plugin, which skipped two of builder's classic hooks,
was the cause, and nothing pointed at the real one.

The real cause is the home folder lookup. Builder and foreman work out the
configuration folder from `CLAUDE_CONFIG_DIR`, or else from `HOME` alone.
Windows does not normally set `HOME`; the home folder is in `USERPROFILE`.
With `HOME` unset, builder's status path is null, builder counts the ticket
as no ticket, and it writes and says nothing. Foreman, with the same lookup,
reads `/.claude/foreman/builds`, a folder at the root of the drive.

## Behavior

1. The configuration folder is `CLAUDE_CONFIG_DIR` when it is set and not
   empty, as before, and refused when it is not absolute, as before.
   Otherwise it is `.claude` under the home folder, where the home folder is
   `HOME` when it is set and absolute, else `USERPROFILE` when it is set and
   absolute, else there is none.
2. A path is absolute when it begins with `/`, or with a drive letter, a
   colon and a slash of either kind, such as `C:\` or `C:/`, as builder's
   `isAbsolute` already counts it.
3. Builder applies this rule everywhere it reads the configuration folder:
   the status file path and the user's own `CLAUDE.md`, which feeds the
   `Reviewer:` fact. Both read `USERPROFILE` as well as `HOME`.
4. Foreman's status folder, and every other use of foreman's configuration
   folder, follows the same rule. When no folder can be worked out, foreman
   reads no status folder at all, rather than `/.claude/foreman/builds`.
5. When a session's first prompt holds a foreman ticket and no configuration
   folder can be worked out, builder's pane shows one line saying that the
   foreman ticket was found but no status file can be written, and naming
   the variables it looked at: `CLAUDE_CONFIG_DIR`, `HOME` and
   `USERPROFILE`. The line names the variables, never their values.
   Nothing is written, as before, and nothing is sent to the parent.
6. Whether builder writes the status file at all depends on no classic
   hook. The ticket is taken up at session start, at a prompt and at a
   turn's start, and the file is rewritten at least once a minute by the
   clock, so a managed plugin that skips builder's classic hooks does not
   stop the file. Three of the record's fields are fed by classic hooks and
   can go stale when one is skipped: the wait on background work, which
   `classic.Stop` and `classic.SubagentStop` update; the count of failed
   cleanup calls and the last cleanup error, which `classic.PostToolUseFailure`
   updates; and the permission-prompt state, which
   `classic.PermissionRequest` updates. Nothing has to be allowed in the
   security plugin for the status file to be written.

## Edge cases

- `HOME` set and absolute, `USERPROFILE` set to another folder: `HOME` wins,
  as it does today on macOS and Linux, and builder and foreman agree.
- `HOME` relative or empty, `USERPROFILE` absolute: `USERPROFILE` is used.
- `HOME` in the POSIX form some Windows shells give, such as `/c/Users/me`:
  it counts as absolute and is used, as today. Git Bash's default `HOME` is
  the same folder as `USERPROFILE` in Windows form, so this is rare.
- Both unset, or both relative: no folder; builder shows the line in
  behaviour 5 when it holds a ticket, and foreman reads no status folder.
- A session with no ticket shows no new line, whatever the variables.
- Trailing slashes or backslashes are dropped from the home folder before
  `.claude` is added, as they are today.

## Non-goals

- The linked-checkout update after a merge (`linked.ts`) keeps finding
  `~/.claude` from `HOME` alone, and keeps saying "HOME is not set" on
  Windows. Its commands (`test`, `realpath`, `find`) and its `/`-based path
  handling are not known to work on Windows; that is a follow-up.
- Moving the classic `Stop`, `SubagentStop`, `PostToolUseFailure` and
  `PermissionRequest` handlers onto engine events, so that a managed plugin
  cannot leave those three fields stale, is a follow-up, because nobody has
  checked that an engine event carries the same data or escapes the same
  skip.
- Deleting the status file after a merge runs `rm -f`, which may be missing
  on Windows. That is not changed here.
- Paths stay joined with `/`, so a Windows path comes out with mixed slashes,
  such as `C:\Users\me/.claude/foreman/builds/<id>.json`. Windows accepts
  both, and the file is not renamed.
- The `watch` tool's refusal of drive-letter paths for its `checkout`
  argument is a separate issue.
- No message to the foreman parent is added, and foreman's five-minute line
  about a missing status file does not change.
- A session that started before this change is not picked up afterwards; it
  needs a new start.

## Failure modes

- No folder can be worked out: builder writes nothing and its pane says why,
  in the line of behaviour 5. Foreman reads nothing and, after five minutes,
  logs its existing line about a missing status file.
- A home folder that exists in the variables but not on disk: the write
  creates the folders as needed, as it does today.

## Verification

- Unit tests of the shared rule, in builder and in foreman, cover: `HOME`
  absolute; `HOME` unset with `USERPROFILE` set to `C:\Users\me`; `HOME`
  unset with `USERPROFILE` set to `C:/Users/me`; `HOME` relative with
  `USERPROFILE` absolute; both unset; both relative; `CLAUDE_CONFIG_DIR`
  set, which wins over both. Each case gives the same folder in both mods.
- A builder test with a ticketed first prompt, `HOME` unset and
  `USERPROFILE` set writes the status file under
  `<USERPROFILE>/.claude/foreman/builds/`.
- A builder test with a ticketed first prompt and no usable variable writes
  nothing and renders the pane line of behaviour 5; the same test without a
  ticket renders no such line, and a test with a ticket and a usable folder
  renders none either.
- A foreman test with `HOME` unset and `USERPROFILE` set reads
  `<USERPROFILE>/.claude/foreman/builds`, and with neither set reads no
  folder.
- The four gates pass. No one runs this on Windows before the merge; after
  the merge, the person who hit the bug reruns a foreman parent on that
  Windows computer to confirm that the status files appear.

## Decided by the counsel

- When CLAUDE_CONFIG_DIR is not set, where should builder and foreman look for the home folder that holds `.claude`? The counsel chose: HOME when it is set and absolute, else USERPROFILE when it is set and absolute, else nothing. 5 of 7 members voted for it.
- Builder's linked-checkout update after a merge (mods/builder/hooks/linked.ts, called from register.tsx line 394) still finds `~/.claude/skills`, `agents` and `commands` from HOME alone, and on Windows without HOME it says "HOME is not set" and moves nothing. Should this change also make that lookup use the same home folder rule (HOME if set and absolute, else USERPROFILE if set and absolute)? The counsel chose: No: leave the linked-checkout update as it is and file it as a follow-up about Windows support for that update. 7 of 7 members voted for it.
- When a session's first prompt holds a foreman ticket but builder can work out no configuration folder (CLAUDE_CONFIG_DIR relative, and neither HOME nor USERPROFILE set and absolute), what should builder do instead of the silent nothing it does today? The counsel chose: Show the person, in builder's pane, one line saying the ticket was found but no status file can be written, naming the variables it looked at. 7 of 7 members voted for it.
- The issue's reporter saw builder's classic.Stop and classic.PostToolUseFailure handlers skipped, because a managed security plugin in a tier above builder continues the event past builder's tier. Those handlers do not carry status writes, but skipping classic.Stop drops builder's update of the list of background work, and skipping classic.PostToolUseFailure drops its count of failed cleanup calls. What should this change do about them? The counsel chose: Nothing in code: record in the spec that status files do not depend on any classic handler, and file a follow-up to find out whether the background list and the cleanup failure count can be fed from engine events instead. 6 of 7 members voted for it. Behaviour 6 states the decision precisely: writing the file depends on no classic hook, while three of its fields are fed by classic hooks.

## Decided by the person

- After the merge, will someone rerun a foreman parent on the Windows computer to confirm the status files appear? Yes, it will be retried.
