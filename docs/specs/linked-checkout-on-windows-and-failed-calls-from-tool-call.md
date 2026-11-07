# The linked-checkout update on Windows, and failed cleanup calls from the engine

Date: 2026-11-06.

## Goal

After a merge, builder's update of the linked main checkout finds and resolves
the links to skills, agents and commands on Windows as it does on macOS and
Linux. Every answer for a path that starts with `/` stays as it is today.

Builder's status file counts failed cleanup calls, and records the last
cleanup error, from the engine's `tool.call` event instead of the classic
`PostToolUseFailure` hook, so a managed plugin that skips builder's classic
hooks no longer leaves those two fields stale.

## Users/Trigger

These are the two follow-ups that the Windows status-file change
(`docs/specs/builder-status-file-on-windows.md`) left in its Non-goals.

- `mods/builder/hooks/linked.ts` runs after builder merges a pull request. It
  finds the links in the configuration folder's `skills`, `agents` and
  `commands` folders, resolves each one to its checkout, and fast-forwards
  the main checkout of the merged repository. Today it finds that folder from
  `HOME` alone, which Windows normally leaves unset, so it always says "HOME
  is not set". It also runs `test`, `realpath` and `find`, which Windows is
  not known to have, and it splits and trims paths on `/` only.
- The status file's count of failed cleanup calls and its last cleanup error
  are fed by `classic.PostToolUseFailure`. A security plugin installed by an
  organisation's managed settings can skip the classic hooks of other
  plugins, and the fields then stay at their old values.

## Behavior

1. **The configuration folder.** The update looks for the links in the
   folder that `configDirOf` in `mods/builder/hooks/status.ts` finds:
   `CLAUDE_CONFIG_DIR` when it is set, and otherwise `HOME`, or else
   `USERPROFILE`, with `/.claude` added. This is the folder Claude Code loads
   user skills, agents and commands from.
2. **No configuration folder.** When `configDirOf` finds no folder, the
   update runs no command, reads nothing and leaves every checkout alone,
   with one sentence. When none of the three variables is set, the sentence
   says that Claude Code's configuration folder could not be found because
   `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` are all unset. When
   `CLAUDE_CONFIG_DIR` is set but is not an absolute path, the sentence says
   so and names its value. The sentences that today say "the links under
   `~/.claude`" name the configuration folder that was searched instead.
3. **Finding the links with the engine's file calls.** On every platform the
   update uses no `test`, `realpath` or `find` command. It uses the engine's
   `$.fs` calls instead, faked in its tests:
   - `$.fs.stat(folder, { resolve: true })` decides whether each of the three
     folders is itself a link, and to where, and whether it is a folder.
   - `$.fs.list(folder)` lists the folder's entries, and the ones marked
     `isLink` are the links.
   - `$.fs.stat(link, { resolve: true })` resolves each link. Its `realPath`
     is the target, and its `kind` says whether the target is a folder or a
     file, which replaces `test -d`.
   - A missing folder is skipped, as today. A link whose `stat` rejects with
     `ENOENT`, or answers with no `realPath`, is broken, as today. Any other
     rejection makes that link failed, with the error's message, as a failed
     command does today.
   - Git is still asked for each target's common folder and top folder with
     `git rev-parse --path-format=absolute --git-common-dir --show-toplevel`,
     as today.
