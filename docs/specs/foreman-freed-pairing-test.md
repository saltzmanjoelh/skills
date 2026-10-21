# The no-action test checks freed pairings too

Date: 2026-10-21. Issue: a follow-up from the review of the change that made
the foreman mod act on its sub sessions (see `docs/specs/foreman-acts.md`).

## Goal

The test "a released or freed pairing gets no action" in
`mods/foreman/tests/act.test.ts` sets only `standing = 'released'`, so its
name claims a case it never checks. A later change that started nudging a
freed pairing, or waking the parent about one, would pass unnoticed. Make the
test check both standings that its name names.

## Users and trigger

Whoever changes `decide()` in `mods/foreman/hooks/act.ts` and runs the
foreman tests. Item 4 of `docs/specs/foreman-acts.md` says foreman leaves
both freed and released pairings alone, and `decide()` skips both today
through the one condition `p.standing !== 'active'`.

## Behavior

- The test keeps its name and runs the same check once for `'released'` and
  once for `'freed'`.
- Each pass builds a fresh pairing joined to the same idle status row, sets
  the standing on it, and expects `readEvery` over thirty minutes to record
  no nudge and no wake reason.
- A failure names the standing that broke, because the value compared
  carries the standing beside the result.
- The test also runs the same setup with the standing left `'active'` and
  expects at least one nudge, so that an empty result for the other two
  standings cannot come from a setup that would never act at all.

## Edge cases

- A pairing changed in place in one pass must not carry into the next, which
  is why each pass builds its own.
- A freed pairing whose row is idle does not happen in normal use, since a
  pairing becomes freed when its row is done. The idle row is chosen on
  purpose: it is the state that would draw a nudge for an active pairing, so
  it is the strongest check that the standing alone stops the action.

## Non-goals

- No change to `decide()` or any other product code.
- No check of the slot-freeing path, where a pairing whose file left the
  folder is forgotten; that path already treats freed and released alike and
  has its own tests.
- No other row states (needs-you, cleanup, done) for freed or released
  pairings.
- No other test in the file is renamed or restructured.

## Failure modes

The only failure is a red test. If `decide()` ever acts on a freed or a
released pairing, the test fails and its message names the standing. If the
setup ever stops producing a nudge for an active pairing, the control fails
instead of the test passing for the wrong reason.

## Verification

- With the guard in `decide()` temporarily narrowed to skip only released
  pairings, the test fails on the freed pass. The guard is then restored.
- With the guard intact, the test passes, and every gate in the project's
  `CLAUDE.md` passes.

## Decided by the counsel

- How should the test "a released or freed pairing gets no action" in mods/foreman/tests/act.test.ts be made honest, given that it checks only a released pairing? The counsel chose: Keep the name and run the same check for both standings: the test loops over 'released' and 'freed', sets each on a fresh pairing joined to the same idle row, and expects no nudge and no wake reason over thirty minutes. 7 of 7 members voted for it.
