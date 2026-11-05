# Plan: a label that shows the outside reviewer's turn

Written 2026-11-05 for `docs/specs/builder-waiting-on-reviewer-label.md`, from
a tournament of three plans: the simplest change, the most robust and the most
extensible. The simplest plan won, with three ideas taken from the others.

## Chosen approach

The code already keeps one list of state labels, `STATE_LABELS` in
`mods/builder/hooks/github.ts`. The `StateLabel` type, `WORKFLOW_LABELS`,
the functions that remove the other state labels, and the parsing of the
stored label record all read that list. Adding `waiting-on-reviewer` to it,
between `waiting-on-author` and `ready-to-merge`, makes the five labels
exclude each other, keeps the new label out of the fingerprint so that moving
it never wakes the session, and lets a stored record that holds it survive a
restart.

Only two places need new behaviour:

- `labelFor` in `mods/builder/hooks/step.ts` returns `waiting-on-reviewer`
  for the step that requests the outside review and the step that waits on
  it. The outside feedback step stays with `waiting-on-author`, and the
  steps that wait on checks, have a head that is not a full commit sha,
  merge, or have no checks stay with `ready-to-merge`.
- `waitingOn` in `mods/builder/hooks/state.ts` widens its existing reviewer
  line, so that it returns `reviewer` when the pull request carries
  `waiting-on-reviewer` or when an outside review is requested. The line
  stays before the `ready-to-merge` line, after the checks for failed and
  running checks.

Nothing else changes in the code. `addLabel` in `register.tsx` already
creates any label it fails to add, without `--force`, and adds it again.
`settleStateLabel` already rewrites the label when the step's label differs
from the stored record, so a pull request recorded as `ready-to-merge` while
an outside reviewer holds the merge is relabelled at the next look.

## Ideas taken from the other plans

- From the robust plan: the State labels section of `skills/implement/SKILL.md`
  must list the new label, because the session's own edit that sets `stuck`
  removes only the state labels that section names. Without it, the session
  would leave `waiting-on-reviewer` beside its `stuck`.
- From the robust plan: a test that a solo project never mentions
  `waiting-on-reviewer` in any `gh` call, and a short test that a dismissed
  approval sends the label back to `waiting-on-reviewer`.
- From the robust plan, changed: a test that a failed create leaves nothing
  recorded and that the next look tries again, using the test fake's
  existing `editsToFail` and `labelMissing` rather than a new flag.
- From the extensible plan: a test with both `waiting-on-reviewer` and
  `ready-to-merge` on, expecting `reviewer`, so that the order in `waitingOn`
  is a decision a test pins down rather than an accident.

## Rejected alternatives

- **The merge interval winning when both labels are on**, from the robust
  plan. Both labels are on together only when an older copy of the mod, a
  person or a read made before an edit lands puts them there. The spec says
  a pull request carrying `waiting-on-reviewer` polls at the reviewer
  interval, and in the likeliest case, an older copy writing `ready-to-merge`
  at a reviewer step, the reviewer interval is also the true one.
- **A table from each state label to its poll interval**, from the extensible
  plan. It gives the same answers as one widened line, adds a structure for
  two real entries, and would make the poll interval depend on the order of
  `STATE_LABELS`, which exists for display. `labelFor` is already an
  exhaustive switch, so the next state label is already forced through a
  decision.
- **A new test flag for a failed label create.** `editsToFail = 2` already
  makes the add, and the add after the create, fail, which is what a failed
  create looks like from outside `addLabel`.
- **Changing `addLabel` or `settleStateLabel`.** Both already do what the spec
  asks.
- **A new kind of wait, a change to `POLL_MS`, the foreman mod or older
  specs.** None is needed, and the shared types that foreman links to stay as
  they are.

## State and its edge cases

The change adds no state. The labels live on the pull request, and the label
record lives in the store, keyed by the pull request rather than by the
session, so a restart, a resumed or cleared session and a hot reload see the
same record and derive the same label. Two copies of the same version derive
the same label, and the existing read after each edit removes any other state
label the other copy put on. An older copy that does not know the new label
can leave both labels on, and the pull request then polls at the reviewer
interval. A person who adds `waiting-on-reviewer` by hand at a merge step
slows the poll to five minutes there, but the session merges on its own
turn, so the merge does not wait on the poll.

## Step sequence

Each test is written and seen to fail before the code that passes it.

1. **Label mapping, in `mods/builder/tests/step.test.ts` and
   `outside.test.ts`.** The full mapping test gives `waiting-on-reviewer`
   for the request and waiting steps. The test that no step text names a
   label the mod sets includes the new label. The mapping test in
   `outside.test.ts` is renamed to say that requesting and waiting on the
   review give `waiting-on-reviewer`, and a dismissed approval, which brings
   back the request step, gives it again.
2. **The set of state labels, in `github.test.ts` and `step.test.ts`.** The
   new label is in `STATE_LABELS` and `WORKFLOW_LABELS`, a change to it alone
   leaves the fingerprint unchanged, and `otherStateLabelsOf` removes the
   other four when it is set and removes it when any other is set.
3. **The poll interval, in `state.test.ts` or `outside.test.ts`.** A pull
   request at the request step carrying `waiting-on-reviewer` waits on
   `reviewer` and polls at `POLL_MS.reviewer`. `ready-to-merge` alone still
   gives `merge`. Both labels on give `reviewer`. A failed check with the new
   label on still gives `fix`.
4. **The mod end to end, in `register.test.ts`.**
   - With `labelMissing` at a request step, `gh label create
     waiting-on-reviewer --repo o/r` runs, the add runs again after it, and
     the record holds `waiting-on-reviewer`.
   - A pull request carrying `ready-to-merge`, recorded as `ready-to-merge`,
     with an outside review requested, gets exactly one edit that adds
     `waiting-on-reviewer` and removes `ready-to-merge`, and no other action.
   - With `labelMissing` and `editsToFail = 2`, nothing is recorded, the step
     is unchanged, and the next look tries again.
   - A solo project's `gh` calls never mention `waiting-on-reviewer`.
5. **The pane, in `pane.test.ts`.** A pull request carrying the new label
   reads "waiting on the reviewer".
6. **The code.** Add the label to `STATE_LABELS`. Split the cases in
   `labelFor` and rewrite the comment above it, which says that
   `ready-to-merge` is what moves the poll to the merge interval. Widen the
   reviewer line in `waitingOn` and update its comment.
7. **The documents.**
   - `skills/implement/SKILL.md`: the State labels section lists five labels
     and says which steps give the new one; the Outside reviewers section
     says the request and waiting steps give `waiting-on-reviewer`, and that
     after an outside review is answered the label goes back to
     `waiting-on-reviewer`, and to `ready-to-merge` only once every outside
     reviewer approves.
   - `mods/builder/README.md`: the sentence that names the labels that never
     wake the session, the two step bullets for the outside review, the
     label paragraph, and the section on how often the mod looks, which
     gains the new label under the five-minute reviewer interval, including
     at the request step, and narrows `ready-to-merge` to the steps where
     nobody holds the merge.
8. **The gates**, in the order the project's `CLAUDE.md` gives. No gate reads
   `skills/` or the README, so the report says so.

## Test plan, against the spec's Verification section

| Verification item | Tests |
|---|---|
| The label mapping | Steps 1 |
| The new label is a state label | Step 2 |
| The poll interval | Steps 3 and 5 |
| Creating the missing label | Step 4, first and third tests |
| Relabelling an old `ready-to-merge` | Step 4, second test |
| The documents | Read by the reviewers |
