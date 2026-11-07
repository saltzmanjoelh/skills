# Drive-letter paths in the issue link reader and the saved-result check

Date: 2026-11-06.

## Goal

On Windows, the builder and foreman mods find the issue link fact in the main
checkout's `CLAUDE.local.md`, and foreman reads a saved tool result from Claude
Code's configuration folder, just as they do on macOS and Linux. Every answer
for a path that starts with `/` stays exactly as it is today.

## Users/Trigger

This is the follow-up that the spec of the earlier drive-letter change
(`docs/specs/builder-watch-accepts-drive-letter-checkout.md`) filed for two
places that test only for a leading `/`.

- `resolved` in `mods/builder/hooks/links.ts`, and its byte-for-byte copy in
  `mods/foreman/hooks/links.ts`, builds the paths that `readIssueLink` reads:
  `CLAUDE.md`, `CLAUDE.local.md`, `.git`, the worktree's `commondir`, and the
  main checkout's `CLAUDE.local.md`. On Windows the session folder looks like
  `C:\work\repo`, which today comes out as `/C:\work\repo/CLAUDE.md`, and an
  absolute `gitdir:` value such as `C:/main/.git/worktrees/wt` is joined onto
  the folder as if it were relative. Every read fails, and the issue link
  quietly comes back empty.
- `isSavedResult` in `mods/foreman/hooks/desktop.ts` decides whether foreman
  may read the file that a "result exceeds maximum allowed tokens" notice
  names. The notice is text that a tool answer could imitate, so the check
  accepts only `<config>/projects/<folder>/<folder>/tool-results/<file>`.
  Today it refuses any path that does not start with `/`, so on Windows every
  saved result is refused. That fails safe, but the feature never works there.

## Behavior

1. `resolved(base, path)` takes its starting point from `path` when `path` is
   absolute by the shared rule (it starts with `/`, or with a drive letter, a
   colon and a slash of either kind), and from `base` otherwise, joined with
   `path`.
