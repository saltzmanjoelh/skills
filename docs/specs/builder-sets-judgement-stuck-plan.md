# Plan: the mod is the single writer of a judgement stuck

Spec: `docs/specs/builder-sets-judgement-stuck.md`.

Three planners wrote blind plans under three priors: the simplest thing, the
most robust, and the most extensible. A judge scored them against the spec,
the real code and the owner's preferences. The most robust plan won, with
grafts from the other two.

## Chosen approach

The state label record under `state-label:<repo>#<number>` gains an optional
`judgement: { label, at }`. The label is the one the step gave when the
session judged the pull request stuck, and it is never `stuck` itself. The
note machinery goes: `noteAfterRead`, `LabelNote`, `labelNoteIn`,
`labelsToRemoveAfterEdit` and `staleNoteKeys`.

A new tool, `mcp__builder__set_stuck`, takes no input. It does three things
in order:

1. It refuses before writing anything when nothing is watched, when the
   stored snapshot is of another pull request, or when the pull request is
   merged or closed. It answers that `stuck` already follows when the step
   gives `stuck` (Over a limit), or when the step gives no label and the
   label last recorded is `stuck`.
2. It records the judgement through a new per-copy record queue,
   `inRecordQueue = oneAtATime({ passesErrors: true })`, as a read, a change
   and a write. The judgement is saved before any edit and before the tool
   enters the label queue. A refused store read or write is answered with
   `isError: true`, and nothing is edited.
3. It runs `settleStateLabel($, r)` in the existing label queue, waits for
   it, and answers from the outcome the job returns.

Every save of a state label record goes through `saveLabelRecord`, which
runs in `inRecordQueue`. It reads the stored record again, and when the
stored judgement differs from the one the job read at its start (by label or
time), it carries the stored judgement into the new record. This closes a
lost update that the spec does not name: a job that read the record before a
judgement existed would otherwise end with a save that overwrites it.

`settleStateLabel` looks at a judgement before today's early exit when the
step's label equals the recorded one:

- It takes an optional expected watch. When the watch is no longer that one,
  it returns `moved`, so the tool never reports on a pull request watched
  after its call.
- When the step is Merged, it changes nothing, even with a judgement.
- With no judgement, and the step's label null or equal to the record, it
  returns without reading the labels, as today.
- Otherwise it reads the labels and acts on `labelActionOf`.

`labelActionOf(derived, record, liveLabels, judged)` keeps its fourth
parameter position, now the judged label instead of the note:

1. When a judgement holds and the step's label is null or equals the judged
   label, it returns `keep` with `add` when `stuck` is missing and `remove`
   for every other state label. The record is not saved.
2. When the step's label is null, it returns `none`.
3. When a judgement holds and the step's label differs from it, it returns
   `write`, removing `stuck` and the others, even when the step's label
   equals the record's label.
4. With no judgement, today's plain rules apply: no record and `stuck` on
   gives `record`; the step's label equal to the record gives `none`;
   anything else gives `write`.

The read after an edit removes every state label other than the one added,
so `removeOtherStateLabels` loses its `before` parameter.

The job returns one of these outcomes, and the tool answers from it:

| Outcome | The tool answers |
|---|---|
| `stuck-on` | `stuck` is on; ask the person, and never edit a state label yourself. |
| `failed`, or `undefined` because the work threw | The judgement is recorded, the edit failed, and the mod puts `stuck` on at its next look; ask the person. |
| `ended` | The step's label changed before the edit, so the judgement ended and `stuck` is not on; call watch. |
| `moved` | The watch moved before the edit; the judgement stays recorded for that pull request. |

`ended` also covers a final save that throws after a judgement ended, so the
tool never claims `stuck` is going on when the new label was written.

`pruneStateLabels` drops a record by the newer of `record.at` and
`record.judgement.at`, because the record's own time does not move while a
judgement holds.

The tool is added to `SESSION_TOOLS`, so a subagent's call is denied, and
the deny wording says so.

## Grafts

- **From the simplest plan: Merged changes nothing.** A merged pull request
  should never have `stuck` put back on. `labelFor` already says Merged
  changes nothing, and the spec now says so in point 8.
- **From the simplest and extensible plans: the judged label as the fourth
  parameter** of `labelActionOf`, instead of the whole record, so today's
  call sites and tests change least.
- **From the extensible plan: the Merged sentence in `SKILL.md`.** The State
  labels section says the tool refuses on Merged and the session still asks
  the person.
- **Trims to the robust plan:** no `inLabelQueueFor` wrapper, a cast does;
  no read of the labels after adding `stuck`, because the same edit already
  removes the others; one short answer each for `ended` and `moved`.

## Rejected alternatives

