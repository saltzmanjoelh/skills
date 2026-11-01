# Plan: foreman shows its reports and checks unwatched sub sessions itself

Written 2026-10-31 for `docs/specs/foreman-reports-and-checks-itself.md`.
Three planners worked blind to each other from three priors: the smallest
change, the most robust, and the easiest to extend. A judge scored them
against the spec and the owner's preferences.

## Chosen approach

The most robust plan won. It is the only one in which neither a still-waits
wake sent while foreman's role is off nor a hot reload in the middle of a
check loses or misroutes anything. Both other plans woke the parent directly
from the check, outside the outbox, and both left `turnRuns` kept only while
the role is on, so a wake sent while off could append to a turn that is not
running.

### Reports

- `wake.ts` gets a `REPORT_KINDS` set (opened, verdicts, merged, closed,
  began). `decideNow` splits `decision.reasons` with it: the wake line is
  built from the other reasons only, and the report sentences go into a new
  outbox field, `reports: string[]`, in the same ledger update.
- The began sentence drops "; tell the person so in one line". `beginOne`
  returns it as a report sentence, and `withSentences` is deleted.
- `carryOut` collects `work.reports` and the began sentences of that run and
  hands them to one `showReports($, sentences)` call: one notification
  titled "foreman" holding them joined, one log line per sentence, and the
  `report` atom set to the newest sentence and the time now. `notify` gains a
  `quiet` option so that a notification whose sentences are already logged
  writes a log line only when raising it fails.
- The `report` atom lives in `$.state` only, so it survives a hot reload and
  is lost on a restart, as the spec allows.

### The band

- `View` gains `report`, set only while the report is under ten minutes old
  (`REPORT_SHOWN_MS`).
- `bandTree` keeps its single row. It fits the chips exactly as today, then
  adds the separator and the report cut with `printable` to the columns left
  over, and drops the report when fewer than about sixteen columns are left.
  The chips never give up width to it.

### Checks of sub sessions foreman holds no record of

- A new pure module, `hooks/checks.ts`, holds the record type's logic:
  - `checksIn` reads the ledger's `checks` tolerantly: whole `local_…` ids
    only, finite times, one record per id (the last), the newest fifty. A
    due time later than now plus the idle minutes is clamped to that.
  - `withNote(checks, id, now, idleMs)` applies spec point 7. A record that
    is not nudged takes the note's time and a new due time. A nudged record
    that has not had its answer marks it answered and moves the due time,
    keeping the nudge. A nudged and answered record clears the nudge and
    takes the new times.
  - `withoutPaired(checks, pairings)` drops any record whose id a pairing
    holds.
  - `headerOf(text)` reads only the first line of the answer and returns
    `{ state, archived }` or null.
  - `checkOutcome(record, look)` answers one of `drop-archived`,
    `drop-failed(reason)`, `later`, `nudge` or `wake`.
  - `soonestDue(checks)`.
- A record is `{ id, notedAt, dueAt, nudged: boolean, answered: boolean }`.
- `desktop.ts` gains `EVENTS_TOOL = 'list_events'` and `readHeader(call, id)`,
  which calls it with `{ session_id: id, limit: 1 }` through `answerOf` and
  answers the first line of the first text block, or a fixed reason:
  `notConnected`, a new `eventsRefused`, or a new `eventsUnreadable`.
- `runDueChecks($)` is the one function that checks:
  1. In one `writeTickets` update it drops paired records and claims every
     due record by moving its due time to now plus the idle minutes, keeping
     each claimed record's `notedAt` and `dueAt` as its claim.
  2. Outside the update, it reads each claimed record's header under
     `within`, and for a nudge outcome first writes the nudged mark,
     guarded by the claim, then sends `NUDGE_TEXT`.
  3. Each outcome is written in a second update, only when the record still
     carries the claimed `notedAt` and `dueAt`. A note that arrived during
     the call changes them, so the stale outcome is thrown away. The wake,
     the failure notification and the archived log line go into the outbox
     in that same update, so a reload cannot lose them and two callers
     cannot carry them out twice. All failures of one pass go into one
     notification effect naming each id and its reason, with one log line
     each.
- The still-waits sentence is a new Reason kind, `{ kind: 'still-waits'; id }`,
  worded "the sub session <id>, which foreman holds no record of, still
  waits after foreman's nudge.", so it goes through `wakeLine` like every
  other wake.
- Scheduling: while the role is on, `readAndSchedule` takes `soonestDue` into
  account when it picks the next read time and runs `runDueChecks` through
  `later` after `carryOut`. While the role is off, `ensureChecks($)` arms a
  module timer at the soonest due time, or cancels it when no record is left,
  and also replays leftover outbox work, which `ensureArmed` skips while off.
  `ensureChecks` reads the role each time it runs, cancels the timer while
  the role is on, and is called from `session.start`, `prompt.submit`,
  `turn.complete`, `becomeParent` and the end of `runDueChecks`, which is
  how a hot reload re-arms it.
- `turn.start` and `turn.complete` keep `turnRuns` whatever the role, so a
  wake sent while off appends or submits correctly.
- `session.start`'s emptiness check also tests `checks` and `outbox.reports`,
  so a hot reload of a ledger that holds only check records keeps the newer
  records in `$.state` rather than replacing them with an older stored copy.

### Notes about such sub sessions

- `checkLine` is removed. `choiceFor` answers `keep`, `noted` or `pass`,
  plus the ids to record. While the role is on, those are the turn-end ids
  no pairing holds; while it is off, the ids in the unwatched list.
