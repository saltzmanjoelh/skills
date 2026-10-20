# A test that a throwing read keeps the earlier pull request watched

Date: 2026-10-12

## Goal

`docs/specs/pilot-command-throws.md` has an edge case that says "A throw while
the watch tool reads the pull request leaves the pull request that was watched
before still watched, as a failed read already does." The test that change
added for a throwing read, "the watch tool answers that gh could not read the
pull request when the read throws", checks only the answer text. Nothing would
notice if a later change made a throwing read drop or replace the pull request
that was watched before. This change adds a test that guards that edge case.

## Users and trigger

The people affected are sessions running `/implement` that call the watch tool
for a second pull request while GitHub is unreachable. The read of the new pull
request throws, and the session must go on watching the pull request it had.

## Behavior

A new test in `mods/pilot/tests/register.test.ts` does the following.

- It watches pull request 8 first, using the `otherNumber` switch of the fake
  `fakeGitHub` so that the fake answers for 8.
- It then sets `readsThrow`, which makes every read of pull request 7 throw,
  and calls the watch tool for 7.
- It asserts that the answer contains "still watching what was watched before".
- It asserts that pull request 8 is still the watched one, through the state
  that the mod reports or the reads that its later polls make.

The behaviour already works on main, because `watch()` in
`mods/pilot/hooks/register.tsx` reads the pull request before it changes
anything. The test is therefore expected to pass when it is first run, and its
comment says that it guards behaviour that already works rather than
reproducing a bug.

## Edge cases

- Pull request 7 must not become the watched one, even partly: a later poll
  must not read 7.

## Non-goals

- No change to `mods/pilot/hooks/register.tsx` or to the fake.
- No change to the existing throwing-read test.

## Failure modes

If the test fails on main, the edge case in `pilot-command-throws.md` is not
true, and that is a bug to report rather than a test to adjust.

## Verification

- The new test passes on main.
- The test would fail if the watch tool switched to pull request 7 when the
  read throws. This is checked by temporarily breaking `watch()` so that it
  records the target before reading, seeing the test fail, and reverting.
- All four gates in the project's `CLAUDE.md` pass.
