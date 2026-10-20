# Plan: foreman acts on what it reads

Written 2026-10-20 for `docs/specs/foreman-acts.md`, from a tournament of
three plans: the simplest change, the most robust, and the most extensible.
A judge compared them against the spec. The most robust plan won, because it
was the only one that found two places where the spec's first wording would
have failed in use. Both are now amendments to the spec: idle nudges are
counted over a stretch without progress, and a missing status folder frees
nothing. The judge's third ruling, that the slot-free line says how many
slots are free, is an amendment too.

## Chosen approach

Every decision foreman makes is computed by pure functions over one value,
the ledger of tickets, and the rows of the last read. The engine calls live
only in `hooks/register.tsx`.

1. **One ledger.** A new atom, `tickets`, mirrored in the store under
   `tickets:<parent session id>`, holds every pairing and what foreman has
   already done for it. A pairing keeps its identity (the ticket, the
   `local_…` id, the owner's engine session id and file, its standing, and
   the forks already logged) apart from its action memory (the episode, the
   idle stretch, and the marks for the notification, the cleanup wake and the
   gone wake).
2. **Decide inside the update, act after it.** Each read joins records to
   pairings, then runs `decide` inside the `update` of the ledger, keeping the
   output of the run that landed. Its output lists the effects (nudges and
   notifications), the wake reasons, the log lines and the earliest time a
   rule next falls due. Because the decision is recorded before any effect
   runs, a second writer, such as a button press during a read or the copy of
   the module left by a hot reload, cannot claim the same nudge or wake.
3. **Effects do not hold the read.** `list_sessions` runs inside the read,
   since the decision needs it, and gives up after 30 seconds. Nudges,
   notifications and the wake run after the next read is scheduled, are not
   awaited by the read, and also give up after 30 seconds, so a desktop tool
   that never answers cannot stop the reads.
4. **Reads land on time.** The next read comes at whichever is sooner, the
   usual delay or the moment the next nudge or wake falls due, and never
   sooner than one second.
5. **Tables typed over every state.** The per-state rules are a
   `Record<BuildState, …>`, so a state builder adds fails foreman's type check
   until it has a rule. The wake sentences are one table, `REASON_WORDS`,
   pinned by a test and listed in the README, because the next step's skill
   is written against them.

## Grafts from the runners-up

- From the extensible plan: the scheduling of the next read at the next due
  time, the state rules and wake sentences as tables typed over every kind,
  and the split of a pairing into identity and action memory.
- From the simplest plan and the extensible plan: the turn flag kept in an
  atom, so it survives a hot reload. From the robust plan: only the main
  loop's `turn.start` and `turn.complete` move it, because a subagent's turn
  raises both too.
- From the simplest plan: one stretch of the gone wake is one unchanged file
  modification time.

## Rejected, with reasons

- The literal idle episode of the simplest and extensible plans. A nudge that
  works starts a new idle episode, so the count would reset for ever and the
  parent would never wake for a sub session that answers "nothing to do".
- Reading a missing folder as no files for the slot rules, from the simplest
  plan. It would free every slot at once while the sub sessions still run.
- Awaiting the effects inside the read, from the simplest plan, because one
  tool that never answers would stop every later read.
- The robust plan's guard that skips the gone check on the first read after a
  long gap. The gone rule already needs `list_sessions` to say the session is
  not running, which is what keeps a parent that slept from waking falsely.
- The robust plan's hand-written comparator for issue keys.
  `Intl.Collator('en', { numeric: true })` meets the rule with less code.
- The robust plan's pairing written as `starting` before `start_session`
  runs. The gap between the call returning and the pairing being written has
  no await that can be interrupted by a reload except the write itself, and a
  pairing with a null id is adopted by its first record anyway.
- The robust plan's serialized chain of store writes is kept in a simpler
  form: each write to the store sends the ledger as `$.state` holds it when
  the write runs, so the last write always carries the newest value.

## Files

- `hooks/record.ts`: imports `BuildStatus`, `BuildStage` and `BuildState`
  from `'builder'` with `import type`, derives `SubRecord` with `Omit`, and
  checks `STATES` against `BuildState` in both directions.
- `hooks/tickets.ts` (new, pure): the ticket and the brief (`briefFor`, with
  the fork refusal first), the `local_…` id in a result, the tolerant reader
  `ticketsIn`, the owner rule `joinOwners`, and `shownRows` for the filter.
- `hooks/act.ts` (new, pure): the episode and the idle stretch, the state
  rules, the leaving rule, the gone rule, whether the session list is needed,
  slot freeing, and `decide`.
- `hooks/wake.ts` (new, pure): `quoted`, `whoOf`, `REASON_WORDS`, the slot
  words, and `wakeLine`.
- `hooks/desktop.ts`: `sendMessage` and `listSessions`, through the existing
  `answerOf`.
- `hooks/subs.ts`: numeric key order, and released rows left out of the busy
  count.
- `hooks/pane.tsx`: the released row, the band without released rows, and
  the repeat count on a folded log line.
- `hooks/register.tsx`: the `tickets` and `turnRuns` atoms, `writeTickets`,
  the `tool.call` hook, the turn hooks, the read pipeline, Nudge, Release,
  resume, the slow retry of rule 23, and the folding of a repeated log line.
- `types/index.d.ts`: the ledger's types and the two new keys.
- `.claude-plugin/plugin.json`: the `idleMinutes` and `cleanupMinutes`
  options, the description, and version 0.2.0.
- `README.md`: tickets and the fork refusal, what foreman does in each state,
  slots, Release, Nudge and pause, the wake sentences, the options, and the
  limits in a managed organization and in a terminal.
- `docs/specs/builder-status-file.md`: the verification line for the desktop
  app's own permission card.

## Steps

1. Import the record's types from builder and rename the reader's type.
2. Write the pure modules with their tests, each test seen failing first.
3. Wire `register.tsx`, the types and the pane, and move the existing tests'
   fixtures onto paired tickets: putting a file in the test folder also
   records an active pairing for its ticket in the test store.
4. Write the engine tests in `tests/acts.test.ts`.
5. The README, the manifest and the builder spec line.
6. Run the four gates for both mods.

## Test plan

Pure tests, in `tests/tickets.test.ts`, `tests/act.test.ts` and
`tests/wake.test.ts`, cover each rule's branches. Engine tests, in
`tests/acts.test.ts`, follow the spec's Verification list, one test per item:
the ticket added to `start_session` and the `local_…` id recorded; the fork
refused; the filter and the owner rule with a fork's file left out and logged
once; two nudges at one and two thresholds, the wake at three and no third
nudge, also when the sub session takes a short turn after a nudge; a failed
nudge counted; needs-you notifying once and never waking; the cleanup wake by
time and by failed calls; slot freeing for done, for a file that leaves and
for Release, with one slot-free wake, none while paused and one at resume; a
missing folder freeing nothing; the gone wake once per stretch; several
reasons joined into one line; `prompt.submit` when no turn runs and
`session.append` during one; no repeat after a reload; and the quoting of
record text. The existing tests keep passing with their fixtures moved onto
paired tickets, and `tests/subs.test.ts` gains the numeric order.
