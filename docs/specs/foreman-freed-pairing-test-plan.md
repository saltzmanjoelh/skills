# Plan: the no-action test checks freed pairings too

Date: 2026-10-21. Spec: `docs/specs/foreman-freed-pairing-test.md`.

## Chosen approach

The most-robust plan won, with one idea grafted from the simplest plan. The
test "a released or freed pairing gets no action" in
`mods/foreman/tests/act.test.ts` keeps its name, and its body becomes:

```ts
test('a released or freed pairing gets no action', () => {
  // Each run builds its own pairing, joined to the same idle row that draws a
  // nudge for an active pairing, so that only the standing differs.
  const run = (standing: ForemanStanding) => {
    const t = joinOwners(paired(), [row()]).tickets
    t.pairings[0]!.standing = standing
    return { standing, seen: readEvery(t, () => [row()], T0 + 30 * MINUTE) }
  }
  // The same setup with the pairing active is nudged, so an empty result
  // below cannot come from a setup that would never act at all.
  const active = run('active')
  expect({ standing: active.standing, nudged: active.seen.some(s => s.nudges > 0) }).toEqual({ standing: 'active', nudged: true })
  expect((['released', 'freed'] as const).map(run)).toEqual([
    { standing: 'released', seen: [] },
    { standing: 'freed', seen: [] },
  ])
})
```

`ForemanStanding` joins the existing type import from `../types`.

## Grafts

- From the simplest plan: set the standing in place on the freshly joined
  pairing, as the original test does, rather than copying the ledger with a
  spread. Every run builds its own pairing, so the copy guarded against
  nothing.

## Rejected alternatives

- The simplest plan's loop with one `expect` per standing stops at the first
  failure, so a broken released case would hide a broken freed case. Its
  control failed with "expected 0 to be greater than 0", which names no
  standing, and it ran after the cases it protects.
- Its hand-written union `'active' | 'released' | 'freed'` would drift from
  `ForemanStanding` if a standing were added.
- `test.each` and a message argument to `expect` were not used, because
  nothing in the repository shows that `claude-code/testing` offers them.
  The standing travels inside the compared value instead, as builder's tests
  already do with their tuples.

## Steps

1. Change the import and the test body as above.
2. Narrow the guard at the `p.standing !== 'active'` condition in `decide()`
   to `p.standing === 'released'`, run `claude plugin test .` in
   `mods/foreman`, and see the freed entry fail. Then narrow it to
   `p.standing === 'freed'` and see the released entry fail, and make it
   skip every pairing and see the control fail. Restore the file with
   `git checkout -- mods/foreman/hooks/act.ts` and confirm it is clean.
   Nothing from this step is committed.
3. Run every gate in the project's `CLAUDE.md`.

## Test plan

| Spec verification | How it is shown |
|---|---|
| The test fails on the freed pass with the guard narrowed to released | Step 2, first narrowing |
| The test passes with the guard intact, and every gate passes | Step 3 |