- A prompt made only of turn-end notes, each tracked or recorded, is kept:
  `keptLine` names a recorded one by its bare id, and the existing
  `quietLine` path answers "Noted.". That path does not read the role.
- A prompt with other parts gets `NOTED`. While the role is off, `NOTED` is
  attached only when a note was recorded, and without the `FOREMAN_REPORTS`
  sentence, which is untrue while off.
- The `prompt.submit` hook writes `withNote` for every recorded id in one
  `writeTickets` update before it calls `next`, then calls `ensureChecks`.

### The header

One real answer was read on 2026-10-31. A session that is not in a turn
answers `Session "<title>" (idle) — showing 1 of N messages`, then a paging
line, the untrusted-data warning and "(no messages)" for a limit of 1. A
session id that does not exist answers a tool error, "Session … not found.",
which `answerOf` reports as refused. No session in a turn was available to
read, so the word for that state was not observed.

- Only the exact state `idle` counts as idle. Any other state word the header
  pattern reads counts as inside a turn, as spec point 8 says, so the record
  is rescheduled.
- A first line that is not a `Session "…" (…)` header is unreadable. A
  tool error, including not found, is a failed read. Titles are never
  compared, logged, notified or woken with; only the checked id and fixed
  reason words are.

## Grafts from the runners-up

- **The report shares the chips' row** (smallest and extensible plans). The
  robust plan drew a second band row. Spec point 4 and its narrow-band test
  only make sense if the chips and the report compete for one width, and no
  band in the repository draws a second row.
- **The claimed due and note times are the claim** (adapted from the smallest
  plan). The robust plan added a random claim token. The claimed times do
  the same job, and the thirty-second `within` limit means the lease of one
  idle period cannot run out while a check is in flight.
- **A pure `checks.ts` with `checkOutcome`** (extensible plan). Tests drive
  the record rules without the engine, and `register.tsx` only carries out
  the effect it is told.
- **Read a real header first** (extensible plan), recorded above.

## Rejected alternatives

- **Waking directly from the check** (smallest and extensible plans): a reload
  between dropping the record and the wake loses the wake, and the outbox
  already exists to prevent that.
- **Leaving `turnRuns` kept only while the role is on**: a still-waits wake
  while off could append to a turn that is not running.
- **A typed channel table for every reason kind** (extensible plan): the
  spec moves exactly five kinds and asks for no further channel, so a set is
  enough.
- **A random claim token** (robust plan): a new stored field the claimed
  times already replace.
- **Treating an unknown state word as unreadable** (the judge's suggestion):
  the in-turn word was not observed, so this would raise a false
  notification for every sub session caught in a turn. The spec says a
  state that is not idle is inside a turn.
- **Comparing the header's title with the note**: a rename would break it,
  and the title is the sub session's own text.

## Steps

1. Ledger and types: `ForemanCheck`, `checks` on the ledger, `reports` on
   the outbox, the `report` state atom, `checksIn`, the outbox parser and
   `hasWork`, and the `session.start` emptiness check, with their tests.
2. `checks.ts` pure functions, with their tests.
3. The `list_events` fixture in `tests/world.ts` (a header text, an error,
   not connected, garbage or a hang per session) and `readHeader`, with its
   tests.
4. The report split in `wake.ts` and `decideNow`, `showReports` in
   `carryOut`, the began sentence, and the band, with their tests.
5. `choiceFor` and the `prompt.submit` hook, with their tests.
6. `runDueChecks`, `ensureChecks`, scheduling, and the `turnRuns` change,
   with the engine tests.
7. The wake skill and the README, as spec points 11 and 12 say.
8. All the gates.

## Test plan

Every test is written before the code it covers and seen to fail.

- **Reports wake nobody.** For opened, verdicts, merged, closed and a begin
  that went: no prompt and no append, exactly one notification titled
  "foreman" holding the sentence, and the sentence in the log. Two
  milestones in one read give one notification holding both, and the band
  shows the newer.
- **A milestone and an idle sub session** wake with the idle sentence only,
  checked as the exact line.
- **The band** shows the newest report at nine minutes and fifty-nine
  seconds and not at ten minutes and one second, and a newer report replaces
  an older one and restarts the ten minutes.
- **A narrow band** keeps every chip's full text, and the report is cut or
  absent.
- **A note about a sub session foreman holds no record of**, with the role
  on and with it off: no wake, the reply is "Noted.", and the stored record's
  due time is the note time plus five minutes, or plus a custom idle time.
- **The nudge cycle**: an idle header nudges once with `what's next?`; the
  first note after it keeps the mark; the next idle header gives exactly one
  still-waits wake and drops the record; a second note after the nudge
  clears the mark instead. The pure `withNote` table is tested too.
- **A header that is not idle** reschedules with nothing sent and no prompt.
- **Failures**: an archived header gives a log line, no notification, and the
  record dropped. An error, not connected, garbage, a hang (the clock moved
  thirty seconds) and a refused nudge each give one notification naming the
  id, a log line, the record dropped, and no wake.
- **Timers**: while off, no timer exists with no records and exactly one
  `list_events` call is made at the due time. After the role turns on, the
  read loop makes the call and the off timer is gone, with one call per due
  record. A note that arrives while the call is in flight throws its outcome
  away. A ledger holding only check records survives `session.start` after a
  hot reload and re-arms the timer.
- **A wake while off** submits a prompt when no turn runs and appends when
  one does.
- **Robustness**: garbage entries in `checksIn`, a pairing that takes over a
  recorded id drops the record, and the REASON_WORDS pins in
  `tests/wake.test.ts` cover the began and still-waits sentences.
- **The gates** in the project's `CLAUDE.md`. They do not read the wake skill
  or the README.
