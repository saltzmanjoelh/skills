# Plan: the builder watch tool accepts a Windows drive-letter checkout

Date: 2026-11-06. Spec: `docs/specs/builder-watch-accepts-drive-letter-checkout.md`.

## Chosen approach

The most-robust plan won, with grafts from the other two. It moves the one
correct rule that already exists, the private `isAbsolute` in
`mods/builder/hooks/status.ts`, into `mods/builder/hooks/text.ts` without
changing its text, and exports it from there. `status.ts` imports it in place
of its private copy. In `mods/builder/hooks/register.tsx`, `baseFolderOf` and
`serveWatch` call it in place of their `startsWith('/')` tests. When gh cannot
name the repository of a checkout of the form `/<one letter>/…` or
`/<one letter>`, `serveWatch` appends one fixed sentence to the existing
refusal. That sentence is held in a named constant next to `repoOf`. No path
is ever rewritten. The tool's description of `checkout` and the README's watch
row name the drive-letter forms.

The change adds no stored state, timer or module-level variable. A
drive-letter checkout is stored in the existing `checkout` field of the
watched run, which nothing checks when it is read back. So a restart, a
resumed or cleared session, a hot reload and two copies running at once
behave exactly as they do for a `/` checkout today.

## Why `text.ts`

`text.ts` imports nothing from the rest of the mod, so any module can import
from it without a cycle, and foreman has a `text.ts` of its own. The filed
follow-up changes `resolved` in `links.ts`, which must stay byte-identical in
builder and foreman. With the check in `text.ts`, both copies can later import
it with the same line, after foreman's `text.ts` gains it.

## Grafts

- From the most-extensible plan: the tool's description of `checkout` and the
  README row are part of the change, not optional, because the description is
  what a Windows session reads before it makes the call. The README is read by
  no gate, and the pull request says so.
- From the most-extensible plan: the drive-letter watch tests run the package
  tool only to show where `git worktree list` ran. They do not assert that the
  package succeeds, because later steps join paths with `/`, and nobody has
  checked that on Windows.
- From the simplest-thing plan: an exact `/c` case for the hint, a relative
  session folder that still leaves the base facts unread, and the tests that
  guard unchanged behaviour labelled as such in the pull request.
- From the judge: unit cases for `c:\x` and `\\server\share`; refused calls
  checked against the pull request watched before them, not only against
  nothing new being watched; and a test that the hint does not appear in the
  other refusal, "… is a checkout of X, not of Y".

## Rejected alternatives

- Exporting the check from `status.ts`, as the simplest-thing plan proposed,
  meets this spec but puts the check where foreman has no matching module, so
  the follow-up would move it again.
- A new `paths.ts` module would hold one line and would need a matching new
  file in foreman later.
- An exported `gitBashDriveSentence` in `checkout.ts` with its own unit tests,
  as the most-extensible plan proposed, adds surface for a sentence used in
  one place that the watch tests already cover.
- Translating `/c/x` into `C:/x` was rejected by the counsel, 7 of 7.
- Modelling an unreadable checkout with `world.throwsIn` fakes a gh that
  cannot start. An empty `world.reposIn` entry fakes a gh that runs and names
  nothing, which is closer to the incident.

## Steps

1. Write the tests below and see the tests of new behaviour fail.
2. Move `isAbsolute` into `text.ts`, extend the module's header comment, and
   import it in `status.ts`.
3. In `register.tsx`, import `isAbsolute` from `./text`, use it in
   `baseFolderOf` and `serveWatch`, add the hint constant and append it on the
   unreadable `/<letter>/` refusal.
4. Update the `checkout` description in the tool schema and the README's
   watch row.
5. Run the four gates.

## Test plan

- `mods/builder/tests/status.test.ts`, beside the `configDirOf` test: the
  shared check accepts `C:\x`, `C:/x`, `c:/x`, `c:\x` and `/x`, and refuses
  `x`, `.\x`, `C:x`, `\\server\share` and the empty string. It fails before
  the change because `text.ts` exports no such function.
- `mods/builder/tests/register.test.ts`, modelled on the test that builds the
  package in another repository's worktree, near the `sessionInAnotherRepository`
  helper:
  - For `C:\work\api` and for `C:/work/api`, the watch answers "Watching this
    pull request.", `gh repo view` ran in exactly that folder, and after a
    package call `git worktree list` ran only in that folder. Both fail
    before the change.
  - After a first good watch, a relative checkout (`work/api`, `.\work\api`
    and `C:work`) is refused with "The checkout must be an absolute path",
    and the package tool still uses the earlier checkout. This is a guard.
  - With `world.reposIn['/c/work/api'] = ''`, the refusal holds both "Could not
    read the repository of /c/work/api; is it a checkout?" and the new
    sentence, and the earlier watch stays. The same holds for exactly `/c`.
    Both fail before the change.
  - A readable `/c/work/api` is watched without the sentence, and unreadable
    `/cd/work` and `/work/api` get the refusal without it. These are guards.
  - A `/c/work/api` checkout of another repository than the named one gets the
    "is a checkout of" refusal without the sentence. This is a guard.
- `mods/builder/tests/register.test.ts`, modelled on the test where the base
  facts come from the session folder's base branch: a session started in
  `C:\work\repo` that watches by number alone runs
  `git show origin/main:CLAUDE.md` in that folder and reaches the merge step.
  It fails before the change. The same with `work/repo` reads no base facts
  there and gets the step with no checks. This is a guard.
- The four gates, in the order the project's `CLAUDE.md` gives.
