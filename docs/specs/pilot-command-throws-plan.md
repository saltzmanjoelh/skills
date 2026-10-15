# Plan: the pilot tools answer when a command throws

Date: 2026-10-12. Spec: `docs/specs/pilot-command-throws.md`.

## Chosen approach

The simplest plan won. The fix goes inside the two command helpers in
`mods/pilot/hooks/register.tsx` and nowhere else. Each helper wraps
`$.process.run` in a try/catch and returns null from the catch, so every caller
takes the null path it already has. No tool's body changes, and no new
answer text is added.

## Grafts from the most robust plan

- A third test, for a throw while the watch tool reads the gh login. The
  spec's Behavior section names that answer, the test fails before the fix,
  and the simplest plan left it untested.
- The robust plan's check of every caller goes into the pull request
  description, because reviewers will ask about it. The next poll is armed
  after a throw as well as after a null. The `finally` blocks reset
  `isDelivering` and the record of the session's own reads. The watch tool
  reads the pull request before it changes any state. The label queue now
  carries on to the next pull request instead of stopping.
- Two risks are named in the pull request. A review post that times out after
  GitHub accepted it reads as a failure, which may invite a retry, and that is
  the same ambiguity as today. A `git rev-parse HEAD` that throws now gives
  the existing "unknown commit" answer.

## Rejected alternatives

- A test that a poll whose read throws hands nothing over. The scheduler's
  own catch already gives that result, so the test passes before the fix and
  proves nothing about it.
- Catching the throw in each tool, or in `route`. That touches many places
  for one cause, and it would leave the two helpers' contracts unlike their
  comments.
- Writing `let ran` before the try. It is only a different style, and the
  `const` inside the try keeps the inferred type.

## Steps

1. Add the fake switches to `fakeGitHub` in
   `mods/pilot/tests/register.test.ts`, each described in its comment block:
   `readsThrow` makes `gh pr view 7` throw, `loginThrows` makes `gh api user`
   throw, and `fetchesThrow` makes `git fetch` throw.
2. Write the three tests, run them, and see each fail because the tool
   answers no result.
3. Change the `gh` helper and the `git` helper, and their comments.
4. Remove the try/catch in `readRuns`, because `runsOf` returns null on a bad
   line and never throws, and reword its comment.
5. Run the three new tests, then all four gates.

## Test plan

- "the watch tool answers that gh could not read the pull request when the
  read throws" asserts that the result contains "gh could not read o/r#7".
- "the watch tool answers that it could not read the gh login when the read
  throws" asserts that the result contains "Could not read the repository or
  the gh login from this folder."
- "the package tool writes no package when git fetch throws" asserts that the
  result contains "git could not fetch the base" and that no `package.md` was
  written.
- The existing test in which a runs read throws must still pass. Once the
  try/catch in `readRuns` is gone, it guards the `gh` helper's catch.