2. When that starting point begins with a drive letter, `resolved` splits on
   both `/` and `\`, keeps the drive letter as written, folds `.`, `..` and
   repeated separators, and joins every part with `/`. So
   `resolved("C:\\work\\repo", "CLAUDE.md")` is `C:/work/repo/CLAUDE.md`, and
   `resolved("C:\\work\\wt", "..\\main\\.git")` is `C:/work/main/.git`. A `..`
   never removes the drive: `resolved("C:/a", "../../..")` is `C:/`.
3. Otherwise `resolved` behaves exactly as today: it splits on `/` alone, so a
   backslash stays part of a name, and its answer starts with `/`.
4. `gitDirOf`, `mainCheckoutOf` and `readIssueLink` change only through
   `resolved`. A Windows worktree whose `.git` file names a drive-letter or
   relative git folder, and whose `commondir` names the main git folder, finds
   the fact in the main checkout's `CLAUDE.local.md`, and the check that the
   main checkout is the working folder itself compares two answers in the same
   form.
5. Builder's and foreman's `links.ts` stay byte for byte the same.
6. `isSavedResult(path, config)`, for a `path` that begins with a drive letter,
   a colon and a slash of either kind, turns every `\` into `/` in both `path`
   and `config`, and compares the drive letter without regard to case, before
   the existing checks. The existing checks then run on the result unchanged:
   the path starts with `<config>/projects/`, the rest has exactly four parts,
   none empty, `.` or `..`, and the third is `tool-results`.
7. For a drive-letter path, `isSavedResult` also refuses any of the four parts
   that is made only of dots and spaces, such as `... ` or `.. `, which Windows
   may read as `..`, and any part that contains a colon, such as
   `x.json:stream`, which names a hidden alternate data stream of a file.
8. A path that starts with `/` is checked by `isSavedResult` exactly as today,
   with no slash change and no new refusal. Any other path is refused, as
   today.

## Edge cases

- `resolved("/work/repo", "a\\b")` stays `/work/repo/a\b`, because a backslash
  is a legal character in a macOS or Linux name.
- `resolved("C:\\work", "/x")` is `/x`, because an absolute `path` that starts
  with `/` is the starting point, and it follows the rules of behaviour 3.
- `resolved("/work", "C:/x")` is `C:/x`.
- `C:x`, a drive letter with no slash, is not absolute, so it is joined onto
  the folder like any relative path.
- A lowercase drive letter, such as `c:\x`, counts as a drive letter and is
  kept lowercase in the answer.
- When the working folder and the main checkout differ only in the case of the
  drive letter, the main-checkout comparison in `readIssueLink` sees two
  folders, so it reads the working folder's `CLAUDE.local.md` a second time.
  That file already had no fact line, so the answer is the same empty link.
- A drive-letter saved path against a configuration folder that starts with
  `/`, or the other way round, is refused.
- The drive letter's own colon lies in the configuration folder, not in the
  four parts, so behaviour 7 never refuses it.

## Non-goals

- The checks that keep a value inside the repository, `placeOf` in
  `mods/builder/hooks/register.tsx`, and `specDirOf` and the plugin source
  check in `mods/builder/hooks/review.ts`, split only on `/`, so on Windows a
  value such as `..\..\x` or `C:\x` gets past their refusal. They guard a
  different boundary, and one follow-up issue is filed for them.
- UNC paths such as `\\server\share`, and the Git Bash form `/c/x`, are not
  drive-letter paths and are treated as before.
- `resolved` does not change the case of a drive letter, and does not strip
  trailing dots or spaces from a part.
- Behaviour 7 applies only to drive-letter paths; on macOS and Linux those
  names are ordinary and stay accepted.
- Foreman's copies stay copies, because one mod cannot import from the other.
- Nobody runs this on Windows before the merge.

## Failure modes

- A drive-letter path that `resolved` builds but the engine cannot read gives
  the same empty issue link as any unreadable file, and never throws.
- A saved path that fails any check is refused with the existing "outside"
  reason, and foreman reads nothing.

## Verification

- Unit tests of `resolved` in both mods' `tests/links.test.ts`: a folder of
  `C:\x` and of `C:/x`, a path of `/x`, and a relative path, each against both
  a drive-letter folder and a `/` folder; `..` stopping at `C:/`; a backslash
  in a `/` path kept as a character; and an absolute path of either kind
  against a folder of the other kind.
- Unit tests of `gitDirOf` and `mainCheckoutOf` with drive-letter values, and a
  `readIssueLink` test in both mods that reads the main checkout's
  `CLAUDE.local.md` for a Windows worktree whose folder is written with
  backslashes and whose `.git` and `commondir` are written by git with forward
  slashes.
- `tests/builder-drawn.ts` gains the new `resolved`, `gitDirOf` and
  `mainCheckoutOf` cases, written down by running builder's functions, so
  `tests/art.test.ts` holds foreman's copy to them, and `diff` of the two
  `links.ts` files prints nothing.
- Tests of `isSavedResult` in `mods/foreman/tests/desktop.test.ts`: a saved
  path written with backslashes throughout against a configuration folder of
  `C:\Users\me/.claude` is accepted; a drive letter that differs only in case
  is accepted; `..` written with backslashes, a part of `... ` and of `.. `,
  and a part with a colon are refused on a drive-letter path; the same
  dot-and-space and colon names, and a backslash, in a path that starts with
  `/` are treated exactly as today; a relative path stays refused.
- Each test of new behaviour is seen to fail before the change and pass after
  it, and the tests that guard unchanged Unix behaviour pass on both sides.
- The four gates pass.

## Decided by the counsel

- Should this change also fix the three checks that keep a value inside the repository (placeOf in mods/builder/hooks/register.tsx, and specDirOf and the plugin source check in mods/builder/hooks/review.ts), which split only on "/" so that on Windows a value such as "..\..\x" or "C:\x" gets past their refusal, or should they go to an issue of their own? The counsel chose: Leave them out: list them as a Non-goal and file one follow-up issue for the three containment checks. 7 of 7 members voted for it.
- When resolved in links.ts is given a Windows drive-letter folder or path, such as resolved("C:\\work\\repo", "CLAUDE.md") or a gitdir value "C:/main/.git/worktrees/wt", what form should the path it gives back take? The counsel chose: Keep the drive letter as written, split on both slashes, and join every part with a forward slash, so the answer is "C:/work/repo/CLAUDE.md". 7 of 7 members voted for it.
- In resolved, should a backslash count as a path separator also when neither the folder nor the path starts with a drive letter, for example resolved("/work/repo", "a\\b") or a relative gitdir value "..\\main\\.git"? The counsel chose: Only for drive-letter paths: split on both slashes when the absolute starting point (the path if absolute, otherwise the folder) starts with a drive letter, and on "/" alone otherwise, so a Unix answer never changes. 6 of 7 members voted for it.
- How should isSavedResult in mods/foreman/hooks/desktop.ts decide that a Windows drive-letter path lies in Claude Code's saved tool results under the configuration folder, when the two can be written with different slashes, such as a config of "C:\\Users\\me/.claude" and a saved path of "C:\\Users\\me\\.claude\\projects\\p\\s\\tool-results\\x.json"? The counsel chose: When the path starts with a drive letter, turn every backslash into "/" in both the path and the config before the existing checks, and compare the drive letter without regard to case; a path starting with "/" is checked exactly as today. 7 of 7 members voted for it.
- For a drive-letter path, should isSavedResult also refuse a path part made only of dots and spaces (such as "... " or ".. "), which Windows may read as "..", and a part containing a colon (such as "x.json:stream", which names a hidden alternate data stream), or should it keep only the existing checks? The counsel chose: Refuse both for drive-letter paths: a part made only of dots and spaces, and a part with a colon, each with a test; Unix paths keep exactly today's checks. 7 of 7 members voted for it.
