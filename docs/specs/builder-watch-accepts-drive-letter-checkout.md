# The builder watch tool accepts a Windows drive-letter checkout

Date: 2026-11-06.

## Goal

On Windows, a session can give the builder mod's `watch` tool a `checkout`
argument written as `C:\Users\me\repo` or `C:/Users/me/repo`. The tool then
watches the pull request and reads that folder with git and gh. A Windows
session that gives no checkout argument also reads its base branch's facts
from its own folder, as a session on macOS or Linux does.

## Users/Trigger

A session on Windows opens its pull request in a different repository from
the one its worktree belongs to, so it calls the watch tool with `checkout`
(see `docs/specs/builder-finds-checkout-in-another-repository.md`). In the
incident behind this issue, the tool refused `C:\Users\…` and `C:/Users/…`
with "The checkout must be an absolute path", because it tested only for a
leading `/`. The session then tried the Git Bash form `/c/Users/…`. That passed
the test, but gh, a native Windows program, read it as `C:\c\Users\…` and
failed, so the tool answered "Could not read the repository of /c/Users/…; is
it a checkout?". The pull request could not be reviewed until the person made
a `C:\c` junction that pointed at `C:\`.

The same leading-`/` test sits in `baseFolderOf`, which picks the folder where
the base branch's `CLAUDE.md` is read. When the watch took its repository from
the session's folder, a Windows folder such as `C:\work\repo` failed the test,
so the base branch's facts (`Checks:`, `Merge command:`, the limits and
`Reviewer:`) counted as unread.

## Behavior

1. The builder mod has one absolute-path check, exported from one module and
   used by `status.ts`, by the watch tool and by `baseFolderOf`. A
   path is absolute when it begins with `/`, or with a drive letter, a colon
   and a slash of either kind, such as `C:\` or `C:/`. This is the rule that
   `status.ts` already applies to the configuration folder and the ticket
   file, and those uses keep working as before.
2. The watch tool's `checkout` argument is refused as not absolute only when
   the shared check says it is not absolute. The refusal's wording does not
   change.
3. An accepted checkout reaches gh and git exactly as given, with no change to
   its slashes, its case or its drive letter. That covers the `gh repo view`
   that names its repository, the folder stored on the watch, and the
   `git worktree list` that the package and review tools run from it.
4. When gh cannot name the repository of a checkout whose path has the form
   `/<one letter>/…` or is exactly `/<one letter>`, the refusal adds one
   sentence. It says that on Windows a path such as `/c/Users/me` is read as
   `C:\c\Users\me`, and that a drive path is written `C:\…` or `C:/…`. The
   path is still used as given and is never rewritten. A path of that form
   that gh can read is accepted with no extra sentence, and a refusal for any
   other path is unchanged.
5. `baseFolderOf` uses the shared check on the session's folder. When the
   watch took its repository from the session's folder, a drive-letter folder
   is used to read the base branch's `CLAUDE.md`. A relative folder is still
   refused, and a session whose watch was given a `repo` or a `checkout` reads
   from exactly the same folder as before.
6. The watch tool's own description of `checkout`, which a session reads
   before it calls the tool, and the tool's row in the builder README say that
   a Windows drive path is written `C:\…` or `C:/…`.

## Edge cases

- `C:\x`, `C:/x` and `/x` are accepted; a relative path such as `x` or
  `.\x`, and a drive letter with no slash such as `C:x`, are refused.
- A lowercase drive letter, such as `c:\x`, is accepted, as the check in
  `status.ts` already accepts it.
- `/cd/x` and `/Users/x` get no extra sentence when gh cannot read them,
  because their first part is longer than one letter.
- A real folder at `/c/x` on macOS or Linux is used as given and works.

## Non-goals

- `resolved` in `mods/builder/hooks/links.ts` and its copy in foreman, and
  `isSavedResult` in `mods/foreman/hooks/desktop.ts`, still test only for a
  leading `/`. A Windows session can reach both, so they are filed as one
  follow-up issue.
- The checks that keep a value inside the repository (`placeOf` in
  `register.tsx`, and `specDirOf` and the plugin source check in `review.ts`)
  refuse a leading `/` on purpose and are not changed.
- Foreman keeps its own copy of the absolute-path check in
  `mods/foreman/hooks/config.ts`, because one mod cannot import from the
  other. Its tests already hold it equal to builder's, and it is not changed.
- UNC paths such as `\\server\share` stay refused as not absolute.
- The tool does not translate `/c/x` into `C:/x`, on any platform.

## Failure modes

- A relative checkout is refused with the same sentence as before, and what
  was watched before stays watched.
- A checkout that gh cannot read is refused as before, with the sentence of
  behaviour 4 added only for the `/<letter>/` form.
- A Windows session folder that cannot be read still leaves the base facts
  unread, as any unreadable folder does.

## Verification

- Unit tests of the shared check: `C:\x`, `C:/x`, `c:/x`, `c:\x` and `/x`
  are absolute; `x`, `.\x`, `C:x`, `\\server\share` and an empty string are
  not.
- A watch test with `checkout: 'C:\\work\\api'` and another with
  `checkout: 'C:/work/api'` each watch the pull request, and the recorded
  commands show `gh repo view` and `git worktree list` run in that folder,
  character for character.
- A watch test with a relative checkout is refused with "The checkout must
  be an absolute path", and the pull request watched before stays watched.
- A watch test with `checkout: '/c/work/api'` that gh cannot read gets the
  refusal with the added sentence; the same path that gh can read is watched
  with no sentence; `/cd/work` and `/work/api` that gh cannot read get the
  refusal without it.
- A test with the watch taking its repository from a session folder
  `C:\work\repo` reads the base branch's `CLAUDE.md` in that folder, and
  shows its facts as read; a relative session folder still counts as unread.
- Each test of new behaviour is seen to fail before the change and pass
  after it. The tests that guard behaviour which must not change, such as the
  relative-checkout refusal and the refusals without the added sentence, pass
  on both sides, and the pull request names them.
- The four gates pass. Nobody runs this on Windows before the merge.

## Decided by the counsel

- Should this change also make the builder mod accept a Windows drive-letter session folder in baseFolderOf, the function that picks which folder the base branch's CLAUDE.md is read in, or stay limited to the watch tool's checkout argument? The counsel chose: Include it: baseFolderOf uses the shared check too, with a test. 7 of 7 members voted for it.
- How should the watch tool treat a checkout given in the Git Bash form /c/Users/x, which starts with a slash and so already passes the absolute-path check, but which a Windows process resolves to C:\c\Users\x? The counsel chose: Use /c/x as given, and when gh cannot read a path of the /<letter>/ form, add a sentence to the refusal suggesting the C:\ or C:/ form. 7 of 7 members voted for it.
- What should this change explicitly leave out of scope, beyond the watch tool's checkout argument and baseFolderOf's session folder, which both move to the shared absolute-path check? The counsel chose: List them as Non-goals, and also file one follow-up issue for links.ts resolved and foreman's desktop.ts check, which are absolute-path tests that a Windows session can reach. 6 of 7 members voted for it.
