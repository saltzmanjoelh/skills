# Plan: a failed label edit or read leaves no stale stuck

Date: 2026-11-04. Spec: `docs/specs/builder-stale-stuck-after-failed-label-edit.md`.

## Chosen approach

The simplest plan won, with four ideas grafted from the robust plan. The
stored `derived` field is replaced by a `note` that holds the label the step
gave and whether the read of the labels saw `stuck`. `settleStateLabel` saves
the note after a successful read instead of before it, clears it when the
step goes back to the recorded label, and saves no note in a finished
record. `labelActionOf` takes the note in place of the last derived label.

### Shapes, in `mods/builder/hooks/step.ts`

```ts
export type LabelNote = { label: StateLabel; sawStuck: boolean }
export type LabelRecord = { label: StateLabel; at: number; note?: LabelNote }
export function labelActionOf(derived: StateLabel | null, record: StateLabel | null, liveLabels: readonly string[], note: LabelNote | null = null): LabelAction
export function noteAfterRead(record: LabelRecord | null, derived: StateLabel, liveLabels: readonly string[]): LabelNote | null
```

- `labelActionOf`: with `stuck` among the live labels, the derived label is
  only recorded when `record === null`, or when `note?.label === derived` and
  `note.sawStuck` is false. Otherwise it is written. A missing note falls on
  the side of writing.
- `noteAfterRead`: null when there is no record, or when the record's note is
  already for `derived`, which keeps the first successful read's answer.
  Otherwise `{ label: derived, sawStuck: liveLabels.includes('stuck') }`.
- `labelRecordIn`: keeps `note` only when it is an object whose `label` is a
  state label and whose `sawStuck` is a boolean. It never reads `derived`, so
  a record written before this change reads as a record with no note.

### `settleStateLabel`, in `mods/builder/hooks/register.tsx`

1. Read the record. When the derived label equals `record.label`, store
   `{ label, at }` if the record holds a note, and return.
2. Read the live labels. When the read fails or the watch moved on, return.
3. When `noteAfterRead` gives a note, store
   `{ label: record.label, at: record.at, note }`, inside a catch, so that a
   store that refuses writes still lets the edits below run. A lost note only
   means the next job sees none and writes the label, as the spec's failure
   modes allow.
4. Call `labelActionOf` with the note as it stood before this job, then make
   the edits as today.
5. Save the finished record as `{ label: derived, at }`, with no note.

The doc comments on the key, on `settleStateLabel`, on `labelActionOf` and on
the record type, and the sentence in `mods/builder/README.md` that begins
"The record also notes the label", describe the note as a record of what a
successful read saw. The comment on `settleStateLabel` also states the risk
that remains: when the final save fails after a read that saw `stuck`, the
note still says it saw `stuck`, so a judgement `stuck` the session puts on
afterwards comes off at the next look.

## Grafts from the robust plan

- The catch around the note write, with a test where the store refuses
  state label writes. Without it, a store that keeps refusing would stop
  every job before its edit and leave the stale `stuck` on for good.
- The pure `noteAfterRead` helper and its unit test, which is the cheap way
  to cover the spec's rule that the first successful read decides.
- A parser case with both `derived` and `note`, which shows the old field is
  ignored beside the new one.
- The sentence on the remaining risk, in the doc comment.

## Rejected alternatives

- Reading the record again before the note write and the clear, and writing
  only when its label and time still match. It is not atomic, adds a store
  read and an edge case of its own, and belongs to the separate fix for the
  queue race.
- Making failing counts large, such as `editsToFail = 100`, so tests do not
  depend on how many jobs a watch queues. One watch runs one label job whose
  edit is tried twice, which the existing tests already rely on, so the
  tests keep `editsToFail = 2` with a comment saying why.
- The two options the counsel turned down in the spec: only clearing the
  old note, and dropping the note.

## Steps

1. Write the unit tests in `mods/builder/tests/step.test.ts` and the
   fake-world tests in `mods/builder/tests/register.test.ts`, and see them
   fail.
2. Change `step.ts`: the types, `noteAfterRead`, `labelActionOf`,
   `labelRecordIn`, and their comments.
3. Change `settleStateLabel` and its comments in `register.tsx`.
4. Update the existing assertions that expect a `derived` field.
5. Rewrite the README sentence.
6. Run the gates.

## Test plan

In `mods/builder/tests/register.test.ts`:

1. The issue's trace with a failed edit: a `ready-to-merge` record, `stuck` on,
   `editsToFail = 2`. After the watch the record holds the note
   `{ label: 'in-review', sawStuck: true }`. The next look edits with
   `--add-label in-review --remove-label stuck`, leaves `[in-review]`, and
   saves exactly `{ label: 'in-review', at }`. This fails on the base code.
2. The same with a failed read (`labelsAnswer = 'not a list'`, then `null`):
   no edit and no note after the watch, then the same outcome.
3. The note is cleared on a return: an `in-review` record, a request-changes
   step with failing edits gives a note for `waiting-on-author` that did not
   see `stuck`; back at the default step the record is exactly the old one
   with no edit; then the request-changes step again with `stuck` on adds
   `waiting-on-author` and removes `stuck`.
4. A store that refuses state label writes: the edit still runs and removes
   `stuck`, no record is saved, and once the refusal lifts the next look
   saves the record.
5. The existing test 'a stuck the session sets after an edit failed is kept
   while the label the step gives stays the same' expects the note
   `{ label: 'in-review', sawStuck: false }`, and then exactly
   `{ label: 'in-review', at }`. The exact record assertions in the earlier
   label tests drop `derived`.

In `mods/builder/tests/step.test.ts`:

6. `labelActionOf` with a note that saw `stuck`, one that did not, one for
   another label, none, and no `stuck` on.
7. `noteAfterRead` with no record, a note already for the label, a note for
   another label, and no note, each with and without `stuck`.
8. `labelRecordIn` with a valid note, notes of the wrong shape, an old
   `derived` field, and both fields together.

The four gates in the project's `CLAUDE.md` then run. None of them reads the
README or the spec.
