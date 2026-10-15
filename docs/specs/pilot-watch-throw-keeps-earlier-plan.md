# Plan: a test that a throwing read keeps the earlier pull request watched

Date: 2026-10-12
Spec: `docs/specs/pilot-watch-throw-keeps-earlier.md`

## Chosen approach

Two planners competed, one aiming for the simplest change and one for the most
robust test, and a judge chose the simplest plan with two ideas taken from the
robust one.

One test goes into `mods/pilot/tests/register.test.ts`, straight after "a
mistyped pull request number leaves the watched one in place", because it
checks the same promise in the same way. It changes neither
`mods/pilot/hooks/register.tsx` nor the fake.

The test starts a session, sets `world.pr` to pull request 8 and
`world.otherNumber` to 8, and watches 8. It checks that this first answer names
`o/r#8`. It then sets `readsThrow`, which makes every read of 7 throw, and
watches 7. It asserts that the answer says "still watching what was watched
before". It clears `world.calls` and advances the clock ten minutes, and
asserts that a poll read `gh pr view 8 ` and that no poll read
`gh pr view 7`. Last, it runs `/pilot poll` and asserts that the state lines
name `o/r#8`.

## Grafts from the robust plan

- **A check that the watch of 8 worked, before the throw.** Without it, a
  setup that watched nothing would let the assertion that 7 is never read pass
  for the wrong reason.
- **The `/pilot poll` assertion.** The brief names it as a way to show which
  pull request is watched. It also catches a regression the poll reads miss:
  if `watch()` moved its watch stamp before the read, the polls would still
  read 8 but every look would be discarded as stale, and `/pilot poll` would
  answer that nothing is watched.

## Rejected alternatives

- **Asserting on stored keys and on the `run` value through `memoryStore` and
  `writtenState`.** Those are internal details the spec does not mention, and
  the poll reads and `/pilot poll` already prove the behaviour a user sees.
- **Placing the test after "switching pull requests drops what the session was
  told about the previous one".** The mistyped-number test is the closer
  neighbour.
- **Four mutation checks.** The spec asks for one; a second one, for the
  watch stamp, is cheap and is run because the grafted assertion exists for
  it.

## Steps

1. Add the test, with a comment saying it guards behaviour that already works
   rather than reproducing a bug.
2. Run `claude plugin test .` from `mods/pilot` and see it pass.
3. Temporarily move the write of `run` above the read in `watch()`, see the
   test fail, and revert. Then temporarily set `currentSince` before the read,
   see the `/pilot poll` assertion fail, and revert. Confirm that
   `git diff mods/pilot/hooks/register.tsx` is empty.
4. Run the four gates.

## Test plan

| Spec verification | How |
|---|---|
| The new test passes on main | Step 2 |
| It fails if the watch switched to 7 on a throw | Step 3 |
| All four gates pass | Step 4 |
