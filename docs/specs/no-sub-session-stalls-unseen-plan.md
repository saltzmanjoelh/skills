# Plan: no sub session stalls without someone being told

Date: 2026-10-22. Spec: `docs/specs/no-sub-session-stalls-unseen.md`.

## Chosen approach

The simplest plan won. It keeps the least new state and puts it where
persistence is already proven: the two role-off facts ride foreman's existing
ledger under `tickets:<session id>`, the two new wakes are branches of the
existing `decide`, and the background ceiling runs the existing idle rule.
It is also the only plan whose hook-failure detection is right against the
engine: the existing `.catch` on the `start_session` hook receives
`{ error, called }`, so it can tell a failure before the call went on from one
after it, and it sees a hook that timed out, which a flag inside the hook
cannot.

## Grafts from the runners-up

1. **Write the wait into builder's memo before the file** (most robust). In
   `writeStatus` the memo is updated only after a successful write, and only
   when the state or `stateSince` changed. A wait that begins inside a
   `working` episode changes neither, so its `since` would never be saved and
   would restart at every write. The wait is written inside the
   generation-checked memo update before the file is written.
2. **Key a task without an id by its kind and description** (most robust),
   because builder stores a missing id as `''`.
3. **Tag the idle stretch with its wait** (most extensible and most robust):
   `stretch.wait` is `null` for an idle stretch and the wait's `since` for a
   background one. A change of wait starts a fresh stretch, so a stretch that
   already woke for idleness cannot silence a later background wait, and
   background nudges do not carry into an idle stretch. A `working` record
   without the field whose stretch is a background one ends that stretch only
   on progress, never on duration, so the short turn that answers a nudge does
   not restart the count.
4. **The nudge effect names its kind** (most extensible): `about: 'background'`
   or absent. `effectIn` keeps it, so a background nudge stored in the outbox
   before a reload is still sent with the background text, and the log reason
   follows it.
5. **Split the pull request sentence out of `NOTED`** (most extensible). While
   the role is on, the check line is followed by that sentence; while it is
   off, the check line stands alone.
6. **Give a new pairing the issue key from the start's title** (both), so the
   five-minute wake names something the parent can find.
7. **Keep prompts made only of the app's notes out of the pasted-command
   check, and allow a chain of opening tags** (most robust), so a sub
   session's report cannot raise the line.
8. **Tell the person when `CronCreate` is unavailable** (most robust), in the
   wake skill.