- **Saving the judgement inside the label queue unit** (the simplest and
  extensible plans). Within one copy it avoids the lost update, but a job
  already waiting in the queue runs first without seeing the judgement, so
  the label flickers through two edits, against the spec's edge case for a
  waiting job. A hot reload while the tool waits loses the call before
  anything is saved, which gives up the point of recording first. And a
  throw before the save would be answered as "recorded" when nothing was.
- **Pure helpers `stuckJudgementOf` and `judgedRecord`** (the extensible
  plan). They are justified by future work the spec rules out (a clear tool,
  a reason text, a pane display), which is speculative generality.
- **A compare-before-save guard that skips the save** (the simplest and
  extensible plans). Skipping leaves the record on the old label, so the
  next look repeats the work. Carrying the newer judgement forward finishes
  the save and keeps the judgement.
- **A compare-and-set across copies.** The store has none. Two copies at
  once keep a window of one store round trip, in which a judgement can be
  ended early. That never leaves a `stuck` without a judgement behind it.

## State and its edge cases

Only the store record persists. The record queue holds only the order of a
promise chain in memory, which is harmless to lose. `staleNoteKeys`, which
lived only in memory, is removed.

- **A restart** keeps the record and its judgement. The first look keeps
  `stuck` or puts it back.
- **A resumed or cleared session**: the record is keyed by pull request. The
  tool refuses while nothing is watched, and the next watch's job honours
  the judgement.
- **A hot reload**: the judgement is saved before the tool waits in the
  label queue, so a cut-off call still leaves it, and the next look puts
  `stuck` on. An old copy's running job carries the new judgement forward at
  its save.
- **Two copies at once**: narrowed to one store round trip, as above.

## Step sequence, each test written first

1. `step.test.ts`: the record parser reads a valid judgement, drops a
   malformed one (`null`, a string, a label that is not a state label,
   `stuck` as the label, a missing or non-finite `at`), and ignores `note`
   and `derived`. Then change `LabelRecord` and `labelRecordIn`.
2. `step.test.ts`: `labelActionOf` with and without a judgement, as listed
   above. Delete the tests of `noteAfterRead` and `labelsToRemoveAfterEdit`,
   then implement and delete those functions.
3. `step.test.ts`: extend the test that no step text sets a label the mod
   sets. No text matches `gh pr edit` with `--add-label`, and every text that
   says to set `stuck` names `mcp__builder__set_stuck`. Then rewrite the
   step texts.
4. `register.test.ts`: rewrite or delete the note-era state label tests. A
   `stuck` that appears between the read and the edit with no judgement now
   comes off. The tests that only tested the note are deleted, and expected
   records lose their `note`. Then rewrite `settleStateLabel`,
   `removeOtherStateLabels` and the record saves, and delete `staleNoteKeys`.
5. `register.test.ts`: the tool's refusals, a subagent's denied call, and a
   refused store read and write. Then register and route the tool.
6. `register.test.ts`: the race, the answers, the lost update, the hand
   removal, the end of a judgement, Merged with a judgement, and pruning.
   Then add `inRecordQueue`, `saveLabelRecord`, the outcomes and pruning.
7. Texts: `SKILL.md` (State labels, Commits the pull request lacks, Outside
   reviewers), the README row and paragraph, the `github.ts` comment, and
   the doc comments.
8. The four gates, and the search for issue keys and pull request numbers.

## Test plan

Fake-world tests in `mods/builder/tests/register.test.ts`:

- The issue's race: the step's label changes, a job is queued, the tool is
  called before it runs, and `stuck` stays on with the judgement recorded
  under the new label.
- The lost update: a job holds on its read of the labels, the tool saves a
  judgement meanwhile, and the job's final save carries the judgement
  forward.
- The answer when the edit succeeds, and when it fails, with the next look
  putting `stuck` on.
- A `stuck` removed by hand while a judgement holds is put back.
- A change of the step's label ends the judgement, writes the new label,
  removes `stuck`, and saves a record with no judgement; also when the step
  goes back to the record's own label but not the judged one.
- Each refusal: nothing watched, a snapshot of another pull request, a
  merged and a closed pull request, and no label from the step with no
  record. Each records nothing and edits nothing.
- No label from the step with a record: the judgement is recorded under the
  recorded label and kept while the runs cannot be read.
- A step that gives `stuck` by itself, and a recorded `stuck` with no label
  from the step: no judgement is recorded.
- A refused store save and a refused store read: an error answer and no
  label edit.
- A hand-set `stuck` with no judgement is removed when the step's label
  changes, and kept after a restart with no record.
- A merged pull request with a recorded judgement: no edit.
- The watch moves between the save and the job: the answer says so, and the
  new pull request is not edited on the tool's behalf.
- Two calls in a row replace only the judgement's time.
- A record with an old time and a recent judgement is not pruned.

Unit tests in `mods/builder/tests/step.test.ts`: the parser, `labelActionOf`
and the extended step-text test.

The four gates in the project's `CLAUDE.md`. No gate reads `SKILL.md` or
`README.md`, so their reviewers check them.
