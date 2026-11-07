# Plan: a test for a user CLAUDE.md read that gives no text

Written 2026-11-06 for `docs/specs/builder-non-text-user-claude-read-test.md`.

## Chosen approach

The simplest-thing plan won. Only `mods/builder/tests/register.test.ts`
changes. The test kit types the answer to `fs.read` as `string | FsBytes`,
where `FsBytes` is `{ base64: string }`, so a fake handler can answer
`{ value: { base64: 'AAEC' } }` without a cast.

1. `fakeFiles` gains a `notText` map from a path to a `{ base64 }` value. Its
   `fs.read` handler answers that value for such a path, after the refused
   read check, and its `fs.exists` handler counts such a path as present. The
   map is returned with the other sets, and the comment above `fakeFiles`
   says what it holds.
2. `UserClaudeSetup` gains `{ kind: 'not-text' }`. `setUserClaude` deletes the
   user's file from `notText` together with its other unconditional deletes,
   and sets `{ base64: 'AAEC' }` for the `not-text` case.
3. One test, right after the test for a refused read, runs `reviewerStep` with
   `Checks: none` and the `not-text` case, and expects the answer to contain
   `USER_CLAUDE_UNREAD_STEP` and not to contain `gh pr merge`.

## Grafts

- From the most-robust plan, the check that the test can fail replaces the
  `typeof` line with `return { kind: 'read', text: String(text) }`. The
  object then becomes the text `[object Object]`, which names no reviewer, so
  the watch names the merge step and the test fails on a clean assertion
  rather than on a crash. The same check proves that the kit hands the object
  to the mod unchanged: if the kit turned it into a rejection, the mod's
  `catch` would give unreadable, and the test would stay green under the
  change.

## Rejected alternatives

- Casting the value with `text as string` for that check, as the
  simplest-thing plan first proposed: `reviewerFactOf` may throw on an
  object, and a crash is a less clear failure than a wrong step.
- Typing the map with the kit's exported `FsBytes`: the inline shape is the
  same and needs no new import. It stays the fallback if `tsc` refuses the
  inline shape.

## Steps

1. Edit the helpers and add the test.
2. Run the builder tests with the `typeof` check replaced as above, and see
   the new test fail. Restore `register.tsx` and confirm
   `git diff mods/builder/hooks` is empty.
3. Run every gate in the project's `CLAUDE.md`.

## Test plan

- The new test fails with the check replaced, and passes with it restored.
- Every gate passes: the load of both mods, `tsc`, `claude plugin test .` and
  `claude plugin validate .`, each in `mods/builder` and in `mods/foreman`.