9. **Store the refusal as the session id it was given for** (the judge's own),
   `offRefusedFor: string | null`, counted only when it matches the current
   id, so a `/clear` does not carry a refusal the new conversation never saw.
   The unwatched list keeps riding the ledger across a `/clear`, because notes
   about those sub sessions keep arriving.
10. **Word the fallback's log line by the failure's kind** (the judge's own):
    `throw`, `timeout` or `re-entry`.

## Rejected alternatives

- **A separate atom and store key for the role-off facts** (most robust and
  most extensible). It is a third piece of persisted state with its own
  restore and merge rules; the ledger already persists everything needed.
- **A flag inside the hook to detect a failure before `next`** (most robust's
  local flag, most extensible's `guardedStart`). When the hook times out the
  engine abandons it and runs `.catch`, which cannot see that flag, so a start
  that timed out would go on without a ticket and without the sentence.
- **Widening the wait's ids to every task that joins it** (most robust). It
  keeps `since` after every first-wait task has ended, against the spec.
- **Waking only when no file carries the ticket** (most robust). A file that
  names another desktop session never joins, and that case would go silent.
- **A general `stretchRule` abstraction** (most extensible). Passing `since`
  and a task into `idleRule` and tagging the stretch does the same with no
  new abstraction.
- **A fired check prompt that begins `foreman: `** (simplest). It would make a
  line the model scheduled look like one the mod wrote. The prompt names the
  wake skill's check section instead.

## Files and changes

### Builder

- `types/index.d.ts`: `BuildStatus.backgroundOnly?: { since: number; tasks:
  string[] }` (version stays 1); `StatusMemo.backgroundWait: { since: number;
  keys: string[] } | null`.
- `hooks/status.ts`:
  - `shownOrWithheld(text, max)`, factored out of `errorLineOf`, which keeps
    using it; `TASK_CHARS = 80`; `TASKS_SHOWN = 3`.
  - `taskKeyOf(task)`: the id, or the kind and description when the id is
    empty.
  - `isBackgroundOnly(f)`: not busy, no running agent, no own call, and at
    least one background task.
  - `backgroundWaitOf(f, now)`: keeps the memo's wait, unchanged, while at
    least one of its keys is in flight; otherwise begins a wait at `now` with
    the keys in flight when the session is background-only, or answers null.
  - `recordOf` adds `backgroundOnly` after `writtenAt` only when the state is
    `working`, `isBackgroundOnly(f)` holds and the memo holds a wait; tasks are
    the cleaned descriptions of the first three tasks, the wait's own tasks
    first, never a command.
  - `newMemo` sets `backgroundWait: null`; `statusMemoIn` reads it tolerantly,
    a missing or malformed value reading as null without rejecting the memo.
- `hooks/register.tsx`, `writeStatus`: work out the wait once per write with
  the write's clock; when it differs from the memo's, store it in the memo,
  inside the same generation check as today's update, before building the
  record and writing the file.
- `README.md`: the field, when the wait begins, is kept and resets.

### Foreman

- `types/index.d.ts`: `ForemanActs.stretch.wait: number | null`;
  `ForemanActs.unseenWoke: boolean`; the nudge effect's `about?:
  'background'`; `ForemanTickets.offRefusedFor: string | null` and
  `unwatched: string[]`.
- `hooks/record.ts`: `backgroundOnlyIn(raw)`, needing a finite `since` and
  keeping at most three string tasks; spread in only when present.
- `hooks/tickets.ts`: readers and defaults for the new fields (an old ledger
  reads with none refused and no unwatched ids; old acts read `unseenWoke`
  false and a stretch without `wait` as idle); `effectIn` keeps `about`;
  `unwatched` keeps only full `local_…` ids, once each, the newest 50;
  `newPairing` takes an issue key; `runsImplement(args)`; `OFF_REFUSAL`,
  `NO_TICKET_SENTENCE`.
- `hooks/commands.ts`: `pastedCommandIn(text)` and `PASTED_LINE`.
- `hooks/notes.ts`: `notesIn` also answers every turn-end id;
  `checkLine(ids, minutes)`; `FOREMAN_REPORTS` split out of `NOTED`.
- `hooks/wake.ts`: reasons `unseen` (with `joined: false | 'mismatch'`) and
  `background`, with the spec's sentences; `quotesText` true for a background
  reason with a task.
- `hooks/act.ts`:
  - `idleRule(s, since, wait, task)`, starting a fresh stretch when the
    stretch's wait differs; the background nudge and wake when `task` is
    given.
  - The `working` rule: with the field, `idleRule` over the wait; without it,
    a background stretch ends only on progress, an idle one as today.
  - In `decide`'s branch for a pairing with no owner: when the folder exists,
    the listing succeeded, the pairing is active with a `localId` and has not
    woken, wake once at `GONE_MS` after pairing, with the mismatch sentence
    when some row carries the ticket; otherwise push the due time.
- `hooks/desktop.ts`: `BACKGROUND_NUDGE_TEXT`.
- `hooks/register.tsx`:
  - `start_session` while off: `offStart`, which passes a start that does not
    run `/implement`, refuses the first one in this session (decided inside
    the ledger update), and gives every later one the sentence and records
    its id.
  - The `.catch`: when the call had not gone on (`called` false), run it on,
    add the sentence when it was not refused or an error, and log by the
    failure's kind, each in a try that cannot throw.
  - `carryOut` picks the nudge text and log reason by `about`.
  - `prompt.submit`: the check kind in `choiceFor`, and `withPasted` for a
    person's prompt while off.
  - `afterStart` passes the title's key to `newPairing`; the session-start
    test for an empty ledger also looks at the new fields.
- `skills/wake/SKILL.md`: sections for the off refusal (a second exception to
  "a refused call is final"), the two no-file sentences, the two background
  sentences, and "Checking a sub session foreman does not watch" with the
  four outcomes, one pending check per sub session, the fallback without
  `CronCreate`, and why there is no standing timer; "A note about a sub
  session" points at it.
- `README.md`: every new sentence, line, refusal and field.

### Skills

- `skills/implement/SKILL.md`: a rule under "## Rules", pointed at from
  "### 6. Verify", as the spec's point 13 words it.

## Step sequence

1. Builder: failing tests in `tests/status.test.ts`, then the pure functions;
   failing engine tests in `tests/register.test.ts`, then `writeStatus`; the
   README. Run the first gate again so foreman's types see the new field.
2. Foreman readers and sentences: failing tests in `record.test.ts`,
   `tickets.test.ts` and `wake.test.ts`, then `record.ts`, `tickets.ts` and
   `wake.ts`.
3. Foreman `decide`: failing tests in `act.test.ts` (with the existing idle
   tests green first), then `act.ts`.
4. Foreman hooks: failing tests in `commands.test.ts`, `notes.test.ts`,
   `acts.test.ts` and `turn-end.test.ts`, then `commands.ts`, `notes.ts`,
   `desktop.ts` and `register.tsx`; update the existing turn-end tests whose
   Noted expectations the spec changes.
5. The wake skill, the foreman README and the `/implement` rule.
6. All four gates in order, and the name search before every commit.

## Test plan

It follows the spec's Verification section, bullet by bullet. The tests that
matter most:

- `act.test.ts`: the incident replay, a background wait with a short own turn
  between the nudges, still wakes at three thresholds; an idle stretch that
  already woke does not silence a later background wait; the no-file wake
  fires once, with the mismatch sentence when a file carries the ticket under
  another desktop session, and never while the folder is missing.
- `acts.test.ts`: a start whose hook throws before `next`, and one that times
  out, get the sentence and a log line; a failure after the call went on adds
  nothing; two `/implement` starts at once while off give exactly one
  refusal; a refusal stored for another session id does not count.
- `register.test.ts` in builder: a `Stop` with one shell task gives the field
  with the time of the Stop, a prompt and a second `Stop` with the same task
  keep `since`, and a failed file write does not move it.
- The two checks by hand in a real parent that the spec names.
