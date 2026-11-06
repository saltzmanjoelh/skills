# A test for a user CLAUDE.md read that gives no text

Written 2026-11-06. Seeded from an issue in the owner's tracker that the
counsel filed, 6 of 7, as a follow-up to the change that made the builder mod
hold the merge when the user's own CLAUDE.md exists but cannot be read (see
`docs/specs/builder-unreadable-user-claude-holds-merge.md`).

## Goal

`readUserClaude` in `mods/builder/hooks/register.tsx` counts a read of the
user's own CLAUDE.md that resolves to something other than a string, such as
the `{ base64 }` value a binary read gives, as unreadable. No test covers that
branch. If a later edit treated such a value as text, a pull request could
merge without waiting for a reviewer whom only the user's file names, and no
test would fail. Add the test that would fail.

## Users/Trigger

Whoever changes `readUserClaude` and runs the builder tests. The case itself
happens when the engine's `$.fs.read` answers the user's CLAUDE.md with a
value that is not text.

## Behavior

- The fake file system in `mods/builder/tests/register.test.ts` (`fakeFiles`)
  gains a way to make `fs.read` answer a given path with a value that is not
  a string, while `fs.exists` answers true for that path.
- `UserClaudeSetup` gains a `not-text` case, and `setUserClaude` sets it up
  with the value `{ base64: ... }` and clears it again, as it clears the
  refused read and the refused exists check, so no test's setting carries
  into the next.
- One new test, beside the test for a refused read, runs the watch with a base
  branch CLAUDE.md that names no reviewer and the user's file in the
  `not-text` case. It expects the answer to contain the step that holds the
  merge because the user's own CLAUDE.md could not be read, and not to
  contain `gh pr merge`. Expecting the step, not only the absence of a merge,
  keeps a crash in the mod from passing the test.

## Edge cases

- Every non-text value takes the same `typeof` branch, so one value is enough;
  `{ base64 }` is the realistic one.
- The cases where the base branch's CLAUDE.md has its own `Reviewer:` line
  start from the same unreadable result, and existing tests already cover
  them for a refused read.

## Non-goals

- No change to `readUserClaude` or any other product code.
- No loop over other non-text values such as `null` or a number.
- No second test for a base branch `Reviewer:` line combined with a non-text
  read.
- No change to the existing tests of the user's file, apart from the shared
  setup helpers the new case needs.

## Failure modes

The only failure is a red test. If the `typeof` check in `readUserClaude` is
removed or loosened so the object counts as text, the watch no longer names
the step that holds the merge, and the new test fails.

## Verification

- With the `typeof` check in `readUserClaude` temporarily replaced so that any
  value counts as text, the new test fails. The check is then restored.
- With the check intact, the new test passes, and every gate in the project's
  `CLAUDE.md` passes.

## Decided by the counsel

- How should the builder mod's tests cover the branch in readUserClaude (mods/builder/hooks/register.tsx) that turns a read of the user's own CLAUDE.md giving something other than text into "unreadable"? The counsel chose: One test with a { base64 } value: give fakeFiles in mods/builder/tests/register.test.ts a way to make fs.read answer a non-text value for a path, add a 'not-text' case to UserClaudeSetup, and expect the step that holds the merge, with no gh pr merge, when the base branch's CLAUDE.md names no reviewer. 7 of 7 members voted for it.