4. **Drive-letter paths.** A path that starts with a drive letter, a colon
   and a slash (the `DRIVE` pattern already used by `resolved` in
   `mods/builder/hooks/links.ts`, imported rather than copied) is split on
   both `/` and `\`. So the parent of a target, the trimming of trailing
   separators, and every comparison of checkout paths treat `C:\a\b` and
   `C:/a/b` as the same path. Every path that starts with `/` is handled
   exactly as today.
5. **Drive-letter case.** When two checkout paths are compared, the drive
   letter is compared without regard to case, so `c:/a` and `C:/a` are the
   same checkout, and the rest of the path is compared as written, so
   `C:/a` and `C:/A` are not. The folding happens only at the comparison:
   every path is shown and passed to git as written.
6. **Failed cleanup calls from `tool.call`.** Builder's existing `tool.call`
   hook reads the call's result. When the result is an error
   (`isError: true` with its `text`), the hook counts it with
   `afterFailedCall`, as `classic.PostToolUseFailure` does today, and that
   classic handler is removed. A call refused by a permission check is not an
   error result and is not counted. A failed call of a subagent counts, as
   today. A failed call of builder's own tools counts, as today. The count
   is still raised only while a cleanup is under way.
7. **What stays on classic hooks.** The wait on background work stays on
   `classic.Stop` and `classic.SubagentStop`, because no engine event and no
   `$` call carries the list of background tasks. The permission-prompt
   state stays on `classic.PermissionRequest`, because the ask decision of
   `tool.check` comes before the permission mode settles it, so it does not
   say that a dialog opened. Behaviour 6 of
   `docs/specs/builder-status-file-on-windows.md` is updated to say that the
   failed-call count and the last cleanup error now come from `tool.call`,
   and that only the other two fields can go stale.
8. **The older specs.** `docs/specs/builder-updates-linked-checkout.md` and
   `docs/specs/merged-updates-linked-checkout.md` say where the links are
   found in terms of the configuration folder rather than `HOME`, and the
   Non-goals of `docs/specs/builder-status-file-on-windows.md` drop the two
   follow-ups this change does. Their "Decided by the counsel" lines stay as
   they were recorded.

## Edge cases

- `CLAUDE_CONFIG_DIR` set to a relative path: left alone, by behaviour 2.
- One of the three folders is itself a link to a folder elsewhere: its
  entries are listed through the link, as `find` with a trailing `/` does
  today.
- A link whose target is a file inside a checkout: git runs in the file's
  parent folder, as today.
- On macOS a temporary folder resolves through `/private`, and `realPath`
  must give the same answer git gives for the checkout, so the top folder
  compares equal to the main checkout. A faked test pins this by giving both
  the same resolved path.
- A target that is not a git repository is skipped, as today.
- A realPath with backslashes and git output with forward slashes, and an
  upper-case drive from git with a lower-case drive from realPath, compare
  equal. The faked tests use both mixtures.
- A call interrupted by the person may come back as an error result and now
  counts as a failed cleanup call. That is accepted, because it is a call
  that did not succeed during a cleanup.
- The hook's reading of the error result sits inside its existing `try`
  block, so a failure there cannot stop the fence's `finally` step.

## Non-goals

- Network paths such as `\\server\share`, Git Bash paths such as `/c/Users`,
  and junctions or other reparse points beyond what `$.fs` reports as
  `isLink`.
- Comparing the rest of a Windows path without regard to case.
- Moving the wait on background work or the permission-prompt state onto
  engine events (behaviour 7 says why).
- Checking whether a managed plugin's skip also reaches engine events. Nobody
  can test that without such a plugin, so this change moves the count to the
  engine on the reading that the skip names classic hooks only.
- Running the update on a real Windows machine. Nobody here has one; the
  faked tests stand in for it.
- foreman's copy of `configDirOf` and any other `HOME` reader outside
  `linked.ts` and its caller.

## Failure modes

- No configuration folder: one left-alone sentence naming why, no command
  run (behaviour 2).
- A `$.fs` call that rejects for a reason other than a missing path: that
  link is reported failed with the message, and the other links go on, as a
  failed command does today.
- A path form this change leaves out, such as a network path: it is compared
  as written, the checkout is not matched, and nothing is moved, which is the
  safe direction.

## Verification

- `mods/builder/tests/linked.test.ts` runs the update against a faked `$.fs`
  and a faked `process.run`, and asserts that no `test`, `realpath` or
  `find` command is ever run.
- Tests show each sentence of behaviour 2, and that `CLAUDE_CONFIG_DIR`, then
  `HOME`, then `USERPROFILE` is used, through the register-level test.
- Tests with mixed separators and mixed drive-letter case show the main
  checkout is matched and moved, and a test with `C:/a` against `C:/A` shows
  it is not.
- Tests of broken links (`ENOENT`, and no `realPath`) and of a failed `stat`
  give the same outcomes as today's tests for those cases.
- `mods/builder/tests/register.test.ts` shows that an error result of
  `tool.call` during a cleanup raises the count and sets the last error,
  that a refused call does not, that a subagent's failed call does, and that
  the classic `PostToolUseFailure` handler is gone. A test fails if an error
  result stops raising the count.
- The four gates in `CLAUDE.md` pass for builder and foreman.

## Decided by the counsel

- Where should builder's linked-checkout update look for the links to skills, agents and commands, now that it must work on Windows where HOME is normally unset? The counsel chose: The configuration folder that configDirOf in mods/builder/hooks/status.ts already finds: CLAUDE_CONFIG_DIR when it is set, otherwise HOME or else USERPROFILE with /.claude added. This is the folder Claude Code loads user skills, agents and commands from, so a person who sets CLAUDE_CONFIG_DIR also gets their links found. 6 of 7 members voted for it.
- How should builder's linked-checkout update find and resolve the links, given that its `test`, `realpath` and `find` commands are not known to exist on Windows? The counsel chose: Replace all three commands, on every platform, with the engine's file system calls: $.fs.list (which marks each entry isLink) to list the links in a folder, and $.fs.stat with resolve: true (which answers isLink, kind and realPath) to tell a link from a folder and to resolve it. One code path for every platform, tested with a faked $.fs. 6 of 7 members voted for it.
- For the second follow-up, which of builder's three status-file fields that are now fed only by classic hooks should this change move onto engine events? The counsel chose: Move only the failed-cleanup count and last cleanup error, from classic.PostToolUseFailure to the error result of builder's existing tool.call hook (isError with text), and keep the wait on background work (classic.Stop, classic.SubagentStop) and the permission-prompt state (classic.PermissionRequest) on classic hooks, with the spec recording that no engine event carries the background task list and that tool.check's ask decision does not say a dialog opened. 7 of 7 members voted for it.
- Which forms of Windows path must the linked-checkout update handle, and which does it deliberately leave out? The counsel chose: Drive-letter paths with either separator, by the rule the earlier drive-letter change set in resolved (mods/builder/hooks/links.ts): when a path starts with a drive letter, a colon and a slash, split on both / and \, keep the drive, and join with /, so parentOf, the trailing-slash trims and the comparisons of checkout paths treat C:\a\b and C:/a/b alike; every path that starts with / is handled exactly as today. Network paths (\\server\share), Git Bash paths such as /c/Users, and anything about junctions beyond what $.fs reports as isLink are left out. 7 of 7 members voted for it.
- When the linked-checkout update compares two Windows checkout paths, should the drive letter's case count? The counsel chose: Compare the drive letter without regard to case (c:/a and C:/a are the same checkout), while keeping every path as written wherever it is shown or passed to git, and comparing the rest of the path as written. 7 of 7 members voted for it.
