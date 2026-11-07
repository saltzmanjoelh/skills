# The builder mod's repository containment checks refuse Windows-shaped values

Date: 2026-11-06.

## Goal

Three checks in the builder mod keep a value that a project or a session
supplies inside the repository. After this change, all three refuse every
value that contains a backslash or that starts with a drive letter and a
colon, so that no Windows way of writing a path can climb out of the
repository past them. Every other value is checked exactly as it is today.

## Users/Trigger

The change that made the issue link reader and foreman's saved-result check
accept drive-letter paths (see
`docs/specs/drive-letter-paths-in-links-and-saved-results.md`) left these
three checks out of its scope and filed them as a follow-up of their own.
This is that follow-up.

- `placeOf` in `mods/builder/hooks/register.tsx` checks the Architecture and
  Gotchas document paths that the branch's `CLAUDE.md` names, and the paths
  that a session passes to the counsel tool.
- `specDirOf` in `mods/builder/hooks/review.ts` reads the base branch's
  `Spec directory:` fact, which decides which changed files count as
  documentation.
- `marketplaceRootsOf` in the same file reads the plugin `source` strings of a
  `marketplace.json`, which decide which changed files Claude Code may load as
  instructions.

Today each of them refuses only a value that starts with `/` or that has a
`..` part between forward slashes. On Windows a value such as `..\..\x`,
`C:\x`, `C:x` or `\\server\x` gets past that refusal. Nobody is known to run
these mods on Windows, so nothing is broken today, but the gap is in a
security boundary.

## Behavior

A value is Windows-shaped when it contains a backslash anywhere, or when it
starts with a letter from `A` to `Z` or `a` to `z` followed by a colon. One
exported function in `mods/builder/hooks/review.ts` makes that test, and all
three checks call it, so the rule is written once.

1. `specDirOf` gives the default spec directory, `docs/specs/`, for a
   Windows-shaped value, as it already does for an absolute value.
2. `marketplaceRootsOf` gives `null`, meaning that it cannot say for certain
   which folders hold plugins, when any plugin's `source` string is
   Windows-shaped, as it already does for an absolute source.
3. `placeOf` gives `outside` for a Windows-shaped path, before it touches the
   file system. So `documentPath` leaves such a document out of the review
   package, as it already does for a path that leads outside the checkout.
4. When the counsel tool refuses a call because a path is Windows-shaped, its
   message says that the path is written in a Windows form and asks for a path
   relative to the checkout written with forward slashes. A path refused for
   any other reason keeps today's message, which says that the path leads
   outside the checkout.
5. A value that is not Windows-shaped goes through exactly the checks it goes
   through today, and gets exactly today's answer.

## Edge cases

- A value with mixed slashes, such as `docs/..\..\x`, contains a backslash and
  is refused.
- A value that starts with two backslashes, such as `\\server\share\x`, or
  with one, such as `\x`, is refused.
- A backslash value that stays inside the repository, such as `docs\specs` or
  `.\mods\a`, is refused too. On macOS and Linux a backslash is an ordinary
  character in a file name, so a folder or file whose name really contains one
  is no longer accepted by these three checks.
- A drive letter in either case, such as `c:x`, is refused. So is a value such
  as `a:notes.md`, whose name on macOS merely starts with one letter and a
  colon.
- A colon later in the value, such as `docs/a:b.md`, does not make it
  Windows-shaped, and the value is checked as today.
- The Git Bash form `/c/x` already starts with `/` and stays refused.

## Non-goals

- A value written only with forward slashes that has a part made only of dots
  and spaces, such as `docs/.. /x`, which Windows may read as `..`, keeps
  today's check and passes. Refusing it would change what macOS and Linux
  accept. One follow-up issue is filed for it.
- `placeOf`'s second check, which requires the resolved real path to start
  with the checkout root followed by `/`, stays as it is. On Windows it may
  count every path as outside, which refuses too much and never too little,
  and nobody has seen what the engine's resolved path looks like there. It
  goes in the same follow-up issue.
- No check rewrites a backslash value into forward slashes.
- `isAbsolute` in `mods/builder/hooks/text.ts`, and every other path check in
  the builder and foreman mods, is not changed.
