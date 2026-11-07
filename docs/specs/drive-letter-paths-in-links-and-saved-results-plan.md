# Plan: drive-letter paths in the issue link reader and the saved-result check

Date: 2026-11-06. Spec: `docs/specs/drive-letter-paths-in-links-and-saved-results.md`.

## Chosen approach

The simplest plan won. It edits two pure functions in place, adds no file, no
dependency and no import, and tests `isSavedResult` directly with a table of
cases. Neither function keeps any state, so a restart, a resumed or cleared
session, a hot reload or two copies running at once cannot see a stale answer.

### `resolved`, in both `links.ts` files

Both files get the same bytes, and `diff` of the two prints nothing.

```ts
// Whether a path starts with a Windows drive letter, a colon and a slash of
// either kind, such as `C:\x` or `c:/x`. With a leading `/`, this is the same
// absolute rule as builder's isAbsolute in hooks/text.ts, which this module
// cannot import.
const DRIVE = /^[A-Za-z]:[\\/]/

// A path resolved against a folder: an absolute path, one that starts with `/`
// or with a drive letter, a colon and a slash, as it is, and a relative one
// joined to the folder, and in both `.`, `..` and repeated slashes folded.
// When the starting point begins with a drive letter, a `\` is a slash too,
// the drive letter is kept as written, a `..` never removes it, and the
// answer is written with `/`. Otherwise only `/` is a slash, so a `\` stays
// part of a name, as it may on macOS and Linux.
export function resolved(base: string, path: string): string {
  const start = path.startsWith('/') || DRIVE.test(path) ? path : `${base}/${path}`
  const drive = DRIVE.test(start) ? start.slice(0, 2) : ''
  const parts: string[] = []
  for (const part of start.slice(drive.length).split(drive === '' ? '/' : /[\\/]/)) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${drive}/${parts.join('/')}`
}
```

When the starting point has no drive letter, `drive` is empty and the loop is
today's loop exactly. `gitDirOf`, `mainCheckoutOf` and `readIssueLink` do not
change.

### `isSavedResult`, in `mods/foreman/hooks/desktop.ts`

```ts
// A path that begins with a drive letter, a colon and a slash of either kind.
const DRIVE_PATH = /^[A-Za-z]:[\\/]/

// A Windows path written with `/` alone and with its drive letter in lower
// case, so that two ways of writing the same path compare equal.
function windowsForm(text: string): string {
  const slashed = text.replace(/\\/g, '/')
  return /^[A-Za-z]:/.test(slashed) ? slashed.charAt(0).toLowerCase() + slashed.slice(1) : slashed
}