- Foreman has no copy of these three checks, so nothing in foreman changes.
- Nobody runs this on Windows before the merge.

## Failure modes

- A refused spec directory costs extra reviewer runs, because fewer changed
  files count as documentation.
- A refused marketplace source makes every changed file count as a possible
  instruction file, which also costs extra reviewer runs and never skips one.
- A refused document path is left out of the review package without a
  message, as any document path that leads outside the checkout is today.
- A refused counsel path refuses the whole counsel call with the message in
  behaviour 4, and the session can call again with forward slashes.

## Verification

- Unit tests of `specDirOf` in `mods/builder/tests/review.test.ts`: `..\specs`,
  `docs\..\..\x`, `docs/..\..\x`, `docs\specs`, `C:\specs`, `C:specs`,
  `c:/specs`, `\\server\specs` and `\specs` each give the default; and
  `design/specs/`, `./design/specs` and `docs/a:b` give what they give today.
- Unit tests of `marketplaceRootsOf` in the same file: a source of `..\a`,
  `.\mods\a`, `mods/..\..\a`, `C:\a`, `C:a`, `\\server\a` or `\a` gives
  `null`; and `./mods/a` still gives `mods/a`.
- A unit test of the Windows-shaped test itself, covering each case above in
  both directions.
- Tests in `mods/builder/tests/register.test.ts`: an Architecture document of
  `..\..\.env` and a Gotchas document of `C:\x` are named as none in the
  package, while a forward-slash document inside the checkout is still named;
  and a counsel call with a path of `..\..\.env`, `C:\x` or `\\server\x` is
  refused with the message in behaviour 4 and writes no brief, while a call
  with `../../.env` keeps today's message.
- Each test of new behaviour is seen to fail before the change and pass after
  it, and the tests of unchanged forward-slash behaviour pass on both sides.
- The four gates pass.

## Decided by the counsel

- Which values should get the stricter Windows refusals (a `..` part written with either slash, a part made only of dots and spaces, an absolute drive-letter or backslash-led value) in placeOf, specDirOf and marketplaceRootsOf? The counsel chose: A value that contains a backslash anywhere or starts with a drive letter and a colon (such as C:x or C:\x); every other value is checked exactly as today. 6 of 7 members voted for it.
- A value written only with forward slashes, with no drive letter, can still hold a part made only of dots and spaces, such as "docs/.. /x" or "a/... /x", which Windows may read as "..". Under the trigger the counsel chose, that value keeps today's check and passes. What should this change do about it? The counsel chose: Leave it: list it as a Non-goal of this change, since refusing it changes what macOS and Linux accept, and file one follow-up issue. 7 of 7 members voted for it.
- placeOf's second check requires the resolved real path to start with the checkout root followed by "/". On Windows the real path may use backslashes, so that comparison may refuse every path, including ones inside the checkout. Should this change also make that comparison accept a backslash after the root? The counsel chose: No: list it as a Non-goal, because nobody runs this on Windows, nobody knows what the engine's realPath looks like there, and refusing too much is the safe side; file it in the same follow-up as the forward-slash dot-and-space case. 6 of 7 members voted for it.
- A backslash value that does not climb out, such as a Spec directory of "docs\specs" or a marketplace plugin source of ".\mods\a", passes the new refusals. What should specDirOf and marketplaceRootsOf give back for it? The counsel chose: Refuse every value that contains a backslash, giving the default spec directory or null, since a value written with backslashes is never a path git lists. 4 of 7 members voted for it.
- The counsel decided that specDirOf and marketplaceRootsOf refuse every value that contains a backslash. Should placeOf, which checks the Architecture and Gotchas document paths in CLAUDE.md and the counsel tool's paths, also refuse every value that contains a backslash, or keep the rules decided first (on a backslash or drive-letter value, refuse a ".." part split on either slash, a part of only dots and spaces, and an absolute value)? The counsel chose: Refuse every value that contains a backslash in placeOf too, as "outside", and refuse a value that starts with a drive letter and a colon; one rule for all three checks. 4 of 7 members voted for it.