// Whether Windows may read a part as something other than a plain name: one
// made only of dots and spaces, such as `... `, which it may read as `..`, or
// one with a colon, such as `x.json:stream`, which names a hidden alternate
// data stream of a file.
const unsafeOnWindows = (part: string) => /^[. ]+$/.test(part) || part.includes(':')
```

`isSavedResult` then refuses a path that is neither a drive path nor a `/`
path, compares a drive path and the configuration folder in their Windows
form, and adds `!(drive && unsafeOnWindows(p))` to the test of each of the
four parts. A `/` path runs today's checks unchanged. `savedEntries` still
reads the path exactly as the notice wrote it.

## Grafts from the other plans

- From the most robust plan: the named `windowsForm` and `unsafeOnWindows`
  helpers in place of reassigned parameters and one dense chained condition,
  so the line that guards the boundary reads in words.
- From the most extensible plan: build `isSavedResult` in two steps. Behaviour
  6 comes first, and the refusal rows for dots, spaces and colons are run and
  seen to fail. Behaviour 7 comes next, and they pass. Today every drive path
  is refused, so this is the only way those rows are seen to fail before the
  change that makes them pass.
- From the most robust plan: the extra refusal rows (a climb through
  `tool-results\..\..\..\..`, a part of `. `, a part of three spaces,
  `Tool-Results` in the wrong case, a doubled backslash, and `C:x` with no
  slash), and from the most extensible plan a `D:\` path against a `C:`
  configuration folder.
- From the most robust plan: the extra cases for `resolved` (an empty folder,
  a UNC folder giving today's answer, `C:\` with `..` giving `C:/`), for
  `gitDirOf` (a `\r\n` ending, a lowercase git folder written with
  backslashes) and for `mainCheckoutOf` (an empty `commondir` giving null).
- From both other plans: a `readIssueLink` case where the main checkout is the
  working folder itself, written with a drive letter.
- From the most robust plan: the pull request names the risks that the spec
  leaves out, listed under Risks below.

## Rejected alternatives

- Importing `isAbsolute` into `links.ts`, or moving it there. `links.ts`
  imports nothing by design, so that every other module can import it, and
  foreman cannot import builder's files at all.
- A shared paths module for both mods. One mod cannot import another's files,
  so it would be one more copy to keep in step, for no gain here.
- Testing `isSavedResult` only through the full three-read path. That makes
  every case long and its failure message vague. One end-to-end case is kept
  to prove the read uses the notice's own path.
- Proving the refusal rows by deleting code and putting it back. The two-step
  build shows the same thing and leaves nothing to restore by hand.
- A test that `resolved` takes a path as it is exactly when `isAbsolute` says
  it is absolute. The property is false for a path such as `..`, which gives
  `/` against any folder, so the test would promise a guarantee that does not
  exist.

## Steps

1. Write the new `resolved`, `gitDirOf`, `mainCheckoutOf` and `readIssueLink`
   tests in both `links.test.ts` files, and see the drive-letter ones fail.
2. Change `resolved` in builder's `links.ts`, copy the file to foreman, and see
   the tests pass and `diff` print nothing.
3. Run builder's new `resolved`, `gitDirOf` and `mainCheckoutOf` from a
   scratch script on the new inputs, and add the answers it prints to
   `tests/builder-drawn.ts`.
4. Write the `isSavedResult` table test and the end-to-end case in
   `desktop.test.ts`, and see the accepted drive rows fail.
5. Add behaviour 6, see the accepted rows pass and the dot, space and colon
   refusal rows fail, then add behaviour 7 and see every row pass.
6. Run the four gates.

## Test plan

- Both `links.test.ts` files, kept the same apart from builder's existing
  `factIn` test, check `resolved` with a folder of `C:\x` and of `C:/x`, a
  path of `/x` and a relative path against both kinds of folder, `..` stopping
  at `C:/`, a backslash kept as a character in a `/` path, an absolute path of
  either kind against a folder of the other kind, a lowercase drive, `C:x`,
  `/c/x`, a UNC folder and an empty folder.
- The same files check `gitDirOf` and `mainCheckoutOf` with drive-letter
  values, and `readIssueLink` for a Windows worktree written with backslashes
  whose `.git` and `commondir` use forward slashes, with an absolute and with a
  relative git folder, with the exact list of paths read in order. They also
  check a main checkout that is the working folder itself, and one that
  differs only in the case of its drive letter.
- `tests/builder-drawn.ts` gains the new `resolved`, `gitDirOf` and
  `mainCheckoutOf` answers, so `tests/art.test.ts` holds foreman's copy to
  them without any change of its own.
- `desktop.test.ts` imports `isSavedResult` and checks a table of rows. The
  accepted rows are a backslash path against `C:\Users\me/.claude`, a drive
  letter that differs only in case, and a path with forward slashes. The
  refused rows are each of the bad names above. The rows for `/` paths with
  the same odd names are checked exactly as today, and a relative path stays
  refused. One end-to-end case shows that the file read is the notice's own
  path.
- The four gates pass.

## Risks

- On Windows, a path that starts with `/` is still checked by today's rule, so
  a part such as `..\..\x` is one name to the check but a climb to Windows.
  The spec keeps `/` paths unchanged, so this belongs with the filed
  follow-up for the containment checks.
- Windows device names such as `CON` and `NUL` are not refused.
- Builder's read cache keys a file by its exact path, so on Windows the same
  `CLAUDE.md` can be read once as `C:\work\repo/CLAUDE.md` and once as
  `C:/work/repo/CLAUDE.md`. That costs one extra read and gives no wrong
  answer.
- Nobody runs this on Windows before the merge.
